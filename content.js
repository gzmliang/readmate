// ReadMate / 读伴 — Content Script
// 浮动朗读条、Web Speech TTS、阅读模式（自动去广告）、高亮、翻译、连续朗读
// 调试日志：点击浮动条上的 🐛 按钮

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

// ====== 状态变量 ======
let settings = {};
let floatingBar = null;
let isPlaying = false;
let isPaused = false;
let currentUtterance = null;
let currentSentences = [];
let currentSentenceIndex = 0;
let currentMode = null;
let selectionText = '';
let userStopped = false; // 用户主动停止标记

// ====== 连续朗读（跨页面持久化）======
const CONTINUOUS_KEY = 'readmate_continuous';
let continuousMode = true; // 默认开启

// 页面加载时检测是否需要自动朗读（仅限连续模式跳转过来的页面）
chrome.storage.session.get('readmate_auto_read', (result) => {
  if (result.readmate_auto_read === true) {
    chrome.storage.session.remove('readmate_auto_read');
    DebugLog.add('Auto-read triggered by continuous mode navigation');
    continuousMode = true;
    loadSettings().then(() => {
      autoReadPage();
    });
  } else {
    // 正常打开页面 — 只加载连续模式状态，不自动朗读
    chrome.storage.local.get(CONTINUOUS_KEY, (result) => {
      continuousMode = result[CONTINUOUS_KEY] !== false;
      DebugLog.add('Continuous mode from storage: ' + continuousMode + ' (no auto-read)');
    });
  }
});

/** 持久化连续模式到 storage */
function setContinuousMode(enabled) {
  continuousMode = enabled;
  chrome.storage.local.set({ [CONTINUOUS_KEY]: enabled }, () => {
    DebugLog.add('Continuous mode saved: ' + enabled);
  });
  // 更新按钮状态
  const btn = document.getElementById('readmate-continuous-btn');
  if (btn) {
    btn.style.opacity = enabled ? '1' : '0.4';
    btn.title = enabled ? '连续朗读 (开启)' : '连续朗读 (关闭)';
  }
}

// ====== 选中文字浮动播放按钮 ======
let selectionPlayBtn = null;

// ====== 手机端悬浮朗读按钮 ======
let fabButton = null;

/** 检测是否为移动端（触屏 + 窄屏） */
function isMobile() {
  return ('ontouchstart' in window) || (window.innerWidth < 768);
}

function createFAB() {
  if (fabButton) return;

  fabButton = document.createElement('button');
  fabButton.id = 'readmate-fab';
  fabButton.textContent = '▶';
  fabButton.title = '朗读此页';
  fabButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (isPlaying) return;
    DebugLog.add('FAB clicked');

    // 内容提取：去广告，只读正文
    let pageText;
    const content = extractReadableContent();
    if (content && content.success) {
      pageText = content.text;
      DebugLog.add('FAB extracted: ' + pageText.length + ' chars (title: ' + (content.title || '') + ')');
    } else {
      pageText = document.body.innerText || '';
      DebugLog.add('FAB fallback to body: ' + pageText.length + ' chars');
    }
    if (pageText.trim().length < 50) {
      DebugLog.add('FAB: page too short');
      return;
    }

    hideFAB();

    // 加载设置（带超时，不行就默认值）
    try {
      await Promise.race([
        loadSettings(),
        new Promise(r => setTimeout(() => { DebugLog.add('Settings timeout, using defaults'); r(); }, 2000))
      ]);
    } catch(e) {
      DebugLog.add('Settings error, using defaults: ' + e.message);
    }
    if (!settings || !settings.ttsSpeed) {
      settings = { ttsSpeed: 1.0, ttsVoice: '', ttsEngine: 'browser', cloudTtsEndpoint: '', cloudTtsVoice: '', highlightEnabled: true };
    }

    currentMode = 'page';
    startReading(pageText);
  });

  document.body.appendChild(fabButton);
  DebugLog.add('FAB created (simplified)');

  // 拖拽支持 + 长按打开设置
  let isDragging = false, startX, startY, origX, origY;
  let longPressTimer = null;
  let suppressNextClick = false;

  fabButton.addEventListener('touchstart', (e) => {
    if (isPlaying) return;
    const touch = e.touches[0];
    isDragging = true;
    startX = touch.clientX;
    startY = touch.clientY;
    origX = fabButton.offsetLeft;
    origY = fabButton.offsetTop;
    if (!origX && !origY) {
      const rect = fabButton.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
    }
    // 设置入口：打开选项页（直接URL方式，兼容Kiwi）
    longPressTimer = setTimeout(() => {
      suppressNextClick = true;
      isDragging = false;
      DebugLog.add('FAB long-press: opening settings');
      const optsUrl = chrome.runtime.getURL('options/options.html');
      window.open(optsUrl, '_blank');
    }, 600);
  }, { passive: true });

  fabButton.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startX);
    const dy = Math.abs(touch.clientY - startY);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimer);
    }
    fabButton.style.left = (origX + touch.clientX - startX) + 'px';
    fabButton.style.top = (origY + touch.clientY - startY) + 'px';
    fabButton.style.right = 'auto';
    fabButton.style.bottom = 'auto';
  }, { passive: true });

  fabButton.addEventListener('touchend', () => {
    clearTimeout(longPressTimer);
    isDragging = false;
  }, { passive: true });
}

function showFAB() {
  if (!fabButton) createFAB();
  if (fabButton) {
    fabButton.style.display = 'flex';
    DebugLog.add('FAB shown');
  }
}

function hideFAB() {
  if (fabButton) fabButton.style.display = 'none';
}

function createSelectionPlayBtn() {
  if (selectionPlayBtn) return;
  selectionPlayBtn = document.createElement('div');
  selectionPlayBtn.id = 'readmate-selection-play';

  const playBtn = document.createElement('button');
  playBtn.className = 'readmate-sel-btn readmate-sel-play';
  playBtn.textContent = '▶';
  playBtn.title = '朗读选中文字';
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = window.getSelection().toString().trim();
    if (sel) {
      selectionText = sel;
      currentMode = 'selection';
      hideSelectionPlayBtn();
      loadSettings().then(() => startReading(sel));
    }
  });

  const translateBtn = document.createElement('button');
  translateBtn.className = 'readmate-sel-btn readmate-sel-translate';
  translateBtn.textContent = '🌐';
  translateBtn.title = '翻译选中文字';
  translateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = window.getSelection().toString().trim();
    if (sel) {
      hideSelectionPlayBtn();
      const rect = translateBtn.getBoundingClientRect();
      window._readmateMouseX = rect.left;
      window._readmateMouseY = rect.top;
      loadSettings().then(async () => {
        if (!settings.aiEndpoint || !settings.aiApiKey) {
          showTranslation('⚠️ 请先在设置中配置 AI 翻译（端点 + API Key）', true, rect.left, rect.top);
          DebugLog.add('Selection translate: no AI config');
          return;
        }
        const translation = await translateText(sel);
        if (translation) {
          showTranslation(translation, false, rect.left, rect.top);
        } else {
          showTranslation('⚠️ 翻译失败，请检查 API 配置', true, rect.left, rect.top);
        }
      });
    }
  });

  selectionPlayBtn.appendChild(playBtn);
  selectionPlayBtn.appendChild(translateBtn);
  document.body.appendChild(selectionPlayBtn);
}

function showSelectionPlayBtn(x, y) {
  if (!selectionPlayBtn) createSelectionPlayBtn();
  const btn = selectionPlayBtn;
  btn.style.display = 'flex';
  // 容器宽度约80px(两个36px按钮+gap)，防止超出右边界
  btn.style.left = Math.min(x, window.innerWidth - 90) + 'px';
  btn.style.top = Math.max(5, y) + 'px';
  DebugLog.add('Selection play btn shown at (' + x + ', ' + y + ')');
}

function hideSelectionPlayBtn() {
  if (selectionPlayBtn) selectionPlayBtn.style.display = 'none';
}

// ====== 文字选中弹出播放按钮（支持桌面鼠标+手机触屏）======
document.addEventListener('mouseup', (e) => {
  if (e.target && e.target.closest && e.target.closest('#readmate-selection-play')) return;
  if (e.target && e.target.closest && e.target.closest('#readmate-translation-panel')) return;
  if (e.target && e.target.closest && e.target.closest('#readmate-bar')) return;

  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (text && text.length > 0 && text.length < 5000) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect && rect.width > 0) {
        showSelectionPlayBtn(rect.right + 5, rect.top - 10);
      }
    } else {
      hideSelectionPlayBtn();
    }
  }, 200);
});

document.addEventListener('mousedown', (e) => {
  if (e.target && e.target.closest && !e.target.closest('#readmate-selection-play')) {
    hideSelectionPlayBtn();
  }
});

// 手机端：选中文字后弹出橙色播放按钮
document.addEventListener('touchend', () => {
  // 延迟等待系统选中完成
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (text && text.length > 0 && text.length < 5000) {
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0) {
          showSelectionPlayBtn(rect.right + 5, rect.top - 10);
        }
      } catch(e) {
        // 某些选区可能没有 range
      }
    }
  }, 300);
});

// 点击页面其他地方隐藏橙色按钮（手机适配）
document.addEventListener('touchstart', (e) => {
  if (!e.target || !(e.target.closest && e.target.closest('#readmate-selection-play'))) {
    hideSelectionPlayBtn();
  }
}, { passive: true });

// ====== 初始化 ======
function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (s) => {
      settings = s;
      DebugLog.add('Settings loaded: speed=' + s.ttsSpeed + ' voice=' + (s.ttsVoice || 'auto') + ' ai=' + (s.aiApiKey ? '✓' : '✗'));
      resolve(s);
    });
  });
}

// ====== Web Speech TTS（唯一引擎）=====
async function speakText(text, onSentenceChange) {
  DebugLog.add('speakText: length=' + text.length);

  const sentences = TextUtils.splitSentences(text);
  if (sentences.length === 0) {
    DebugLog.add('No sentences to speak');
    return;
  }
  // === 断句调试日志 ===
  DebugLog.add('=== SPLIT DEBUG ===');
  DebugLog.add('Text preview: "' + text.substring(0, 120) + '..."');
  DebugLog.add('Total sentences: ' + sentences.length);
  sentences.forEach((s, i) => {
    const excerpt = s.length > 80 ? s.substring(0, 80) + '...' : s;
    DebugLog.add('  [' + i + '] (' + s.length + 'c) "' + excerpt + '"');
  });
  DebugLog.add('=== END SPLIT DEBUG ===');

  DebugLog.add('Sentences: ' + sentences.length);
  currentSentences = sentences;
  currentSentenceIndex = 0;
  isPlaying = true;
  isPaused = false;

  if (!window.speechSynthesis) {
    DebugLog.add('ERROR: speechSynthesis not available');
    return;
  }

  // 预构建第一句 utterance（后面的在播放中提前构建）
  let prebuilt = buildUtterance(sentences[0]);

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

    // speak() 是同步返回的，不会阻塞
    const playPromise = speakUtterance(prebuilt);

    // 【预构建】当前句正在播放时，提前准备好下一句的 utterance
    if (i + 1 < sentences.length) {
      prebuilt = buildUtterance(sentences[i + 1]);
    }

    // 等待当前句播完
    await playPromise;

    if (!isPlaying) break;

    if (settings.autoTranslate && i + 1 < sentences.length) {
      translateText(sentences[i + 1]).then(t => {
        if (t) showInlineTranslation(i + 1, t);
      });
    }
  }

  isPlaying = false;
  hideBar();
  DebugLog.add('speakText done');

  // 连续朗读模式：读完找下一篇（用户主动停止的不触发）
  if (continuousMode && currentMode === 'page' && !userStopped) {
    DebugLog.add('Continuous mode: looking for next article...');
    showTranslation('🔁 当前篇读完，寻找下一篇...', true);
    setTimeout(() => {
      findAndNavigateNext();
    }, 1500);
  }
}

// ====== 预构建 Utterance（数字标准化+语音设置，提前准备好）======
function buildUtterance(text) {
  const speechText = NumberNormalizer.needsNormalization(text)
    ? NumberNormalizer.normalize(text)
    : text;
  const utterance = new SpeechSynthesisUtterance(speechText);
  utterance.rate = settings.ttsSpeed || 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  if (settings.ttsVoice) {
    const voices = window.speechSynthesis.getVoices();
    const matched = voices.find(v => v.name === settings.ttsVoice);
    if (matched) {
      utterance.voice = matched;
      utterance.lang = matched.lang;
    }
  }
  return utterance;
}

/** 播放一个已构建好的 Utterance，返回 onend promise */
function speakUtterance(utterance) {
  return new Promise((resolve) => {
    try {
      currentUtterance = utterance;
      let resolved = false;
      function done() { if (!resolved) { resolved = true; resolve(); } }

      utterance.onend = done;
      utterance.onerror = (e) => {
        DebugLog.add('speak error: ' + (e.error || 'unknown'));
        done();
      };

      // 注意：不要在这里调 cancel()！Android Chrome 上 cancel 会干扰下一句
      window.speechSynthesis.speak(utterance);

      // 轮询 fallback：Android 上 onend 不可靠，用 speaking 状态兜底
      let phase = 'wait_start';
      function pollSpeaking() {
        if (resolved) return;
        const s = window.speechSynthesis.speaking;
        if (phase === 'wait_start') {
          if (s) { phase = 'wait_end'; DebugLog.add('speak poll: started'); }
        } else if (phase === 'wait_end') {
          if (!s) { DebugLog.add('speak poll: finished'); setTimeout(done, 100); return; }
        }
        setTimeout(pollSpeaking, 200);
      }
      setTimeout(pollSpeaking, 300);
    } catch (e) {
      DebugLog.add('speakUtterance exception: ' + e.message);
      resolve();
    }
  });
}

// ====== 云端 Edge TTS（通过 background 代理请求）======
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
      chrome.storage.local.get(resp.storageKey, (items) => {
        const stored = items[resp.storageKey];
        if (!stored || !stored.bytes) {
          reject(new Error('Audio data not found'));
          return;
        }
        const blob = new Blob([new Uint8Array(stored.bytes)], { type: 'audio/mpeg' });
        chrome.storage.local.remove(resp.storageKey, () => {});
        resolve(blob);
      });
    });
  });
}

async function speakWithCloudTTS(text, onSentenceChange) {
  const endpoint = (settings.cloudTtsEndpoint || 'http://powerplus.blogsyte.com:5001').replace(/\/+$/, '') + '/tts';
  const bufferSize = settings.ttsBuffer || 1; // 预读句数
  DebugLog.add('Cloud TTS: ' + endpoint + ' voice=' + (settings.cloudTtsVoice || 'default') + ' buffer=' + bufferSize);

  const sentences = TextUtils.splitSentences(text);
  if (sentences.length === 0) return;
  // === 断句调试日志 ===
  DebugLog.add('=== SPLIT DEBUG ===');
  DebugLog.add('Text preview: "' + text.substring(0, 120) + '..."');
  DebugLog.add('Total sentences: ' + sentences.length);
  sentences.forEach((s, i) => {
    const excerpt = s.length > 80 ? s.substring(0, 80) + '...' : s;
    DebugLog.add('  [' + i + '] (' + s.length + 'c) "' + excerpt + '"');
  });
  DebugLog.add('=== END SPLIT DEBUG ===');
  currentSentences = sentences;
  currentSentenceIndex = 0;
  isPlaying = true;
  isPaused = false;

  /** 获取朗读用文本（数字标准化） */
  function getSpeechText(sentence) {
    return NumberNormalizer.needsNormalization(sentence)
      ? NumberNormalizer.normalize(sentence)
      : sentence;
  }

  // 预取缓存：URL对象
  const prefetched = {};

  /** 后台预取一句 */
  function prefetchOne(idx) {
    if (idx >= sentences.length || prefetched[idx]) return;
    DebugLog.add('Cloud TTS prefetch: sentence ' + (idx + 1));
    proxyFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: getSpeechText(sentences[idx]),
        voice: settings.cloudTtsVoice || 'zh-CN-XiaoxiaoNeural',
        rate: `+${Math.round((settings.ttsSpeed - 1) * 100)}%`,
      }),
    }).then(blob => {
      prefetched[idx] = URL.createObjectURL(blob);
      DebugLog.add('Cloud TTS prefetched: sentence ' + (idx + 1));
    }).catch(e => {
      DebugLog.add('Cloud TTS prefetch error: ' + e.message);
    });
  }

  // 先预取第一批
  for (let b = 0; b <= bufferSize && b < sentences.length; b++) {
    prefetchOne(b);
  }

  let i = 0;
  DebugLog.add('Cloud TTS: entering loop, ' + sentences.length + ' sentences');
  while (isPlaying && i < sentences.length) {
    if (isPaused) { await new Promise(r => setTimeout(r, 200)); continue; }
    currentSentenceIndex = i;
    DebugLog.add('Cloud TTS: playing sentence ' + (i + 1));
    highlightSentence(i);
    onSentenceChange?.(i, sentences.length, sentences[i]);
    updateBarProgress(i + 1, sentences.length);

    try {
      // 如果已经预取好了，直接用；否则同步等
      let audioUrl = prefetched[i];
      if (!audioUrl) {
        DebugLog.add('Cloud TTS: buffer miss, fetching sync');
        const fetchPromise = proxyFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: getSpeechText(sentences[i]),
            voice: settings.cloudTtsVoice || 'zh-CN-XiaoxiaoNeural',
            rate: `+${Math.round((settings.ttsSpeed - 1) * 100)}%`,
          }),
        });
        // 15秒超时保护
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TTS request timeout (15s)')), 15000)
        );
        const blob = await Promise.race([fetchPromise, timeoutPromise]);
        audioUrl = URL.createObjectURL(blob);
      }

      // 播放当前句的同时预取后续句
      for (let b = 1; b <= bufferSize; b++) {
        prefetchOne(i + b);
      }

      const audio = new Audio(audioUrl);
      await new Promise((resolve, reject) => {
        audio.onended = () => { DebugLog.add('Cloud TTS sentence ' + (i + 1) + ' done'); resolve(); };
        audio.onerror = (e) => { DebugLog.add('Cloud TTS error: ' + e.message); reject(e); };
        audio.play().catch(reject);
      });
      URL.revokeObjectURL(audioUrl);
      delete prefetched[i];
    } catch (e) {
      DebugLog.add('Cloud TTS error: ' + e.message);
    }
    i++;
  }
  isPlaying = false;
  hideBar();
  DebugLog.add('Cloud TTS done');

  // 清理残留预取
  for (const key in prefetched) {
    URL.revokeObjectURL(prefetched[key]);
  }

  // 连续朗读
  if (continuousMode && currentMode === 'page' && !userStopped) {
    setTimeout(() => { findAndNavigateNext(); }, 1500);
  }
}

// ====== AI 翻译代理 ======
function proxyTranslate(text) {
  return new Promise((resolve) => {
    if (!settings.aiEndpoint || !settings.aiApiKey) {
      DebugLog.add('Translate skipped: no AI config');
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
        <button class="readmate-btn" id="readmate-continuous-btn" title="连续朗读">🔁</button>
        <button class="readmate-btn" id="readmate-translate-btn" title="翻译当前句">🌐</button>
        <button class="readmate-btn" id="readmate-close-btn" title="关闭">✕</button>
        <button class="readmate-btn" id="readmate-debug-btn" title="调试日志">🐛</button>
      </div>
    </div>
    <div class="readmate-current-text"></div>
    <div class="readmate-page-info" id="readmate-page-info" style="display:none"></div>
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
  floatingBar.querySelector('#readmate-continuous-btn').onclick = () => {
    setContinuousMode(!continuousMode);
    showTranslation(continuousMode ? '🔁 连续朗读已开启 — 读完自动下一篇' : '🔁 连续朗读已关闭', true);
  };
  floatingBar.querySelector('#readmate-translate-btn').onclick = (e) => {
    window._readmateMouseX = e.clientX;
    window._readmateMouseY = e.clientY;
    translateCurrentSentence();
  };
  floatingBar.querySelector('#readmate-debug-btn').onclick = toggleDebugPanel;
  document.getElementById('readmate-debug-count')?.addEventListener('click', copyDebugLogs);

  // 初始化连续模式按钮状态
  const contBtn = document.getElementById('readmate-continuous-btn');
  if (contBtn) {
    contBtn.style.opacity = continuousMode ? '1' : '0.4';
    contBtn.title = continuousMode ? '连续朗读 (开启)' : '连续朗读 (关闭)';
  }

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
  hideFAB(); // 朗读中隐藏悬浮按钮
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
  showFAB(); // 朗读结束恢复悬浮按钮
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
  userStopped = true; // 标记用户主动停止
  stopImmediate = true; // 让 speakSentence 的 poll 立刻退出
  window.speechSynthesis.cancel();
  hideBar();
  DebugLog.add('Stopped (user)');
}

// ====== 句子高亮（改进版：覆盖整句，跨元素边界正确，避免重复图片 caption 跳转）======
let highlightSpans = [];
let lastHighlightEnd = 0; // 上次高亮结束位置，用于避免重复文字跳回开头
let stopImmediate = false; // 立即停止信号，让 speakSentence 的 poll 立刻退出

function highlightSentence(index) {
  clearHighlights();
  if (!settings.highlightEnabled) return;
  const sentence = currentSentences[index];
  if (!sentence) return;

  const textNodes = getTextNodesInBody();
  const fullText = textNodes.map(n => n.textContent).join('');

  // 用整句前200字匹配，从上一次高亮结束位置往后搜（避免重复 caption 跳回开头）
  const searchText = sentence.trim().substring(0, 200);
  let startIdx = fullText.indexOf(searchText, lastHighlightEnd);
  if (startIdx < 0) {
    // 后面没找到，回溯全文搜索
    startIdx = fullText.indexOf(searchText);
  }

  // 精确匹配失败时降级到前30字
  if (startIdx < 0) {
    const shortText = sentence.trim().substring(0, 30);
    startIdx = fullText.indexOf(shortText, lastHighlightEnd);
    if (startIdx < 0) {
      startIdx = fullText.indexOf(shortText);
    }
    if (startIdx < 0) {
      DebugLog.add('Highlight: text not found for "' + shortText + '"');
      return;
    }
    DebugLog.add('Highlight: fuzzy match at ' + startIdx);
  }

  // 确定高亮终止位置
  const endIdx = Math.min(startIdx + sentence.trim().length, fullText.length);
  lastHighlightEnd = endIdx; // 记录本次位置，下一句从这往后搜
  applyHighlight(textNodes, startIdx, endIdx);
}

/** 在文本节点序列上应用高亮（分割文本节点避免跨元素失败） */
function applyHighlight(textNodes, startIdx, endIdx) {
  let charCount = 0;

  for (const node of textNodes) {
    const nodeLen = node.textContent.length;
    const nodeStart = charCount;
    const nodeEnd = charCount + nodeLen;

    if (nodeEnd > startIdx && nodeStart < endIdx) {
      // 此节点包含需要高亮的部分
      const rangeStart = Math.max(0, startIdx - nodeStart);
      const rangeEnd = Math.min(nodeLen, endIdx - nodeStart);
      const text = node.textContent;

      if (rangeStart <= 0 && rangeEnd >= nodeLen) {
        // 整个节点都高亮
        const span = document.createElement('span');
        span.className = 'readmate-highlight';
        node.parentNode.insertBefore(span, node);
        span.appendChild(node);
        highlightSpans.push(span);
      } else {
        // 部分高亮：分割文本节点
        const parent = node.parentNode;
        const before = document.createTextNode(text.substring(0, rangeStart));
        const highlight = document.createElement('span');
        highlight.className = 'readmate-highlight';
        highlight.textContent = text.substring(rangeStart, rangeEnd);
        const after = document.createTextNode(text.substring(rangeEnd));

        parent.insertBefore(before, node);
        parent.insertBefore(highlight, node);
        parent.insertBefore(after, node);
        parent.removeChild(node);
        highlightSpans.push(highlight);
      }
    }
    charCount += nodeLen;
    if (charCount >= endIdx) break;
  }

  // 滚动到第一个高亮元素
  if (highlightSpans.length > 0) {
    highlightSpans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  DebugLog.add('Highlighted ' + highlightSpans.length + ' spans for sentence');
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

// ====== 翻译面板 ======
function showTranslation(text, isInfo, posX, posY) {
  let panel = document.getElementById('readmate-translation-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'readmate-translation-panel';
    panel.innerHTML = '<span id="readmate-translation-text" style="flex:1"></span><button id="readmate-translation-close" style="flex-shrink:0;margin-left:8px;background:none;border:none;color:#8b8b9e;cursor:pointer;font-size:14px;line-height:1;padding:0">✕</button>';
    document.body.appendChild(panel);

    document.getElementById('readmate-translation-close').onclick = () => {
      panel.style.display = 'none';
    };

    document.addEventListener('click', (e) => {
      if (panel.style.display !== 'none' && !panel.contains(e.target) && e.target.closest('#readmate-translate-btn') === null) {
        panel.style.display = 'none';
      }
    });

    let isDragging = false, startX, startY, origLeft, origTop;
    function onMouseDown(e) {
      if (e.target.id === 'readmate-translation-close') return;
      isDragging = true;
      startX = e.clientX; startY = e.clientY;
      origLeft = panel.offsetLeft; origTop = panel.offsetTop;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    }
    function onMouseMove(e) {
      if (!isDragging) return;
      panel.style.left = (origLeft + e.clientX - startX) + 'px';
      panel.style.top = (origTop + e.clientY - startY) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    }
    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    panel.addEventListener('mousedown', onMouseDown);
  }

  document.getElementById('readmate-translation-text').textContent = text;
  panel.classList.toggle('readmate-translation-info', !!isInfo);
  panel.style.display = 'flex';
  panel.style.alignItems = 'flex-start';
  panel.style.gap = '4px';

  if (posX !== undefined && posY !== undefined) {
    const w = panel.offsetWidth || 300;
    const h = panel.offsetHeight || 60;
    let x = Math.max(10, Math.min(posX, window.innerWidth - w - 10));
    let y = posY - h - 10;
    if (y < 10) y = Math.min(posY + 20, window.innerHeight - h - 10);
    panel.style.left = x + 'px'; panel.style.top = y + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  } else {
    panel.style.left = 'auto'; panel.style.right = '20px';
    panel.style.bottom = '80px'; panel.style.top = 'auto';
  }

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

  let posX = window._readmateMouseX;
  let posY = window._readmateMouseY;
  if (posX === undefined) {
    const btn = document.getElementById('readmate-translate-btn');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      posX = rect.left; posY = rect.top;
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

// ====== 内容提取（阅读模式 — 始终开启）======

/** 使用 ContentExtractor 提取正文，失败则回退 body.innerText */
function extractReadableContent() {
  const result = ContentExtractor.extract();
  if (result.success) {
    DebugLog.add('Content extracted: ' + result.wordCount + ' chars, title="' + (result.title || '').substring(0, 40) + '"');
    if (result.fallback) {
      DebugLog.add('Content extraction used fallback (full body text)');
    }
    return result;
  }
  DebugLog.add('Content extraction failed: ' + (result.error || 'unknown'));
  return null;
}

// ====== 消息监听 ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ ok: true, version: '1.2.1' });
    return true;
  }

  switch (msg.action) {
    case 'testTts':
      loadSettings().then(async () => {
        settings.cloudTtsEndpoint = msg.cloudEndpoint || settings.cloudTtsEndpoint;
        settings.cloudTtsVoice = msg.cloudVoice || settings.cloudTtsVoice;
        settings.ttsVoice = msg.browserVoice || settings.ttsVoice;
        settings.ttsSpeed = msg.speed || settings.ttsSpeed;

        const testText = '你好，欢迎使用读伴朗读助手。This is a test of the TTS engine.';
        DebugLog.add('testTts: using cloud=' + !!settings.cloudTtsEndpoint);

        try {
          if (settings.cloudTtsEndpoint && settings.cloudTtsEndpoint.includes('://')) {
            const endpoint = settings.cloudTtsEndpoint.replace(/\/+$/, '') + '/tts';
            const blob = await proxyFetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: testText,
                voice: settings.cloudTtsVoice || 'zh-CN-XiaoxiaoNeural',
                rate: '+0%',
              }),
            });
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            audio.onended = () => { URL.revokeObjectURL(audioUrl); sendResponse({ ok: true, engine: 'cloud' }); };
            audio.onerror = (e) => { URL.revokeObjectURL(audioUrl); sendResponse({ ok: false, error: 'Cloud TTS音频播放失败' }); };
            audio.play().catch(e => { sendResponse({ ok: false, error: 'Cloud TTS播放错误: ' + e.message }); });
          } else if (window.speechSynthesis) {
            speechSynthesis.cancel();
            await new Promise(r => setTimeout(r, 100));
            const utterance = new SpeechSynthesisUtterance(testText);
            utterance.lang = 'zh-CN';
            utterance.rate = settings.ttsSpeed || 1.0;
            if (settings.ttsVoice) {
              const voices = speechSynthesis.getVoices();
              const found = voices.find(v => v.name === settings.ttsVoice);
              if (found) utterance.voice = found;
            }
            utterance.onend = () => sendResponse({ ok: true, engine: 'browser' });
            utterance.onerror = (e) => sendResponse({ ok: false, error: 'Browser TTS错误: ' + e.error });
            speechSynthesis.speak(utterance);
          } else {
            sendResponse({ ok: false, error: '没有可用的语音引擎' });
          }
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      });
      return true;

    case 'readSelection':
      loadSettings().then(() => {
        selectionText = msg.text || '';
        currentMode = 'selection';
        DebugLog.add('readSelection: text length=' + selectionText.length);
        startReading(selectionText);
      });
      break;

    case 'readPage':
      sendResponse({ ok: true }); // 先回复避免弹窗端超时报错
      loadSettings().then(() => {
        // 阅读模式始终开启：先用 extractor，失败 fallback
        const content = extractReadableContent();
        let pageText;
        if (content && content.success) {
          pageText = content.text;
          const info = document.getElementById('readmate-page-info');
          if (info) {
            info.textContent = '📖 ' + (content.title || '') + ' · ' + (content.wordCount || 0) + '字';
            info.style.display = 'block';
            setTimeout(() => { info.style.display = 'none'; }, 5000);
          }
        } else {
          pageText = document.body.innerText;
          DebugLog.add('Using full body text as fallback');
        }
        currentMode = 'page';
        DebugLog.add('readPage: text length=' + pageText.length);
        startReading(pageText);
      });
      break;

    case 'translateSelection':
      loadSettings().then(() => {
        if (msg.text) {
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

    case 'toggleRead':
      if (isPlaying) togglePlayPause();
      break;

    case 'copyToClipboard':
      if (msg.text) {
        navigator.clipboard.writeText(msg.text).then(() => {
          showTranslation('✓ 已复制到剪贴板', true);
          DebugLog.add('Copied ' + msg.text.length + ' chars to clipboard');
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = msg.text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showTranslation('✓ 已复制到剪贴板', true);
        });
      }
      break;

    case 'exportMarkdown':
      if (msg.text) exportToMarkdown(msg.text, msg.title, msg.url);
      break;
  }
});

// ====== 导出功能 ======
function exportToMarkdown(text, title, url) {
  const now = new Date().toISOString().slice(0, 10);
  const md = `# ${title || 'ReadMate Export'}\n\n${url ? `来源: ${url}\n\n` : ''}---\n\n${text}\n\n---\n*由 ReadMate / 读伴于 ${now} 导出*\n`;

  navigator.clipboard.writeText(md).then(() => {
    showTranslation('✓ Markdown 已复制到剪贴板', true);
    DebugLog.add('Markdown exported: ' + md.length + ' chars');
  }).catch(() => {
    showTranslation('✓ Markdown 已准备好（字符数: ' + md.length + '）', true);
  });
}

// ====== 连续朗读：寻找下一篇 ======
function findAndNavigateNext() {
  const nextLink = ContentExtractor.findNextPageLink();
  if (nextLink) {
    DebugLog.add('Found next page link: ' + nextLink.url);
    showTranslation('➡️ 正在跳转到下一篇: ' + (nextLink.text || '下一篇文章'), true);
    // 标记这是连续朗读跳转
    chrome.storage.session.set({ readmate_auto_read: true }, () => {
      setTimeout(() => { window.location.href = nextLink.url; }, 800);
    });
    return true;
  }

  const articles = ContentExtractor.findArticleLinks();
  if (articles.length > 0) {
    const currentUrl = window.location.href;
    const nextArticle = articles.find(a => a.url !== currentUrl);
    if (nextArticle) {
      DebugLog.add('Found next article: ' + nextArticle.title);
      showTranslation('➡️ 正在跳转: ' + (nextArticle.title || '下一篇文章'), true);
      chrome.storage.session.set({ readmate_auto_read: true }, () => {
        setTimeout(() => { window.location.href = nextArticle.url; }, 800);
      });
      return true;
    }
  }

  DebugLog.add('No next page/article found');
  showTranslation('🔚 没有找到下一篇，连续朗读结束', true);
  setContinuousMode(false);
  return false;
}

/** 连续朗读模式：页面加载后自动朗读 */
async function autoReadPage() {
  await loadSettings();
  const content = extractReadableContent();
  let pageText;
  if (content && content.success) {
    pageText = content.text;
  } else {
    pageText = document.body.innerText;
  }
  if (pageText && pageText.trim().length > 50) {
    currentMode = 'page';
    DebugLog.add('Auto-read: ' + pageText.length + ' chars');
    startReading(pageText);
  } else {
    DebugLog.add('Auto-read skipped: page too short');
    setContinuousMode(false);
  }
}

// ====== 主朗读入口 ======
async function startReading(text) {
  if (!text || !text.trim()) { DebugLog.add('startReading: empty text'); return; }
  DebugLog.add('== startReading ==');
  // 记录原文前200字用于调试
  DebugLog.add('RAW TEXT: "' + text.substring(0, 200) + (text.length > 200 ? '...' : '') + '"');

  // 重置高亮追踪位置
  lastHighlightEnd = 0;
  stopImmediate = false; // 清除停止信号

  // 文本预处理
  const cleanText = TextUtils.preprocess(text, {
    stripHtml: true,
    stripPinyin: true,
    stripFootnotes: true,
    stripDecorative: true,
    collapseWhitespace: true,
    cleanCjk: false,
  });
  if (cleanText.length < text.length) {
    DebugLog.add('Preprocessed: ' + text.length + ' → ' + cleanText.length + ' chars');
  }
  // 记录预处理后的文本内容
  DebugLog.add('CLEAN TEXT: "' + cleanText.substring(0, 200) + (cleanText.length > 200 ? '...' : '') + '"');

  // 语速验证
  settings.ttsSpeed = TextUtils.validateSpeed(settings.ttsSpeed);
  DebugLog.add('Validated speed: ' + settings.ttsSpeed + 'x');

  stopReading();
  await new Promise(r => setTimeout(r, 100));

  userStopped = false; // 重置停止标记
  showBar();
  floatingBar.querySelector('#readmate-play-btn').textContent = '⏸';

  console.log('[ReadMate] Starting...');
  const startTime = Date.now();

  // 选择引擎：ttsEngine='cloud'且端点有效才用云端
  const useCloud = settings.ttsEngine === 'cloud' && settings.cloudTtsEndpoint && settings.cloudTtsEndpoint.includes('://');
  DebugLog.add('Engine: ' + (useCloud ? 'Cloud TTS' : 'Web Speech') + ' (ttsEngine=' + (settings.ttsEngine || 'browser') + ')');

  if (useCloud) {
    await speakWithCloudTTS(cleanText, (idx, total, sentence) => {
      updateCurrentText(sentence);
    });
  } else {
    await speakText(cleanText, (idx, total, sentence) => {
      updateCurrentText(sentence);
    });
  }

  // 记录阅读统计
  const elapsedMs = Date.now() - startTime;
  ReadingStats.recordSession(cleanText, elapsedMs).then(result => {
    DebugLog.add('Stats recorded: ' + result.chars + ' chars, ' + result.timeMs + 'ms');
  }).catch(e => {
    DebugLog.add('Stats error: ' + e.message);
  });

  DebugLog.add('== startReading done ==');
}

// ====== 初始化：页面语言检测 ======
function initializePageDetection() {
  const htmlLang = document.documentElement.lang || '';
  if (htmlLang.startsWith('zh')) settings.ttsVoiceLang = 'zh-CN';
  else if (htmlLang.startsWith('ja')) settings.ttsVoiceLang = 'ja-JP';
  else if (htmlLang.startsWith('ko')) settings.ttsVoiceLang = 'ko-KR';
  else settings.ttsVoiceLang = 'en-US';
  DebugLog.add('Page language: ' + htmlLang + ' → voiceLang: ' + settings.ttsVoiceLang);
}

loadSettings().then(() => {
  initializePageDetection();
  // 始终显示悬浮朗读按钮
  createFAB();
  showFAB();
});
