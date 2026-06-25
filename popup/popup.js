// ReadMate / 读伴 — 设置弹窗

// 加载设置
document.addEventListener('DOMContentLoaded', async () => {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
    document.getElementById('ttsEngine').value = settings.ttsEngine;
    document.getElementById('ttsSpeed').value = settings.ttsSpeed;
    document.getElementById('ttsSpeedLabel').textContent = settings.ttsSpeed + 'x';

    // Edge TTS
    document.getElementById('edgeTtsEndpoint').value = settings.edgeTtsEndpoint;
    // Edge TTS voice 会异步加载，加载后再设值
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

    // 加载可用语音（settings 加载后再加载 voices，避免被覆盖）
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
    if (voices.length === 0) {
      return;
    }

    voiceSelect.innerHTML = '<option value="">自动检测（按页面语言）</option>';

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
        opt.textContent = `${v.name}${v.localService ? ' (本地)' : ''}`;
        optgroup.appendChild(opt);
      }
      voiceSelect.appendChild(optgroup);
    }

    if (savedVoice) {
      voiceSelect.value = savedVoice;
    }
  }

  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

// 加载 Edge TTS 语音列表
function loadEdgeTtsVoices(endpoint, savedVoice) {
  const select = document.getElementById('edgeTtsVoice');
  if (!endpoint) {
    select.innerHTML = '<option value="">请先配置端点</option>';
    return;
  }

  const voicesUrl = endpoint.replace(/\/+$/, '') + '/voices';
  select.innerHTML = '<option value="">加载语音列表...</option>';

  fetch(voicesUrl)
    .then(r => r.json())
    .then(voices => {
      if (!voices || voices.length === 0) {
        select.innerHTML = '<option value="">无可用语音</option>';
        return;
      }

      select.innerHTML = '';

      // 添加默认选项
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- 请选择语音 --';
      select.appendChild(defaultOpt);

      // 按 Locale 分组
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
          opt.textContent = `${v.FriendlyName} (${v.Gender})`;
          optgroup.appendChild(opt);
        }
        select.appendChild(optgroup);
      }

      if (savedVoice) select.value = savedVoice;
    })
    .catch(err => {
      select.innerHTML = '<option value="">加载失败，请检查端点</option>';
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
  status.textContent = '⏳ 保存中...';
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
    status.textContent = '⚠️ 请先填写端点和 API Key';
    status.style.color = '#f44336';
    return;
  }

  status.textContent = '⏳ 测试中...';
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
      status.textContent = '✅ 翻译成功: ' + resp.text;
      status.style.color = '#4caf50';
    } else {
      status.textContent = '❌ 测试失败: ' + (resp?.error || '无响应');
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
  };

  chrome.runtime.sendMessage({ action: 'saveSettings', settings }, (resp) => {
    const status = document.getElementById('saveStatus');
    if (resp?.ok) {
      status.textContent = '✅ 已保存';
      status.style.color = '#4caf50';
    } else {
      status.textContent = '❌ 保存失败';
      status.style.color = '#f44336';
    }
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}
