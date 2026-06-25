// ReadMate / 读伴 — 设置弹窗

// i18n: 通过 JS 设置所有文本（不依赖 Chrome 的 __MSG_*__ HTML 替换）
function _(key) { return chrome.i18n.getMessage(key) || key; }

function localize() {
  document.title = _('appDesc');
  setText('lblAppName', _('appName'));
  setText('lblTtsEngineSection', _('ttsEngineSection'));
  setText('lblEngine', _('engineLabel'));
  setText('optEngineWebSpeech', _('engineWebSpeech'));
  setText('optEngineEdgeTts', _('engineEdgeTts'));
  setText('optEngineCustom', _('engineCustom'));
  setText('lblSpeed', _('speedLabel'));
  setText('lblVoice', _('voiceLabel'));
  setText('lblEdgeTtsSection', _('edgeTtsSection'));
  setText('lblEndpoint', _('endpointLabel'));
  setText('lblEdgeTtsVoice', _('edgeTtsVoiceLabel'));
  setText('lblCustomTtsSection', _('customTtsSection'));
  setText('lblApiKey', _('apiKeyLabel'));
  setText('lblModel', _('modelLabel'));
  setText('lblCustomTtsVoice', _('customTtsVoiceLabel'));
  setText('lblAiTranslateSection', _('aiTranslateSection'));
  setText('lblTargetLanguage', _('targetLanguageLabel'));
  setText('optLangZhCn', _('langZhCn'));
  setText('optLangEn', _('langEn'));
  setText('optLangJa', _('langJa'));
  setText('optLangKo', _('langKo'));
  setText('optLangFr', _('langFr'));
  setText('optLangDe', _('langDe'));
  setText('optLangEs', _('langEs'));
  setText('lblAutoTranslate', _('autoTranslateLabel'));
  setText('lblOtherSection', _('otherSection'));
  setText('lblHighlight', _('highlightLabel'));
  setText('lblUiLanguage', _('uiLanguageLabel'));
  setText('optLangAuto', _('langAuto'));
  setText('optLangEnglish', _('langEnglish'));
  setText('optLangChinese', _('langChinese'));
  setText('saveBtn', _('saveButton'));
  setText('testBtn', _('testTranslateBtn'));
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// 加载设置
document.addEventListener('DOMContentLoaded', async () => {
  // 先本地化所有文本（不依赖 Chrome 的 __MSG_*__ 内建替换）
  localize();

  chrome.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
    document.getElementById('ttsEngine').value = settings.ttsEngine;
    document.getElementById('ttsSpeed').value = settings.ttsSpeed;
    document.getElementById('ttsSpeedLabel').textContent = settings.ttsSpeed + 'x';

    // Edge TTS
    document.getElementById('edgeTtsEndpoint').value = settings.edgeTtsEndpoint;
    loadEdgeTtsVoices(settings.edgeTtsEndpoint, settings.edgeTtsVoice);

    // Custom TTS
    document.getElementById('customTtsEndpoint').value = settings.customTtsEndpoint;
    document.getElementById('customTtsApiKey').value = settings.customTtsApiKey;
    document.getElementById('customTtsModel').value = settings.customTtsModel;
    document.getElementById('customTtsVoice').value = settings.customTtsVoice;

    // AI 翻译
    document.getElementById('aiEndpoint').value = settings.aiEndpoint;
    document.getElementById('aiApiKey').value = settings.aiApiKey;
    document.getElementById('aiModel').value = settings.aiModel;
    document.getElementById('translateTarget').value = settings.translateTarget;
    document.getElementById('autoTranslate').checked = settings.autoTranslate;
    document.getElementById('highlightEnabled').checked = settings.highlightEnabled;

    // 界面语言
    document.getElementById('uiLanguage').value = settings.uiLanguage || 'auto';

    // 加载可用语音
    loadVoices(settings.ttsVoice);

    // Edge TTS 端点变更时重新加载语音列表
    document.getElementById('edgeTtsEndpoint').addEventListener('change', function() {
      loadEdgeTtsVoices(this.value, '');
    });

    toggleSections();
  });

  // 语速
  document.getElementById('ttsSpeed').addEventListener('input', (e) => {
    document.getElementById('ttsSpeedLabel').textContent = e.target.value + 'x';
  });

  // 引擎切换
  document.getElementById('ttsEngine').addEventListener('change', toggleSections);

  // 保存
  document.getElementById('saveBtn').addEventListener('click', saveSettings);

  // 测试翻译
  document.getElementById('testBtn').addEventListener('click', testTranslation);

  // 所有输入变化自动保存
  document.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', autoSave);
    if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'password') {
      el.addEventListener('input', debounce(autoSave, 500));
    }
  });
});

function toggleSections() {
  const engine = document.getElementById('ttsEngine').value;
  document.getElementById('voiceField').style.display = engine === 'web-speech' ? 'block' : 'none';
  document.getElementById('edgeTtsSection').style.display = engine === 'edge-tts' ? 'block' : 'none';
  document.getElementById('customTtsSection').style.display = engine === 'custom' ? 'block' : 'none';
}

// 加载浏览器可用语音列表
function loadVoices(savedVoice) {
  const voiceSelect = document.getElementById('ttsVoice');

  function populateVoices() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;

    voiceSelect.innerHTML = '<option value="">' + _('voiceAutoLang') + '</option>';

    const groups = {};
    for (const v of voices) {
      const lang = v.lang || 'unknown';
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push(v);
    }

    for (const [lang, list] of Object.entries(groups).sort()) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = lang;
      for (const v of list) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.name + (v.localService ? _('localVoiceSuffix') : '');
        optgroup.appendChild(opt);
      }
      voiceSelect.appendChild(optgroup);
    }

    if (savedVoice) voiceSelect.value = savedVoice;
  }

  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

// 加载 Edge TTS 语音列表
function loadEdgeTtsVoices(endpoint, savedVoice) {
  const select = document.getElementById('edgeTtsVoice');
  if (!endpoint) {
    select.innerHTML = '<option value="">' + _('configEndpointFirst') + '</option>';
    return;
  }

  const voicesUrl = endpoint.replace(/\/+$/, '') + '/voices';
  select.innerHTML = '<option value="">' + _('loadingVoices') + '</option>';

  fetch(voicesUrl)
    .then(r => r.json())
    .then(voices => {
      if (!voices || voices.length === 0) {
        select.innerHTML = '<option value="">' + _('noVoicesAvailable') + '</option>';
        return;
      }

      select.innerHTML = '';

      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = _('selectVoiceHint');
      select.appendChild(defaultOpt);

      const groups = {};
      for (const v of voices) {
        const locale = v.Locale || 'unknown';
        if (!groups[locale]) groups[locale] = [];
        groups[locale].push(v);
      }

      for (const [locale, list] of Object.entries(groups).sort()) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = locale;
        for (const v of list) {
          const opt = document.createElement('option');
          opt.value = v.ShortName;
          opt.textContent = v.FriendlyName + ' (' + v.Gender + ')';
          optgroup.appendChild(opt);
        }
        select.appendChild(optgroup);
      }

      if (savedVoice) select.value = savedVoice;
    })
    .catch(err => {
      select.innerHTML = '<option value="">' + _('loadVoicesFailed') + '</option>';
      console.warn('[ReadMate] Failed to load Edge TTS voices:', err);
    });
}

// 防抖
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 自动保存
function autoSave() {
  const status = document.getElementById('saveStatus');
  status.textContent = _('savingStatus');
  status.style.color = '#888';
  saveSettings();
}

// 测试翻译连接
function testTranslation() {
  const status = document.getElementById('saveStatus');
  const endpoint = document.getElementById('aiEndpoint').value;
  const apiKey = document.getElementById('aiApiKey').value;
  const model = document.getElementById('aiModel').value;

  if (!endpoint || !apiKey) {
    status.textContent = _('fillEndpointKeyWarning');
    status.style.color = '#f44336';
    return;
  }

  status.textContent = _('testingStatus');
  status.style.color = '#888';

  chrome.runtime.sendMessage({
    action: 'proxyTranslate',
    endpoint: endpoint.replace(/\/+$/, '') + '/chat/completions',
    apiKey: apiKey,
    model: model || 'deepseek-chat',
    text: 'Hello, how are you?',
    targetLang: 'Simplified Chinese',
  }, (resp) => {
    if (resp?.ok && resp.text) {
      status.textContent = '✅ ' + resp.text;
      status.style.color = '#4caf50';
    } else {
      status.textContent = '❌ ' + _('saveFailedStatus').replace('❌ ', '') + ': ' + (resp?.error || 'no response');
      status.style.color = '#f44336';
    }
    setTimeout(() => { status.textContent = ''; }, 5000);
  });
}

// 保存设置
function saveSettings() {
  const settings = {
    ttsEngine: document.getElementById('ttsEngine').value,
    ttsSpeed: parseFloat(document.getElementById('ttsSpeed').value),
    ttsVoice: document.getElementById('ttsVoice').value || '',
    // Edge TTS
    edgeTtsEndpoint: document.getElementById('edgeTtsEndpoint').value,
    edgeTtsVoice: document.getElementById('edgeTtsVoice').value,
    // Custom TTS
    customTtsEndpoint: document.getElementById('customTtsEndpoint').value,
    customTtsApiKey: document.getElementById('customTtsApiKey').value,
    customTtsModel: document.getElementById('customTtsModel').value,
    customTtsVoice: document.getElementById('customTtsVoice').value,
    // AI 翻译
    aiEndpoint: document.getElementById('aiEndpoint').value,
    aiApiKey: document.getElementById('aiApiKey').value,
    aiModel: document.getElementById('aiModel').value,
    translateTarget: document.getElementById('translateTarget').value,
    autoTranslate: document.getElementById('autoTranslate').checked,
    highlightEnabled: document.getElementById('highlightEnabled').checked,
    // UI 语言
    uiLanguage: document.getElementById('uiLanguage').value,
  };

  chrome.runtime.sendMessage({ action: 'saveSettings', settings }, (resp) => {
    const status = document.getElementById('saveStatus');
    if (resp?.ok) {
      status.textContent = _('savedStatus');
      status.style.color = '#4caf50';
    } else {
      status.textContent = _('saveFailedStatus');
      status.style.color = '#f44336';
    }
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}
