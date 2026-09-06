// ReadMate / 读伴 — 设置弹窗 (全国际化 + 防迷路视觉切换器)

let messages = {};
let currentTabId = null;
let activeUiLang = 'zh_CN';

// AI 服务商预设配置映射
const AI_PRESETS = {
  openai: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: '',
  },
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    apiKey: '',
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash',
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

function getBrowserLang() {
  const lang = (navigator.language || 'en').replace('-', '_');
  if (lang.startsWith('zh')) return 'zh_CN';
  if (lang.startsWith('ja')) return 'ja';
  return 'en';
}

async function loadMessages(lang) {
  activeUiLang = lang || 'zh_CN';
  try {
    const url = chrome.runtime.getURL(`_locales/${activeUiLang}/messages.json`);
    const resp = await fetch(url);
    const data = await resp.json();
    messages = {};
    for (const [key, val] of Object.entries(data)) {
      messages[key] = val.message;
    }
  } catch(e) {
    messages = {};
  }
}

function _(key) {
  return messages[key] || chrome.i18n.getMessage(key) || key;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function localize() {
  document.title = _('appName');
  setText('readPageBtn', _('btnReadPage'));
  setText('stopBtn', _('btnStop'));
  setText('lblShortcutTip', _('shortcutTip'));
  setText('lblRefreshTip', _('refreshTip'));

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
  setText('optProviderOpenAI', _('optProviderOpenAI'));
  setText('optProviderDeepSeek', _('optProviderDeepSeek'));
  setText('optProviderSiliconFlow', _('optProviderSiliconFlow'));
  setText('optProviderGemini', _('optProviderGemini'));
  setText('optProviderMoonshot', _('optProviderMoonshot'));
  setText('optProviderQwen', _('optProviderQwen'));
  setText('optProviderCustom', _('optProviderCustom'));

  setText('lblEndpoint', _('lblEndpoint'));
  setText('lblApiKey', _('lblApiKey'));
  setText('lblModel', _('lblModel'));
  setText('optModelGpt4oMini', _('optModelGpt4oMini'));
  setText('optModelSiliconFree', _('optModelSiliconFree'));
  setText('lblTargetLanguage', _('lblTargetLanguage'));
  setText('lblHighlight', _('lblHighlight'));
  setText('testBtn', _('btnTestAi'));

  setText('saveBtn', _('btnSave'));
  setText('btnPopupDonate', _('btnDonatePopup'));
  setText('openOptionsBtn', _('btnFullOptions'));

  // 同步下拉框状态
  const sel = document.getElementById('uiLangSelect');
  if (sel) sel.value = activeUiLang;
}

/** 切换界面语言并通知当前页面与后台 */
async function switchLanguage(lang) {
  await loadMessages(lang);
  localize();
  chrome.storage.sync.set({ uiLanguage: lang }, () => {
    // 广播语言变更给所有活跃 tab，原地重新渲染
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { action: 'uiLanguageChanged', lang }, () => {});
      });
    });
  });
}

function updateEngineSections(engine) {
  const browserSection = document.getElementById('browserTtsSection');
  const cloudSection = document.getElementById('cloudTtsSection');
  if (engine === 'cloud') {
    if (browserSection) browserSection.style.display = 'none';
    if (cloudSection) cloudSection.style.display = '';
  } else {
    if (browserSection) browserSection.style.display = '';
    if (cloudSection) cloudSection.style.display = 'none';
  }
}

function getCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs.length > 0 ? tabs[0] : null);
    });
  });
}

function pingContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (resp) => {
      resolve(!chrome.runtime.lastError && !!resp);
    });
  });
}

function injectContentScripts(tabId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'injectContent', tabId }, (resp) => {
      if (resp?.ok) resolve(true);
      else reject(resp?.error || 'inject failed');
    });
  });
}

function setPageStatus(text, ok) {
  const el = document.getElementById('pageStatus');
  if (el) {
    el.textContent = text;
    el.className = 'page-status ' + (ok === true ? 'status-ok' : ok === false ? 'status-err' : '');
  }
}

async function readCurrentPage() {
  if (!currentTabId) return;
  saveSettings(true);
  let alive = await pingContentScript(currentTabId);
  if (!alive) {
    setPageStatus('Injecting...', null);
    try {
      await injectContentScripts(currentTabId);
      await new Promise(r => setTimeout(r, 300));
      alive = await pingContentScript(currentTabId);
    } catch (e) {
      setPageStatus('Failed: ' + e.message, false);
      return;
    }
  }

  if (alive) {
    chrome.tabs.sendMessage(currentTabId, { action: 'readPage' }, () => {
      setTimeout(() => window.close(), 300);
    });
  }
}

async function stopAllReading() {
  chrome.runtime.sendMessage({ action: 'stop' });
  // 广播停止信号到所有标签页，确保毫秒级秒杀任何正在播放的页面
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(t => {
      if (t.id) chrome.tabs.sendMessage(t.id, { action: 'stop' }, () => {});
    });
  });
  setPageStatus(_('btnStop'), false);
}

document.addEventListener('DOMContentLoaded', async () => {
  const tab = await getCurrentTab();
  if (tab) currentTabId = tab.id;

  // 绑定语言下拉框选择
  const langSel = document.getElementById('uiLangSelect');
  if (langSel) {
    langSel.onchange = (e) => switchLanguage(e.target.value);
  }

  chrome.runtime.sendMessage({ action: 'getSettings' }, async (settings) => {
    let uiLang = settings.uiLanguage || 'auto';
    if (uiLang === 'auto') uiLang = getBrowserLang();
    await loadMessages(uiLang);
    localize();

    // 填充设置值
    document.getElementById('ttsSpeed').value = settings.ttsSpeed || 1.0;
    document.getElementById('ttsSpeedLabel').textContent = (settings.ttsSpeed || 1.0) + 'x';

    // 引擎
    const engine = settings.ttsEngine || 'cloud';
    const engineRadio = document.querySelector(`input[name="ttsEngine"][value="${engine}"]`);
    if (engineRadio) engineRadio.checked = true;
    updateEngineSections(engine);
    document.querySelectorAll('input[name="ttsEngine"]').forEach(r => {
      r.addEventListener('change', (e) => {
        updateEngineSections(e.target.value);
        autoSave();
      });
    });

    // 朗读语音流模式与字幕
    if (document.getElementById('readVoiceMode')) {
      document.getElementById('readVoiceMode').value = settings.readVoiceMode || 'original';
    }
    if (document.getElementById('showBilingualSubtitles')) {
      document.getElementById('showBilingualSubtitles').checked = settings.showBilingualSubtitles !== false;
    }

    // AI 服务商与端点
    const provider = settings.aiProvider || 'gemini';
    const providerSelect = document.getElementById('aiProviderSelect');
    if (providerSelect) {
      providerSelect.value = provider;
      providerSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (AI_PRESETS[val] && val !== 'custom') {
          document.getElementById('aiEndpoint').value = AI_PRESETS[val].endpoint;
          document.getElementById('aiModel').value = AI_PRESETS[val].model;
          if (AI_PRESETS[val].apiKey) {
            document.getElementById('aiApiKey').value = AI_PRESETS[val].apiKey;
          }
          autoSave();
        }
      });
    }

    // AI
    document.getElementById('aiEndpoint').value = settings.aiEndpoint || 'https://api.openai.com/v1';
    document.getElementById('aiApiKey').value = settings.aiApiKey || '';
    document.getElementById('aiModel').value = settings.aiModel || 'gpt-4o-mini';
    document.getElementById('translateTarget').value = settings.translateTarget || 'Simplified Chinese';
    document.getElementById('highlightEnabled').checked = settings.highlightEnabled !== false;

    // 云端 Edge TTS
    document.getElementById('cloudTtsEndpoint').value = settings.cloudTtsEndpoint || 'http://powerplus.blogsyte.com:5001';
    loadCloudVoices(settings.cloudTtsEndpoint || 'http://powerplus.blogsyte.com:5001', settings.cloudTtsVoice || '');

    // 本地语音
    loadVoices(settings.ttsVoice);

    if (currentTabId) {
      const alive = await pingContentScript(currentTabId);
      setPageStatus(alive ? '✓ Ready' : 'Ready', alive);
    }
  });

  document.getElementById('readPageBtn').addEventListener('click', readCurrentPage);
  document.getElementById('stopBtn')?.addEventListener('click', stopAllReading);
  document.getElementById('injectBtn').addEventListener('click', async () => {
    if (!currentTabId) return;
    await injectContentScripts(currentTabId);
    const alive = await pingContentScript(currentTabId);
    setPageStatus(alive ? '✓ Ready' : 'Failed', alive);
  });

  document.getElementById('ttsSpeed').addEventListener('input', (e) => {
    document.getElementById('ttsSpeedLabel').textContent = e.target.value + 'x';
  });

  document.getElementById('saveBtn').addEventListener('click', () => saveSettings(false));
  document.getElementById('testBtn').addEventListener('click', testAiConnection);

  document.getElementById('testBrowserVoiceBtn').addEventListener('click', () => {
    testVoiceFromPopup('browser', document.getElementById('testBrowserVoiceBtn'), document.getElementById('testBrowserVoiceResult'));
  });
  document.getElementById('testCloudVoiceBtn').addEventListener('click', () => {
    testVoiceFromPopup('cloud', document.getElementById('testCloudVoiceBtn'), document.getElementById('testCloudVoiceResult'));
  });

  document.getElementById('openOptionsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  document.getElementById('btnPopupDonate')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#donate') });
  });

  document.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', () => autoSave());
    if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'password') {
      el.addEventListener('input', debounce(autoSave, 500));
    }
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

function loadCloudVoices(endpoint, savedVoice) {
  const voiceSelect = document.getElementById('cloudTtsVoice');
  if (!endpoint) return;
  fetch(endpoint.replace(/\/+$/, '') + '/voices')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      const voices = data.voices || data;
      if (!Array.isArray(voices)) return;
      voiceSelect.innerHTML = `<option value="">${_('optCloudAuto')}</option>`;
      for (const v of voices) {
        const opt = document.createElement('option');
        opt.value = v.ShortName || v.name;
        opt.textContent = `${v.FriendlyName || v.name} (${v.Locale || ''})`;
        voiceSelect.appendChild(opt);
      }
      if (savedVoice) voiceSelect.value = savedVoice;
    }).catch(() => {});
}

function testAiConnection() {
  const endpoint = document.getElementById('aiEndpoint').value;
  const apiKey = document.getElementById('aiApiKey').value;
  const model = document.getElementById('aiModel').value;
  const btn = document.getElementById('testBtn');
  const res = document.getElementById('testAiResult');
  btn.textContent = '...';
  if (res) {
    res.textContent = '';
    res.className = 'test-result';
  }

  chrome.runtime.sendMessage({
    action: 'proxyTranslate',
    endpoint,
    apiKey,
    model,
    text: 'Hello, ReadMate!',
    targetLang: 'Simplified Chinese'
  }, (resp) => {
    btn.textContent = _('btnTestAi');
    if (res) {
      if (resp?.ok) {
        res.textContent = '✓ ' + (resp.text || 'OK');
        res.className = 'test-result test-ok';
      } else {
        res.textContent = '✕ ' + (resp?.error || 'Err');
        res.className = 'test-result test-err';
      }
    } else {
      btn.textContent = resp?.ok ? '✓ OK: ' + resp.text : '✕ ' + (resp?.error || 'Err');
      setTimeout(() => { btn.textContent = _('btnTestAi'); }, 3500);
    }
  });
}

function testVoiceFromPopup(type, btn, resultEl) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';
  const speed = parseFloat(document.getElementById('ttsSpeed').value);
  const text = 'ReadMate voice test. 你好，欢迎使用读伴。';

  if (type === 'cloud') {
    const endpoint = document.getElementById('cloudTtsEndpoint').value;
    const voice = document.getElementById('cloudTtsVoice').value || 'zh-CN-XiaoxiaoNeural';
    fetch(endpoint.replace(/\/+$/, '') + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate: `+${Math.round((speed - 1) * 100)}%` })
    }).then(r => r.blob()).then(blob => {
      const a = new Audio(URL.createObjectURL(blob));
      a.play();
      btn.disabled = false; btn.textContent = orig;
    }).catch(() => { btn.disabled = false; btn.textContent = 'Error'; });
  } else {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = speed;
    const v = document.getElementById('ttsVoice').value;
    if (v) u.voice = speechSynthesis.getVoices().find(x => x.name === v);
    speechSynthesis.speak(u);
    btn.disabled = false; btn.textContent = orig;
  }
}

function saveSettings(silent) {
  const settings = {
    ttsEngine: document.querySelector('input[name="ttsEngine"]:checked')?.value || 'browser',
    ttsSpeed: parseFloat(document.getElementById('ttsSpeed').value),
    ttsVoice: document.getElementById('ttsVoice').value || '',
    readVoiceMode: document.getElementById('readVoiceMode')?.value || 'original',
    showBilingualSubtitles: document.getElementById('showBilingualSubtitles')?.checked !== false,
    cloudTtsEndpoint: document.getElementById('cloudTtsEndpoint').value,
    cloudTtsVoice: document.getElementById('cloudTtsVoice').value || '',
    aiProvider: document.getElementById('aiProviderSelect')?.value || 'gemini',
    aiEndpoint: document.getElementById('aiEndpoint').value,
    aiApiKey: document.getElementById('aiApiKey').value,
    aiModel: document.getElementById('aiModel').value,
    translateTarget: document.getElementById('translateTarget').value,
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

function autoSave() { saveSettings(true); }
function debounce(fn, delay) {
  let timer;
  return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); };
}
