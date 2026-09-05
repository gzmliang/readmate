// ReadMate / 读伴 — Background Service Worker
// 右键菜单、消息路由、设置存储、AI翻译/摘要代理、键盘快捷键、脚本注入

let readState = {
  isPlaying: false,
  isPaused: false,
  tabId: null,
};

// ====== 脚本注入配置 ======
const CONTENT_FILES = [
  'content-extractor.js',
  'text-utils.js',
  'number-normalizer.js',
  'reading-stats.js',
  'content.js',
];
const CONTENT_CSS = ['content.css'];

/** 向指定标签页注入 content scripts */
function injectScripts(tabId) {
  return new Promise(async (resolve, reject) => {
    try {
      for (const css of CONTENT_CSS) {
        try {
          await chrome.scripting.insertCSS({ target: { tabId }, files: [css] });
        } catch(e) {}
      }
      for (const js of CONTENT_FILES) {
        await chrome.scripting.executeScript({ target: { tabId }, files: [js] });
      }
      resolve(true);
    } catch (e) {
      reject(new Error('注入失败: ' + e.message));
    }
  });
}

// ====== 右键菜单与多语言更新 ======
function updateContextMenus(lang) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'read-selection',
      title: chrome.i18n.getMessage('menuReadSelection') || 'Read Selection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'read-page',
      title: chrome.i18n.getMessage('menuReadPage') || 'Read Page',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'separator-1',
      type: 'separator',
      contexts: ['selection', 'page'],
    });
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: chrome.i18n.getMessage('menuTranslateSelection') || 'Translate Selection',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  updateContextMenus();
});

// ====== 右键菜单点击 ======
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  readState.tabId = tab.id;

  switch (info.menuItemId) {
    case 'read-selection':
      chrome.tabs.sendMessage(tab.id, {
        action: 'readSelection',
        text: info.selectionText,
        pageUrl: info.pageUrl,
      });
      break;
    case 'read-page':
      chrome.tabs.sendMessage(tab.id, { action: 'readPage' });
      break;
    case 'translate-selection':
      chrome.tabs.sendMessage(tab.id, {
        action: 'translateSelection',
        text: info.selectionText,
      });
      break;
  }
});

// ====== 快捷键处理 ======
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const tab = tabs[0];
    readState.tabId = tab.id;

    switch (command) {
      case 'read-selection':
        chrome.tabs.sendMessage(tab.id, { action: 'readSelectionShortcut' });
        break;
      case 'read-page':
        chrome.tabs.sendMessage(tab.id, { action: 'readPage' });
        break;
      case 'toggle-read':
        chrome.tabs.sendMessage(tab.id, { action: 'toggleRead' });
        break;
      case 'stop-read':
        chrome.tabs.sendMessage(tab.id, { action: 'stop' });
        readState.isPlaying = false;
        readState.isPaused = false;
        break;
    }
  });
});

// ====== 消息处理 ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'getI18nMessages': {
      const requestedLang = msg.lang || 'zh_CN';
      const effectiveLang = (requestedLang === 'auto')
        ? (navigator.language.startsWith('zh') ? 'zh_CN' : navigator.language.startsWith('ja') ? 'ja' : 'en')
        : requestedLang;
      const url = chrome.runtime.getURL(`_locales/${effectiveLang}/messages.json`);
      fetch(url)
        .then(r => r.json())
        .then(data => {
          const dict = {};
          for (const [k, v] of Object.entries(data)) {
            dict[k] = v.message;
          }
          sendResponse({ ok: true, messages: dict });
        })
        .catch(err => {
          const fallbackUrl = chrome.runtime.getURL('_locales/zh_CN/messages.json');
          fetch(fallbackUrl)
            .then(r => r.json())
            .then(data => {
              const dict = {};
              for (const [k, v] of Object.entries(data)) {
                dict[k] = v.message;
              }
              sendResponse({ ok: true, messages: dict });
            })
            .catch(() => sendResponse({ ok: false, messages: {} }));
        });
      return true;
    }

    case 'injectContent':
      injectScripts(msg.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'getSettings':
      chrome.storage.sync.get({
        ttsSpeed: 1.0,
        ttsVoice: '',
        ttsVoiceLang: 'en-US',
        ttsEngine: 'cloud', // 默认优先云端 Edge TTS（音质最好）
        ttsBuffer: 2,
        readVoiceMode: 'original', // 'original', 'translated', 'bilingual'
        showBilingualSubtitles: true,
        // 云端 Edge TTS 服务端（默认指向梁老师长期公开服务）
        cloudTtsEndpoint: 'http://powerplus.blogsyte.com:5001',
        cloudTtsVoice: '', // 保持空 = 智能双轨自动匹配
        cloudTtsVoiceOrig: '', // 留空 = 原文语种智能匹配 (如 Jenny/美式)
        cloudTtsVoiceTrans: '', // 留空 = 译文语种智能匹配 (如 Xiaoxiao/晓晓)
        ttsVoiceOrig: '', // 浏览器本地原文声音
        ttsVoiceTrans: '', // 浏览器本地译文声音
        // 通用 AI 语音 (OpenAI兼容音频流TTS)
        openaiTtsEndpoint: 'https://api.openai.com/v1',
        openaiTtsApiKey: '',
        openaiTtsModel: 'tts-1',
        openaiTtsVoice: 'alloy',
        // 默认标准 AI 服务商配置（遵循官方标准 BaseURL 与 gpt-4o-mini）
        aiProvider: 'openai',
        aiEndpoint: 'https://api.openai.com/v1',
        aiApiKey: '',
        aiModel: 'gpt-4o-mini',
        enableBilingual: false, // 默认不开启双语翻译（省 Token）
        translateEnabled: false,
        translateTarget: 'Simplified Chinese',
        defaultSummaryView: 'bilingual',
        highlightEnabled: true,
        highlightParagraphEnabled: true,
        highlightOffset: 0,
        showFab: true,
        autoTranslate: false,
        uiLanguage: 'auto',
        enableShortcuts: true,
        translateOnSelect: false,
      }, (settings) => {
        sendResponse(settings);
      });
      return true;

    case 'saveSettings':
      chrome.storage.sync.get(null, (existing) => {
        const merged = Object.assign({}, existing, msg.settings);
        chrome.storage.sync.set(merged, () => {
          if (msg.settings?.uiLanguage) {
            updateContextMenus(msg.settings.uiLanguage);
          }
          sendResponse({ ok: true });
        });
      });
      return true;

    case 'speak':
      readState.isPlaying = true;
      readState.isPaused = false;
      break;

    case 'pause':
      readState.isPaused = true;
      break;

    case 'resume':
      readState.isPaused = false;
      break;

    case 'stop':
      readState.isPlaying = false;
      readState.isPaused = false;
      break;

    case 'getReadState':
      sendResponse(readState);
      return true;

    // ====== AI 多语种摘要生成代理（双核：原文摘要 + 目标语言译文摘要） ======
    case 'proxySummarize': {
      const { endpoint, apiKey, model, text, targetLang, docLang } = msg;
      let ep = (endpoint || 'https://api.openai.com/v1').trim();
      if (!ep.endsWith('/chat/completions')) {
        ep = ep.replace(/\/+$/, '') + '/chat/completions';
      }
      const prompt = `You are an expert news analyst and bilingual tutor.
Analyze the provided article and generate an in-depth, structured summary consisting of 4 to 6 detailed bullet points that fully cover the main facts, key arguments, context, and outcomes.
For each bullet point, provide BOTH the original language statement and an accurate, natural ${targetLang || 'Simplified Chinese'} translation.
Output MUST be a strict JSON array of objects with the exact schema:
[
  { "id": 1, "original": "Detailed point in original language...", "translated": "Detailed translation..." }
]
Do not wrap in markdown code blocks like \`\`\`json, output ONLY valid JSON string.

Article content:
${(text || '').substring(0, 5000)}`;

      fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey || 'liang-gemini-proxy-2026'}`,
        },
        body: JSON.stringify({
          model: model || 'gemini-3.7-flash-high',
          messages: [
            { role: 'system', content: 'You are a precise JSON-only summary assistant.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
        }),
      })
        .then(async (resp) => {
          if (!resp.ok) {
            const errTxt = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${errTxt}`);
          }
          const data = await resp.json();
          let raw = data.choices?.[0]?.message?.content?.trim() || '[]';
          raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch(e) {
            parsed = [{ id: 1, original: 'Summary', translated: raw }];
          }
          sendResponse({ ok: true, summary: parsed });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // ====== Edge TTS 代理 fetch（支持 HTTPS 页面）====== 
    case 'proxyFetch': {
      const { url, options } = msg;
      (async () => {
        try {
          const resp = await fetch(url, options || {});
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buffer = await resp.arrayBuffer();
          // 用分块字符串拼接 base64
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 1024;
          for (let i = 0; i < bytes.byteLength; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            for (let j = 0; j < chunk.length; j++) {
              binary += String.fromCharCode(chunk[j]);
            }
          }
          const base64 = btoa(binary);
          const dataUrl = 'data:audio/mpeg;base64,' + base64;
          sendResponse({ ok: true, dataUrl });
        } catch(err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    // ====== Bing 极速查词代理 ======
    case 'proxyBingDict': {
      const { word } = msg;
      if (!word || !word.trim()) {
        sendResponse({ ok: false, error: 'Empty query' });
        return true;
      }
      fetch(`https://cn.bing.com/dict/search?q=${encodeURIComponent(word.trim())}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      })
        .then(async (resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const html = await resp.text();
          let phonetic = '';
          const usMatch = html.match(/class="hd_prUS[^"]*">.*?\[(.*?)\]/);
          const ukMatch = html.match(/class="hd_pr[^"]*">.*?\[(.*?)\]/);
          if (usMatch) phonetic = usMatch[1];
          else if (ukMatch) phonetic = ukMatch[1];

          // 提取释义
          const defs = [];
          const liRegex = /<li>\s*<span class="pos">([^<]+)<\/span>\s*<span class="def[^"]*">([\s\S]*?)<\/span>\s*<\/li>/g;
          let m;
          while ((m = liRegex.exec(html)) !== null) {
            const pos = m[1].trim();
            const def = m[2].replace(/<[^>]+>/g, '').trim();
            if (def) defs.push(`${pos} ${def}`);
          }
          sendResponse({ ok: true, phonetic, defs, trans: defs.slice(0, 3).join('； ') });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // ====== AI 翻译代理 ======
    case 'proxyTranslate': {
      const { endpoint, apiKey, model, text, targetLang } = msg;
      let ep = (endpoint || 'https://api.openai.com/v1').trim();
      if (!ep.endsWith('/chat/completions')) {
        ep = ep.replace(/\/+$/, '') + '/chat/completions';
      }
      fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey || 'liang-gemini-proxy-2026'}`,
        },
        body: JSON.stringify({
          model: model || 'gemini-3.7-flash-high',
          messages: [
            { role: 'system', content: `You are a translator. Translate the following text to ${targetLang || 'Simplified Chinese'}. Return ONLY the translation, no explanation.` },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
        }),
      })
        .then(async (resp) => {
          if (!resp.ok) {
            const errTxt = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${errTxt}`);
          }
          const data = await resp.json();
          const result = data.choices?.[0]?.message?.content?.trim() || null;
          sendResponse({ ok: true, text: result });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // ====== 通用 OpenAI 兼容语音合成 (Audio Speech API) ======
    case 'proxyOpenAITTS': {
      const { endpoint, apiKey, model, voice, text, speed } = msg;
      let ep = (endpoint || 'https://api.openai.com/v1').trim();
      if (!ep.endsWith('/audio/speech')) {
        ep = ep.replace(/\/+$/, '') + '/audio/speech';
      }
      fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey || ''}`,
        },
        body: JSON.stringify({
          model: model || 'tts-1',
          input: text,
          voice: voice || 'alloy',
          speed: speed || 1.0,
        }),
      })
        .then(async (resp) => {
          if (!resp.ok) {
            const errTxt = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${errTxt}`);
          }
          const blob = await resp.blob();
          const reader = new FileReader();
          reader.onloadend = () => {
            sendResponse({ ok: true, dataUrl: reader.result });
          };
          reader.readAsDataURL(blob);
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }
  }
});
