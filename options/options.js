// ReadMate / 读伴 — 选项页面逻辑
// 标签切换、设置加载/保存、语音选择、TTS测试、诊断

document.addEventListener('DOMContentLoaded', async () => {
  // ====== 标签切换 ======
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      if (target) target.classList.add('active');
      // 切换到语音标签时自动加载
      if (tab.dataset.tab === 'tts') {
        setTimeout(loadTTSVoices, 100);
      }
    });
  });

  // ====== 加载设置 ======
  const settings = await getSettings();

  // 基本设置
  document.getElementById('uiLanguage').value = settings.uiLanguage || 'auto';
  document.getElementById('highlightEnabled').checked = settings.highlightEnabled !== false;

  // 语音设置
  document.getElementById('ttsSpeedRange').value = settings.ttsSpeed || 1.0;
  document.getElementById('ttsSpeedDisplay').textContent = (settings.ttsSpeed || 1.0) + 'x';
  document.getElementById('cloudEndpoint').value = settings.cloudTtsEndpoint || 'http://powerplus.blogsyte.com:5001';

  // 引擎切换
  const engine = settings.ttsEngine || 'browser';
  document.querySelector('input[name="ttsEngine"][value="' + engine + '"]').checked = true;
  document.getElementById('browserTtsSection').style.display = engine === 'browser' ? 'block' : 'none';
  document.getElementById('cloudTtsSection').style.display = engine === 'cloud' ? 'block' : 'none';

  // 预读句数
  const buffer = settings.ttsBuffer || 1;
  document.getElementById('ttsBuffer').value = buffer;
  document.getElementById('ttsBufferDisplay').textContent = buffer + ' 句';

  // 翻译
  document.getElementById('translateTarget2').value = settings.translateTarget || 'Simplified Chinese';
  document.getElementById('autoTranslate').checked = settings.autoTranslate === true;
  document.getElementById('translateOnSelect').checked = settings.translateOnSelect === true;

  // 快捷键
  document.getElementById('enableShortcuts').checked = settings.enableShortcuts !== false;

  // ====== 统计展示 ======
  await refreshStats();

  // ====== 关于页 ======
  document.getElementById('aboutVersion').textContent = chrome.runtime.getManifest().version;

  // ====== 语速滑动条联动 ======
  document.getElementById('ttsSpeedRange').addEventListener('input', (e) => {
    document.getElementById('ttsSpeedDisplay').textContent = e.target.value + 'x';
  });

  // ====== 引擎切换 ======
  document.querySelectorAll('input[name="ttsEngine"]').forEach(radio => {
    radio.addEventListener('change', function() {
      const isCloud = this.value === 'cloud';
      document.getElementById('browserTtsSection').style.display = isCloud ? 'none' : 'block';
      document.getElementById('cloudTtsSection').style.display = isCloud ? 'block' : 'none';
      if (isCloud) loadCloudVoices();
    });
  });

  // ====== 预读句数滑动条 ======
  document.getElementById('ttsBuffer').addEventListener('input', (e) => {
    document.getElementById('ttsBufferDisplay').textContent = e.target.value + ' 句';
  });

  // ====== 云端端点变更 ======
  document.getElementById('cloudEndpoint').addEventListener('change', function() {
    loadCloudVoices(this.value);
  });

  // ====== 测试浏览器语音 ======
  document.getElementById('testBrowserTtsBtn').addEventListener('click', testBrowserTTS);

  // ====== 测试云端语音 ======
  document.getElementById('testCloudTtsBtn').addEventListener('click', testCloudTTS);

  // ====== 运行诊断 ======
  document.getElementById('runDiagnosticsBtn').addEventListener('click', runDiagnostics);

  // ====== 语音标签首次加载 ======
  setTimeout(loadTTSVoices, 200);
  setTimeout(loadCloudVoices, 300);

  // ====== 保存 ======
  document.getElementById('saveBtn').addEventListener('click', saveAllSettings);
  document.querySelectorAll('select, input').forEach(el => {
    el.addEventListener('change', () => {
      document.getElementById('globalSaveStatus').textContent = '(有未保存的更改)';
      document.getElementById('globalSaveStatus').style.color = '#e65100';
    });
  });

  // ====== 重置统计 ======
  document.getElementById('resetStatsBtn').addEventListener('click', async () => {
    if (confirm('确定要重置所有阅读统计数据吗？此操作不可恢复。')) {
      await ReadingStats.resetStats();
      await refreshStats();
      showStatus('统计已重置', '#4caf50');
    }
  });
});

// ====== 加载浏览器语音列表 ======
function loadTTSVoices() {
  const select = document.getElementById('ttsVoiceSelect');
  const savedVoice = select.dataset.savedVoice || '';

  function populate() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;

    select.innerHTML = '<option value="">自动匹配（浏览器默认）</option>';
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
        opt.title = v.lang + (v.localService ? ' · 本地引擎' : ' · 远程');
        optgroup.appendChild(opt);
      }
      select.appendChild(optgroup);
    }
    if (savedVoice) select.value = savedVoice;
    // 更新诊断
    updateDiagVoices(voices);
  }

  populate();
  window.speechSynthesis.onvoiceschanged = populate;
}

// ====== 加载云端语音列表 ======
async function loadCloudVoices(endpoint) {
  if (!endpoint) {
    endpoint = document.getElementById('cloudEndpoint')?.value || '';
  }
  const select = document.getElementById('cloudVoiceSelect');
  if (!endpoint) {
    select.innerHTML = '<option value="">先填写服务器地址</option>';
    return;
  }
  const voicesUrl = endpoint.replace(/\/+$/, '') + '/voices';
  select.innerHTML = '<option value="">加载中...</option>';

  try {
    const resp = await fetch(voicesUrl);
    const voices = await resp.json();
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
    document.getElementById('cloudStatus').textContent = '✅ 连接成功 (' + voices.length + ' 个语音)';
    document.getElementById('cloudStatus').className = 'engine-status status-ok';
    document.getElementById('diagCloudServer').textContent = '✅ 可连接';
    document.getElementById('diagCloudServer').className = 'diag-value diag-ok';
  } catch (err) {
    select.innerHTML = '<option value="">连接失败: ' + err.message + '</option>';
    document.getElementById('cloudStatus').textContent = '❌ 连接失败: ' + err.message;
    document.getElementById('cloudStatus').className = 'engine-status status-err';
    document.getElementById('diagCloudServer').textContent = '❌ 不可达';
    document.getElementById('diagCloudServer').className = 'diag-value diag-err';
  }
}

// ====== 测试浏览器 TTS ======
async function testBrowserTTS() {
  const btn = document.getElementById('testBrowserTtsBtn');
  const result = document.getElementById('testBrowserResult');
  btn.disabled = true;
  btn.textContent = '⏳ 测试中...';
  result.textContent = '';

  if (!window.speechSynthesis) {
    result.textContent = '❌ 浏览器不支持 speechSynthesis';
    result.className = 'test-result test-err';
    btn.disabled = false;
    btn.textContent = '▶ 测试浏览器语音';
    return;
  }

  speechSynthesis.cancel();
  await new Promise(r => setTimeout(r, 200));

  const voiceName = document.getElementById('ttsVoiceSelect').value;
  const speed = parseFloat(document.getElementById('ttsSpeedRange').value);
  const testText = '你好，欢迎使用读伴朗读助手。This is a test of the TTS engine.';

  const utterance = new SpeechSynthesisUtterance(testText);
  utterance.rate = speed;
  if (voiceName) {
    const voices = speechSynthesis.getVoices();
    const found = voices.find(v => v.name === voiceName);
    if (found) {
      utterance.voice = found;
      utterance.lang = found.lang; // Android 上必须匹配 lang 才生效
    }
  } else {
    utterance.lang = 'zh-CN';
  }

  utterance.onend = () => {
    result.textContent = '✅ 测试成功 (浏览器语音)';
    result.className = 'test-result test-ok';
    btn.disabled = false;
    btn.textContent = '▶ 测试浏览器语音';
  };
  utterance.onerror = (e) => {
    result.textContent = '❌ 播放失败: ' + e.error;
    result.className = 'test-result test-err';
    btn.disabled = false;
    btn.textContent = '▶ 测试浏览器语音';
  };

  speechSynthesis.speak(utterance);
  // 3秒超时保护
  setTimeout(() => {
    if (btn.disabled) {
      result.textContent = '⚠️ 无语音输出（可能引擎未就绪）';
      result.className = 'test-result test-warn';
      btn.disabled = false;
      btn.textContent = '▶ 测试浏览器语音';
    }
  }, 3000);
}

// ====== 测试云端 TTS ======
async function testCloudTTS() {
  const btn = document.getElementById('testCloudTtsBtn');
  const result = document.getElementById('testCloudResult');
  btn.disabled = true;
  btn.textContent = '⏳ 测试中...';
  result.textContent = '';

  const endpoint = document.getElementById('cloudEndpoint').value;
  const voice = document.getElementById('cloudVoiceSelect').value || 'zh-CN-XiaoxiaoNeural';

  if (!endpoint) {
    result.textContent = '❌ 请先填写服务器地址';
    result.className = 'test-result test-err';
    btn.disabled = false;
    btn.textContent = '▶ 测试云端语音';
    return;
  }

  const ttsUrl = endpoint.replace(/\/+$/, '') + '/tts';
  try {
    const resp = await fetch(ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '你好，欢迎使用读伴朗读助手。This is a test of the TTS engine.',
        voice: voice,
        rate: '+0%',
      }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      result.textContent = '✅ 测试成功 (云端语音)';
      result.className = 'test-result test-ok';
      btn.disabled = false;
      btn.textContent = '▶ 测试云端语音';
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(audioUrl);
      result.textContent = '❌ 播放失败';
      result.className = 'test-result test-err';
      btn.disabled = false;
      btn.textContent = '▶ 测试云端语音';
    };
    audio.play().catch(e => {
      result.textContent = '❌ 播放异常: ' + e.message;
      result.className = 'test-result test-err';
      btn.disabled = false;
      btn.textContent = '▶ 测试云端语音';
    });
    // 5秒超时
    setTimeout(() => {
      if (btn.disabled) {
        result.textContent = '⚠️ 超时无输出';
        result.className = 'test-result test-warn';
        btn.disabled = false;
        btn.textContent = '▶ 测试云端语音';
      }
    }, 5000);
  } catch (e) {
    result.textContent = '❌ 连接失败: ' + e.message;
    result.className = 'test-result test-err';
    btn.disabled = false;
    btn.textContent = '▶ 测试云端语音';
  }
}

// ====== 诊断 ======
function updateDiagVoices(voices) {
  document.getElementById('diagSpeechAvail').textContent = '✅ 可用';
  document.getElementById('diagSpeechAvail').className = 'diag-value diag-ok';
  document.getElementById('diagVoiceCount').textContent = voices.length;
  const zhVoices = voices.filter(v => v.lang.startsWith('zh'));
  document.getElementById('diagZhVoices').textContent = zhVoices.length + ' 个 (' + zhVoices.map(v => v.name.replace('Microsoft ', '')).join(', ') + ')';
}

async function runDiagnostics() {
  const btn = document.getElementById('runDiagnosticsBtn');
  btn.textContent = '⏳ 诊断中...';
  btn.disabled = true;

  // 检查 speechSynthesis
  if (window.speechSynthesis) {
    document.getElementById('diagSpeechAvail').textContent = '✅ 可用';
    document.getElementById('diagSpeechAvail').className = 'diag-value diag-ok';
    const voices = speechSynthesis.getVoices();
    document.getElementById('diagVoiceCount').textContent = voices.length + ' 个';
    const zhVoices = voices.filter(v => v.lang && v.lang.startsWith('zh'));
    document.getElementById('diagZhVoices').textContent = zhVoices.length + ' 个';
    if (zhVoices.length === 0) {
      document.getElementById('diagZhVoices').className = 'diag-value diag-err';
    } else {
      document.getElementById('diagZhVoices').className = 'diag-value diag-ok';
    }
  } else {
    document.getElementById('diagSpeechAvail').textContent = '❌ 不可用';
    document.getElementById('diagSpeechAvail').className = 'diag-value diag-err';
    document.getElementById('diagVoiceCount').textContent = '0';
    document.getElementById('diagZhVoices').textContent = '0';
    document.getElementById('diagZhVoices').className = 'diag-value diag-err';
  }

  // 检查云端
  const endpoint = document.getElementById('cloudEndpoint').value;
  if (endpoint) {
    try {
      const resp = await fetch(endpoint.replace(/\/+$/, '') + '/voices');
      if (resp.ok) {
        const voices = await resp.json();
        document.getElementById('diagCloudServer').textContent = '✅ 可连接 (' + (voices ? voices.length : 0) + ' 语音)';
        document.getElementById('diagCloudServer').className = 'diag-value diag-ok';
      } else {
        throw new Error('HTTP ' + resp.status);
      }
    } catch (e) {
      document.getElementById('diagCloudServer').textContent = '❌ 连接失败: ' + e.message;
      document.getElementById('diagCloudServer').className = 'diag-value diag-err';
    }
  }

  btn.textContent = '🔄 重新诊断';
  btn.disabled = false;
}

// ====== 基础工具函数 ======
function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, resolve);
  });
}

async function saveAllSettings() {
  const settings = {};
  const existing = await getSettings();
  Object.assign(settings, existing);

  settings.uiLanguage = document.getElementById('uiLanguage').value;
  settings.highlightEnabled = document.getElementById('highlightEnabled').checked;
  settings.ttsSpeed = parseFloat(document.getElementById('ttsSpeedRange').value);
  settings.ttsVoice = document.getElementById('ttsVoiceSelect').value || '';
  settings.ttsEngine = document.querySelector('input[name="ttsEngine"]:checked')?.value || 'browser';
  settings.cloudTtsEndpoint = document.getElementById('cloudEndpoint').value;
  settings.cloudTtsVoice = document.getElementById('cloudVoiceSelect').value || '';
  settings.ttsBuffer = parseInt(document.getElementById('ttsBuffer').value) || 1;
  settings.translateTarget = document.getElementById('translateTarget2').value;
  settings.autoTranslate = document.getElementById('autoTranslate').checked;

  chrome.runtime.sendMessage({ action: 'saveSettings', settings }, (resp) => {
    const status = document.getElementById('globalSaveStatus');
    if (resp?.ok) {
      status.textContent = '✓ 设置已保存';
      status.style.color = '#4caf50';
    } else {
      status.textContent = '✗ 保存失败';
      status.style.color = '#f44336';
    }
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

async function refreshStats() {
  const allStats = await ReadingStats.getAllStats();
  const todayStats = await ReadingStats.getTodayStats();
  const trend = await ReadingStats.getWeekTrend();

  document.getElementById('statTotalChars').textContent = ReadingStats.formatChars(allStats.totalCharsRead);
  document.getElementById('statTotalSessions').textContent = allStats.totalSessions;
  document.getElementById('statTotalTime').textContent = ReadingStats.formatTime(allStats.totalTimeMs);
  document.getElementById('statTotalArticles').textContent = allStats.totalArticles;
  document.getElementById('statTodayChars').textContent = ReadingStats.formatChars(todayStats.chars);
  document.getElementById('statTodaySessions').textContent = todayStats.sessions;
  renderTrend(trend);
}

function renderTrend(trend) {
  const container = document.getElementById('weekTrend');
  container.innerHTML = '';
  const maxChars = Math.max(...trend.map(d => d.chars), 1);
  for (const day of trend) {
    const bar = document.createElement('div');
    bar.className = 'trend-bar';
    const height = (day.chars / maxChars) * 80;
    bar.style.height = Math.max(height, 4) + 'px';
    bar.title = `${day.date} (周${day.weekday}): ${ReadingStats.formatChars(day.chars)}`;
    const label = document.createElement('div');
    label.className = 'trend-label';
    label.textContent = day.weekday;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;flex:1;';
    wrapper.appendChild(bar);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  }
}

function showStatus(msg, color) {
  const status = document.getElementById('globalSaveStatus');
  status.textContent = msg;
  status.style.color = color;
  setTimeout(() => { status.textContent = ''; }, 3000);
}
