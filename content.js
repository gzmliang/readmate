// ReadMate / 读伴 — Content Script
// 浮动朗读条、Web Speech API TTS、高亮、翻译
// 调试日志：点击浮动条上的显示/隐藏日志按钮

// ====== 调试日志 ======
const DebugLog = {
  logs: [],
  add(msg) {
    const t = new Date().toLocaleTimeString();
    this.logs.push(`[${t}] ${msg}`);
    if (this.logs.length > 200) this.logs.splice(0, 50);
    console.log('[ReadMate]', msg);
  },
  copy() {
    const text = this.logs.join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
    return text;
  },
  getHTML() {
    return this.logs.map(l => `<div>${l}</div>`).join('');
  }
};

DebugLog.add('Content script loaded');

let settings = {};
let floatingBar = null;
let isPlaying = false;
let isPaused = false;
let currentUtterance = null;
let currentSentences = [];
let currentSentenceIndex = 0;
let currentMode = null;
let selectionText = '';

// ====== 初始化 ======
function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (s) => {
      settings = s;
      DebugLog.add('Settings loaded: engine=' + s.ttsEngine + ' edgeVoice=' + (s.edgeTtsVoice || 'default') + ' ai=' + (s.aiEndpoint ? '✓' : '✗') + ' aiKey=' + (s.aiApiKey ? '***' : 'empty'));
      resolve(s);
    });
  });
}

// ====== Web Speech（直接调用）=====
async function speakWithWebSpeech(text, onSentenceChange) {
  DebugLog.add('speakWithWebSpeech: text length=' + text.length);

  const sentences = text
    .split(/(?<=[.!?。！？；;])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length === 0) {
    DebugLog.add('No sentences to speak');
    return;
  }

  DebugLog.add('Sentences: ' + sentences.length);
  currentSentences = sentences;
  currentSentenceIndex = 0;
  isPlaying = true;
  isPaused = false;

  if (!window.speechSynthesis) {
    DebugLog.add('ERROR: speechSynthesis not available');
    return;
  }

  for (let i = 0; i < sentences.length; i++) {
    if (!isPlaying) { DebugLog.add('Stopped at sentence ' + i); break; }
    if (isPaused) {
      await new Promise(r => setTimeout(r, 200));
      i--;
      continue;
    }

    currentSentenceIndex = i;
    highlightSentence(i);
    onSentenceChange?.(i, sentences.length, sentences[i]);
    updateBarProgress(i + 1, sentences.length);

    DebugLog.add('Speaking sentence ' + (i + 1) + '/' + sentences.length + ': "' + sentences[i].substring(0, 40) + '..."');

    await speakSentence(sentences[i]);

    if (!isPlaying) break;

    if (settings.autoTranslate && i + 1 < sentences.length) {
      translateText(sentences[i + 1]).then(t => {
        if (t) showInlineTranslation(i + 1, t);
      });
    }
  }

  isPlaying = false;
  hideBar();
  DebugLog.add('speakWithWebSpeech done');
}

function speakSentence(text) {
  return new Promise((resolve) => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      currentUtterance = utterance;

      utterance.rate = settings.ttsSpeed || 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // 设置语音
      if (settings.ttsVoice) {
        const voices = window.speechSynthesis.getVoices();
        const matched = voices.find(v => v.name === settings.ttsVoice);
        if (matched) {
          utterance.voice = matched;
          DebugLog.add('Voice set: ' + settings.ttsVoice);
        }
      }

      // 超时兜底
      const timeout = setTimeout(() => {
        DebugLog.add('Speech timeout after 30s, skipping');
        window.speechSynthesis.cancel();
        resolve();
      }, 30000);

      utterance.onstart = () => {
        DebugLog.add('Utterance started');
      };

      utterance.onend = () => {
        clearTimeout(timeout);
        DebugLog.add('Utterance ended OK');
        resolve();
      };

      utterance.onerror = (e) => {
        clearTimeout(timeout);
        DebugLog.add('Utterance ERROR: ' + (e.error || 'unknown'));
        resolve();
      };

      window.speechSynthesis.speak(utterance);
      DebugLog.add('speak() called');
    } catch (e) {
      DebugLog.add('speakSentence exception: ' + e.message);
      resolve();
    }
  });
}

// ====== Edge TTS（HTTP 请求）=====
async function speakWithEdgeTTS(text, onSentenceChange) {
  const endpoint = (settings.edgeTtsEndpoint || 'http://192.168.199.159:5001').replace(/\/+$/, '') + '/tts';
  DebugLog.add('speakWithEdgeTTS: endpoint=' + endpoint + ' voice=' + (settings.edgeTtsVoice || 'default'));

  const sentences = text.split(/(?<=[.!?。！？；;])\s*/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length === 0) { DebugLog.add('No sentences for Edge TTS'); return; }
  currentSentences = sentences;
  currentSentenceIndex = 0;
  isPlaying = true;
  isPaused = false;

  // 预取缓存：提前 fetch 后面几句的音频
  const audioCache = []; // { url, blob }
  let prefetchUpTo = 0;

  async function ensurePrefetched(upToIndex) {
    for (let i = Math.max(prefetchUpTo, currentSentenceIndex + 1); i <= upToIndex && i < sentences.length; i++) {
      if (audioCache[i]) continue;
      const s = sentences[i];
      if (!s || s.trim().length < 2) { audioCache[i] = { url: null }; continue; }
      DebugLog.add('Prefetching sentence ' + (i + 1) + ': "' + s.substring(0, 20) + '..."');
      proxyFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: s,
          voice: settings.edgeTtsVoice || 'zh-CN-XiaoxiaoNeural',
          rate: `+${Math.round((settings.ttsSpeed - 1) * 100)}%`,
        }),
      }).then(blob => {
        audioCache[i] = { url: URL.createObjectURL(blob), blob };
        DebugLog.add('Prefetched ' + (i + 1) + ': ' + blob.size + ' bytes');
      }).catch(e => {
        DebugLog.add('Prefetch error ' + (i + 1) + ': ' + e.message);
        audioCache[i] = { url: null };
      });
    }
    prefetchUpTo = Math.max(prefetchUpTo, upToIndex);
  }

  // 提前预取前10句
  await ensurePrefetched(Math.min(9, sentences.length - 1));

  while (isPlaying && currentSentenceIndex < sentences.length) {
    if (isPaused) { await new Promise(r => setTimeout(r, 200)); continue; }

    const i = currentSentenceIndex;
    const sentence = sentences[i];
    highlightSentence(i);
    onSentenceChange?.(i, sentences.length, sentence);
    updateBarProgress(i + 1, sentences.length);

    try {
      let audioUrl;
      // 如果已预取到，直接用；否则等 fetch
      if (audioCache[i]?.url) {
        audioUrl = audioCache[i].url;
        DebugLog.add('Using prefetched audio for sentence ' + (i + 1));
      } else {
        DebugLog.add('Fetching sentence ' + (i + 1) + ': "' + sentence.substring(0, 30) + '..."');
        const blob = await proxyFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: sentence,
            voice: settings.edgeTtsVoice || 'zh-CN-XiaoxiaoNeural',
            rate: `+${Math.round((settings.ttsSpeed - 1) * 100)}%`,
          }),
        });
        audioUrl = URL.createObjectURL(blob);
        DebugLog.add('Fetched ' + (i + 1) + ': ' + blob.size + ' bytes');
      }

      const audio = new Audio(audioUrl);

      // 在播放当前句的同时预取后面10句
      ensurePrefetched(i + 10);

      await new Promise((resolve, reject) => {
        audio.onended = () => { DebugLog.add('Sentence ' + (i + 1) + ' ended'); resolve(); };
        audio.onerror = (e) => { DebugLog.add('Audio error on ' + (i + 1)); reject(e); };
        audio.play().catch(reject);
      });

      URL.revokeObjectURL(audioUrl);
      delete audioCache[i];
    } catch (e) {
      DebugLog.add('Edge TTS error: ' + e.message);
    }

    currentSentenceIndex++;
    if (settings.autoTranslate && currentSentenceIndex < sentences.length) {
      translateText(sentences[currentSentenceIndex]).then(t => {
        showInlineTranslation(currentSentenceIndex, t);
      });
    }
  }

  // 清理缓存
  for (const key in audioCache) {
    if (audioCache[key]?.url) URL.revokeObjectURL(audioCache[key].url);
  }

  isPlaying = false;
  hideBar();
  DebugLog.add('speakWithEdgeTTS done');
}

// ====== Custom TTS ======
async function speakWithCustomTTS(text, onSentenceChange) {
  if (!settings.customTtsEndpoint) {
    DebugLog.add('Custom TTS: no endpoint configured');
    return;
  }
  const endpoint = settings.customTtsEndpoint.replace(/\/+$/, '') + '/audio/speech';
  DebugLog.add('speakWithCustomTTS');

  const sentences = text.split(/(?<=[.!?。！？；;])\s*/).map(s => s.trim()).filter(s => s.length > 0);
  currentSentences = sentences;
  currentSentenceIndex = 0;
  isPlaying = true;
  isPaused = false;

  while (isPlaying && currentSentenceIndex < sentences.length) {
    if (isPaused) { await new Promise(r => setTimeout(r, 200)); continue; }

    const sentence = sentences[currentSentenceIndex];
    highlightSentence(currentSentenceIndex);
    onSentenceChange?.(currentSentenceIndex, sentences.length, sentence);
    updateBarProgress(currentSentenceIndex + 1, sentences.length);

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.customTtsApiKey || 'dummy'}`,
        },
        body: JSON.stringify({
          model: settings.customTtsModel || 'tts-1',
          input: sentence, voice: settings.customTtsVoice || 'alloy',
          response_format: 'mp3',
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const audioBlob = await resp.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      });
      URL.revokeObjectURL(audioUrl);
    } catch (e) {
      console.error('[ReadMate] Custom TTS error:', e);
    }
    currentSentenceIndex++;
    if (settings.autoTranslate && currentSentenceIndex < sentences.length) {
      translateText(sentences[currentSentenceIndex]).then(t => {
        showInlineTranslation(currentSentenceIndex, t);
      });
    }
  }
  isPlaying = false;
  hideBar();
}

// ====== 后台代理 fetch（解决 HTTPS 页面无法 fetch HTTP 的问题）======
let _proxyReqId = 0;
function proxyFetch(url, options) {
  const requestId = 'req_' + (++_proxyReqId);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'proxyFetch', url, options, requestId }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp.ok) {
        reject(new Error(resp.error || 'proxy fetch failed'));
        return;
      }
      // 从 chrome.storage.local 读取音频数据（避免消息传递体积限制）
      chrome.storage.local.get(resp.storageKey, (items) => {
        const stored = items[resp.storageKey];
        if (!stored || !stored.bytes) {
          reject(new Error('Audio data not found in storage'));
          return;
        }
        const blob = new Blob([new Uint8Array(stored.bytes)], { type: stored.contentType || 'audio/mpeg' });
        DebugLog.add('Proxy fetch returned: ' + stored.byteLength + ' bytes');
        // 清理存储
        chrome.storage.local.remove(resp.storageKey, () => {});
        resolve(blob);
      });
    });
  });
}

function proxyTranslate(text) {
  return new Promise((resolve) => {
    if (!settings.aiEndpoint || !settings.aiApiKey) {
      DebugLog.add('Translate skipped: no AI config (ep=' + (settings.aiEndpoint||'') + ' key=' + (settings.aiApiKey ? '***' : 'empty') + ')');
      resolve(null);
      return;
    }
    chrome.runtime.sendMessage({
      action: 'proxyTranslate',
      endpoint: settings.aiEndpoint.replace(/\/+$/, '') + '/chat/completions',
      apiKey: settings.aiApiKey,
      model: settings.aiModel || 'gpt-3.5-turbo',
      text,
      targetLang: settings.translateTarget || 'Simplified Chinese',
    }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        DebugLog.add('Translate proxy error: ' + (chrome.runtime.lastError?.message || resp?.error || 'unknown'));
        resolve(null);
        return;
      }
      DebugLog.add('Translate OK: "' + (resp.text || '').substring(0, 40) + '..."');
      resolve(resp.text);
    });
  });
}
async function translateText(text) {
  return proxyTranslate(text);
}

// ====== UI：浮动朗读条 ======
function createFloatingBar() {
  if (floatingBar) return;
  DebugLog.add('Creating floating bar');

  floatingBar = document.createElement('div');
  floatingBar.id = 'readmate-bar';
  floatingBar.innerHTML = `
    <div class="readmate-bar-inner">
      <div class="readmate-bar-left">
        <span class="readmate-progress">0/0</span>
      </div>
      <div class="readmate-bar-center">
        <button class="readmate-btn" id="readmate-play-btn" title="播放/暂停">⏸</button>
        <button class="readmate-btn" id="readmate-stop-btn" title="停止">⏹</button>
      </div>
      <div class="readmate-bar-right">
        <button class="readmate-btn" id="readmate-translate-btn" title="翻译当前句">🌐</button>
        <button class="readmate-btn" id="readmate-close-btn" title="关闭">✕</button>
        <button class="readmate-btn" id="readmate-debug-btn" title="调试日志">🐛</button>
      </div>
    </div>
    <div class="readmate-current-text"></div>
    <div id="readmate-debug-panel" style="display:none;max-height:200px;overflow:auto;padding:8px 12px;font-size:11px;font-family:monospace;border-top:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.2);color:#aaa;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>调试日志</span>
        <span id="readmate-debug-count" style="cursor:pointer" title="复制日志">0 条</span>
      </div>
      <div id="readmate-debug-body"></div>
    </div>
  `;
  document.body.appendChild(floatingBar);

  floatingBar.querySelector('#readmate-play-btn').onclick = togglePlayPause;
  floatingBar.querySelector('#readmate-stop-btn').onclick = stopReading;
  floatingBar.querySelector('#readmate-close-btn').onclick = stopReading;
  floatingBar.querySelector('#readmate-translate-btn').onclick = (e) => {
    // 捕获鼠标点击位置
    window._readmateMouseX = e.clientX;
    window._readmateMouseY = e.clientY;
    translateCurrentSentence();
  };
  floatingBar.querySelector('#readmate-debug-btn').onclick = toggleDebugPanel;
  document.getElementById('readmate-debug-count')?.addEventListener('click', copyDebugLogs);

  makeDraggable(floatingBar);
  DebugLog.add('Floating bar created');
}

function toggleDebugPanel() {
  const panel = document.getElementById('readmate-debug-panel');
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'block') refreshDebugPanel();
  }
}

function refreshDebugPanel() {
  const body = document.getElementById('readmate-debug-body');
  const count = document.getElementById('readmate-debug-count');
  if (body) body.innerHTML = DebugLog.getHTML();
  if (count) count.textContent = DebugLog.logs.length + ' 条 (点击复制)';
}

function copyDebugLogs() {
  const text = DebugLog.copy();
  const count = document.getElementById('readmate-debug-count');
  if (count) count.textContent = '已复制! ' + DebugLog.logs.length + ' 条';
  setTimeout(() => {
    if (count) count.textContent = DebugLog.logs.length + ' 条 (点击复制)';
  }, 2000);
}

// 定时刷新调试面板
let debugTimer = null;
function startDebugTimer() {
  stopDebugTimer();
  debugTimer = setInterval(refreshDebugPanel, 500);
}
function stopDebugTimer() {
  if (debugTimer) { clearInterval(debugTimer); debugTimer = null; }
}

function showBar() {
  if (!floatingBar) createFloatingBar();
  floatingBar.classList.add('readmate-active');
  startDebugTimer();
  refreshDebugPanel();
}

function hideBar() {
  stopDebugTimer();
  if (floatingBar) {
    floatingBar.classList.remove('readmate-active');
    floatingBar.querySelector('.readmate-current-text').textContent = '';
  }
  clearHighlights();
  currentSentences = [];
  currentSentenceIndex = 0;
}

function updateBarProgress(current, total) {
  const el = floatingBar?.querySelector('.readmate-progress');
  if (el) el.textContent = `${current}/${total}`;
}

function updateCurrentText(text) {
  const el = floatingBar?.querySelector('.readmate-current-text');
  if (el) el.textContent = text;
}

// ====== 播放控制 ======
function togglePlayPause() {
  if (isPaused) {
    isPaused = false;
    floatingBar.querySelector('#readmate-play-btn').textContent = '⏸';
    window.speechSynthesis.resume();
    DebugLog.add('Resumed');
  } else if (isPlaying) {
    isPaused = true;
    floatingBar.querySelector('#readmate-play-btn').textContent = '▶';
    window.speechSynthesis.pause();
    DebugLog.add('Paused');
  }
}

function stopReading() {
  isPlaying = false;
  isPaused = false;
  window.speechSynthesis.cancel();
  hideBar();
  DebugLog.add('Stopped');
}

// ====== 句子高亮 ======
let highlightSpans = [];

function highlightSentence(index) {
  clearHighlights();
  if (!settings.highlightEnabled) return;
  const sentence = currentSentences[index];
  if (!sentence) return;

  const textNodes = getTextNodesInBody();
  const fullText = textNodes.map(n => n.textContent).join('');

  let searchText = sentence.trim();
  if (searchText.length > 30) searchText = searchText.substring(0, 30);

  const startIdx = fullText.indexOf(searchText);
  if (startIdx < 0) { DebugLog.add('Highlight: text not found'); return; }

  const endIdx = startIdx + searchText.length;
  let charCount = 0;
  for (const node of textNodes) {
    const nodeLen = node.textContent.length;
    const nodeStart = charCount;
    const nodeEnd = charCount + nodeLen;

    if (nodeEnd > startIdx && nodeStart < endIdx) {
      const range = document.createRange();
      const rangeStart = Math.max(0, startIdx - nodeStart);
      const rangeEnd = Math.min(nodeLen, endIdx - nodeStart);
      try {
        range.setStart(node, rangeStart);
        range.setEnd(node, rangeEnd);
        const span = document.createElement('span');
        span.className = 'readmate-highlight';
        range.surroundContents(span);
        highlightSpans.push(span);
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {}
    }
    charCount += nodeLen;
    if (charCount >= endIdx) break;
  }
}

function clearHighlights() {
  for (const span of highlightSpans) {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
  }
  highlightSpans = [];
}

function getTextNodesInBody() {
  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentNode;
        if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' ||
            parent.tagName === 'NOSCRIPT' || parent.id === 'readmate-bar')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

function showTranslation(text, isInfo, posX, posY) {
  let panel = document.getElementById('readmate-translation-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'readmate-translation-panel';
    panel.innerHTML = '<span id="readmate-translation-text" style="flex:1"></span><button id="readmate-translation-close" style="flex-shrink:0;margin-left:8px;background:none;border:none;color:#8b8b9e;cursor:pointer;font-size:14px;line-height:1;padding:0">✕</button>';
    document.body.appendChild(panel);
    
    // 点击✕关闭
    document.getElementById('readmate-translation-close').onclick = () => {
      panel.style.display = 'none';
    };
    
    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (panel.style.display !== 'none' && !panel.contains(e.target) && e.target.closest('#readmate-translate-btn') === null) {
        panel.style.display = 'none';
      }
    });

    // 拖拽功能
    let isDragging = false, startX, startY, origLeft, origTop;
    const onMouseDown = (e) => {
      if (e.target.id === 'readmate-translation-close') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = panel.offsetLeft;
      origTop = panel.offsetTop;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      panel.style.left = (origLeft + e.clientX - startX) + 'px';
      panel.style.top = (origTop + e.clientY - startY) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    panel.addEventListener('mousedown', onMouseDown);
  }

  document.getElementById('readmate-translation-text').textContent = text;
  panel.classList.toggle('readmate-translation-info', !!isInfo);
  panel.style.display = 'flex';
  panel.style.alignItems = 'flex-start';
  panel.style.gap = '4px';

  // 定位
  if (posX !== undefined && posY !== undefined) {
    // 需要先显示才能量尺寸
    const w = panel.offsetWidth || 300;
    const h = panel.offsetHeight || 60;
    let x = Math.max(10, Math.min(posX, window.innerWidth - w - 10));
    let y = posY - h - 10;
    if (y < 10) y = Math.min(posY + 20, window.innerHeight - h - 10);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    DebugLog.add('Panel position: (' + x + ', ' + y + ')');
  } else {
    // 默认：显示在屏幕中央偏下
    panel.style.left = 'auto';
    panel.style.right = '20px';
    panel.style.bottom = '80px';
    panel.style.top = 'auto';
    DebugLog.add('Panel position: default bottom-right');
  }

  // 信息类提示 2 秒自消，翻译结果不自动隐藏
  if (isInfo) {
    clearTimeout(panel._infoTimer);
    panel._infoTimer = setTimeout(() => { panel.style.display = 'none'; }, 2000);
  }
}

function showInlineTranslation(sentenceIndex, translation, posX, posY) {
  if (!translation) return;
  showTranslation(translation, false, posX, posY);
}

async function translateCurrentSentence() {
  const text = currentSentences[currentSentenceIndex];
  if (!text) { DebugLog.add('Translate: no current sentence'); return; }
  
  // 使用鼠标点击位置（优先）或浮动条按钮位置
  let posX = window._readmateMouseX;
  let posY = window._readmateMouseY;
  if (posX === undefined) {
    const btn = document.getElementById('readmate-translate-btn');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      posX = rect.left;
      posY = rect.top;
    }
  }
  DebugLog.add('Translate pos: (' + posX + ', ' + posY + ')');

  if (!settings.aiEndpoint || !settings.aiApiKey) {
    showTranslation('⚠️ 请先在设置中配置 AI 翻译（端点 + API Key）', true, posX, posY);
    DebugLog.add('Translate: no AI config');
    return;
  }
  const translation = await translateText(text);
  if (translation) {
    showTranslation(translation, false, posX, posY);
  } else {
    showTranslation('⚠️ 翻译失败，请检查 API 配置', true, posX, posY);
  }
}

// ====== 拖拽 ======
function makeDraggable(el) {
  let isDragging = false, startX, startY, origX, origY;
  const header = el.querySelector('.readmate-bar-inner');

  header.onmousedown = (e) => {
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    origX = el.offsetLeft; origY = el.offsetTop;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  };

  function onMouseMove(e) {
    if (!isDragging) return;
    el.style.left = (origX + e.clientX - startX) + 'px';
    el.style.top = (origY + e.clientY - startY) + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

// ====== 消息处理 ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  DebugLog.add('Message received: ' + msg.action);
  switch (msg.action) {
    case 'readSelection':
      loadSettings().then(() => {
        selectionText = msg.text || '';
        currentMode = 'selection';
        DebugLog.add('readSelection: text length=' + selectionText.length);
        startReading(selectionText);
      });
      break;
    case 'readPage':
      loadSettings().then(() => {
        const bodyText = document.body.innerText;
        currentMode = 'page';
        DebugLog.add('readPage: text length=' + bodyText.length);
        startReading(bodyText);
      });
      break;
    case 'translateSelection':
      loadSettings().then(() => {
        if (msg.text) {
          // 使用选中文本的位置
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            window._readmateMouseX = rect.left;
            window._readmateMouseY = rect.top;
          }
          translateText(msg.text).then(t => {
            if (t) showInlineTranslation(0, t, window._readmateMouseX, window._readmateMouseY);
          });
        }
      });
      break;
    case 'stop':
      stopReading();
      break;
  }
});

// ====== 主朗读入口 ======
async function startReading(text) {
  if (!text || !text.trim()) { DebugLog.add('startReading: empty text'); return; }
  DebugLog.add('== startReading == engine=' + settings.ttsEngine);

  stopReading();
  await new Promise(r => setTimeout(r, 100));

  showBar();
  floatingBar.querySelector('#readmate-play-btn').textContent = '⏸';

  console.log('[ReadMate] Starting with engine:', settings.ttsEngine);

  if (settings.ttsEngine === 'web-speech') {
    DebugLog.add('Selected engine: Web Speech');
    await speakWithWebSpeech(text, (idx, total, sentence) => {
      updateCurrentText(sentence);
    });
  } else if (settings.ttsEngine === 'edge-tts') {
    DebugLog.add('Selected engine: Edge TTS');
    await speakWithEdgeTTS(text, (idx, total, sentence) => {
      updateCurrentText(sentence);
    });
  } else if (settings.ttsEngine === 'custom' && settings.customTtsEndpoint) {
    DebugLog.add('Selected engine: Custom TTS');
    await speakWithCustomTTS(text, (idx, total, sentence) => {
      updateCurrentText(sentence);
    });
  } else {
    DebugLog.add('ERROR: Unknown engine: ' + settings.ttsEngine);
  }

  DebugLog.add('== startReading done ==');
}

// ====== 自动检测语言设置 ======
loadSettings().then(() => {
  const htmlLang = document.documentElement.lang || '';
  if (htmlLang.startsWith('zh')) settings.ttsVoiceLang = 'zh-CN';
  else if (htmlLang.startsWith('ja')) settings.ttsVoiceLang = 'ja-JP';
  else settings.ttsVoiceLang = 'en-US';
  DebugLog.add('Page language: ' + htmlLang + ' → voiceLang: ' + settings.ttsVoiceLang);
});
