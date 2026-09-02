// ReadMate - Options Script (全国际化 + 防迷路视觉切换器)

let messages = {};
let activeUiLang = 'zh_CN';

const AI_PRESETS = {
  gemini: {
    endpoint: 'http://192.168.199.159:28080/v1',
    model: 'gemini-3.1-flash-lite',
    apiKey: 'liang-gemini-proxy-2026',
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: '',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
  },
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    apiKey: '',
  },
  moonshot: {
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    apiKey: '',
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    apiKey: '',
  },
  custom: {
    endpoint: '',
    model: '',
    apiKey: '',
  }
};

async function loadMessages(lang) {
  activeUiLang = lang || 'zh_CN';
  try {
    const url = chrome.runtime.getURL(`_locales/${activeUiLang}/messages.json`);
    const resp = await fetch(url);
    const data = await resp.json();
    messages = {};
    for (const [k, v] of Object.entries(data)) {
      messages[k] = v.message;
    }
  } catch(e) {
    messages = {};
  }
}

function _(k) { return messages[k] || chrome.i18n.getMessage(k) || k; }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

function localize() {
  document.title = _('appName') + ' - Options';
  setText('lblSectionVoiceStream', _('sectionVoiceStream'));
  setText('lblVoiceMode', _('lblVoiceMode'));
  setText('optModeOriginal', _('modeOriginal'));
  setText('optModeTranslated', _('modeTranslated'));
  setText('optModeBilingual', _('modeBilingual'));
  setText('lblBilingualSubtitles', _('lblBilingualSubtitles'));
  setText('lblChkShowSubtitles', _('chkShowSubtitles'));

  setText('lblTtsSection', _('ttsEngineSection'));
  setText('lblEngineBrowser', _('engineBrowser'));
  setText('lblEngineCloud', _('engineCloud'));
  setText('lblSpeed', _('speedLabel'));
  setText('lblVoice', _('voiceLabel'));
  setText('optVoiceAuto', _('voiceAutoLang'));
  setText('testBrowserVoiceBtn', _('btnTestBrowser'));

  setText('lblCloudTtsSection', _('cloudTtsSection'));
  setText('lblCloudEndpoint', _('lblCloudEndpoint'));
  setText('lblCloudVoice', _('lblCloudVoice'));
  setText('optCloudAuto', _('optCloudAuto'));
  setText('testCloudVoiceBtn', _('btnTestCloud'));

  setText('lblAiSection', _('aiSectionTitle'));
  setText('lblProvider', _('lblProvider'));
  setText('lblEndpoint', _('lblEndpoint'));
  setText('lblApiKey', _('lblApiKey'));
  setText('lblModel', _('lblModel'));
  setText('lblTargetLanguage', _('lblTargetLanguage'));
  setText('lblSummaryViewMode', _('lblSummaryViewMode'));
  setText('lblHighlight', _('lblHighlight'));
  setText('testAiBtn', _('btnTestAi'));
  setText('saveBtn', _('btnSave'));

  // 同步下拉框状态
  const sel = document.getElementById('uiLangSelect');
  if (sel) sel.value = activeUiLang;
}

async function switchLanguage(lang) {
  await loadMessages(lang);
  localize();
  chrome.storage.sync.set({ uiLanguage: lang }, () => {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(t => { if (t.id) chrome.tabs.sendMessage(t.id, { action: 'uiLanguageChanged', lang }, () => {}); });
    });
  });
}

function updateEngineSections(engine) {
  const browserSec = document.getElementById('browserTtsSection');
  const cloudSec = document.getElementById('cloudTtsSection');
  if (engine === 'cloud') {
    if (browserSec) browserSec.style.display = 'none';
    if (cloudSec) cloudSec.style.display = 'block';
  } else {
    if (browserSec) browserSec.style.display = 'block';
    if (cloudSec) cloudSec.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const langSel = document.getElementById('uiLangSelect');
  if (langSel) {
    langSel.onchange = (e) => switchLanguage(e.target.value);
  }

  chrome.runtime.sendMessage({ action: 'getSettings' }, async (settings) => {
    let uiLang = settings.uiLanguage || 'zh_CN';
    if (uiLang === 'auto') uiLang = (navigator.language.startsWith('zh') ? 'zh_CN' : 'en');
    await loadMessages(uiLang);
    localize();

    document.getElementById('ttsSpeed').value = settings.ttsSpeed || 1.0;
    document.getElementById('ttsSpeedLabel').textContent = (settings.ttsSpeed || 1.0) + 'x';

    const engine = settings.ttsEngine || 'cloud';
    const radio = document.querySelector(`input[name="ttsEngine"][value="${engine}"]`);
    if (radio) radio.checked = true;
    updateEngineSections(engine);

    document.querySelectorAll('input[name="ttsEngine"]').forEach(r => {
      r.addEventListener('change', (e) => {
        updateEngineSections(e.target.value);
        saveSettings(true);
      });
    });

    document.getElementById('readVoiceMode').value = settings.readVoiceMode || 'original';
    document.getElementById('enableBilingual').checked = !!settings.enableBilingual;
    document.getElementById('showBilingualSubtitles').checked = settings.showBilingualSubtitles !== false;

    // AI
    const provider = settings.aiProvider || 'gemini';
    const providerSel = document.getElementById('aiProviderSelect');
    if (providerSel) {
      providerSel.value = provider;
      providerSel.addEventListener('change', (e) => {
        const val = e.target.value;
        if (AI_PRESETS[val] && val !== 'custom') {
          document.getElementById('aiEndpoint').value = AI_PRESETS[val].endpoint;
          document.getElementById('aiModel').value = AI_PRESETS[val].model;
          if (AI_PRESETS[val].apiKey) {
            document.getElementById('aiApiKey').value = AI_PRESETS[val].apiKey;
          }
          saveSettings(true);
        }
      });
    }

    document.getElementById('aiEndpoint').value = settings.aiEndpoint || 'http://192.168.199.159:28080/v1';
    document.getElementById('aiApiKey').value = settings.aiApiKey || 'liang-gemini-proxy-2026';
    document.getElementById('aiModel').value = settings.aiModel || 'gemini-3.1-flash-lite';
    document.getElementById('translateTarget').value = settings.translateTarget || 'Simplified Chinese';
    document.getElementById('defaultSummaryView').value = settings.defaultSummaryView || 'bilingual';
    document.getElementById('highlightEnabled').checked = settings.highlightEnabled !== false;

    // Cloud TTS
    document.getElementById('cloudTtsEndpoint').value = settings.cloudTtsEndpoint || 'http://192.168.199.159:5001';
    loadCloudVoices(settings.cloudTtsEndpoint || 'http://192.168.199.159:5001', settings.cloudTtsVoice || '', settings.cloudTtsVoiceTrans || '');

    loadVoices(settings.ttsVoice);
  });

  document.getElementById('ttsSpeed').addEventListener('input', (e) => {
    document.getElementById('ttsSpeedLabel').textContent = e.target.value + 'x';
  });

  document.getElementById('saveBtn').addEventListener('click', () => saveSettings(false));

  document.getElementById('testAiBtn').addEventListener('click', () => {
    const btn = document.getElementById('testAiBtn');
    const res = document.getElementById('testAiResult');
    btn.textContent = '...';
    res.textContent = '';
    const endpoint = document.getElementById('aiEndpoint').value;
    const apiKey = document.getElementById('aiApiKey').value;
    const model = document.getElementById('aiModel').value;

    chrome.runtime.sendMessage({
      action: 'proxyTranslate',
      endpoint,
      apiKey,
      model,
      text: 'Hello, ReadMate!',
      targetLang: 'Simplified Chinese'
    }, (resp) => {
      btn.textContent = _('btnTestAi');
      if (resp?.ok) {
        res.textContent = '✓ ' + resp.text;
        res.className = 'test-result test-ok';
      } else {
        res.textContent = '✕ ' + (resp?.error || 'Err');
        res.className = 'test-result test-err';
      }
    });
  });

  document.getElementById('testCloudVoiceBtn').addEventListener('click', () => {
    const btn = document.getElementById('testCloudVoiceBtn');
    const res = document.getElementById('testCloudVoiceResult');
    btn.disabled = true;
    res.textContent = '...';
    const endpoint = document.getElementById('cloudTtsEndpoint').value;
    const voice = document.getElementById('cloudTtsVoice').value || 'zh-CN-XiaoxiaoNeural';
    fetch(endpoint.replace(/\/+$/, '') + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ReadMate voice test. 读伴语音测试。', voice, rate: '+0%' })
    }).then(r => r.blob()).then(blob => {
      const a = new Audio(URL.createObjectURL(blob));
      a.play();
      btn.disabled = false;
      res.textContent = '✓ OK';
      res.className = 'test-result test-ok';
    }).catch(e => {
      btn.disabled = false;
      res.textContent = '✕ ' + e.message;
      res.className = 'test-result test-err';
    });
  });
});

function loadVoices(savedVoice) {
  const voiceSelect = document.getElementById('ttsVoice');
  function populateVoices() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    voiceSelect.innerHTML = `<option value="">${_('voiceAutoLang')}</option>`;
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    }
    if (savedVoice) voiceSelect.value = savedVoice;
  }
  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

function loadCloudVoices(endpoint, savedVoice, savedTransVoice) {
  const voiceSelect = document.getElementById('cloudTtsVoice');
  const transSelect = document.getElementById('cloudTtsVoiceTrans');
  if (!endpoint) return;
  fetch(endpoint.replace(/\/+$/, '') + '/voices')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      const voices = data.voices || data;
      if (!Array.isArray(voices)) return;
      if (voiceSelect) {
        voiceSelect.innerHTML = `<option value="">${_('optCloudAuto')}</option>`;
        for (const v of voices) {
          const opt = document.createElement('option');
          opt.value = v.ShortName || v.name;
          opt.textContent = `${v.FriendlyName || v.name} (${v.Locale || ''})`;
          voiceSelect.appendChild(opt);
        }
        if (savedVoice) voiceSelect.value = savedVoice;
      }
      if (transSelect) {
        transSelect.innerHTML = `<option value="">跟随母语最佳音色 (中文自动用晓晓)</option>`;
        for (const v of voices) {
          const opt = document.createElement('option');
          opt.value = v.ShortName || v.name;
          opt.textContent = `${v.FriendlyName || v.name} (${v.Locale || ''})`;
          transSelect.appendChild(opt);
        }
        if (savedTransVoice) transSelect.value = savedTransVoice;
      }
    }).catch(() => {});
}

function saveSettings(silent) {
  const settings = {
    ttsEngine: document.querySelector('input[name="ttsEngine"]:checked')?.value || 'cloud',
    ttsSpeed: parseFloat(document.getElementById('ttsSpeed').value),
    ttsVoice: document.getElementById('ttsVoice').value || '',
    readVoiceMode: document.getElementById('readVoiceMode')?.value || 'original',
    enableBilingual: document.getElementById('enableBilingual')?.checked || false,
    showBilingualSubtitles: document.getElementById('showBilingualSubtitles')?.checked !== false,
    cloudTtsEndpoint: document.getElementById('cloudTtsEndpoint').value,
    cloudTtsVoice: document.getElementById('cloudTtsVoice')?.value || '',
    cloudTtsVoiceTrans: document.getElementById('cloudTtsVoiceTrans')?.value || '',
    aiProvider: document.getElementById('aiProviderSelect')?.value || 'gemini',
    aiEndpoint: document.getElementById('aiEndpoint').value,
    aiApiKey: document.getElementById('aiApiKey').value,
    aiModel: document.getElementById('aiModel').value,
    translateTarget: document.getElementById('translateTarget').value,
    defaultSummaryView: document.getElementById('defaultSummaryView')?.value || 'bilingual',
    highlightEnabled: document.getElementById('highlightEnabled').checked,
    uiLanguage: activeUiLang,
  };

  chrome.runtime.sendMessage({ action: 'saveSettings', settings }, () => {
    // 广播给所有打开的标签页，原地热生效新配置，读者无需手动刷新页面！
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(t => {
        if (t.id) chrome.tabs.sendMessage(t.id, { action: 'settingsUpdated', settings }, () => {});
      });
    });
    if (!silent) {
      const s = document.getElementById('saveStatus');
      if (s) {
        s.textContent = _('savedStatus');
        setTimeout(() => s.textContent = '', 2000);
      }
    }
  });
}
