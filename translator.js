// ReadMate / 读伴 — 快速翻译板 (Translation Board)
// 遵循开发红线：
// 1. UI 严禁硬编码中文，100% 走 chrome.i18n.getMessage (或多语言词典兜底)
// 2. 复用 background.js 的 proxyTranslate 协议与浏览器原生 SpeechSynthesis
// 3. 支持防抖自动翻译与手动即时翻译

(function () {
  'use strict';

  // 国际化提取辅助函数
  function _(key, def) {
    try {
      const msg = chrome.i18n.getMessage(key);
      if (msg) return msg;
    } catch (e) {}
    return def || key;
  }

  // DOM 元素引用
  const $ = (id) => document.getElementById(id);

  const els = {
    pageTitle: $('pageTitle'),
    lblBoardBadge: $('lblBoardBadge'),
    lblNavReader: $('lblNavReader'),
    lblNavOptions: $('lblNavOptions'),
    btnNavReader: $('btnNavReader'),
    btnNavOptions: $('btnNavOptions'),

    btnEngineMs: $('btnEngineMs'),
    btnEngineGoogle: $('btnEngineGoogle'),
    btnEngineAI: $('btnEngineAI'),
    lblEngineMs: $('lblEngineMs'),
    lblEngineGoogle: $('lblEngineGoogle'),
    lblEngineAI: $('lblEngineAI'),

    chipSrcAuto: $('chipSrcAuto'),
    chipSrcEn: $('chipSrcEn'),
    chipSrcZh: $('chipSrcZh'),
    selectSrcLang: $('selectSrcLang'),
    btnSwapLang: $('btnSwapLang'),

    chipTgtZh: $('chipTgtZh'),
    chipTgtEn: $('chipTgtEn'),
    chipTgtJa: $('chipTgtJa'),
    selectTgtLang: $('selectTgtLang'),

    sourceInput: $('sourceInput'),
    sourceMeta: $('sourceMeta'),
    btnClear: $('btnClear'),
    btnPaste: $('btnPaste'),
    btnSpeakSource: $('btnSpeakSource'),
    btnDoTranslate: $('btnDoTranslate'),
    lblBtnClear: $('lblBtnClear'),
    lblBtnPaste: $('lblBtnPaste'),
    lblBtnSpeakSource: $('lblBtnSpeakSource'),
    lblBtnTranslate: $('lblBtnTranslate'),

    targetOutput: $('targetOutput'),
    targetMeta: $('targetMeta'),
    btnCopyResult: $('btnCopyResult'),
    btnSpeakTarget: $('btnSpeakTarget'),
    lblBtnCopyResult: $('lblBtnCopyResult'),
    lblBtnSpeakTarget: $('lblBtnSpeakTarget'),

    aiOptionsStrip: $('aiOptionsStrip'),
    lblAiTonePrompt: $('lblAiTonePrompt'),
    aiModelTag: $('aiModelTag'),
    toneStandard: $('toneStandard'),
    toneAcademic: $('toneAcademic'),
    toneCasual: $('toneCasual'),
    toneBusiness: $('toneBusiness'),
    toneLiterature: $('toneLiterature'),

    toast: $('trans-toast'),
  };

  // 状态变量
  let currentEngine = 'microsoft'; // 'microsoft' | 'google' | 'custom'
  let sourceLang = 'auto';
  let targetLang = 'zh-Hans';
  let currentAiTone = 'standard';
  let translateTimer = null;
  let isTranslating = false;
  let lastTranslatedText = '';
  let aiConfig = {
    apiKey: '',
    endpoint: '',
    model: 'gpt-4o-mini',
    provider: 'custom',
  };

  // 初始化多语言文本
  function initI18n() {
    document.title = _('translatorTitle', 'ReadMate Translation Board');
    els.lblBoardBadge.textContent = _('translatorTitle', 'Translation Board');
    els.lblNavReader.textContent = _('btnOpenReader', 'My Books');
    els.lblNavOptions.textContent = _('optionsTitle', 'Settings & AI');

    els.lblEngineMs.textContent = _('transEngineMicrosoft', 'Microsoft Edge (Free)');
    els.lblEngineGoogle.textContent = _('transEngineGoogle', 'Google Translate (Free)');
    els.lblEngineAI.textContent = _('transEngineAI', 'AI LLM (DeepSeek / OpenAI)');

    els.chipSrcAuto.textContent = _('transAutoDetect', 'Auto');
    els.sourceInput.placeholder = _('transSourcePlaceholder', 'Type or paste text to translate here...');
    els.targetOutput.textContent = _('transTargetPlaceholder', 'Translation will appear here...');

    els.lblBtnClear.textContent = _('btnClear', 'Clear');
    els.lblBtnPaste.textContent = _('btnPaste', 'Paste');
    els.lblBtnSpeakSource.textContent = _('btnSpeakSource', 'Read Source');
    els.lblBtnTranslate.textContent = _('btnTranslate', 'Translate');

    els.lblBtnCopyResult.textContent = _('btnCopyResult', 'Copy');
    els.lblBtnSpeakTarget.textContent = _('btnSpeakResult', 'Read Translation');

    els.lblAiTonePrompt.textContent = _('transAiTonePrompt', 'Tone & Style:');
    els.toneStandard.textContent = _('transToneStandard', 'Standard');
    els.toneAcademic.textContent = _('transToneAcademic', 'Academic');
    els.toneCasual.textContent = _('transToneCasual', 'Casual');
    els.toneBusiness.textContent = _('transToneBusiness', 'Business');
    els.toneLiterature.textContent = _('transToneLiterature', 'Literary');

    updateWordCount();
    setTargetStatus(_('transStatusReady', 'Ready'));
  }

  // Toast 提示
  let toastTimer = null;
  function showToast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 2500);
  }

  // 字数统计与检测
  function updateWordCount() {
    const txt = els.sourceInput.value;
    const chars = txt.length;
    const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
    const pattern = _('transCharWordCount', '{chars} chars / {words} words');
    els.sourceMeta.textContent = pattern.replace('{chars}', chars).replace('{words}', words);
  }

  function setTargetStatus(statusText, isError = false) {
    els.targetMeta.textContent = statusText;
    els.targetMeta.style.color = isError ? '#ef4444' : '#64748b';
  }

  // 加载配置
  function loadSettings() {
    chrome.storage.sync.get(
      ['translateProvider', 'translateTarget', 'aiApiKey', 'aiEndpoint', 'aiModel'],
      (res) => {
        if (res.translateProvider) {
          setEngine(res.translateProvider);
        }
        if (res.translateTarget) {
          setTargetLanguage(res.translateTarget);
        }
        aiConfig.apiKey = res.aiApiKey || '';
        aiConfig.endpoint = res.aiEndpoint || '';
        aiConfig.model = res.aiModel || 'gpt-4o-mini';
        els.aiModelTag.textContent = `Model: ${aiConfig.model}`;
      }
    );
  }

  // 引擎切换
  function setEngine(engine) {
    currentEngine = engine;
    [els.btnEngineMs, els.btnEngineGoogle, els.btnEngineAI].forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle('active', btn.dataset.engine === engine);
    });

    if (engine === 'custom' || engine === 'openai') {
      els.aiOptionsStrip.classList.add('show');
    } else {
      els.aiOptionsStrip.classList.remove('show');
    }

    if (els.sourceInput.value.trim()) {
      triggerTranslation(true);
    }
  }

  // 语言同步与切换
  function setSourceLanguage(lang) {
    sourceLang = lang;
    els.selectSrcLang.value = lang;
    document.querySelectorAll('.lang-group:first-child .lang-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.lang === lang);
    });
    if (els.sourceInput.value.trim()) {
      triggerTranslation(true);
    }
  }

  function setTargetLanguage(lang) {
    targetLang = lang;
    els.selectTgtLang.value = lang;
    document.querySelectorAll('.lang-group:last-child .lang-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.lang === lang);
    });
    if (els.sourceInput.value.trim()) {
      triggerTranslation(true);
    }
  }

  // 执行翻译
  async function triggerTranslation(force = false) {
    const rawText = els.sourceInput.value.trim();
    if (!rawText) {
      els.targetOutput.textContent = _('transTargetPlaceholder', 'Translation will appear here...');
      els.targetOutput.classList.add('placeholder');
      setTargetStatus(_('transStatusReady', 'Ready'));
      return;
    }

    if (!force && rawText === lastTranslatedText) {
      return;
    }

    isTranslating = true;
    setTargetStatus(_('transStatusTranslating', 'Translating...'));
    const startTime = Date.now();

    try {
      let promptPrefix = '';
      if (currentEngine === 'custom') {
        const toneMap = {
          academic: 'Translate into an academic, formal research paper style. ',
          casual: 'Translate into a natural, spoken, and colloquial style. ',
          business: 'Translate into an official, professional business style. ',
          literature: 'Translate into an elegant, literary and poetic style. ',
        };
        promptPrefix = toneMap[currentAiTone] || '';
      }

      const sendText = promptPrefix ? `${promptPrefix}\n\n${rawText}` : rawText;

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: 'proxyTranslate',
            text: sendText,
            targetLang: targetLang,
            sourceLang: sourceLang === 'auto' ? '' : sourceLang,
            provider: currentEngine,
            endpoint: aiConfig.endpoint,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
          },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { ok: false, error: 'Empty response' });
            }
          }
        );
      });

      if (!response.ok) {
        throw new Error(response.error || 'Translation failed');
      }

      const translated = response.text || (response.results && response.results[0]) || '';
      els.targetOutput.textContent = translated;
      els.targetOutput.classList.remove('placeholder');
      lastTranslatedText = rawText;

      const duration = Date.now() - startTime;
      let statusMsg = _('transStatusSuccess', 'Translated in {time}ms').replace('{time}', duration);

      // 若发生了降级兜底，给出温和但明确的中文/多语言提示
      if (response.fallbackReason) {
        if (response.fallbackReason === 'no_key') {
          const fallbackTip = _('transFallbackNoKey', '⚠️ AI API Key not configured; fell back to Microsoft Free engine.');
          statusMsg = `${fallbackTip} (${duration}ms)`;
          showToast(fallbackTip);
        } else if (response.fallbackReason.startsWith('error:')) {
          const errDetail = response.fallbackReason.replace('error:', '').trim();
          const fallbackTip = _('transFallbackError', '⚠️ AI request failed ({err}); fell back to Microsoft Free engine.').replace('{err}', errDetail);
          statusMsg = `${fallbackTip} (${duration}ms)`;
          showToast(fallbackTip);
        }
        els.targetMeta.style.color = '#d97706'; // 琥珀警示色
        els.targetMeta.textContent = statusMsg;
      } else {
        setTargetStatus(statusMsg);
      }
    } catch (err) {
      const failMsg = _('transStatusFailed', 'Translation failed: {err}').replace('{err}', err.message);
      setTargetStatus(failMsg, true);
    } finally {
      isTranslating = false;
    }
  }

  // 语音朗读控制（原生 SpeechSynthesis 纯净播放）
  let isSpeaking = false;
  function speakText(text, lang, btnEl) {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      document.querySelectorAll('.tool-btn-speak').forEach((b) => b.classList.remove('speaking'));
      if (isSpeaking) {
        isSpeaking = false;
        return;
      }
    }

    if (!text || !text.trim()) return;

    const utterance = new SpeechSynthesisUtterance(text.trim());
    if (lang && lang !== 'auto') {
      utterance.lang = lang;
    }
    utterance.rate = 1.0;

    btnEl.classList.add('speaking');
    isSpeaking = true;

    utterance.onend = () => {
      btnEl.classList.remove('speaking');
      isSpeaking = false;
    };
    utterance.onerror = () => {
      btnEl.classList.remove('speaking');
      isSpeaking = false;
    };

    window.speechSynthesis.speak(utterance);
  }

  // 事件绑定
  function bindEvents() {
    // 导航
    els.btnNavReader.addEventListener('click', () => {
      window.location.href = chrome.runtime.getURL('reader.html');
    });
    els.btnNavOptions.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // 引擎按钮
    [els.btnEngineMs, els.btnEngineGoogle, els.btnEngineAI].forEach((btn) => {
      btn.addEventListener('click', () => {
        setEngine(btn.dataset.engine);
      });
    });

    // 源语言快速 Chip
    [els.chipSrcAuto, els.chipSrcEn, els.chipSrcZh].forEach((chip) => {
      chip.addEventListener('click', () => {
        setSourceLanguage(chip.dataset.lang);
      });
    });
    els.selectSrcLang.addEventListener('change', (e) => {
      setSourceLanguage(e.target.value);
    });

    // 目标语言快速 Chip
    [els.chipTgtZh, els.chipTgtEn, els.chipTgtJa].forEach((chip) => {
      chip.addEventListener('click', () => {
        setTargetLanguage(chip.dataset.lang);
      });
    });
    els.selectTgtLang.addEventListener('change', (e) => {
      setTargetLanguage(e.target.value);
    });

    // 交换语言
    els.btnSwapLang.addEventListener('click', () => {
      if (sourceLang === 'auto') {
        showToast('Auto language cannot be swapped');
        return;
      }
      const tmp = sourceLang;
      setSourceLanguage(targetLang);
      setTargetLanguage(tmp);
      const srcVal = els.sourceInput.value;
      const tgtVal = els.targetOutput.classList.contains('placeholder') ? '' : els.targetOutput.textContent;
      if (tgtVal) {
        els.sourceInput.value = tgtVal;
        els.targetOutput.textContent = srcVal;
        updateWordCount();
        triggerTranslation(true);
      }
    });

    // 输入监听（带 600ms 防抖）
    els.sourceInput.addEventListener('input', () => {
      updateWordCount();
      clearTimeout(translateTimer);
      translateTimer = setTimeout(() => {
        triggerTranslation(false);
      }, 600);
    });

    // 清空
    els.btnClear.addEventListener('click', () => {
      els.sourceInput.value = '';
      els.targetOutput.textContent = _('transTargetPlaceholder', 'Translation will appear here...');
      els.targetOutput.classList.add('placeholder');
      updateWordCount();
      setTargetStatus(_('transStatusReady', 'Ready'));
      lastTranslatedText = '';
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    });

    // 粘贴
    els.btnPaste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          els.sourceInput.value = text;
          updateWordCount();
          triggerTranslation(true);
        }
      } catch (e) {
        showToast('Please grant clipboard permission');
      }
    });

    // 复制译文
    els.btnCopyResult.addEventListener('click', async () => {
      const text = els.targetOutput.classList.contains('placeholder') ? '' : els.targetOutput.textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast(_('transCopySuccess', 'Copied to clipboard!'));
      } catch (e) {
        showToast('Copy failed');
      }
    });

    // 朗读原文
    els.btnSpeakSource.addEventListener('click', () => {
      const text = els.sourceInput.value;
      speakText(text, sourceLang, els.btnSpeakSource);
    });

    // 朗读译文
    els.btnSpeakTarget.addEventListener('click', () => {
      const text = els.targetOutput.classList.contains('placeholder') ? '' : els.targetOutput.textContent;
      speakText(text, targetLang, els.btnSpeakTarget);
    });

    // 手动立即翻译
    els.btnDoTranslate.addEventListener('click', () => {
      triggerTranslation(true);
    });

    // AI 语气风格点击
    document.querySelectorAll('.ai-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.ai-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentAiTone = pill.dataset.tone;
        if (els.sourceInput.value.trim()) {
          triggerTranslation(true);
        }
      });
    });
  }

  // 读取 URL 参数（支持外部快捷跳转注入文本）
  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const text = params.get('text');
    if (text) {
      els.sourceInput.value = text;
      updateWordCount();
      setTimeout(() => triggerTranslation(true), 150);
    }
  }

  // 启动
  document.addEventListener('DOMContentLoaded', () => {
    initI18n();
    loadSettings();
    bindEvents();
    checkUrlParams();
  });
})();
