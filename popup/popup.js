// ReadMate / 读伴 — 设置弹窗
// 语音设置 + 云端 Edge TTS + AI 翻译 + 界面语言 + 页面朗读控制

let messages = {};
let currentTabId = null;

function getBrowserLang() {
  const lang = (navigator.language || 'en').replace('-', '_');
  if (lang === 'zh_CN' || lang === 'zh_TW' || lang === 'zh') return 'zh_CN';
  return 'en';
}

async function loadMessages(lang) {
  try {
    const url = chrome.runtime.getURL('_locales/' + lang + '/messages.json');
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
  setText('lblTtsSection', _('ttsEngineSection'));
  setText('lblSpeed', _('speedLabel'));
  setText('lblVoice', _('voiceLabel'));
  setText('optVoiceAuto', _('voiceAutoLang'));
  setText('lblCloudEndpoint', '服务器');
  setText('lblCloudVoice', '云端语音');
  setText('optCloudAuto', '默认 (zh-CN-XiaoxiaoNeural)');
  setText('lblAiSection', _('aiTranslateSection'));
  setText('lblEndpoint', _('endpointLabel'));
  setText('lblApiKey', _('apiKeyLabel'));
  setText('lblModel', _('modelLabel'));
  setText('lblTargetLanguage', _('targetLanguageLabel'));
  setText('optLangZhCn', _('langZhCn'));
  setText('optLangEn', _('langEn'));
  setText('optLangJa', _('langJa'));
  setText('optLangKo', _('langKo'));
  setText('optLangFr', _('langFr'));
  setText('optLangDe', _('langDe'));
  setText('optLangEs', _('langEs'));
  setText('lblAutoTranslate', _('autoTranslateLabel'));
  setText('lblHighlight', _('highlightLabel'));
  setText('lblUiSection', _('otherSection'));
  setText('lblUiLanguage', _('uiLanguageLabel'));
  setText('optLangAuto', _('langAuto'));
  setText('optLangEnglish', _('langEnglish'));
  setText('optLangChinese', _('langChinese'));
  setText('saveBtn', _('saveButton'));
  setText('testBtn', _('testTranslateBtn'));
}

/** 根据引擎选择显示/隐藏对应区域 */
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

/** 获取当前活动标签页 */
function getCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs.length > 0 ? tabs[0] : null);
    });
  });
}

/** 检测 content script 是否已注入 */
function pingContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/** 通过 background 注入 content scripts */
function injectContentScripts(tabId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'injectContent', tabId }, (resp) => {
      if (resp?.ok) {
        resolve(true);
      } else {
        reject(resp?.error || 'inject failed');
      }
    });
  });
}

/** 更新页面状态指示 */
function setPageStatus(text, ok) {
  const el = document.getElementById('pageStatus');
  if (el) {
    el.textContent = text;
    el.className = 'page-status' + (ok === true ? ' status-ok' : ok === false ? ' status-err' : '');
  }
}

/** 朗读当前页面 */
async function readCurrentPage() {
  if (!currentTabId) {
    setPageStatus('没有活动页面', false);
    return;
  }

  setPageStatus('正在连接插件...', null);

  // 先保存当前设置
  saveSettings(true);

  // 检查 content script 是否存活
  let alive = await pingContentScript(currentTabId);

  if (!alive) {
    setPageStatus('正在注入插件到页面...', null);
    try {
      await injectContentScripts(currentTabId);
      // 等待注入完成
      await new Promise(r => setTimeout(r, 300));
      alive = await pingContentScript(currentTabId);
    } catch (e) {
      setPageStatus('注入失败: ' + e.message, false);
      return;
    }
  }

  if (alive) {
    chrome.tabs.sendMessage(currentTabId, { action: 'readPage' }, (resp) => {
      if (chrome.runtime.lastError) {
        setPageStatus('朗读启动失败: ' + chrome.runtime.lastError.message, false);
      } else {
        setPageStatus('▶ 朗读已开始', true);
      }
    });
  } else {
    setPageStatus('无法连接页面，请刷新后重试', false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 获取当前标签
  const tab = await getCurrentTab();
  if (tab) {
    currentTabId = tab.id;
  }

  chrome.runtime.sendMessage({ action: 'getSettings' }, async (settings) => {
    const uiLang = settings.uiLanguage || 'auto';
    const effectiveLang = uiLang === 'auto' ? getBrowserLang() : uiLang;
    await loadMessages(effectiveLang);
    localize();

    // 填充设置值
    document.getElementById('ttsSpeed').value = settings.ttsSpeed;
    document.getElementById('ttsSpeedLabel').textContent = settings.ttsSpeed + 'x';

    // 引擎切换
    const engine = settings.ttsEngine || 'browser';
    document.querySelector(`input[name="ttsEngine"][value="${engine}"]`).checked = true;
    updateEngineSections(engine);

    // 引擎切换事件
    document.querySelectorAll('input[name="ttsEngine"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        updateEngineSections(e.target.value);
        autoSave();
      });
    });

    // 从 HTTP 端点加载云端语音（手机端不需要 CA 证书）
    document.getElementById('cloudTtsEndpoint').value = settings.cloudTtsEndpoint || 'http://powerplus.blogsyte.com:5001';
    loadCloudVoices(settings.cloudTtsEndpoint || 'http://powerplus.blogsyte.com:5001', settings.cloudTtsVoice || '');

    // AI 翻译
    document.getElementById('aiEndpoint').value = settings.aiEndpoint;
    document.getElementById('aiApiKey').value = settings.aiApiKey;
    document.getElementById('aiModel').value = settings.aiModel;
    document.getElementById('translateTarget').value = settings.translateTarget;
    document.getElementById('autoTranslate').checked = settings.autoTranslate;
    document.getElementById('highlightEnabled').checked = settings.highlightEnabled;
    document.getElementById('uiLanguage').value = settings.uiLanguage || 'auto';

    // 加载语音列表
    loadVoices(settings.ttsVoice);

    // Edge TTS 端点变更时重新加载语音
    document.getElementById('cloudTtsEndpoint').addEventListener('change', function() {
      loadCloudVoices(this.value, '');
    });

    // 检测页面状态
    if (currentTabId) {
      const alive = await pingContentScript(currentTabId);
      setPageStatus(alive ? '✅ 插件已就绪' : '⚠️ 点击"▶ 朗读此页"自动注入', alive);
    } else {
      setPageStatus('⚠️ 没有活动标签页', false);
    }
  });

  // ====== 朗读按钮 ======
  document.getElementById('readPageBtn').addEventListener('click', readCurrentPage);

  // ====== 重新注入按钮 ======
  document.getElementById('injectBtn').addEventListener('click', async () => {
    if (!currentTabId) return;
    setPageStatus('正在注入插件到页面...', null);
    try {
      await injectContentScripts(currentTabId);
      await new Promise(r => setTimeout(r, 300));
      const alive = await pingContentScript(currentTabId);
      setPageStatus(alive ? '✅ 注入成功' : '❌ 注入后仍未响应', alive);
    } catch (e) {
      setPageStatus('注入失败: ' + e.message, false);
    }
  });

  // 语速实时更新
  document.getElementById('ttsSpeed').addEventListener('input', (e) => {
    document.getElementById('ttsSpeedLabel').textContent = e.target.value + 'x';
  });

  // ====== 测试按钮 ======
  document.getElementById('testBrowserVoiceBtn').addEventListener('click', async () => {
    const btn = document.getElementById('testBrowserVoiceBtn');
    const result = document.getElementById('testBrowserVoiceResult');
    testVoiceFromPopup('browser', btn, result);
  });
  document.getElementById('testCloudVoiceBtn').addEventListener('click', async () => {
    const btn = document.getElementById('testCloudVoiceBtn');
    const result = document.getElementById('testCloudVoiceResult');
    testVoiceFromPopup('cloud', btn, result);
  });

  document.getElementById('saveBtn').addEventListener('click', () => saveSettings(false));
  document.getElementById('testBtn').addEventListener('click', testTranslation);

  // ====== 打开完整设置页面（直接URL，兼容Kiwi）======
  document.getElementById('openOptionsBtn').addEventListener('click', () => {
    const optsUrl = chrome.runtime.getURL('options/options.html');
    chrome.tabs.create({ url: optsUrl });
  });

  // 自动保存
  document.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', () => autoSave());
    if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'password') {
      el.addEventListener('input', debounce(autoSave, 500));
    }
  });
});

// 加载浏览器语音列表
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
        opt.textContent = v.name + (v.localService ? ' (本地)' : '');
        optgroup.appendChild(opt);
      }
      voiceSelect.appendChild(optgroup);
    }

    if (savedVoice) voiceSelect.value = savedVoice;
  }

  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

// 加载云端 Edge TTS 语音列表
function loadCloudVoices(endpoint, savedVoice) {
  const select = document.getElementById('cloudTtsVoice');
  if (!endpoint) {
    select.innerHTML = '<option value="">先填写服务器地址</option>';
    return;
  }
  const voicesUrl = endpoint.replace(/\/+$/, '') + '/voices';
  select.innerHTML = '<option value="">加载中...</option>';

  fetch(voicesUrl)
    .then(r => r.json())
    .then(voices => {
      if (!voices || voices.length === 0) {
        select.innerHTML = '<option value="">无可用语音</option>';
        return;
      }
      select.innerHTML = '<option value="">默认 (zh-CN-XiaoxiaoNeural)</option>';
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
      select.innerHTML = '<option value="">连接失败: ' + err.message + '</option>';
    });
}

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function autoSave() {
  const status = document.getElementById('saveStatus');
  status.textContent = _('savingStatus');
  status.style.color = '#888';
  saveSettings(true);
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
      status.textContent = '❌ ' + (resp?.error || 'no response');
      status.style.color = '#f44336';
    }
    setTimeout(() => { status.textContent = ''; }, 5000);
  });
}

/** 测试语音（直接在当前弹窗播放，不依赖 content script） */
function testVoiceFromPopup(type, btn, resultEl) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = type === 'cloud' ? '☁️ 测试中...' : '测试中...';
  resultEl.textContent = '';
  resultEl.className = 'test-result';

  const speed = parseFloat(document.getElementById('ttsSpeed').value);
  const testText = '你好，欢迎使用读伴朗读助手。This is a test of the TTS engine.';

  if (type === 'cloud') {
    // 云端测试：直接 fetch TTS 服务端
    const endpoint = document.getElementById('cloudTtsEndpoint').value;
    const voice = document.getElementById('cloudTtsVoice').value || 'zh-CN-XiaoxiaoNeural';
    if (!endpoint) {
      resultEl.textContent = '❌ 请先填写服务器地址';
      resultEl.className = 'test-result test-err';
      btn.disabled = false; btn.textContent = origText; return;
    }
    fetch(endpoint.replace(/\/+$/, '') + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: testText, voice, rate: `+${Math.round((speed - 1) * 100)}%` }),
    }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => { URL.revokeObjectURL(url); done(true, '云端'); };
        audio.onerror = () => { URL.revokeObjectURL(url); done(false, '播放失败'); };
        audio.play().catch(e => done(false, e.message));
      }).catch(e => done(false, e.message));
  } else {
    // 浏览器测试：直接用 speechSynthesis
    if (!window.speechSynthesis) { done(false, '浏览器不支持 speechSynthesis'); return; }
    speechSynthesis.cancel();
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(testText);
      utterance.rate = speed;
      const voiceName = document.getElementById('ttsVoice').value;
      if (voiceName) {
        const found = speechSynthesis.getVoices().find(v => v.name === voiceName);
        if (found) { utterance.voice = found; utterance.lang = found.lang; }
      } else { utterance.lang = 'zh-CN'; }
      let started = false;
      utterance.onstart = () => { started = true; };
      utterance.onend = () => done(true, '浏览器');
      utterance.onerror = (e) => done(false, e.error || '播放失败');
      speechSynthesis.speak(utterance);
      // 500ms 内没触发 onstart → 引擎未就绪
      setTimeout(() => { if (!started && btn.disabled) done(false, '引擎未就绪'); }, 500);
    }, 200);
  }

  function done(ok, msg) {
    btn.disabled = false; btn.textContent = origText;
    resultEl.textContent = ok ? '✅ ' + msg + '语音播放中...' : '❌ ' + msg;
    resultEl.className = 'test-result ' + (ok ? 'test-ok' : 'test-err');
  }
}

// 保存设置
function saveSettings(silent) {
  const settings = {
    ttsEngine: document.querySelector('input[name="ttsEngine"]:checked')?.value || 'browser',
    ttsSpeed: parseFloat(document.getElementById('ttsSpeed').value),
    ttsVoice: document.getElementById('ttsVoice').value || '',
    // 云端 Edge TTS
    cloudTtsEndpoint: document.getElementById('cloudTtsEndpoint').value,
    cloudTtsVoice: document.getElementById('cloudTtsVoice').value || '',
    // AI 翻译
    aiEndpoint: document.getElementById('aiEndpoint').value,
    aiApiKey: document.getElementById('aiApiKey').value,
    aiModel: document.getElementById('aiModel').value,
    translateTarget: document.getElementById('translateTarget').value,
    autoTranslate: document.getElementById('autoTranslate').checked,
    highlightEnabled: document.getElementById('highlightEnabled').checked,
    uiLanguage: document.getElementById('uiLanguage').value,
  };

  chrome.runtime.sendMessage({ action: 'saveSettings', settings }, (resp) => {
    if (!silent) {
      const status = document.getElementById('saveStatus');
      if (resp?.ok) {
        status.textContent = _('savedStatus');
        status.style.color = '#4caf50';
      } else {
        status.textContent = _('saveFailedStatus');
        status.style.color = '#f44336';
      }
      setTimeout(() => { status.textContent = ''; }, 2000);
    }
  });
}
