// ReadMate / 读伴 v2.0 — Content Script
// 专注单篇听读：多语种双核朗读（仅原文/直接读译文/双语交替）、动态双语歌词字幕条、AI 3句双语摘要、断点续听

// ====== 调试日志系统 ======
const DebugLog = {
  logs: [],
  add(msg) {
    const t = new Date().toLocaleTimeString();
    this.logs.push(`[${t}] ${msg}`);
    if (this.logs.length > 250) this.logs.splice(0, 50);
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

DebugLog.add('ReadMate v2.0 content script loaded');

// ====== 全局状态 ======
let settings = {};
let floatingBar = null;
let isPlaying = false;
let isPaused = false;
let currentUtterance = null;
let currentAudio = null;
let interruptCurrentPlayback = null;
let currentSentences = [];
let currentSentenceIndex = 0;
let currentMode = null; // 'page', 'selection', 'summary'
let selectionText = '';
let userStopped = false;
let stopImmediate = false;
let lastHighlightEnd = 0;
let detectedDocLang = 'en-US'; // 当前页面自动检测到的语种
let cachedArticleText = ''; // 页面锚定正文缓存，严防点重播时跳到相关推荐

// 双语字幕与翻译预取缓存（LRU/Map）
const translationCache = new Map();
let translationPrefetchQueue = [];

// 朗读语音流模式：'original' (仅原文), 'translated' (仅译文), 'bilingual' (双语交替)
let readVoiceMode = 'original';
let enableBilingual = false; // 默认不开启双语翻译（省Token模式）
let showBilingualSubtitles = true;

// ====== 语种与 Edge TTS 顶级音色映射表 ======
const VOICE_MAP = {
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh': 'zh-CN-XiaoxiaoNeural',
  'en-US': 'en-US-JennyNeural',
  'en': 'en-US-JennyNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'ja': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural',
  'ko': 'ko-KR-SunHiNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'fr': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural',
  'de': 'de-DE-KatjaNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'es': 'es-ES-ElviraNeural',
  'ru-RU': 'ru-RU-SvetlanaNeural',
  'ru': 'ru-RU-SvetlanaNeural',
  'it-IT': 'it-IT-ElsaNeural',
  'it': 'it-IT-ElsaNeural',
  'pt-PT': 'pt-BR-FranciscaNeural',
  'pt': 'pt-BR-FranciscaNeural',
};

/** 根据语言代码与偏好，智能获取最佳云端音色（严格按语言智能匹配，避免跨语言错配如中文音色读英文） */
function getBestVoiceForLang(langCode, customVoice = '') {
  const shortCode = (langCode || 'en').split('-')[0].toLowerCase();
  // 仅当用户指定的音色前缀与当前目标语言匹配时才使用 customVoice
  if (customVoice) {
    const vLower = customVoice.toLowerCase();
    if (vLower.startsWith(shortCode)) {
      return customVoice;
    }
  }
  return VOICE_MAP[langCode] || VOICE_MAP[shortCode] || (shortCode === 'zh' ? 'zh-CN-XiaoxiaoNeural' : 'en-US-JennyNeural');
}

/** 获取浏览器本地最匹配的高质量语音对象（严格校验语种匹配） */
function getBestBrowserVoice(langCode, customVoiceName = '') {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;

  const short = (langCode || 'en').split('-')[0].toLowerCase();
  if (customVoiceName) {
    const matched = voices.find(v => v.name === customVoiceName);
    if (matched && matched.lang.toLowerCase().startsWith(short)) {
      return matched;
    }
  }

  // 1. 优先匹配完全相同的 locale 且推荐 Natural/Online 声音
  let candidate = voices.find(v => v.lang.toLowerCase() === (langCode || 'en').toLowerCase() && (v.name.includes('Natural') || v.name.includes('Online')));
  if (candidate) return candidate;

  // 2. 匹配语言前缀且推荐 Natural
  candidate = voices.find(v => v.lang.toLowerCase().startsWith(short) && (v.name.includes('Natural') || v.name.includes('Online')));
  if (candidate) return candidate;

  // 3. 匹配完全相同的 locale
  candidate = voices.find(v => v.lang.toLowerCase() === (langCode || 'en').toLowerCase());
  if (candidate) return candidate;

  // 4. 匹配语言前缀
  candidate = voices.find(v => v.lang.toLowerCase().startsWith(short));
  if (candidate) return candidate;

  return null;
}

/** 语言名称映射 */
const LANG_NAME_TO_CODE = {
  'Simplified Chinese': 'zh-CN',
  'English': 'en-US',
  'Japanese': 'ja-JP',
  'Korean': 'ko-KR',
  'French': 'fr-FR',
  'German': 'de-DE',
  'Spanish': 'es-ES',
  'Russian': 'ru-RU',
  'Italian': 'it-IT',
  'Portuguese': 'pt-PT',
};

// ====== 多语言国际化（i18n）系统 ======
let i18nMessages = {};
async function loadContentI18n(lang) {
  const targetLang = lang || settings.uiLanguage || 'zh_CN';
  const effectiveLang = (targetLang === 'auto') ? (navigator.language.startsWith('zh') ? 'zh_CN' : navigator.language.startsWith('ja') ? 'ja' : 'en') : targetLang;

  // 1. 优先向 background 请求加载语言字典（完全避开 Content Script 沙箱限制）
  try {
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getI18nMessages', lang: effectiveLang }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          resolve(null);
        } else {
          resolve(res.messages);
        }
      });
    });
    if (resp && Object.keys(resp).length > 0) {
      i18nMessages = resp;
      return;
    }
  } catch(e) {}

  // 2. 备用本地 fetch
  try {
    const url = chrome.runtime.getURL(`_locales/${effectiveLang}/messages.json`);
    const resp = await fetch(url);
    const data = await resp.json();
    i18nMessages = {};
    for (const [k, v] of Object.entries(data)) {
      i18nMessages[k] = v.message;
    }
  } catch (e) {
    // 保持当前字典
  }
}

function _t(key, fallback = '') {
  return i18nMessages[key] || fallback || key;
}

// ====== 设置加载与同步 ======
function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, async (saved) => {
      settings = saved || {};
      readVoiceMode = settings.readVoiceMode || 'original';
      enableBilingual = !!settings.enableBilingual;
      showBilingualSubtitles = settings.showBilingualSubtitles !== false;
      await loadContentI18n(settings.uiLanguage);
      DebugLog.add(`Settings loaded: mode=${readVoiceMode}, bilingual=${enableBilingual}, speed=${settings.ttsSpeed}x, lang=${settings.uiLanguage}`);
      resolve(settings);
    });
  });
}

function updateSelectionBtnI18n() {
  if (!selectionPlayBtn) return;
  const playBtn = selectionPlayBtn.querySelector('#readmate-sel-play-btn');
  if (playBtn) playBtn.title = _t('selPlayTip', '朗读选中文字');
  const transBtn = selectionPlayBtn.querySelector('#readmate-sel-trans-btn');
  if (transBtn) transBtn.title = _t('selTranslateTip', '翻译选中文字');
}

// ====== 选中文字悬浮播放按钮 ======
let selectionPlayBtn = null;

function createSelectionPlayBtn() {
  if (selectionPlayBtn) return;
  selectionPlayBtn = document.createElement('div');
  selectionPlayBtn.id = 'readmate-sel-btn-group';
  selectionPlayBtn.innerHTML = `
    <button class="readmate-sel-btn readmate-sel-play" id="readmate-sel-play-btn" title="${_t('selPlayTip', '朗读选中文字')}">▶</button>
    <button class="readmate-sel-btn readmate-sel-translate" id="readmate-sel-trans-btn" title="${_t('selTranslateTip', '翻译选中文字')}">🌐</button>
  `;
  document.body.appendChild(selectionPlayBtn);

  selectionPlayBtn.querySelector('#readmate-sel-play-btn').onclick = (e) => {
    e.stopPropagation();
    if (selectionText) {
      hideSelectionBtn();
      currentMode = 'selection';
      startReading(selectionText);
    }
  };

  selectionPlayBtn.querySelector('#readmate-sel-trans-btn').onclick = (e) => {
    e.stopPropagation();
    if (selectionText) {
      window._readmateMouseX = e.clientX;
      window._readmateMouseY = e.clientY;
      hideSelectionBtn();
      translateAndShow(selectionText);
    }
  };
}

function showSelectionBtn(x, y) {
  createSelectionPlayBtn();
  const pad = 12;
  let left = x + pad;
  let top = y + pad;
  if (left + 70 > window.innerWidth) left = x - 70;
  if (top + 40 > window.innerHeight) top = y - 40;
  selectionPlayBtn.style.left = `${left}px`;
  selectionPlayBtn.style.top = `${top}px`;
  selectionPlayBtn.style.display = 'flex';
}

function hideSelectionBtn() {
  if (selectionPlayBtn) selectionPlayBtn.style.display = 'none';
}

// 划词监听
document.addEventListener('mouseup', (e) => {
  if (e.target.closest('#readmate-sel-btn-group') || e.target.closest('#readmate-bar') || e.target.closest('#readmate-fab-container')) {
    return;
  }
  setTimeout(() => {
    const sel = window.getSelection();
    const txt = sel ? sel.toString().trim() : '';
    if (txt && txt.length >= 2) {
      selectionText = txt;
      showSelectionBtn(e.clientX, e.clientY);
    } else {
      hideSelectionBtn();
    }
  }, 10);
});

// ====== 极简悬浮圆钮（FAB 回归单一极简 ▶ 按钮）======
let fabContainer = null;
let suppressNextFabClick = false;

function updateFABI18n() {
  if (!fabContainer) return;
  const readerBtn = fabContainer.querySelector('#readmate-fab-reader');
  if (readerBtn) readerBtn.title = _t('btnReaderMode', '📖 沉浸净读模式 (Alt+R / F9)');
  const summaryBtn = fabContainer.querySelector('#readmate-fab-summary');
  if (summaryBtn) summaryBtn.title = _t('fabSummaryTip', 'AI 双语摘要');
  const playBtn = fabContainer.querySelector('#readmate-fab-play');
  if (playBtn) playBtn.title = _t('fabPlayTip', '朗读当前文章 (Ctrl+Shift+P)');
}

function updateSummaryDialogI18n() {
  if (!summaryDialog) return;
  const titleEl = summaryDialog.querySelector('.readmate-summary-title');
  if (titleEl) titleEl.textContent = _t('summaryCardTitle', '⚡ AI 双语核心要闻摘要');

  const tabBi = summaryDialog.querySelector('.readmate-summary-tab[data-view="bilingual"]');
  if (tabBi) {
    tabBi.textContent = _t('summaryTabBilingual', '🔄 双语');
    tabBi.title = _t('summaryTabBilingualTip', '双语对照模式');
  }
  const tabOrig = summaryDialog.querySelector('.readmate-summary-tab[data-view="original"]');
  if (tabOrig) {
    tabOrig.textContent = _t('summaryTabOriginal', '📄 原文');
    tabOrig.title = _t('summaryTabOriginalTip', '仅看原文 (纯净沉浸)');
  }
  const tabTrans = summaryDialog.querySelector('.readmate-summary-tab[data-view="translated"]');
  if (tabTrans) {
    tabTrans.textContent = _t('summaryTabTranslated', '🌐 译文');
    tabTrans.title = _t('summaryTabTranslatedTip', '仅看译文 (母语速览)');
  }

  const regenBtn = summaryDialog.querySelector('#readmate-summary-regen-btn');
  if (regenBtn) regenBtn.title = _t('summaryRegenerateTip', '重新生成摘要');
  const minBtn = summaryDialog.querySelector('#readmate-summary-min-btn');
  if (minBtn) minBtn.title = _t('summaryMinimizeTip', '最小化');
  const closeBtn = summaryDialog.querySelector('#readmate-summary-close-btn');
  if (closeBtn) closeBtn.title = _t('summaryCloseTip', '关闭 (ESC)');

  summaryDialog.querySelectorAll('.readmate-summary-play-btn[data-type="orig"]').forEach(btn => {
    btn.title = _t('readOriginal', '读原文');
  });
  summaryDialog.querySelectorAll('.readmate-summary-play-btn[data-type="trans"]').forEach(btn => {
    btn.title = _t('readTranslated', '读译文');
  });

  const playBiBtn = summaryDialog.querySelector('#readmate-summary-play-bilingual');
  if (playBiBtn) {
    playBiBtn.textContent = _t('summaryPlayBilingual', '🔄 连播摘要 (双语)');
    playBiBtn.title = _t('summaryPlayBilingualTip', '双语交替读摘要');
  }
  const playOrigBtn = summaryDialog.querySelector('#readmate-summary-play-orig');
  if (playOrigBtn) {
    playOrigBtn.textContent = _t('summaryPlayOrig', '🔊 读原文');
    playOrigBtn.title = _t('summaryPlayOrigTip', '仅读原文摘要');
  }
  const playTransBtn = summaryDialog.querySelector('#readmate-summary-play-trans');
  if (playTransBtn) {
    playTransBtn.textContent = _t('summaryPlayTrans', '🌐 读译文');
    playTransBtn.title = _t('summaryPlayTransTip', '直接读译文摘要');
  }
  const copyMdBtn = summaryDialog.querySelector('#readmate-summary-copy-md');
  if (copyMdBtn) {
    copyMdBtn.textContent = _t('copyMarkdown', '📋 复制 Markdown');
  }
}

function updateFloatingBarI18n() {
  if (!floatingBar) return;
  const modeSel = floatingBar.querySelector('#readmate-voice-mode-select');
  if (modeSel) {
    modeSel.title = _t('lblVoiceMode', '播放模式');
    const optOrig = modeSel.querySelector('option[value="original"]');
    if (optOrig) optOrig.textContent = _t('modeOriginal', '🔊 仅读原文');
    const optTrans = modeSel.querySelector('option[value="translated"]');
    if (optTrans) optTrans.textContent = _t('modeTranslated', '🌐 直接读译文');
    const optBi = modeSel.querySelector('option[value="bilingual"]');
    if (optBi) optBi.textContent = _t('modeBilingual', '🔄 双语交替读');
  }

  const prevBtn = floatingBar.querySelector('#readmate-prev-sentence');
  if (prevBtn) prevBtn.title = _t('btnPrev', '上一句');
  const playBtn = floatingBar.querySelector('#readmate-play-btn');
  if (playBtn) playBtn.title = _t('btnPlay', '播放/暂停');
  const nextBtn = floatingBar.querySelector('#readmate-next-sentence');
  if (nextBtn) nextBtn.title = _t('btnNext', '下一句');
  const stopBtn = floatingBar.querySelector('#readmate-stop-btn');
  if (stopBtn) stopBtn.title = _t('btnStop', '停止');

  const biLabel = floatingBar.querySelector('#readmate-bilingual-label');
  if (biLabel) biLabel.title = _t('lblEnableBilingual', '双语翻译 (不勾选省Token)');
  const biText = floatingBar.querySelector('#readmate-bilingual-text');
  if (biText) biText.textContent = _t('lblBilingual', '双语');

  const subLabel = floatingBar.querySelector('#readmate-subtitles-label');
  if (subLabel) subLabel.title = _t('lblBilingualSubtitles', '字幕显示');
  const subText = floatingBar.querySelector('#readmate-subtitles-text');
  if (subText) subText.textContent = _t('lblSubtitles', '字幕');

  const summaryBtn = floatingBar.querySelector('#readmate-summary-btn');
  if (summaryBtn) summaryBtn.title = _t('fabSummaryTip', 'AI 双语摘要');
  const readerBtn = floatingBar.querySelector('#readmate-bar-reader-btn');
  if (readerBtn) readerBtn.title = _t('btnReaderMode', '📖 沉浸净读模式 (Alt+R / F9)');
}

/** 智能文本语言检测辅助函数 */
function detectTextLanguage(txt) {
  if (!txt || !txt.trim()) return 'en-US';
  if (window.ContentExtractor && typeof ContentExtractor.detectLanguage === 'function') {
    return ContentExtractor.detectLanguage(txt);
  }
  if (typeof TextUtils !== 'undefined' && typeof TextUtils.detectLanguage === 'function') {
    return TextUtils.detectLanguage(txt);
  }
  return 'en-US';
}

/** 全局唯一权威语料源提取器（确保原网页朗读与沉浸模式句子序号 100% 绝对一致） */
function getCanonicalArticle() {
  if (cachedReaderContent && readerSentences && readerSentences.length > 0) {
    return cachedReaderContent;
  }

  let content = null;
  try {
    content = ContentExtractor.extract(document);
  } catch(e) {
    DebugLog.add('ContentExtractor in getCanonicalArticle error: ' + e.message);
  }

  const pageTitle = (content && content.title && content.title.trim().length > 2)
    ? content.title.trim()
    : (document.title || 'Untitled Article');

  let paras = [];
  if (content && content.paragraphs && content.paragraphs.length > 0) {
    paras = [...content.paragraphs];
  } else if (content && content.text && content.text.length > 50) {
    paras = content.text.split(/\n{2,}/);
  } else {
    const pEls = document.querySelectorAll('article p, main p, [role="main"] p, p');
    pEls.forEach(p => {
      const t = p.textContent.trim();
      if (t.length > 15) paras.push(t);
    });
  }
  paras = paras.map(p => p.trim()).filter(p => p.length > 0);

  if (paras.length > 0 && paras[0] === pageTitle) {
    paras.shift();
  }

  const allSentences = [];
  if (pageTitle && pageTitle.length > 1) {
    allSentences.push(pageTitle);
  }

  for (const p of paras) {
    let cleanP = p;
    try {
      cleanP = TextUtils.preprocess(p, {
        stripHtml: true,
        collapseWhitespace: true,
      });
    } catch(e) {}

    let sentences = [];
    try {
      sentences = TextUtils.splitSentences(cleanP);
    } catch(e) {
      sentences = [cleanP];
    }

    sentences = sentences.filter(s => {
      const cl = getSpeechText(s);
      return cl && cl.replace(/[\s.,!?;:，。！？；：'"`~—\-_/\\|]+/g, '').length > 0;
    });

    for (const s of sentences) {
      allSentences.push(s);
    }
  }

  readerSentences = allSentences;
  cachedReaderContent = {
    title: pageTitle,
    paragraphs: paras,
    sentences: allSentences,
    text: allSentences.join('\n\n'),
  };
  cachedArticleText = cachedReaderContent.text;

  return cachedReaderContent;
}

function createFAB() {
  if (fabContainer) return;
  fabContainer = document.createElement('div');
  fabContainer.id = 'readmate-fab-container';
  fabContainer.innerHTML = `
    <button id="readmate-fab-reader" class="readmate-fab-btn readmate-fab-sub" title="${_t('btnReaderMode', '📖 沉浸净读模式 (Alt+R / F9)')}">📖</button>
    <button id="readmate-fab-summary" class="readmate-fab-btn readmate-fab-sub" title="${_t('fabSummaryTip', 'AI 双语摘要')}">⚡</button>
    <button id="readmate-fab-play" class="readmate-fab-btn" title="${_t('fabPlayTip', '朗读当前文章 (Ctrl+Shift+P)')}">▶</button>
  `;
  document.body.appendChild(fabContainer);

  const readerBtn = fabContainer.querySelector('#readmate-fab-reader');
  readerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleReaderMode();
  });

  const summaryBtn = fabContainer.querySelector('#readmate-fab-summary');
  summaryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    generateAISummary();
  });

  const btn = fabContainer.querySelector('#readmate-fab-play');
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (suppressNextFabClick) { suppressNextFabClick = false; return; }
    if (isPlaying) {
      togglePlayPause();
      return;
    }
    DebugLog.add('Single FAB clicked: reading current page');

    const canonical = getCanonicalArticle();
    let pageText = canonical ? canonical.text : '';
    if (!pageText || pageText.trim().length < 20) {
      pageText = document.body.innerText || '';
      DebugLog.add(`Fallback body text: ${pageText.length} chars`);
    }

    if (pageText.trim().length < 20) {
      showTranslation(_t('toastTextTooShort', '⚠️ 正文过短，无法朗读'), true);
      return;
    }

    currentMode = 'page';
    hideFAB();
    startReading(pageText);
  });
}

function showFAB() {
  if (settings.showFab === false) return;
  if (!fabContainer) createFAB();
  if (fabContainer) fabContainer.style.display = 'flex';
}

function hideFAB() {
  if (fabContainer) fabContainer.style.display = 'none';
}

// ====== 浮动朗读控制条（双层歌词卡片式） ======
function createFloatingBar() {
  if (floatingBar) return;
  DebugLog.add('Entering createFloatingBar...');
  floatingBar = document.createElement('div');
  floatingBar.id = 'readmate-bar';
  floatingBar.className = 'readmate-card-bar';

  floatingBar.innerHTML = `
    <!-- 上层：主控制行 -->
    <div class="readmate-bar-main">
      <div class="readmate-bar-left">
        <span class="readmate-progress">0/0</span>
        <select class="readmate-mode-select" id="readmate-voice-mode-select" title="${_t('lblVoiceMode', '播放模式')}">
          <option value="original">${_t('modeOriginal', '🔊 仅读原文')}</option>
          <option value="translated">${_t('modeTranslated', '🌐 直接读译文')}</option>
          <option value="bilingual">${_t('modeBilingual', '🔄 双语交替读')}</option>
        </select>
      </div>

      <div class="readmate-bar-center">
        <button class="readmate-btn" id="readmate-prev-sentence" title="${_t('btnPrev', '上一句')}">⏮</button>
        <button class="readmate-btn readmate-btn-main" id="readmate-play-btn" title="${_t('btnPlay', '播放/暂停')}">⏸</button>
        <button class="readmate-btn" id="readmate-next-sentence" title="${_t('btnNext', '下一句')}">⏭</button>
        <button class="readmate-btn readmate-btn-stop" id="readmate-stop-btn" title="${_t('btnStop', '停止')}">⏹</button>
      </div>

      <div class="readmate-bar-right">
        <label class="readmate-chk-toggle" id="readmate-bilingual-label" title="${_t('lblEnableBilingual', '双语翻译 (不勾选省Token)')}">
          <input type="checkbox" id="readmate-bilingual-chk" ${enableBilingual ? 'checked' : ''}>
          <span id="readmate-bilingual-text">${_t('lblBilingual', '双语')}</span>
        </label>
        <label class="readmate-sub-toggle" id="readmate-subtitles-label" title="${_t('lblBilingualSubtitles', '字幕显示')}">
          <input type="checkbox" id="readmate-sub-chk" ${showBilingualSubtitles ? 'checked' : ''}>
          <span id="readmate-subtitles-text">${_t('lblSubtitles', '字幕')}</span>
        </label>
        <button class="readmate-btn readmate-btn-reader" id="readmate-bar-reader-btn" title="${_t('btnReaderMode', '📖 沉浸净读模式 (Alt+R / F9)')}">📖</button>
        <button class="readmate-btn readmate-btn-summary" id="readmate-summary-btn" title="${_t('fabSummaryTip', 'AI 双语摘要')}">⚡</button>
        <button class="readmate-btn" id="readmate-debug-btn" title="Debug" style="display:none">🐛</button>
        <button class="readmate-btn readmate-btn-close" id="readmate-close-btn" title="Close">✕</button>
      </div>
    </div>

    <!-- 下层：动态双语字幕区（可勾选折叠） -->
    <div class="readmate-subtitles-wrap" id="readmate-subtitles-wrap" style="${showBilingualSubtitles ? '' : 'display:none;'}">
      <div class="readmate-sub-original" id="readmate-sub-original" title="Original"></div>
      <div class="readmate-sub-translated" id="readmate-sub-translated" title="Translated"></div>
    </div>

    <!-- 调试面板 -->
    <div id="readmate-debug-panel" style="display:none;max-height:160px;overflow:auto;padding:8px 12px;font-size:11px;font-family:monospace;border-top:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.25);color:#aaa;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>Debug Log</span>
        <span id="readmate-debug-count" style="cursor:pointer" title="Copy">0</span>
      </div>
      <div id="readmate-debug-body"></div>
    </div>
  `;

  document.body.appendChild(floatingBar);

  try {
    // 绑定事件
    floatingBar.querySelector('#readmate-play-btn').onclick = togglePlayPause;
    floatingBar.querySelector('#readmate-stop-btn').onclick = () => stopReading(true);
    floatingBar.querySelector('#readmate-close-btn').onclick = () => stopReading(true);
    floatingBar.querySelector('#readmate-prev-sentence').onclick = prevSentence;
    floatingBar.querySelector('#readmate-next-sentence').onclick = nextSentence;
    floatingBar.querySelector('#readmate-bar-reader-btn').onclick = toggleReaderMode;
    floatingBar.querySelector('#readmate-summary-btn').onclick = generateAISummary;

    // 语音流模式切换（立即清空旧缓存，秒级生效）
    const modeSel = floatingBar.querySelector('#readmate-voice-mode-select');
    modeSel.value = readVoiceMode;
    modeSel.onchange = (e) => {
      readVoiceMode = e.target.value;
      // 若选择了直接读译文或双语交替，自动激活双语开关
      if (readVoiceMode !== 'original' && !enableBilingual) {
        enableBilingual = true;
        const biChk = floatingBar.querySelector('#readmate-bilingual-chk');
        if (biChk) biChk.checked = true;
        chrome.runtime.sendMessage({ action: 'saveSettings', settings: { enableBilingual: true } });
      }
      audioPrefetchCache.clear(); // 清空旧模式预读缓存
      chrome.runtime.sendMessage({ action: 'saveSettings', settings: { readVoiceMode } });
      showTranslation(`${_t('toastModeChanged', '模式已切换: ')}${modeSel.options[modeSel.selectedIndex].text}`, true);
      // 如果正在播放，打断当前句，立即用新模式重播当前句
      if (isPlaying && interruptCurrentPlayback) {
        interruptCurrentPlayback();
      }
    };

    // 双语翻译独立开关（勾选才翻译，0 Token 默认纯净原文）
    const biChk = floatingBar.querySelector('#readmate-bilingual-chk');
    if (biChk) {
      biChk.onchange = (e) => {
        enableBilingual = e.target.checked;
        chrome.runtime.sendMessage({ action: 'saveSettings', settings: { enableBilingual } });
        if (enableBilingual) {
          showTranslation('🌐 已开启双语翻译', true);
          // 正在播放时，立即在后台异步预取当前句翻译
          if (isPlaying && currentSentences.length > 0) {
            const curOrig = currentSentences[currentSentenceIndex];
            if (curOrig && !translationCache.has(curOrig)) {
              fetchTranslation(curOrig).then(t => {
                if (isPlaying && currentSentenceIndex < currentSentences.length) {
                  updateSubtitleDisplay(curOrig, t);
                }
              });
            }
          }
        } else {
          showTranslation('📄 已关闭翻译 (纯原文省Token模式)', true);
          // 若之前处于仅读译文或双语模式，自动切回仅读原文
          if (readVoiceMode !== 'original') {
            readVoiceMode = 'original';
            modeSel.value = 'original';
            chrome.runtime.sendMessage({ action: 'saveSettings', settings: { readVoiceMode: 'original' } });
          }
          const transEl = floatingBar.querySelector('#readmate-sub-translated');
          if (transEl) transEl.textContent = '';
        }
      };
    }

    // 字幕折叠开关
    const subChk = floatingBar.querySelector('#readmate-sub-chk');
    if (subChk) {
      subChk.onchange = (e) => {
        showBilingualSubtitles = e.target.checked;
        const wrap = floatingBar.querySelector('#readmate-subtitles-wrap');
        if (wrap) wrap.style.display = showBilingualSubtitles ? '' : 'none';
        chrome.runtime.sendMessage({ action: 'saveSettings', settings: { showBilingualSubtitles } });
      };
    }

    // 调试日志
    floatingBar.querySelector('#readmate-debug-btn').onclick = toggleDebugPanel;
    document.getElementById('readmate-debug-count')?.addEventListener('click', copyDebugLogs);

    makeDraggable(floatingBar);
  } catch(e) {
    DebugLog.add('createFloatingBar setup error: ' + e.message);
  }
  DebugLog.add('Floating bar created successfully');
}

function showBar() {
  DebugLog.add('showBar() called');
  if (!floatingBar) createFloatingBar();
  if (floatingBar) {
    document.body.appendChild(floatingBar);
    floatingBar.classList.add('readmate-active');
    floatingBar.style.display = 'flex';
    floatingBar.style.zIndex = '2147483647';
  }
  hideFAB();
  startDebugTimer();
  refreshDebugPanel();
}

function hideBar() {
  stopDebugTimer();
  if (floatingBar) {
    floatingBar.classList.remove('readmate-active');
    floatingBar.style.display = 'none';
    updateSubtitleDisplay('', '');
  }
  clearHighlights();
  currentSentences = [];
  currentSentenceIndex = 0;
  showFAB();
}

function updateBarProgress(cur, total) {
  const el = floatingBar?.querySelector('.readmate-progress');
  if (el) el.textContent = `${cur}/${total}`;
}

function updateSubtitleDisplay(original, translated) {
  if (!floatingBar) return;
  const origEl = floatingBar.querySelector('#readmate-sub-original');
  const transEl = floatingBar.querySelector('#readmate-sub-translated');
  if (origEl) origEl.textContent = original || '';
  if (transEl) transEl.textContent = translated || (original ? '正在翻译...' : '');
}

// ====== 拖拽移动支持（排除交互元素与标签，防止阻止复选框默认点击） ======
function makeDraggable(el) {
  let isDragging = false, startX, startY, origLeft, origTop;
  const handle = el.querySelector('.readmate-bar-main');
  if (!handle) return;

  handle.addEventListener('mousedown', (e) => {
    // 忽略所有可交互元素（按钮、下拉框、复选框、label文本标签等）
    if (e.target.closest('button, select, input, label, a, .readmate-chk-toggle, .readmate-sub-toggle, .readmate-btn')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = `${origLeft + dx}px`;
    el.style.top = `${origTop + dy}px`;
    el.style.transform = 'none';
    el.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => { isDragging = false; });
}

// ====== 调试面板 ======
function toggleDebugPanel() {
  const p = document.getElementById('readmate-debug-panel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
function refreshDebugPanel() {
  const b = document.getElementById('readmate-debug-body');
  const c = document.getElementById('readmate-debug-count');
  if (b) b.innerHTML = DebugLog.getHTML();
  if (c) c.textContent = `${DebugLog.logs.length} 条 (点击复制)`;
}
function copyDebugLogs() {
  DebugLog.copy();
  showTranslation('✓ 调试日志已复制', true);
}
let debugTimer = null;
function startDebugTimer() { stopDebugTimer(); debugTimer = setInterval(refreshDebugPanel, 600); }
function stopDebugTimer() { if (debugTimer) { clearInterval(debugTimer); debugTimer = null; } }

// ====== 播放控制与秒停 ======
function togglePlayPause() {
  if (isPaused) {
    isPaused = false;
    const playBtn = floatingBar?.querySelector('#readmate-play-btn');
    if (playBtn) playBtn.textContent = '⏸';
    if (currentAudio) {
      currentAudio.play().catch(e => DebugLog.add('Resume audio error: ' + e.message));
    } else if (window.speechSynthesis) {
      window.speechSynthesis.resume();
    }
    DebugLog.add(`Playback resumed at sentence ${currentSentenceIndex + 1}`);
    updateReaderPlayButton();
  } else if (isPlaying) {
    isPaused = true;
    const playBtn = floatingBar?.querySelector('#readmate-play-btn');
    if (playBtn) playBtn.textContent = '▶';
    if (currentAudio) {
      currentAudio.pause();
    } else if (window.speechSynthesis) {
      window.speechSynthesis.pause();
    }
    DebugLog.add(`Playback paused at sentence ${currentSentenceIndex + 1}`);
    updateReaderPlayButton();
  }
}

function cancelPlayback() {
  DebugLog.add('cancelPlayback invoked: forcing instant stop');
  isPlaying = false;
  isPaused = false;
  stopImmediate = true;
  if (interruptCurrentPlayback) {
    try { interruptCurrentPlayback(); } catch(e) {}
    interruptCurrentPlayback = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = '';
    } catch(e) {}
    currentAudio = null;
  }
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch(e) {}
  }
  audioPrefetchCache.clear();
  clearHighlights();
  updateReaderPlayButton();
}

function stopReading(isUser = true) {
  cancelPlayback();
  if (isUser) {
    userStopped = true;
    DebugLog.add('Stopped by user');
  }
  hideBar();
}

let pendingJumpIndex = null;

function jumpToSentence(target) {
  if (!currentSentences || currentSentences.length === 0) return;
  const idx = Math.max(0, Math.min(currentSentences.length - 1, target));
  pendingJumpIndex = idx;
  isPaused = false;
  const playBtn = floatingBar?.querySelector('#readmate-play-btn');
  if (playBtn) playBtn.textContent = '⏸';
  DebugLog.add(`jumpToSentence clicked: jumping to ${idx + 1}/${currentSentences.length}`);
  if (interruptCurrentPlayback) {
    interruptCurrentPlayback();
  }
  if (isReaderModeActive) {
    highlightReaderModeSentence(idx);
  }
}

function prevSentence() {
  if (!currentSentences || currentSentences.length === 0) return;
  jumpToSentence(currentSentenceIndex - 1);
}

function nextSentence() {
  if (!currentSentences || currentSentences.length === 0) return;
  jumpToSentence(currentSentenceIndex + 1);
}

// ====== 翻译预取流水线（确保读译文和双语无延迟） ======
async function fetchTranslation(text) {
  if (!text || !text.trim()) return '';
  if (translationCache.has(text)) return translationCache.get(text);

  const targetLang = settings.translateTarget || 'Simplified Chinese';
  const apiKey = settings.aiApiKey || 'liang-gemini-proxy-2026';
  const endpoint = settings.aiEndpoint || 'http://192.168.199.159:28080/v1';
  const model = settings.aiModel || 'gemini-3.7-flash-high';

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'proxyTranslate',
      endpoint,
      apiKey,
      model,
      text,
      targetLang,
    }, (resp) => {
      const translated = (resp && resp.ok && resp.text) ? resp.text.trim() : '';
      if (translated) translationCache.set(text, translated);
      resolve(translated);
    });
  });
}

// ====== 预读机制：翻译与云端 TTS 双重预读流水线 ======
const audioPrefetchCache = new Map(); // key -> Promise<dataUrl>

function getTtsAudioKey(text, voice, speed) {
  return `${voice}__${Math.round(((speed || 1.0) - 1) * 100)}%__${text}`;
}

function prefetchTtsAudio(endpoint, text, voice, speed) {
  if (!text || !text.trim()) return null;
  const speechText = getSpeechText(text);
  const key = getTtsAudioKey(speechText, voice, speed);
  if (audioPrefetchCache.has(key)) {
    return audioPrefetchCache.get(key);
  }
  DebugLog.add(`Prefetching TTS audio for: "${speechText.substring(0, 25)}..."`);
  const promise = proxyFetchTTS(endpoint, {
    text: speechText,
    voice,
    rate: `+${Math.round(((speed || 1.0) - 1) * 100)}%`,
  }).catch(err => {
    DebugLog.add(`Audio prefetch failed for "${speechText.substring(0, 25)}": ${err.message}`);
    audioPrefetchCache.delete(key);
    return null;
  });
  audioPrefetchCache.set(key, promise);
  return promise;
}

async function getOrFetchTtsAudio(endpoint, text, voice, speed) {
  const speechText = getSpeechText(text);
  const key = getTtsAudioKey(speechText, voice, speed);
  if (audioPrefetchCache.has(key)) {
    DebugLog.add(`TTS prefetch HIT for "${speechText.substring(0, 25)}..."`);
    const cached = await audioPrefetchCache.get(key);
    if (cached) return cached;
  }
  DebugLog.add(`TTS prefetch MISS, fetching now: "${speechText.substring(0, 25)}..."`);
  return await proxyFetchTTS(endpoint, {
    text: speechText,
    voice,
    rate: `+${Math.round(((speed || 1.0) - 1) * 100)}%`,
  });
}

/** 双重流水线预读：向前滑动预取 bufferSize 句的翻译与音频 */
function prefetchAhead(sentences, startIndex, bufferSize, ttsEndpoint, origVoice, transVoice, ttsSpeed, useCloud) {
  for (let b = 1; b <= bufferSize; b++) {
    const idx = startIndex + b;
    if (idx < 0 || idx >= sentences.length) continue;
    const nextOrig = sentences[idx];

    // 1. 原文 TTS 音频预取（模式为“仅读原文”或“双语交替”）
    if (useCloud && (readVoiceMode === 'original' || readVoiceMode === 'bilingual')) {
      prefetchTtsAudio(ttsEndpoint, nextOrig, origVoice, ttsSpeed);
    }

    // 2. 译文预取（必须开启双语 且（需要显示双语字幕 或 朗读包含译文））
    if (enableBilingual && (readVoiceMode !== 'original' || showBilingualSubtitles)) {
      if (translationCache.has(nextOrig)) {
        const trans = translationCache.get(nextOrig);
        if (useCloud && trans && (readVoiceMode === 'translated' || readVoiceMode === 'bilingual')) {
          prefetchTtsAudio(ttsEndpoint, trans, transVoice, ttsSpeed);
        }
      } else {
        fetchTranslation(nextOrig).then(trans => {
          if (useCloud && trans && (readVoiceMode === 'translated' || readVoiceMode === 'bilingual')) {
            prefetchTtsAudio(ttsEndpoint, trans, transVoice, ttsSpeed);
          }
        }).catch(() => {});
      }
    }
  }
}

/** 异步预取后续 2 句的翻译 */
function prefetchTranslations(sentences, startIndex) {
  for (let b = 1; b <= 2; b++) {
    const idx = startIndex + b;
    if (idx < sentences.length && !translationCache.has(sentences[idx])) {
      fetchTranslation(sentences[idx]);
    }
  }
}

// ====== 云端 Edge TTS 播放代理 ======
let _proxyReqId = 0;
function proxyFetchTTS(endpoint, payload) {
  const requestId = 'req_' + (++_proxyReqId);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'proxyFetch', url: endpoint, options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, requestId }, (resp) => {
      if (chrome.runtime.lastError) {
        DebugLog.add('proxyFetch runtime error: ' + chrome.runtime.lastError.message);
        return reject(new Error(chrome.runtime.lastError.message));
      }
      DebugLog.add('proxyFetch raw resp: ' + JSON.stringify(resp || {}));
      if (!resp?.ok || !resp.dataUrl) {
        DebugLog.add('proxyFetch response error: ' + (resp?.error || 'no dataUrl'));
        return reject(new Error(resp?.error || 'proxy fetch failed'));
      }

      DebugLog.add('proxyFetch success with dataUrl, length=' + resp.dataUrl.length);
      resolve(resp.dataUrl);
    });
  });
}

// ====== 终极朗读发音文本净化器（严防 Edge TTS 念出 Markdown、怪符号、斜杠、无声字符） ======
function getSpeechText(sentence) {
  if (!sentence || typeof sentence !== 'string') return '';
  let s = sentence;
  // 1. 去除网址 URL（http/https），防止 TTS 念一长串字母和斜杠
  s = s.replace(/https?:\/\/\S+/gi, '');
  // 2. 去除 Markdown 链接格式 [文字](链接) -> 保留文字
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 3. 去除 HTML 标签残留
  s = s.replace(/<[^>]+>/g, '');
  // 4. 去除所有 Emoji 与特殊装饰符号、图符
  s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\u2300-\u23FF•·※✦✧○●■□▲▼◆◇→←↑↓✓✔✕✖©®™]/g, ' ');
  // 5. 去除 Markdown 粗体、斜体、删除线、行内代码、标题标记：**text**, *text*, __text__, ~~text~~, `code`, #
  s = s.replace(/[*_~`#]+/g, '');
  // 6. 去除箭头符 -> => <-
  s = s.replace(/[-=]>\s*|<\s*[-=]/g, ' ');
  // 7. 去除行首列表、引用与编号标记：- , + , * , > , 1. 
  s = s.replace(/^[\s>+\-]+/gm, '');
  // 8. 处理斜杠：非数字分数情况下的斜杠（如 A/B, and/or）替换为逗号停顿，严防读成 "slash" 或 "斜杠"
  s = s.replace(/(?<!\d)\/|\/(?!\d)/g, ', ');
  // 9. 去除竖线、反斜杠、波浪线、插入符、等号等特殊排版符号
  s = s.replace(/[|\\^=~_]+/g, ' ');
  // 10. 处理括号（保留括号内文字，移除括号符号本身）
  s = s.replace(/[()\[\]{}【】（）「」《》]/g, ' ');
  // 11. 连续破折号转为自然逗号停顿
  s = s.replace(/[-—]{2,}/g, ', ');
  // 12. 规范化连续标点符号（如 ???, !!! -> ?, !）
  s = s.replace(/([!?,.。！？])\1+/g, '$1');
  // 13. 数字朗读友好化（仅当含有数字时）
  if (typeof NumberNormalizer !== 'undefined' && NumberNormalizer.needsNormalization && NumberNormalizer.needsNormalization(s)) {
    try { s = NumberNormalizer.normalize(s); } catch(e) {}
  }
  // 14. 压缩连续空白
  s = s.replace(/\s+/g, ' ').trim();
  return s || sentence;
}

/** 播放音频（标准 Blob ObjectURL / 原生精准 onended 触发 / 动态时长 + 心跳防死锁 + 声画毫秒级对齐） */
function playAudioUrl(url, onStart = null) {
  return new Promise((resolve) => {
    if (stopImmediate || !isPlaying) return resolve();
    let done = false;
    let started = false;
    let heartbeatTimer = null;
    let activePlaySeconds = 0;
    let maxAllowedSeconds = 60; // 初始默认保底 60 秒（待音频元数据返回后自适应调整）
    let lastTime = 0;
    let stallCount = 0;

    function triggerStart() {
      if (!started && !done && isPlaying && !stopImmediate) {
        started = true;
        if (typeof onStart === 'function') {
          try { onStart(); } catch(e) { DebugLog.add('onStart error: ' + e.message); }
        }
      }
    }

    function finish() {
      if (!done) {
        done = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (currentAudio) {
          try {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio.src = '';
          } catch(e) {}
          currentAudio = null;
        }
        interruptCurrentPlayback = null;
        resolve();
      }
    }

    const audio = new Audio(url);
    currentAudio = audio;

    interruptCurrentPlayback = () => {
      finish();
    };

    audio.onended = () => {
      DebugLog.add('Audio onended naturally');
      finish();
    };

    audio.onerror = (e) => {
      DebugLog.add('Audio onerror fired: ' + (audio.error ? audio.error.message : ''));
      finish();
    };

    // 墨阅经验：音频真正开始解码发出声音（playing / timeupdate）的瞬间才高亮，杜绝高亮抢跑
    audio.addEventListener('playing', triggerStart);
    audio.addEventListener('play', () => {
      setTimeout(triggerStart, 80);
    });
    audio.addEventListener('timeupdate', () => {
      if (audio.currentTime > 0.03) triggerStart();
    });

    // 动态感知音频真实总时长：以真实 duration 为基准，加 15 秒缓冲，长句绝不提前掐断
    const syncDuration = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        maxAllowedSeconds = Math.max(20, Math.round(audio.duration) + 15);
        DebugLog.add(`Audio metadata loaded, duration=${audio.duration.toFixed(1)}s, maxAllowed=${maxAllowedSeconds}s`);
      }
    };

    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('canplay', syncDuration);

    // 播放心跳与活性监控器（每 1 秒巡检一次）
    heartbeatTimer = setInterval(() => {
      if (done) return;
      if (isPaused) {
        stallCount = 0;
        return;
      }

      if (!audio.paused) {
        activePlaySeconds++;

        if (audio.currentTime > lastTime + 0.05) {
          lastTime = audio.currentTime;
          stallCount = 0;
        } else if (audio.currentTime > 0) {
          stallCount++;
          if (stallCount >= 8) {
            DebugLog.add('Audio playback stalled for 8s, auto recovering');
            finish();
            return;
          }
        } else if (audio.currentTime === 0 && activePlaySeconds >= 15) {
          DebugLog.add('Audio failed to buffer/play within 15s, skipping');
          finish();
          return;
        }

        if (activePlaySeconds >= maxAllowedSeconds) {
          DebugLog.add(`Audio reached max dynamic safety threshold (${maxAllowedSeconds}s), completing`);
          finish();
          return;
        }
      }
    }, 1000);

    audio.play().catch(err => {
      DebugLog.add('Audio play error: ' + err.message);
      finish();
    });
  });
}

/** 播放单个 Utterance（浏览器原生 TTS，双语智能音色匹配 + boundary 字词级同步） */
function playSpeechUtterance(text, lang, customVoiceName = '', onStart = null, onBoundary = null) {
  return new Promise((resolve) => {
    if (stopImmediate || !isPlaying) return resolve();
    if (!window.speechSynthesis) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    const speed = settings.ttsSpeed || 1.0;
    utterance.rate = speed;
    utterance.lang = lang || 'zh-CN';

    const matchedVoice = getBestBrowserVoice(lang, customVoiceName);
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    let done = false;
    let started = false;
    let timer = null;

    function triggerStart() {
      if (!started && !done && isPlaying && !stopImmediate) {
        started = true;
        if (typeof onStart === 'function') {
          try { onStart(); } catch(e) { DebugLog.add('utterance onStart error: ' + e.message); }
        }
      }
    }

    function finish() {
      if (!done) {
        done = true;
        if (timer) clearTimeout(timer);
        interruptCurrentPlayback = null;
        resolve();
      }
    }

    interruptCurrentPlayback = () => {
      try { window.speechSynthesis.cancel(); } catch(e) {}
      finish();
    };

    utterance.onstart = () => {
      DebugLog.add('SpeechUtterance onstart');
      triggerStart();
    };

    // 墨阅经验：监听原生 TTS boundary 事件，实现毫秒级字词进度跟随
    utterance.onboundary = (e) => {
      if (typeof onBoundary === 'function') {
        try {
          onBoundary(e.charIndex, e.charLength || 1, e.name);
        } catch(err) {}
      }
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);

    // 兜底启动（避免个别老版本浏览器未触发 onstart 导致永远不高亮）
    setTimeout(triggerStart, 150);

    // 针对无声卡/模拟环境的自适应时长保底：
    const isZh = (typeof TextUtils !== 'undefined' && TextUtils.isChinese) ? TextUtils.isChinese(text) : /[\u4e00-\u9fa5]/.test(text);
    const units = isZh ? text.length : text.split(/\s+/).filter(Boolean).length;
    const estMs = Math.round((units * 450) / speed) + 10000;
    const estDuration = Math.max(6000, Math.min(180000, estMs));

    timer = setTimeout(() => {
      if (!done) {
        DebugLog.add(`SpeechUtterance safety timeout reached (${Math.round(estDuration / 1000)}s)`);
        finish();
      }
    }, estDuration);
  });
}

// ====== 核心朗读执行调度器（多语种双核引擎 + 绝对可用保底 + 双重预读流水线） ======
async function playSentencesFlow(sentences) {
  currentSentences = sentences;
  isPlaying = true;
  isPaused = false;
  pendingJumpIndex = null;
  currentSentenceIndex = 0;
  showBar();
  updateReaderPlayButton();
  const playBtn = floatingBar?.querySelector('#readmate-play-btn');
  if (playBtn) playBtn.textContent = '⏸';
  DebugLog.add(`playSentencesFlow started: ${sentences.length} sentences`);

  const useCloud = (settings.ttsEngine !== 'browser') && settings.cloudTtsEndpoint && settings.cloudTtsEndpoint.includes('://');
  const ttsEndpoint = (settings.cloudTtsEndpoint || 'http://192.168.199.159:5001').replace(/\/+$/, '') + '/tts';
  const targetLangCode = LANG_NAME_TO_CODE[settings.translateTarget] || 'zh-CN';
  const bufferSize = settings.ttsBuffer || 2;
  const currentSpeed = settings.ttsSpeed || 1.0;

  // 原文音色与译文音色匹配（附带强制保底与双语自动映射）
  let origVoice = useCloud ? getBestVoiceForLang(detectedDocLang, settings.cloudTtsVoiceOrig || settings.cloudTtsVoice) : '';
  let transVoice = useCloud ? getBestVoiceForLang(targetLangCode, settings.cloudTtsVoiceTrans) : '';
  if (!origVoice) origVoice = (detectedDocLang && detectedDocLang.startsWith('zh')) ? 'zh-CN-XiaoxiaoNeural' : (detectedDocLang && detectedDocLang.startsWith('ko') ? 'ko-KR-SunHiNeural' : 'en-US-JennyNeural');
  if (!transVoice) transVoice = (targetLangCode && targetLangCode.startsWith('en')) ? 'en-US-JennyNeural' : 'zh-CN-XiaoxiaoNeural';

  DebugLog.add(`TTS Config: useCloud=${useCloud}, endpoint=${ttsEndpoint}, origVoice=${origVoice}, buffer=${bufferSize}`);

  // 1. 预先启动开篇几句的预读流水线
  prefetchAhead(sentences, -1, bufferSize + 1, ttsEndpoint, origVoice, transVoice, currentSpeed, useCloud);

  while (isPlaying && !stopImmediate && currentSentenceIndex < sentences.length) {
    if (pendingJumpIndex !== null) {
      currentSentenceIndex = pendingJumpIndex;
      pendingJumpIndex = null;
    }
    const i = currentSentenceIndex;
    DebugLog.add(`Loop top: i=${i}, isPlaying=${isPlaying}, stopImmediate=${stopImmediate}`);

    while (isPaused) {
      await new Promise(r => setTimeout(r, 150));
      if (!isPlaying || stopImmediate) break;
      if (pendingJumpIndex !== null) break;
    }
    if (!isPlaying || stopImmediate) break;

    if (pendingJumpIndex !== null) {
      currentSentenceIndex = pendingJumpIndex;
      pendingJumpIndex = null;
      continue;
    }

    const origSentence = sentences[i];
    DebugLog.add(`Playing sentence ${i + 1}/${sentences.length}: "${origSentence.substring(0, 30)}..."`);
    updateBarProgress(i + 1, sentences.length);

    // 墨阅经验：严谨声画对齐。绝不在获取音频前抢跑高亮，仅当真正出声（onStart）时点亮并滚动到屏幕中央
    let currentSentenceHighlighted = false;
    const triggerCurrentHighlight = () => {
      if (!currentSentenceHighlighted && isPlaying && !stopImmediate && pendingJumpIndex === null) {
        currentSentenceHighlighted = true;
        const offset = typeof settings.highlightOffset === 'number' ? settings.highlightOffset : 0;
        const targetIdx = Math.max(0, Math.min(sentences.length - 1, i + offset));
        highlightSentence(targetIdx);
      }
    };

    // 句内 boundary 字词级跟读回调
    const handleWordBoundary = (charIndex, charLength) => {
      if (activeHighlightRange) {
        highlightWordInRange(activeHighlightRange, charIndex, charLength);
      }
    };

    // 2. 保持预读流水线滑动向前推荐后续 bufferSize 句
    prefetchAhead(sentences, i, bufferSize, ttsEndpoint, origVoice, transVoice, currentSpeed, useCloud);

    // 3. 准备当前句译文（仅在开启双语时才请求 AI，不开启 0 Token 消耗）
    let transSentence = translationCache.get(origSentence) || '';
    if (enableBilingual && !transSentence && (readVoiceMode !== 'original' || showBilingualSubtitles)) {
      updateSubtitleDisplay(origSentence, _t('toastGeneratingSummary', 'Translating...'));
      try {
        transSentence = await Promise.race([
          fetchTranslation(origSentence),
          new Promise(r => setTimeout(() => r(''), 3000))
        ]);
      } catch(e) {
        transSentence = '';
      }
    }
    if (!isPlaying || stopImmediate) break;
    if (pendingJumpIndex !== null) continue;

    updateSubtitleDisplay(origSentence, enableBilingual ? transSentence : '');

    // 4. 根据模式决定播放流（完全采用发音净化后的文本）
    const speechOrig = getSpeechText(origSentence);
    try {
      if (readVoiceMode === 'original') {
        // 1. 仅读原文
        if (useCloud) {
          try {
            const dataUrl = await getOrFetchTtsAudio(ttsEndpoint, speechOrig, origVoice, currentSpeed);
            if (dataUrl && isPlaying && !stopImmediate && pendingJumpIndex === null) {
              await playAudioUrl(dataUrl, triggerCurrentHighlight);
            }
          } catch(e) {
            DebugLog.add('Cloud TTS failed, fallback: ' + e.message);
            if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
              await playSpeechUtterance(speechOrig, detectedDocLang, settings.ttsVoiceOrig || settings.ttsVoice, triggerCurrentHighlight, handleWordBoundary);
            }
          }
        } else {
          if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
            await playSpeechUtterance(speechOrig, detectedDocLang, settings.ttsVoiceOrig || settings.ttsVoice, triggerCurrentHighlight, handleWordBoundary);
          }
        }
      } else if (readVoiceMode === 'translated') {
        // 2. 直接读译文
        const speechText = getSpeechText(transSentence || origSentence);
        if (useCloud) {
          try {
            const dataUrl = await getOrFetchTtsAudio(ttsEndpoint, speechText, transVoice, currentSpeed);
            if (dataUrl && isPlaying && !stopImmediate && pendingJumpIndex === null) {
              await playAudioUrl(dataUrl, triggerCurrentHighlight);
            }
          } catch(e) {
            DebugLog.add('Cloud TTS failed, fallback: ' + e.message);
            if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
              await playSpeechUtterance(speechText, targetLangCode, settings.ttsVoiceTrans, triggerCurrentHighlight, handleWordBoundary);
            }
          }
        } else {
          if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
            await playSpeechUtterance(speechText, targetLangCode, settings.ttsVoiceTrans, triggerCurrentHighlight, handleWordBoundary);
          }
        }
      } else if (readVoiceMode === 'bilingual') {
        // 3. 双语交替读（先读原文，再读译文）
        // 原文句
        if (useCloud) {
          try {
            const dataUrlOrig = await getOrFetchTtsAudio(ttsEndpoint, speechOrig, origVoice, currentSpeed);
            if (dataUrlOrig && isPlaying && !stopImmediate && pendingJumpIndex === null) {
              await playAudioUrl(dataUrlOrig, triggerCurrentHighlight);
            }
          } catch(e) {
            if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
              await playSpeechUtterance(speechOrig, detectedDocLang, settings.ttsVoiceOrig || settings.ttsVoice, triggerCurrentHighlight, handleWordBoundary);
            }
          }
        } else {
          if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
            await playSpeechUtterance(speechOrig, detectedDocLang, settings.ttsVoiceOrig || settings.ttsVoice, triggerCurrentHighlight, handleWordBoundary);
          }
        }

        if (!isPlaying || stopImmediate || pendingJumpIndex !== null) continue;

        // 稍微停顿 250ms
        await new Promise(r => setTimeout(r, 250));
        if (!isPlaying || stopImmediate || pendingJumpIndex !== null) continue;

        // 译文句（保持屏幕原文高亮与段落上下文，字幕栏聚焦译文）
        const speechTrans = getSpeechText(transSentence || origSentence);
        if (speechTrans) {
          if (useCloud) {
            try {
              const dataUrlTrans = await getOrFetchTtsAudio(ttsEndpoint, speechTrans, transVoice, currentSpeed);
              if (dataUrlTrans && isPlaying && !stopImmediate && pendingJumpIndex === null) {
                await playAudioUrl(dataUrlTrans);
              }
            } catch(e) {
              if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
                await playSpeechUtterance(speechTrans, targetLangCode, settings.ttsVoiceTrans);
              }
            }
          } else {
            if (isPlaying && !stopImmediate && pendingJumpIndex === null) {
              await playSpeechUtterance(speechTrans, targetLangCode, settings.ttsVoiceTrans);
            }
          }
        }
      }
    } catch(err) {
      DebugLog.add('Sentence playback error: ' + err.message);
    }

    // 安全保底：如果因极短音频/纯标点导致未被触发，补全一次高亮记录
    if (!currentSentenceHighlighted && isPlaying && !stopImmediate && pendingJumpIndex === null) {
      triggerCurrentHighlight();
    }

    // 播放完成步进（如果用户未点跳转，自然推进到下一句）
    if (pendingJumpIndex !== null) {
      currentSentenceIndex = pendingJumpIndex;
      pendingJumpIndex = null;
    } else {
      currentSentenceIndex++;
    }
  }

  const finishedNaturally = isPlaying && !stopImmediate;
  isPlaying = false;
  updateReaderPlayButton();
  hideBar();
  if (finishedNaturally) {
    showTranslation(_t('toastArticleFinished', '🎉 当前文章已朗读完毕'), true);
  }
}

// ====== 主入口：启动文章朗读 ======
async function startReading(text, forceLang = null, voiceModeOverride = null) {
  if (!text || !text.trim()) return;
  DebugLog.add('== startReading v2.0 ==');
  await loadSettings();

  if (voiceModeOverride) {
    readVoiceMode = voiceModeOverride;
  }

  // 语种自动检测（支持显式指定，如摘要读译文时强行锁定为目标语言）
  if (forceLang) {
    detectedDocLang = forceLang;
  } else {
    try {
      detectedDocLang = detectTextLanguage(text);
    } catch(e) {
      detectedDocLang = 'en-US';
    }
  }
  DebugLog.add(`Detected doc language: ${detectedDocLang}`);

  cancelPlayback();
  stopImmediate = false;
  userStopped = false;

  let cleanText = text;
  try {
    cleanText = TextUtils.preprocess(text, {
      stripHtml: true,
      stripPinyin: true,
      stripFootnotes: true,
      stripDecorative: true,
      collapseWhitespace: true,
      cleanCjk: false,
    });
  } catch(e) {
    cleanText = text;
  }

  let sentences = [];
  try {
    sentences = TextUtils.splitSentences(cleanText);
  } catch(e) {
    sentences = [cleanText];
  }

  if (!sentences || sentences.length === 0) return;

  // 过滤掉纯标点符号或空白的无效句子
  sentences = sentences.filter(s => {
    const cleaned = getSpeechText(s);
    return cleaned && cleaned.replace(/[\s.,!?;:，。！？；：'"`~—\-_/\\|]+/g, '').length > 0;
  });

  if (sentences.length === 0) return;

  DebugLog.add(`Ready to play: ${sentences.length} sentences`);
  playSentencesFlow(sentences);
}

// ====== ⚡ AI 双语核心要闻摘要系统 ======
let summaryDialog = null;
let cachedSummaryList = null;

function updateFABSummaryState() {
  const summaryBtn = fabContainer?.querySelector('#readmate-fab-summary');
  if (summaryBtn) {
    if (cachedSummaryList && cachedSummaryList.length > 0) {
      summaryBtn.classList.add('has-summary');
    } else {
      summaryBtn.classList.remove('has-summary');
    }
  }
}

function closeSummaryDialog() {
  const dialogs = document.querySelectorAll('#readmate-summary-dialog, .readmate-summary-mask');
  dialogs.forEach(el => el.remove());
  summaryDialog = null;
  document.removeEventListener('keydown', handleSummaryKeydown);
  updateFABSummaryState();
}

function minimizeSummaryDialog() {
  if (summaryDialog) {
    summaryDialog.style.display = 'none';
  }
  updateFABSummaryState();
}

function handleSummaryKeydown(e) {
  if (e.key === 'Escape' || e.keyCode === 27) {
    closeSummaryDialog();
  }
}

async function generateAISummary(forceRefresh = false) {
  // 如果已存在最小化的弹窗且非强制刷新，直接展开
  if (!forceRefresh && summaryDialog && summaryDialog.style.display === 'none') {
    summaryDialog.style.display = '';
    return;
  }

  // 如果当前页面已有摘要缓存且非强制刷新，秒开展示
  if (!forceRefresh && cachedSummaryList && cachedSummaryList.length > 0) {
    showSummaryCard(cachedSummaryList);
    return;
  }

  closeSummaryDialog();
  await loadSettings();
  const apiKey = settings.aiApiKey || 'liang-gemini-proxy-2026';
  const endpoint = settings.aiEndpoint || 'http://192.168.199.159:28080/v1';
  const model = settings.aiModel || 'gemini-3.1-flash-lite';

  showTranslation(_t('toastGeneratingSummary', '⚡ 正在由 AI 提炼详细双语核心要闻...'), true);

  let pageText = '';
  try {
    const content = ContentExtractor.extract(document);
    pageText = (content && content.success && content.text) ? content.text : (document.body.innerText || '');
  } catch(e) {
    pageText = document.body.innerText || '';
  }

  chrome.runtime.sendMessage({
    action: 'proxySummarize',
    endpoint: endpoint,
    apiKey: apiKey,
    model: model,
    text: pageText,
    targetLang: settings.translateTarget || 'Simplified Chinese',
    docLang: detectedDocLang,
  }, (resp) => {
    if (!resp?.ok || !Array.isArray(resp.summary) || resp.summary.length === 0) {
      closeSummaryDialog();
      showTranslation(_t('toastSummaryFailed', '❌ 摘要生成失败: ') + (resp?.error || ''), true);
      return;
    }
    cachedSummaryList = resp.summary;
    updateFABSummaryState();
    showSummaryCard(resp.summary);
  });
}

/** 弹出精致的多语种/原文/译文摘要卡片 */
function showSummaryCard(summaryList) {
  closeSummaryDialog();

  summaryDialog = document.createElement('div');
  summaryDialog.id = 'readmate-summary-dialog';
  summaryDialog.innerHTML = `
    <div class="readmate-summary-mask" id="readmate-summary-mask"></div>
    <div class="readmate-summary-content">
      <div class="readmate-summary-head">
        <div class="readmate-summary-title">${_t('summaryCardTitle', '⚡ AI 核心要闻摘要')}</div>
        <div class="readmate-summary-head-right">
          <div class="readmate-summary-tabs" id="readmate-summary-tabs">
            <button class="readmate-summary-tab" data-view="bilingual" title="${_t('summaryTabBilingualTip', '双语对照模式')}">${_t('summaryTabBilingual', '🔄 双语')}</button>
            <button class="readmate-summary-tab" data-view="original" title="${_t('summaryTabOriginalTip', '仅看原文 (纯净沉浸)')}">${_t('summaryTabOriginal', '📄 原文')}</button>
            <button class="readmate-summary-tab" data-view="translated" title="${_t('summaryTabTranslatedTip', '仅看译文 (母语速览)')}">${_t('summaryTabTranslated', '🌐 译文')}</button>
          </div>
          <div class="readmate-summary-window-actions">
            <button class="readmate-summary-action-btn" id="readmate-summary-regen-btn" title="${_t('summaryRegenerateTip', '重新生成摘要')}">🔄</button>
            <button class="readmate-summary-action-btn" id="readmate-summary-min-btn" title="${_t('summaryMinimizeTip', '最小化')}">一</button>
            <button class="readmate-summary-action-btn readmate-summary-close" id="readmate-summary-close-btn" title="${_t('summaryCloseTip', '关闭 (ESC)')}">✕</button>
          </div>
        </div>
      </div>

      <div class="readmate-summary-list">
        ${summaryList.map((item, idx) => `
          <div class="readmate-summary-item" data-idx="${idx}">
            <div class="readmate-summary-idx">${idx + 1}</div>
            <div class="readmate-summary-texts">
              <div class="readmate-summary-orig">${item.original || ''}</div>
              <div class="readmate-summary-trans">${item.translated || ''}</div>
            </div>
            <div class="readmate-summary-item-actions">
              <button class="readmate-summary-play-btn" data-type="orig" title="${_t('readOriginal', '读原文')}">🗣️</button>
              <button class="readmate-summary-play-btn" data-type="trans" title="${_t('readTranslated', '读译文')}">🌐</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="readmate-summary-foot">
        <div class="readmate-summary-actions-left">
          <button class="readmate-btn-primary" id="readmate-summary-play-bilingual" title="${_t('summaryPlayBilingualTip', '双语交替读摘要')}">${_t('summaryPlayBilingual', '🔄 连播摘要 (双语)')}</button>
          <button class="readmate-btn-ghost" id="readmate-summary-play-orig" title="${_t('summaryPlayOrigTip', '仅读原文摘要')}">${_t('summaryPlayOrig', '🔊 读原文')}</button>
          <button class="readmate-btn-ghost" id="readmate-summary-play-trans" title="${_t('summaryPlayTransTip', '直接读译文摘要')}">${_t('summaryPlayTrans', '🌐 读译文')}</button>
        </div>
        <button class="readmate-btn-ghost" id="readmate-summary-copy-md">${_t('copyMarkdown', '📋 复制 Markdown')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(summaryDialog);
  document.addEventListener('keydown', handleSummaryKeydown);

  // 切换呈现模式（双语 / 仅原文 / 仅译文）
  function applySummaryView(viewMode) {
    summaryDialog.setAttribute('data-view', viewMode);
    summaryDialog.querySelectorAll('.readmate-summary-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === viewMode);
    });

    const btnBilingual = summaryDialog.querySelector('#readmate-summary-play-bilingual');
    const btnOrig = summaryDialog.querySelector('#readmate-summary-play-orig');
    const btnTrans = summaryDialog.querySelector('#readmate-summary-play-trans');

    if (viewMode === 'original') {
      if (btnOrig) btnOrig.className = 'readmate-btn-primary';
      if (btnBilingual) btnBilingual.className = 'readmate-btn-ghost';
      if (btnTrans) btnTrans.className = 'readmate-btn-ghost';
    } else if (viewMode === 'translated') {
      if (btnTrans) btnTrans.className = 'readmate-btn-primary';
      if (btnBilingual) btnBilingual.className = 'readmate-btn-ghost';
      if (btnOrig) btnOrig.className = 'readmate-btn-ghost';
    } else {
      if (btnBilingual) btnBilingual.className = 'readmate-btn-primary';
      if (btnOrig) btnOrig.className = 'readmate-btn-ghost';
      if (btnTrans) btnTrans.className = 'readmate-btn-ghost';
    }
  }

  // 初始化应用默认呈现模式
  const initialView = settings.defaultSummaryView || 'bilingual';
  applySummaryView(initialView);

  // 绑定模式切换点击事件
  summaryDialog.querySelectorAll('.readmate-summary-tab').forEach(tab => {
    tab.onclick = () => applySummaryView(tab.dataset.view);
  });

  // 操作按钮绑定（注意：不再绑定遮罩层点击关闭，防止误触）
  summaryDialog.querySelector('#readmate-summary-regen-btn').onclick = () => generateAISummary(true);
  summaryDialog.querySelector('#readmate-summary-min-btn').onclick = minimizeSummaryDialog;
  summaryDialog.querySelector('#readmate-summary-close-btn').onclick = closeSummaryDialog;

  // 单条点播
  summaryDialog.querySelectorAll('.readmate-summary-play-btn').forEach(btn => {
    btn.onclick = (e) => {
      const type = btn.dataset.type;
      const itemEl = btn.closest('.readmate-summary-item');
      const idx = parseInt(itemEl.dataset.idx);
      const item = summaryList[idx];
      const targetLangCode = LANG_NAME_TO_CODE[settings.translateTarget] || 'zh-CN';
      if (type === 'orig') {
        const itemDocLang = detectTextLanguage(item.original);
        startReading(item.original, itemDocLang, 'original');
      } else {
        startReading(item.translated, targetLangCode, 'original');
      }
    };
  });

  // 连播全部（支持三种模式，不关闭弹窗，由用户手动关闭）
  summaryDialog.querySelector('#readmate-summary-play-bilingual').onclick = () => {
    const origSentences = [];
    summaryList.forEach(item => {
      if (item.original) {
        origSentences.push(item.original);
        if (item.translated) {
          translationCache.set(item.original, item.translated);
        }
      }
    });
    enableBilingual = true;
    const allOrigText = origSentences.join('\n\n');
    const firstOrigLang = detectTextLanguage(allOrigText);
    startReading(allOrigText, firstOrigLang, 'bilingual');
  };

  summaryDialog.querySelector('#readmate-summary-play-orig').onclick = () => {
    const origSentences = summaryList.map(item => item.original).filter(Boolean);
    const allOrigText = origSentences.join('\n\n');
    const origLang = detectTextLanguage(allOrigText);
    startReading(allOrigText, origLang, 'original');
  };

  summaryDialog.querySelector('#readmate-summary-play-trans').onclick = () => {
    const targetLangCode = LANG_NAME_TO_CODE[settings.translateTarget] || 'zh-CN';
    const transSentences = summaryList.map(item => item.translated).filter(Boolean);
    startReading(transSentences.join('\n\n'), targetLangCode, 'original');
  };

  // 复制 Markdown
  summaryDialog.querySelector('#readmate-summary-copy-md').onclick = () => {
    const md = `# ${document.title || 'Summary'}\n\n` + summaryList.map((item, i) => `${i + 1}. **${item.original}**\n   *${item.translated}*`).join('\n\n');
    navigator.clipboard?.writeText(md);
    showTranslation(_t('toastCopied', '✓ 已复制到剪贴板'), true);
  };
}

// ====== 句子高亮算法（基于 Range 精确字元定位 + 原生 CSS Custom Highlight 支持 + 墨阅双层段落体系） ======
let highlightSpans = [];
let activeHighlightRange = null;
let activeParagraphEl = null;

function clearHighlights() {
  if (isReaderModeActive && readerOverlay) {
    readerOverlay.querySelectorAll('.readmate-reader-active-s').forEach(el => el.classList.remove('readmate-reader-active-s'));
    readerOverlay.querySelectorAll('.readmate-reader-active-p').forEach(el => el.classList.remove('readmate-reader-active-p'));
  }
  if (window.CSS && CSS.highlights) {
    try {
      CSS.highlights.delete('readmate-highlight');
      CSS.highlights.delete('readmate-word-highlight');
    } catch(e) {}
  }
  highlightSpans.forEach(span => {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
  });
  highlightSpans = [];
  activeHighlightRange = null;

  if (activeParagraphEl) {
    try {
      activeParagraphEl.classList.remove('readmate-active-paragraph');
    } catch(e) {}
    activeParagraphEl = null;
  }
}

/** 向上寻找合适的段落/块级容器元素（墨阅式段落级上下文视觉底座） */
function findParagraphContainer(node) {
  if (!node) return null;
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const tag = el.tagName.toLowerCase();
    if (['p', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption'].includes(tag)) {
      return el;
    }
    if (tag === 'div' || tag === 'section' || tag === 'article') {
      const len = el.textContent ? el.textContent.trim().length : 0;
      // 避免选中整个大文章容器，只挑选合理长度的独立段落块
      if (len > 0 && len < 2000) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/** 更新当前活跃段落的高亮状态（保持平滑无感过渡） */
function updateActiveParagraph(node) {
  if (settings.highlightParagraphEnabled === false) return;
  const newPara = findParagraphContainer(node);
  if (activeParagraphEl && activeParagraphEl !== newPara) {
    try { activeParagraphEl.classList.remove('readmate-active-paragraph'); } catch(e) {}
    activeParagraphEl = null;
  }
  if (newPara && newPara !== activeParagraphEl) {
    activeParagraphEl = newPara;
    try { activeParagraphEl.classList.add('readmate-active-paragraph'); } catch(e) {}
  }
}

/** 句内字词级流动高亮（原生 Speech boundary 事件驱动，卡拉OK式体验） */
function highlightWordInRange(parentRange, charIndex, charLength = 1) {
  if (!parentRange || !window.CSS || !CSS.highlights) return;
  try {
    const walker = document.createTreeWalker(
      parentRange.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return parentRange.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let currentOffset = 0;
    let wordStartNode = null;
    let wordStartOffset = 0;
    let wordEndNode = null;
    let wordEndOffset = 0;

    let node;
    while ((node = walker.nextNode())) {
      const nodeStartInParent = Math.max(0, node === parentRange.startContainer ? parentRange.startOffset : 0);
      const nodeEndInParent = Math.min(node.textContent.length, node === parentRange.endContainer ? parentRange.endOffset : node.textContent.length);
      const effectiveLen = nodeEndInParent - nodeStartInParent;

      if (!wordStartNode && charIndex >= currentOffset && charIndex < currentOffset + effectiveLen) {
        wordStartNode = node;
        wordStartOffset = nodeStartInParent + (charIndex - currentOffset);
      }

      const targetEnd = charIndex + Math.max(1, charLength);
      if (!wordEndNode && targetEnd >= currentOffset && targetEnd <= currentOffset + effectiveLen) {
        wordEndNode = node;
        wordEndOffset = nodeStartInParent + (targetEnd - currentOffset);
      }

      currentOffset += effectiveLen;
    }

    if (wordStartNode) {
      const wordRange = document.createRange();
      wordRange.setStart(wordStartNode, wordStartOffset);
      if (wordEndNode) {
        wordRange.setEnd(wordEndNode, wordEndOffset);
      } else {
        wordRange.setEnd(wordStartNode, Math.min(wordStartNode.textContent.length, wordStartOffset + Math.max(1, charLength)));
      }
      const wordHl = new Highlight(wordRange);
      CSS.highlights.set('readmate-word-highlight', wordHl);
    }
  } catch(e) {}
}

/** 在页面中精确定位目标句子的 Range（支持跨标签、跨行扫描） */
function findSentenceRange(targetText) {
  if (!targetText || targetText.length < 2) return null;
  const cleanTarget = targetText.replace(/\s+/g, ' ').trim();
  const sample = cleanTarget.length > 25 ? cleanTarget.substring(0, 25) : cleanTarget;

  // 1. 优先在文章正文区域搜索
  const root = document.querySelector('article, main, [role="main"], .article, .post, .entry-content') || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest('#readmate-bar, #readmate-fab-container, #readmate-summary-dialog, script, style, noscript, nav, footer, header')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent && n.textContent.trim()) {
      textNodes.push(n);
    }
  }

  // 2. 找到包含 sample 的起始节点
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    const idx = node.textContent.indexOf(sample);
    if (idx !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);

      let remainingChars = cleanTarget.length;
      let currIdx = i;
      let currOffset = idx;

      while (currIdx < textNodes.length && remainingChars > 0) {
        const currNode = textNodes[currIdx];
        const availInNode = currNode.textContent.length - currOffset;
        if (remainingChars <= availInNode) {
          range.setEnd(currNode, currOffset + remainingChars);
          remainingChars = 0;
          break;
        } else {
          remainingChars -= availInNode;
          currIdx++;
          currOffset = 0;
        }
      }

      if (remainingChars === 0) {
        return range;
      } else if (currIdx > i) {
        range.setEnd(textNodes[Math.min(currIdx, textNodes.length - 1)], textNodes[Math.min(currIdx, textNodes.length - 1)].textContent.length);
        return range;
      }
    }
  }

  // 3. 容错：去除标点后进行紧凑匹配
  const compactTarget = cleanTarget.replace(/[\s.,!?;:，。！？；：'"`~—\-_/\\|]+/g, '').toLowerCase();
  if (compactTarget.length >= 4) {
    const head = compactTarget.substring(0, Math.min(15, compactTarget.length));
    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];
      const compactNode = node.textContent.replace(/[\s.,!?;:，。！？；：'"`~—\-_/\\|]+/g, '').toLowerCase();
      const matchIdx = compactNode.indexOf(head);
      if (matchIdx !== -1) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range;
      }
    }
  }

  return null;
}

function highlightSentence(index) {
  clearHighlights();
  if (isReaderModeActive) {
    highlightReaderModeSentence(index);
  }
  if (!settings.highlightEnabled || !currentSentences[index]) return;

  const targetText = currentSentences[index].trim();
  if (targetText.length < 2) return;

  // 1. 优先标题匹配
  const headings = document.querySelectorAll('h1, h2, h3, [class*="headline"], [class*="title"]');
  for (const h of headings) {
    if (h.textContent.trim().includes(targetText.substring(0, 20))) {
      h.classList.add('readmate-highlight-heading');
      highlightSpans.push(h);
      updateActiveParagraph(h);
      h.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  // 2. 精确 Range 高亮
  const range = findSentenceRange(targetText);
  if (range) {
    activeHighlightRange = range;
    updateActiveParagraph(range.commonAncestorContainer || range.startContainer);
    let customHighlightSuccess = false;
    if (window.CSS && CSS.highlights) {
      try {
        const highlight = new Highlight(range);
        CSS.highlights.set('readmate-highlight', highlight);
        customHighlightSuccess = true;
      } catch(e) {}
    }

    if (!customHighlightSuccess) {
      try {
        const span = document.createElement('span');
        span.className = 'readmate-highlight';
        range.surroundContents(span);
        highlightSpans.push(span);
      } catch(e) {
        const parent = range.commonAncestorContainer;
        const el = parent.nodeType === Node.ELEMENT_NODE ? parent : parent.parentElement;
        if (el) {
          el.classList.add('readmate-highlight');
          highlightSpans.push(el);
        }
      }
    }

    // 平滑滚动定位到视野中央
    try {
      const rect = range.getBoundingClientRect();
      const targetScrollY = window.scrollY + rect.top - (window.innerHeight / 2) + (rect.height / 2);
      window.scrollTo({
        top: Math.max(0, targetScrollY),
        behavior: 'smooth'
      });
    } catch(e) {}
  }
}

// ====== 沉浸净读模式（方案 A 全屏纯净书页） ======
let isReaderModeActive = false;
let readerOverlay = null;
let readerTheme = 'sepia';
let readerFontSize = 19;
let readerSentences = []; // 权威句子列表：确保眼睛看到的每一句与耳朵听到的每一句 100% 绝对一致！
try {
  readerTheme = localStorage.getItem('readmate_reader_theme') || 'sepia';
  readerFontSize = parseInt(localStorage.getItem('readmate_reader_font_size') || '19', 10);
} catch(e) {}
let cachedReaderContent = null;

function ensureReaderOverlay() {
  if (readerOverlay) return readerOverlay;

  readerOverlay = document.createElement('div');
  readerOverlay.id = 'readmate-reader-overlay';
  readerOverlay.dataset.theme = readerTheme;
  readerOverlay.style.display = 'none';

  readerOverlay.innerHTML = `
    <header class="readmate-reader-header">
      <div class="readmate-reader-header-left">
        <button id="readmate-reader-close" class="readmate-reader-btn" title="${_t('btnExitReader', '返回网页 (ESC)')}">
          ✕ ${_t('btnExitReader', '返回网页')}
        </button>
      </div>
      <div class="readmate-reader-header-center">
        <span class="readmate-reader-stats" id="readmate-reader-stats"></span>
      </div>
      <div class="readmate-reader-header-right">
        <!-- 主题切换 -->
        <div class="readmate-theme-picker" title="${_t('tipThemePicker', '切换阅读底色')}">
          <button class="readmate-theme-dot theme-sepia ${readerTheme === 'sepia' ? 'active' : ''}" data-theme="sepia" title="米黄羊皮纸"></button>
          <button class="readmate-theme-dot theme-light ${readerTheme === 'light' ? 'active' : ''}" data-theme="light" title="纯净白"></button>
          <button class="readmate-theme-dot theme-green ${readerTheme === 'green' ? 'active' : ''}" data-theme="green" title="护眼绿"></button>
          <button class="readmate-theme-dot theme-dark ${readerTheme === 'dark' ? 'active' : ''}" data-theme="dark" title="夜间墨黑"></button>
        </div>
        <!-- 字号调节 -->
        <div class="readmate-font-controls" title="${_t('tipFontSize', '调节正文字号')}">
          <button id="readmate-font-dec" class="readmate-reader-btn-icon" title="缩小字号">A-</button>
          <span id="readmate-font-val">${readerFontSize}</span>
          <button id="readmate-font-inc" class="readmate-reader-btn-icon" title="放大字号">A+</button>
        </div>
        <!-- 导出 PDF -->
        <button id="readmate-reader-print-btn" class="readmate-reader-btn" title="${_t('btnExportPdf', '导出排版 PDF (打印)')}">
          📄 PDF
        </button>
        <!-- 导出整篇有声书 -->
        <button id="readmate-reader-download-audio-btn" class="readmate-reader-btn readmate-btn-pdf" title="${_t('btnDownloadAudio', '下载整篇语音 (MP3)')}">
          📥 ${_t('btnAudio', '下载语音')}
        </button>
        <!-- 生词本 -->
        <button id="readmate-reader-vocab-btn" class="readmate-reader-btn" title="${_t('btnVocabNotebook', '我的生词本')}">
          📚 ${_t('btnVocab', '生词本')}
        </button>
      </div>
    </header>

    <main class="readmate-reader-main" id="readmate-reader-main">
      <article class="readmate-reader-article" id="readmate-reader-article">
        <h1 class="readmate-reader-title" id="readmate-reader-title"></h1>
        <div class="readmate-reader-meta" id="readmate-reader-meta"></div>

        <!-- 显式专属朗读条（解决进入后找不到播放按钮的痛点） -->
        <div class="readmate-reader-action-bar">
          <button id="readmate-reader-play-main" class="readmate-reader-play-btn">
            <span class="readmate-reader-play-icon">▶</span>
            <span class="readmate-reader-play-text">${_t('btnPlayArticle', '开始朗读全文')}</span>
          </button>
          <span class="readmate-reader-play-progress" id="readmate-reader-play-progress"></span>
        </div>

        <div class="readmate-reader-body" id="readmate-reader-body" style="font-size: ${readerFontSize}px;"></div>
      </article>
    </main>
  `;

  document.body.appendChild(readerOverlay);

  // 绑定事件：点返回按钮时退出并回退 history
  readerOverlay.querySelector('#readmate-reader-close').onclick = () => closeReaderMode(true);

  // 主播放按钮
  const mainPlayBtn = readerOverlay.querySelector('#readmate-reader-play-main');
  mainPlayBtn.onclick = () => {
    if (isPlaying) {
      togglePlayPause();
    } else {
      playReaderModeSentences(0);
    }
  };

  // 主题切换
  readerOverlay.querySelectorAll('.readmate-theme-dot').forEach(btn => {
    btn.onclick = () => {
      const th = btn.dataset.theme;
      if (!th) return;
      readerTheme = th;
      readerOverlay.dataset.theme = th;
      readerOverlay.querySelectorAll('.readmate-theme-dot').forEach(b => b.classList.toggle('active', b === btn));
      try { localStorage.setItem('readmate_reader_theme', th); } catch(e) {}
    };
  });

  // 字号增减
  const fontValEl = readerOverlay.querySelector('#readmate-font-val');
  const bodyEl = readerOverlay.querySelector('#readmate-reader-body');
  readerOverlay.querySelector('#readmate-font-dec').onclick = () => {
    readerFontSize = Math.max(14, readerFontSize - 1);
    fontValEl.textContent = readerFontSize;
    bodyEl.style.fontSize = readerFontSize + 'px';
    try { localStorage.setItem('readmate_reader_font_size', String(readerFontSize)); } catch(e) {}
  };
  readerOverlay.querySelector('#readmate-font-inc').onclick = () => {
    readerFontSize = Math.min(28, readerFontSize + 1);
    fontValEl.textContent = readerFontSize;
    bodyEl.style.fontSize = readerFontSize + 'px';
    try { localStorage.setItem('readmate_reader_font_size', String(readerFontSize)); } catch(e) {}
  };

  // 导出 PDF
  readerOverlay.querySelector('#readmate-reader-print-btn').onclick = exportPdf;

  // 下载整篇语音 MP3
  readerOverlay.querySelector('#readmate-reader-download-audio-btn').onclick = downloadFullAudio;

  // 生词本抽屉
  readerOverlay.querySelector('#readmate-reader-vocab-btn').onclick = openVocabDrawer;

  // “指哪读哪”：防抖 220ms，若 220ms 内触发了双击查词，此定时器被即刻取消，绝不误触朗读！
  bodyEl.addEventListener('click', (e) => {
    if (e.target.closest('#readmate-dict-bubble') || e.target.closest('#readmate-vocab-drawer')) return;

    if (dictBubble) {
      hideDictBubble();
      return;
    }

    const sEl = e.target.closest('.readmate-reader-s');
    if (!sEl || sEl.dataset.sentenceIdx === undefined) return;
    const sIdx = parseInt(sEl.dataset.sentenceIdx, 10);
    if (isNaN(sIdx)) return;

    if (readerClickTimer) clearTimeout(readerClickTimer);
    readerClickTimer = setTimeout(async () => {
      readerClickTimer = null;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

      DebugLog.add(`Single click confirmed on sentence #${sIdx}`);
      if (!isPlaying) {
        await playReaderModeSentences(sIdx);
      } else {
        jumpToSentence(sIdx);
      }
    }, 220);
  });

  return readerOverlay;
}

let readerClickTimer = null;

function updateReaderPlayButton() {
  if (!readerOverlay) return;
  const icon = readerOverlay.querySelector('.readmate-reader-play-icon');
  const txt = readerOverlay.querySelector('.readmate-reader-play-text');
  if (icon && txt) {
    if (isPlaying && !isPaused) {
      icon.textContent = '⏸';
      txt.textContent = _t('btnPause', '暂停朗读');
    } else if (isPaused) {
      icon.textContent = '▶';
      txt.textContent = _t('btnResume', '继续朗读');
    } else {
      icon.textContent = '▶';
      txt.textContent = _t('btnPlayArticle', '开始朗读全文');
    }
  }
}

function renderReaderModeContent() {
  ensureReaderOverlay();
  const canonical = getCanonicalArticle();
  const pageTitle = canonical.title;
  const paras = canonical.paragraphs;

  const titleEl = readerOverlay.querySelector('#readmate-reader-title');
  const metaEl = readerOverlay.querySelector('#readmate-reader-meta');
  const bodyEl = readerOverlay.querySelector('#readmate-reader-body');
  const statsEl = readerOverlay.querySelector('#readmate-reader-stats');

  let globalSentenceCounter = 0;

  // 大标题作为第 0 句
  if (pageTitle && pageTitle.length > 1) {
    const safeTitle = pageTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    titleEl.innerHTML = `<span class="readmate-reader-s" data-sentence-idx="0">${safeTitle}</span>`;
    globalSentenceCounter = 1;
  } else {
    titleEl.textContent = pageTitle;
  }

  const parasHtml = paras.map((p, pIdx) => {
    let cleanP = p;
    try {
      cleanP = TextUtils.preprocess(p, {
        stripHtml: true,
        collapseWhitespace: true,
      });
    } catch(e) {}

    let sentences = [];
    try {
      sentences = TextUtils.splitSentences(cleanP);
    } catch(e) {
      sentences = [cleanP];
    }

    sentences = sentences.filter(s => {
      const cl = getSpeechText(s);
      return cl && cl.replace(/[\s.,!?;:，。！？；：'"`~—\-_/\\|]+/g, '').length > 0;
    });

    if (sentences.length === 0) return '';

    const spansHtml = sentences.map(s => {
      const idx = globalSentenceCounter++;
      const safeText = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<span class="readmate-reader-s" data-sentence-idx="${idx}">${safeText}</span>`;
    }).join(' ');

    return `<p class="readmate-reader-p" data-para-idx="${pIdx}">${spansHtml}</p>`;
  }).filter(Boolean).join('\n');

  bodyEl.innerHTML = parasHtml;

  // 统计信息
  const totalChars = canonical.sentences.reduce((sum, s) => sum + s.length, 0);
  const estMinutes = Math.max(1, Math.round(totalChars / 350));
  const domain = window.location.hostname.replace(/^www\./, '');

  statsEl.textContent = `${totalChars} ${_t('statChars', '字')} · ${_t('statEst', '约')} ${estMinutes} ${_t('statMins', '分钟')}`;
  metaEl.innerHTML = `
    <span>🌐 ${domain}</span>
    <span>⏱️ ${_t('statEst', '约')} ${estMinutes} ${_t('statMins', '分钟朗读')}</span>
    <span>📝 ${canonical.sentences.length} ${_t('statParas', '个句子')}</span>
  `;

  const progEl = readerOverlay.querySelector('#readmate-reader-play-progress');
  if (progEl) {
    progEl.textContent = `共 ${canonical.sentences.length} 句 · 预计朗读 ${estMinutes} 分钟 · 单击任意句可直接开播`;
  }
}

/** 启动净读模式的朗读流（彻底解决语音文字不同步，100% 对应屏幕展示句子） */
async function playReaderModeSentences(startIdx = 0) {
  const canonical = getCanonicalArticle();
  if (!canonical || !canonical.sentences || canonical.sentences.length === 0) return;

  currentMode = 'reader';
  showBar();
  updateReaderPlayButton();

  cancelPlayback();
  stopImmediate = false;
  userStopped = false;

  if (startIdx > 0) {
    pendingJumpIndex = startIdx;
  }
  await playSentencesFlow(canonical.sentences);
}

function openReaderMode() {
  if (isReaderModeActive) return;
  isReaderModeActive = true;
  ensureReaderOverlay();
  renderReaderModeContent();
  readerOverlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  hideFAB();

  // 核心改进：进入净读模式时，底部控制条立即浮现可用
  showBar();
  updateReaderPlayButton();

  // 压入 history 状态，防止用户点浏览器后退键或鼠标手势直接跳出网站！
  try {
    window.history.pushState({ readmateReaderOpen: true }, '');
  } catch(e) {}

  if (isPlaying) {
    highlightReaderModeSentence(currentSentenceIndex);
  }
  DebugLog.add('Reader Mode opened');
}

function closeReaderMode(needPop = false) {
  if (!isReaderModeActive) return;
  isReaderModeActive = false;
  if (readerOverlay) {
    readerOverlay.style.display = 'none';
  }
  closeVocabDrawer();
  hideDictBubble();

  document.body.style.overflow = '';
  showFAB();
  updateReaderPlayButton();

  // 若由点击返回网页触发且历史栈在 reader 状态，安全回退
  if (needPop && window.history.state && window.history.state.readmateReaderOpen) {
    try {
      window.history.back();
    } catch(e) {}
  }

  // ★ 核心改进：从净读模式退回原网页时，无缝将原网页滚动并高亮到当前句子！
  if (isPlaying && currentSentences && currentSentences[currentSentenceIndex]) {
    setTimeout(() => {
      highlightSentence(currentSentenceIndex);
    }, 80);
  }
  DebugLog.add('Reader Mode closed');
}

function toggleReaderMode() {
  if (isReaderModeActive) closeReaderMode(true);
  else openReaderMode();
}

function exportPdf() {
  if (!isReaderModeActive) openReaderMode();
  document.body.classList.add('readmate-print-mode');
  showTranslation(_t('toastPreparingPdf', '📄 正在唤起系统打印/保存为 PDF...'), true);
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('readmate-print-mode');
    }, 500);
  }, 150);
}

function highlightReaderModeSentence(index) {
  if (!readerOverlay || !isReaderModeActive) return;
  readerOverlay.querySelectorAll('.readmate-reader-active-s').forEach(el => el.classList.remove('readmate-reader-active-s'));
  readerOverlay.querySelectorAll('.readmate-reader-active-p').forEach(el => el.classList.remove('readmate-reader-active-p'));

  const targetSpan = readerOverlay.querySelector(`.readmate-reader-s[data-sentence-idx="${index}"]`);
  if (targetSpan) {
    targetSpan.classList.add('readmate-reader-active-s');
    const p = targetSpan.closest('.readmate-reader-p');
    if (p) p.classList.add('readmate-reader-active-p');
    targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ========================================================
// 📥 整篇语音有声书合成打包下载（离线听书导出）
// ========================================================
let isDownloadingAudio = false;

async function downloadFullAudio() {
  if (isDownloadingAudio) {
    showTranslation(_t('toastAudioDownloading', '⏳ 正在合成中，请稍候...'), true);
    return;
  }
  if (!readerSentences || readerSentences.length === 0) {
    renderReaderModeContent();
  }
  if (!readerSentences || readerSentences.length === 0) {
    showTranslation(_t('toastNoContentToDownload', '⚠️ 没有可下载的文章内容'), true);
    return;
  }

  isDownloadingAudio = true;
  await loadSettings();
  const title = (cachedReaderContent && cachedReaderContent.title) ? cachedReaderContent.title : (document.title || 'ReadMate_Article');
  const cleanTitle = title.replace(/[\\/:*?"<>|]+/g, '_').substring(0, 40);

  const ttsEndpoint = (settings.cloudTtsEndpoint || 'http://192.168.199.159:5001').replace(/\/+$/, '') + '/tts';
  const origVoice = getBestVoiceForLang(detectedDocLang, settings.cloudTtsVoiceOrig || settings.cloudTtsVoice) || 'zh-CN-XiaoxiaoNeural';
  const speed = settings.ttsSpeed || 1.0;

  showTranslation(`📥 开始合成整篇有声书（共 ${readerSentences.length} 句）...`, true);

  const audioBuffers = [];
  try {
    for (let i = 0; i < readerSentences.length; i++) {
      const sentence = readerSentences[i];
      const speech = getSpeechText(sentence);
      if (!speech) continue;

      showTranslation(`📥 正在合成语音 (${i + 1}/${readerSentences.length} 句)...`, true);

      // 请求单句音频
      const dataUrl = await getOrFetchTtsAudio(ttsEndpoint, speech, origVoice, speed);
      if (dataUrl && dataUrl.startsWith('data:')) {
        const base64Data = dataUrl.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let b = 0; b < binaryString.length; b++) {
          bytes[b] = binaryString.charCodeAt(b);
        }
        audioBuffers.push(bytes);
      }
    }

    if (audioBuffers.length === 0) {
      throw new Error('未获取到音频数据');
    }

    // 顺序拼接所有 MP3 帧为单个完整音频文件
    const mergedBlob = new Blob(audioBuffers, { type: 'audio/mpeg' });
    const downloadUrl = URL.createObjectURL(mergedBlob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${cleanTitle}_ReadMate有声朗读.mp3`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    }, 6000);

    showTranslation('🎉 整篇有声书已合成完毕并开始下载！', true);
  } catch(err) {
    DebugLog.add('downloadFullAudio error: ' + err.message);
    showTranslation('❌ 语音合成下载失败: ' + err.message, true);
  } finally {
    isDownloadingAudio = false;
  }
}

// ========================================================
// 📚 点词查词小气泡与生词本管理（Vocab Notebook）
// ========================================================
let dictBubble = null;
let vocabDrawer = null;
let currentLookupWord = null;
let currentLookupContext = '';

function getStoredVocabList() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['readmate_vocab_list'], (res) => {
        resolve(res?.readmate_vocab_list || []);
      });
    } catch(e) { resolve([]); }
  });
}

function saveStoredVocabList(list) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ readmate_vocab_list: list }, () => resolve());
    } catch(e) { resolve(); }
  });
}

function showDictBubble(word, rect, contextSentence = '') {
  hideDictBubble();
  currentLookupWord = word;
  currentLookupContext = contextSentence;

  dictBubble = document.createElement('div');
  dictBubble.id = 'readmate-dict-bubble';
  dictBubble.innerHTML = `
    <div class="readmate-dict-header">
      <div class="readmate-dict-word-wrap">
        <span class="readmate-dict-word">${word}</span>
        <span class="readmate-dict-phonetic" id="readmate-dict-ph">...</span>
      </div>
      <div class="readmate-dict-actions">
        <button class="readmate-dict-btn" id="readmate-dict-pron" title="发音">🔊</button>
        <button class="readmate-dict-btn" id="readmate-dict-fav" title="收藏到生词本">⭐</button>
      </div>
    </div>
    <div class="readmate-dict-trans" id="readmate-dict-tr">🔍 正在查询释义...</div>
    ${contextSentence ? `<div class="readmate-dict-context">"${contextSentence.substring(0, 120)}"</div>` : ''}
  `;

  document.body.appendChild(dictBubble);

  const scrollY = window.scrollY || window.pageYOffset || 0;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  let top = rect.top + scrollY - dictBubble.offsetHeight - 10;
  let left = rect.left + scrollX + (rect.width / 2) - (dictBubble.offsetWidth / 2);

  if (top < scrollY + 60) top = rect.bottom + scrollY + 10;
  if (left < 10) left = 10;
  if (left + dictBubble.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - dictBubble.offsetWidth - 10;
  }

  dictBubble.style.top = top + 'px';
  dictBubble.style.left = left + 'px';

  // 绑定发音
  dictBubble.querySelector('#readmate-dict-pron').onclick = (e) => {
    e.stopPropagation();
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = detectTextLanguage(word);
      window.speechSynthesis.speak(u);
    }
  };

  // 检查是否已收藏
  getStoredVocabList().then(list => {
    const isFav = list.some(item => item.word.toLowerCase() === word.toLowerCase());
    const favBtn = dictBubble?.querySelector('#readmate-dict-fav');
    if (favBtn && isFav) {
      favBtn.textContent = '★';
      favBtn.classList.add('is-fav');
    }
  });

  // 绑定收藏
  dictBubble.querySelector('#readmate-dict-fav').onclick = async (e) => {
    e.stopPropagation();
    const favBtn = dictBubble.querySelector('#readmate-dict-fav');
    const ph = dictBubble.querySelector('#readmate-dict-ph').textContent;
    const tr = dictBubble.querySelector('#readmate-dict-tr').textContent;
    const list = await getStoredVocabList();
    const idx = list.findIndex(item => item.word.toLowerCase() === word.toLowerCase());

    if (idx !== -1) {
      list.splice(idx, 1);
      await saveStoredVocabList(list);
      favBtn.textContent = '⭐';
      favBtn.classList.remove('is-fav');
      showTranslation('已从生词本移除', true);
    } else {
      list.unshift({
        word,
        phonetic: ph !== '...' ? ph : '',
        trans: tr,
        context: contextSentence,
        time: Date.now(),
        domain: window.location.hostname,
      });
      await saveStoredVocabList(list);
      favBtn.textContent = '★';
      favBtn.classList.add('is-fav');
      showTranslation('⭐ 已收藏到生词本！', true);
    }
    renderVocabDrawer();
  };

  // 执行释义查询
  fetchWordDefinition(word, contextSentence).then(res => {
    if (!dictBubble) return;
    const phEl = dictBubble.querySelector('#readmate-dict-ph');
    const trEl = dictBubble.querySelector('#readmate-dict-tr');
    if (phEl) phEl.textContent = res.phonetic ? `[${res.phonetic}]` : '';
    if (trEl) trEl.textContent = res.trans || '暂无释义';
  });
}

function hideDictBubble() {
  if (dictBubble) {
    dictBubble.remove();
    dictBubble = null;
  }
}

async function fetchWordDefinition(word, context) {
  let phonetic = '';
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (r.ok) {
      const data = await r.json();
      phonetic = data[0]?.phonetic || data[0]?.phonetics?.find(p => p.text)?.text || '';
    }
  } catch(e) {}

  let trans = '';
  try {
    trans = await fetchTranslation(word);
  } catch(e) {}

  return { word, phonetic, trans: trans || '暂未查到中文释义' };
}

function ensureVocabDrawer() {
  if (vocabDrawer) return vocabDrawer;

  vocabDrawer = document.createElement('div');
  vocabDrawer.id = 'readmate-vocab-drawer';
  vocabDrawer.style.display = 'none';

  vocabDrawer.innerHTML = `
    <div class="readmate-vocab-header">
      <div class="readmate-vocab-title">
        <span>📚</span>
        <span id="readmate-vocab-count-title">我的生词本</span>
      </div>
      <button class="readmate-dict-btn" id="readmate-vocab-close" title="关闭">✕</button>
    </div>
    <div class="readmate-vocab-list" id="readmate-vocab-list"></div>
    <div class="readmate-vocab-footer">
      <button class="readmate-reader-btn" id="readmate-vocab-export">📋 导出 Markdown</button>
      <button class="readmate-reader-btn" id="readmate-vocab-clear" style="color:#ef4444;">🗑️ 清空</button>
    </div>
  `;

  document.body.appendChild(vocabDrawer);

  vocabDrawer.querySelector('#readmate-vocab-close').onclick = closeVocabDrawer;

  vocabDrawer.querySelector('#readmate-vocab-export').onclick = async () => {
    const list = await getStoredVocabList();
    if (list.length === 0) {
      showTranslation('生词本为空', true);
      return;
    }
    const md = `# ReadMate 生词本 (${list.length}词)\n\n` + list.map(item => `### ${item.word} ${item.phonetic}\n- **释义**: ${item.trans}\n${item.context ? `- **例句**: *${item.context}*\n` : ''}`).join('\n');
    navigator.clipboard?.writeText(md);
    showTranslation('✓ 已导出为 Markdown 并复制到剪贴板！', true);
  };

  vocabDrawer.querySelector('#readmate-vocab-clear').onclick = async () => {
    if (confirm('确定要清空生词本中的所有单词吗？')) {
      await saveStoredVocabList([]);
      renderVocabDrawer();
      showTranslation('生词本已清空', true);
    }
  };

  return vocabDrawer;
}

async function renderVocabDrawer() {
  ensureVocabDrawer();
  const list = await getStoredVocabList();
  const titleEl = vocabDrawer.querySelector('#readmate-vocab-count-title');
  const container = vocabDrawer.querySelector('#readmate-vocab-list');

  if (titleEl) titleEl.textContent = `我的生词本 (${list.length})`;

  if (list.length === 0) {
    container.innerHTML = `<div class="readmate-vocab-empty">📭 暂无收藏的生词<br>在净读模式下双击单词即可一键查词与收藏</div>`;
    return;
  }

  container.innerHTML = list.map((item, idx) => `
    <div class="readmate-vocab-card" data-vocab-idx="${idx}">
      <div class="readmate-vocab-card-head">
        <div>
          <span class="readmate-vocab-card-word">${item.word}</span>
          ${item.phonetic ? `<span class="readmate-vocab-card-phonetic">${item.phonetic}</span>` : ''}
        </div>
        <div>
          <button class="readmate-dict-btn btn-vocab-pron" data-word="${item.word}" title="发音">🔊</button>
          <button class="readmate-dict-btn btn-vocab-del" data-idx="${idx}" title="删除">🗑️</button>
        </div>
      </div>
      <div class="readmate-vocab-card-trans">${item.trans || ''}</div>
      ${item.context ? `<div class="readmate-vocab-card-context">"${item.context}"</div>` : ''}
    </div>
  `).join('');

  container.querySelectorAll('.btn-vocab-pron').forEach(btn => {
    btn.onclick = () => {
      const w = btn.dataset.word;
      if (w && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(w);
        u.lang = detectTextLanguage(w);
        window.speechSynthesis.speak(u);
      }
    };
  });

  container.querySelectorAll('.btn-vocab-del').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.idx, 10);
      list.splice(i, 1);
      await saveStoredVocabList(list);
      renderVocabDrawer();
    };
  });
}

function openVocabDrawer() {
  ensureVocabDrawer();
  renderVocabDrawer();
  vocabDrawer.style.display = 'flex';
}

function closeVocabDrawer() {
  if (vocabDrawer) {
    vocabDrawer.style.display = 'none';
  }
}

// 净读模式下双击单词查词监听
document.addEventListener('dblclick', (e) => {
  // ★ 核心改进：一旦触发双击，立即掐断单击跳转定时器，绝不误触朗读！
  if (readerClickTimer) {
    clearTimeout(readerClickTimer);
    readerClickTimer = null;
  }
  if (!isReaderModeActive) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const text = sel.toString().trim();
  if (text && text.length >= 2 && text.length <= 35 && !text.includes('\n')) {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const sSpan = e.target.closest('.readmate-reader-s');
    const context = sSpan ? sSpan.textContent.trim() : '';
    showDictBubble(text, rect, context);
  }
});

// 点击空白关闭查词小气泡
document.addEventListener('mousedown', (e) => {
  if (dictBubble && !dictBubble.contains(e.target)) {
    hideDictBubble();
  }
});

// ====== 提示与小气泡（Toast） ======
function showTranslation(text, isToast = false) {
  let toast = document.getElementById('readmate-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'readmate-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}

async function translateAndShow(text) {
  showTranslation('🌐 正在翻译选中文本...', true);
  const trans = await fetchTranslation(text);
  if (trans) showTranslation(trans, true);
  else showTranslation('❌ 翻译失败，请检查 AI 配置', true);
}

// ====== 初始化监听 ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'ping':
      sendResponse({ ok: true });
      break;
    case 'settingsUpdated':
      if (msg.settings) {
        Object.assign(settings, msg.settings);
        if (msg.settings.readVoiceMode) readVoiceMode = msg.settings.readVoiceMode;
        if (msg.settings.enableBilingual !== undefined) {
          enableBilingual = msg.settings.enableBilingual;
          const biChk = floatingBar?.querySelector('#readmate-bilingual-chk');
          if (biChk) biChk.checked = enableBilingual;
        }
        if (msg.settings.showBilingualSubtitles !== undefined) {
          showBilingualSubtitles = msg.settings.showBilingualSubtitles;
          const subChk = floatingBar?.querySelector('#readmate-sub-chk');
          if (subChk) subChk.checked = showBilingualSubtitles;
          const wrap = floatingBar?.querySelector('#readmate-subtitles-wrap');
          if (wrap) wrap.style.display = showBilingualSubtitles ? '' : 'none';
        }
        if (msg.settings.uiLanguage) {
          loadContentI18n(msg.settings.uiLanguage).then(() => {
            updateFABI18n();
            updateSelectionBtnI18n();
            updateSummaryDialogI18n();
            updateFloatingBarI18n();
          });
        }
        DebugLog.add(`Settings updated live via broadcast: mode=${readVoiceMode}, bilingual=${enableBilingual}, speed=${settings.ttsSpeed}x`);
      }
      sendResponse({ ok: true });
      break;
    case 'uiLanguageChanged':
      loadSettings().then(() => {
        updateFABI18n();
        updateSelectionBtnI18n();
        updateSummaryDialogI18n();
        updateFloatingBarI18n();
      });
      sendResponse({ ok: true });
      break;
    case 'readPage':
      createFAB();
      document.getElementById('readmate-fab-play')?.click();
      sendResponse({ ok: true });
      break;
    case 'summarizePage':
      createFAB();
      generateAISummary();
      sendResponse({ ok: true });
      break;
    case 'stop':
      stopReading(true);
      sendResponse({ ok: true });
      break;
    case 'toggleRead':
      togglePlayPause();
      sendResponse({ ok: true });
      break;
    case 'toggleReaderMode':
      toggleReaderMode();
      sendResponse({ ok: true });
      break;
  }
});

// 全局键盘快捷键监听（ESC 退出净读模式 / 摘要，Alt+R 或 F9 切换净读模式）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.keyCode === 27) {
    if (isReaderModeActive) {
      closeReaderMode(true);
    }
  } else if ((e.altKey && (e.key === 'r' || e.key === 'R')) || e.key === 'F9') {
    e.preventDefault();
    toggleReaderMode();
  }
});

// 监听浏览器自带后退按钮或鼠标后退手势（优雅退出净读模式并留在当前网页）
window.addEventListener('popstate', (e) => {
  if (isReaderModeActive) {
    closeReaderMode(false);
  }
});

// 页面就绪：加载设置并创建悬浮按钮
loadSettings().then(() => {
  createFAB();
  showFAB();
});
