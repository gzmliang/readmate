// ReadMate - Options Script (全国际化 + 防迷路视觉切换器)

let messages = {};
let activeUiLang = 'zh_CN';

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
  const openaiSec = document.getElementById('openaiTtsSection');
  if (engine === 'cloud') {
    if (browserSec) browserSec.style.display = 'none';
    if (cloudSec) cloudSec.style.display = 'block';
    if (openaiSec) openaiSec.style.display = 'none';
  } else if (engine === 'openai') {
    if (browserSec) browserSec.style.display = 'none';
    if (cloudSec) cloudSec.style.display = 'none';
    if (openaiSec) openaiSec.style.display = 'block';
  } else {
    if (browserSec) browserSec.style.display = 'block';
    if (cloudSec) cloudSec.style.display = 'none';
    if (openaiSec) openaiSec.style.display = 'none';
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
    const provider = settings.aiProvider || 'openai';
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

    document.getElementById('aiEndpoint').value = settings.aiEndpoint || 'https://api.openai.com/v1';
    document.getElementById('aiApiKey').value = settings.aiApiKey || '';
    document.getElementById('aiModel').value = settings.aiModel || 'gpt-4o-mini';
    document.getElementById('translateTarget').value = settings.translateTarget || 'Simplified Chinese';
    document.getElementById('defaultSummaryView').value = settings.defaultSummaryView || 'bilingual';
    document.getElementById('highlightEnabled').checked = settings.highlightEnabled !== false;
    document.getElementById('highlightParagraphEnabled').checked = settings.highlightParagraphEnabled !== false;
    document.getElementById('showFab').checked = settings.showFab !== false;

    // 通用 OpenAI TTS
    document.getElementById('openaiTtsEndpoint').value = settings.openaiTtsEndpoint || 'https://api.openai.com/v1';
    document.getElementById('openaiTtsApiKey').value = settings.openaiTtsApiKey || '';
    document.getElementById('openaiTtsModel').value = settings.openaiTtsModel || 'tts-1';
    document.getElementById('openaiTtsVoice').value = settings.openaiTtsVoice || 'alloy';

    // Edge TTS
    const defaultEdgeEndpoint = 'http://powerplus.blogsyte.com:5001';
    document.getElementById('cloudTtsEndpoint').value = settings.cloudTtsEndpoint || defaultEdgeEndpoint;
    loadCloudVoices(settings.cloudTtsEndpoint || defaultEdgeEndpoint, settings.cloudTtsVoice || '', settings.cloudTtsVoiceTrans || '');

    loadVoices(settings.ttsVoice);
  });

  // 绑定帮助弹窗
  setupHelpModal();

  document.getElementById('testOpenAiTtsBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('testOpenAiTtsBtn');
    const res = document.getElementById('testOpenAiTtsResult');
    btn.disabled = true;
    res.textContent = '...';
    const endpoint = document.getElementById('openaiTtsEndpoint').value;
    const apiKey = document.getElementById('openaiTtsApiKey').value;
    const model = document.getElementById('openaiTtsModel').value || 'tts-1';
    const voice = document.getElementById('openaiTtsVoice').value || 'alloy';

    chrome.runtime.sendMessage({
      action: 'proxyOpenAITTS',
      endpoint,
      apiKey,
      model,
      voice,
      text: 'ReadMate AI voice test. 读伴通用AI语音测试。',
      speed: 1.0,
    }, (resp) => {
      btn.disabled = false;
      if (resp?.ok && resp?.dataUrl) {
        const a = new Audio(resp.dataUrl);
        a.play();
        res.textContent = '✓ OK';
        res.className = 'test-result test-ok';
      } else {
        res.textContent = '✕ ' + (resp?.error || 'Err');
        res.className = 'test-result test-err';
      }
    });
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
    openaiTtsEndpoint: document.getElementById('openaiTtsEndpoint')?.value || 'https://api.openai.com/v1',
    openaiTtsApiKey: document.getElementById('openaiTtsApiKey')?.value || '',
    openaiTtsModel: document.getElementById('openaiTtsModel')?.value || 'tts-1',
    openaiTtsVoice: document.getElementById('openaiTtsVoice')?.value || 'alloy',
    aiProvider: document.getElementById('aiProviderSelect')?.value || 'openai',
    aiEndpoint: document.getElementById('aiEndpoint').value,
    aiApiKey: document.getElementById('aiApiKey').value,
    aiModel: document.getElementById('aiModel').value,
    translateTarget: document.getElementById('translateTarget').value,
    defaultSummaryView: document.getElementById('defaultSummaryView')?.value || 'bilingual',
    highlightEnabled: document.getElementById('highlightEnabled').checked,
    highlightParagraphEnabled: document.getElementById('highlightParagraphEnabled').checked,
    showFab: document.getElementById('showFab').checked,
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

function setupHelpModal() {
  const modal = document.getElementById('helpModal');
  const closeBtn = document.getElementById('helpModalClose');
  const title = document.getElementById('helpModalTitle');
  const content = document.getElementById('helpModalContent');

  function open(t, html) {
    title.textContent = t;
    content.innerHTML = html;
    modal.style.display = 'flex';
  }

  closeBtn.onclick = () => modal.style.display = 'none';
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  // TTS 帮助与自建说明书 (中英双语)
  document.getElementById('btnHelpTts')?.addEventListener('click', () => {
    const isZh = activeUiLang && activeUiLang.startsWith('zh');
    if (isZh) {
      open('☁️ 语音朗读引擎完全指南 & 自建 Edge-TTS 服务教程', `
        <div style="background:rgba(56,189,248,0.1);border-left:4px solid #38bdf8;padding:10px 14px;border-radius:4px;margin-bottom:16px;">
          💡 <strong>Edge 浏览器原生免搭技巧（强烈推荐）</strong>：<br>
          如果您使用的是微软 Edge 浏览器，安装本插件后直接在上方选择【🔊 浏览器原生】引擎，即可直接免费调用微软最高清的自然语音（如晓晓、Yunxi），完全本地极速发音，零网络延迟！
        </div>

        <h4 style="color:#facc15;margin:16px 0 8px;">1. 默认公共服务</h4>
        <p>插件默认内置了梁老师为大家长期维护的免费高音质服务：<code>http://powerplus.blogsyte.com:5001</code>，全球开箱即用，无需配置。</p>

        <h4 style="color:#facc15;margin:16px 0 8px;">2. 5分钟在自己的 VPS/服务器 上搭建专属 Edge-TTS（附完整代码）</h4>
        <p>如果您有自己的云服务器（Ubuntu/Debian/CentOS），可以自建专属节点，完全独享带宽：</p>
        
        <p><strong>第一步：安装 Python 依赖</strong></p>
        <pre style="background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto;">pip3 install edge-tts flask flask-cors gunicorn</pre>

        <p><strong>第二步：新建服务脚本 <code>server.py</code></strong></p>
        <pre style="background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;">import edge_tts, asyncio, tempfile, os
from flask import Flask, request, jsonify, send_file, make_response
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route('/voices')
def list_voices():
    return jsonify(asyncio.run(edge_tts.list_voices()))

@app.route('/tts', methods=['POST', 'OPTIONS'])
def tts():
    if request.method == 'OPTIONS':
        res = make_response()
        res.headers['Access-Control-Allow-Origin'] = '*'
        res.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return res
    d = request.get_json() or {}
    text = d.get('text', '')
    voice = d.get('voice', 'zh-CN-XiaoxiaoNeural')
    rate = d.get('rate', '+0%')
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
        p = tmp.name
    asyncio.run(edge_tts.Communicate(text=text, voice=voice, rate=rate).save(p))
    return send_file(p, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)</pre>

        <p><strong>第三步：后台长期运行</strong></p>
        <pre style="background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto;">gunicorn -w 2 -b 0.0.0.0:5001 server:app --timeout 900</pre>

        <h4 style="color:#facc15;margin:16px 0 8px;">3. 通用 AI 语音接口 (OpenAI 兼容) 说明</h4>
        <p>支持任何兼容 OpenAI <code>/v1/audio/speech</code> 规范的服务（如 OpenAI 官方 tts-1、硅基流动 CosyVoice、Fish Audio、自建 GPT-SoVITS 等）。只需填入 API 端点与 Key 即可畅享超拟真发音！</p>
      `);
    } else {
      open('☁️ TTS Engine Guide & Self-Hosting Edge-TTS Tutorial', `
        <div style="background:rgba(56,189,248,0.1);border-left:4px solid #38bdf8;padding:10px 14px;border-radius:4px;margin-bottom:16px;">
          💡 <strong>Pro Tip for Microsoft Edge Users</strong>:<br>
          If you are using Microsoft Edge browser, simply choose <strong>Browser Native</strong> engine above. It directly accesses Microsoft's premium neural voices (e.g., Jenny, Guy, Xiaoxiao) completely locally with zero network latency!
        </div>

        <h4 style="color:#facc15;margin:16px 0 8px;">1. Default Public Service</h4>
        <p>ReadMate comes with teacher Liang's permanently maintained free public node: <code>http://powerplus.blogsyte.com:5001</code>. Works out of the box worldwide.</p>

        <h4 style="color:#facc15;margin:16px 0 8px;">2. Self-Host Edge-TTS on Your Own VPS (in 5 minutes)</h4>
        <p>If you have a Linux VPS (Ubuntu/Debian), deploy your own dedicated node for unlimited bandwidth:</p>
        
        <p><strong>Step 1: Install Python dependencies</strong></p>
        <pre style="background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto;">pip3 install edge-tts flask flask-cors gunicorn</pre>

        <p><strong>Step 2: Create server script <code>server.py</code></strong></p>
        <pre style="background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;">import edge_tts, asyncio, tempfile, os
from flask import Flask, request, jsonify, send_file, make_response
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route('/voices')
def list_voices():
    return jsonify(asyncio.run(edge_tts.list_voices()))

@app.route('/tts', methods=['POST', 'OPTIONS'])
def tts():
    if request.method == 'OPTIONS':
        res = make_response()
        res.headers['Access-Control-Allow-Origin'] = '*'
        res.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return res
    d = request.get_json() or {}
    text = d.get('text', '')
    voice = d.get('voice', 'en-US-JennyNeural')
    rate = d.get('rate', '+0%')
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
        p = tmp.name
    asyncio.run(edge_tts.Communicate(text=text, voice=voice, rate=rate).save(p))
    return send_file(p, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)</pre>

        <p><strong>Step 3: Run with Gunicorn daemon</strong></p>
        <pre style="background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto;">gunicorn -w 2 -b 0.0.0.0:5001 server:app --timeout 900</pre>

        <h4 style="color:#facc15;margin:16px 0 8px;">3. Universal AI Voice (OpenAI Compatible)</h4>
        <p>Compatible with any service following OpenAI <code>/v1/audio/speech</code> format (OpenAI tts-1, SiliconFlow CosyVoice, Fish Audio, etc.). Enjoy hyper-realistic AI voices!</p>
      `);
    }
  });

  // AI 大模型帮助说明 (中英双语)
  document.getElementById('btnHelpAi')?.addEventListener('click', () => {
    const isZh = activeUiLang && activeUiLang.startsWith('zh');
    if (isZh) {
      open('🤖 AI 大模型与翻译接口配置指南', `
        <p>ReadMate 支持任何兼容 OpenAI 协议的国际主流大模型（无需购买昂贵专有服务，按量计费极低）：</p>

        <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;">
          <strong style="color:#60a5fa;">1. DeepSeek（强烈推荐 / 超高性价比）</strong><br>
          • API 端点：<code>https://api.deepseek.com/v1</code><br>
          • 推荐模型：<code>deepseek-chat</code><br>
          • 获取 Key：访问 <a href="https://platform.deepseek.com" target="_blank" style="color:#38bdf8;">platform.deepseek.com</a> 注册充值 5~10 元即可精读上千篇文章。
        </div>

        <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;">
          <strong style="color:#60a5fa;">2. SiliconFlow 硅基流动（免费额度多）</strong><br>
          • API 端点：<code>https://api.siliconflow.cn/v1</code><br>
          • 推荐模型：<code>Qwen/Qwen2.5-7B-Instruct</code>（永久免费）或 <code>deepseek-ai/DeepSeek-V3</code><br>
          • 获取 Key：访问 <a href="https://cloud.siliconflow.cn" target="_blank" style="color:#38bdf8;">cloud.siliconflow.cn</a> 注册即送免费 Token。
        </div>

        <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;">
          <strong style="color:#60a5fa;">3. OpenAI 官方 ChatGPT</strong><br>
          • API 端点：<code>https://api.openai.com/v1</code><br>
          • 推荐模型：<code>gpt-4o-mini</code>（极速、翻译优美）<br>
          • 获取 Key：访问 <a href="https://platform.openai.com/api-keys" target="_blank" style="color:#38bdf8;">platform.openai.com</a> 申请。
        </div>
      `);
    } else {
      open('🤖 LLM & Translation API Setup Guide', `
        <p>ReadMate supports any standard OpenAI-compatible API provider (pay-as-you-go, low-cost and high quality):</p>

        <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;">
          <strong style="color:#60a5fa;">1. OpenAI Official</strong><br>
          • API Endpoint: <code>https://api.openai.com/v1</code><br>
          • Recommended Model: <code>gpt-4o-mini</code><br>
          • Get Key: Visit <a href="https://platform.openai.com/api-keys" target="_blank" style="color:#38bdf8;">platform.openai.com</a>.
        </div>

        <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;">
          <strong style="color:#60a5fa;">2. DeepSeek (Top Quality & Affordable)</strong><br>
          • API Endpoint: <code>https://api.deepseek.com/v1</code><br>
          • Recommended Model: <code>deepseek-chat</code><br>
          • Get Key: Visit <a href="https://platform.deepseek.com" target="_blank" style="color:#38bdf8;">platform.deepseek.com</a>.
        </div>

        <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;">
          <strong style="color:#60a5fa;">3. SiliconFlow (Generous Free Quota)</strong><br>
          • API Endpoint: <code>https://api.siliconflow.cn/v1</code><br>
          • Recommended Model: <code>Qwen/Qwen2.5-7B-Instruct</code> or <code>deepseek-ai/DeepSeek-V3</code><br>
          • Get Key: Visit <a href="https://cloud.siliconflow.cn" target="_blank" style="color:#38bdf8;">cloud.siliconflow.cn</a>.
        </div>
      `);
    }
  });

  // 赞助弹窗
  const triggerDonate = () => {
    const isZh = activeUiLang && activeUiLang.startsWith('zh');
    const qrImgUrl = chrome.runtime.getURL('icons/receivecode.jpg');
    open(isZh ? '☕ 支持独立开发者梁老师' : '☕ Support Independent Developer Liang', `
      <div style="font-size:13.5px;color:#cbd5e1;line-height:1.6;">
        <p>${isZh ? '感谢您对读伴（ReadMate）的喜爱与认可！无论您身在海内外，您的每一份支持都是工具持续更新与维护的最佳动力。' : 'Thank you for supporting ReadMate! Your generosity keeps this tool ad-free, high quality, and actively maintained worldwide.'}</p>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;">
          <!-- 海外支持 -->
          <div style="background:rgba(255,255,255,0.05);padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);">
            <h4 style="color:#facc15;margin:0 0 10px;">🌍 International / 海外</h4>
            <a href="https://ko-fi.com/jimmyliang10894" target="_blank" style="display:block;text-align:center;background:#ff5e5b;color:#fff;text-decoration:none;font-weight:700;padding:10px;border-radius:8px;margin-bottom:10px;">
              ☕ Ko-fi 支持页面
            </a>
            <div style="font-size:12.5px;color:#94a3b8;word-break:break-all;">
              PayPal 收款邮箱：<br><strong style="color:#38bdf8;">gzjliang@gmail.com</strong>
            </div>
          </div>

          <!-- 国内支持 -->
          <div style="background:rgba(255,255,255,0.05);padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);text-align:center;">
            <h4 style="color:#facc15;margin:0 0 10px;">🇨🇳 中国大陆 / 微信与支付宝</h4>
            <img src="${qrImgUrl}" alt="收款码" style="width:140px;height:auto;border-radius:8px;border:2px solid #fff;display:inline-block;margin-bottom:6px;">
            <div style="font-size:12px;color:#94a3b8;">微信 / 支付宝 扫码赞赏</div>
          </div>
        </div>
      </div>
    `);
  };

  document.getElementById('btnOptionsDonate')?.addEventListener('click', triggerDonate);
  if (window.location.hash === '#donate') {
    setTimeout(triggerDonate, 200);
  }
}
