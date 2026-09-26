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
    // 读伴书页：右键一个书稿链接（txt/md/epub/pdf）直接导入阅读
    chrome.contextMenus.create({
      id: 'open-in-reader',
      title: chrome.i18n.getMessage('menuOpenInReader') || 'Open in ReadMate Reader',
      contexts: ['link'],
      targetUrlPatterns: ['*://*/*.txt', '*://*/*.md', '*://*/*.markdown', '*://*/*.epub', '*://*/*.pdf', 'file:///*.txt', 'file:///*.epub', 'file:///*.pdf'],
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
    case 'open-in-reader': {
      const linkUrl = info.linkUrl || '';
      if (linkUrl) {
        chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') + '?src=' + encodeURIComponent(linkUrl) });
      }
      break;
    }
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
        // 云端 Edge TTS 服务端（默认指向官方 HTTPS 安全加密节点）
        cloudTtsEndpoint: 'https://liang-studio.duckdns.org/edge-tts',
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
        enableBilingual: false, // 默认不开启双语翻译（高阶开关，按需激活）
        translateEnabled: false,
        translateProvider: 'microsoft', // 默认免费免配置：'microsoft' (微软Edge), 'google' (谷歌免费), 'custom' (自定义AI API)
        translateTarget: 'Simplified Chinese',
        bilingualDisplayMode: 'bilingual', // 'bilingual' (双语对照), 'original' (仅原文), 'translated' (仅译文)
        pdfLayout: 'stacked', // 'stacked' (上下对照), 'columns' (左右双栏)
        defaultSummaryView: 'bilingual',
        highlightEnabled: true,
        highlightParagraphEnabled: true,
        highlightOffset: 0,
        showFab: true,
        paragraphClickMode: 'bubble', // 'bubble' = 单击段落先弹气泡确认（防误触，默认）；'direct' = 直接朗读（旧行为）
        autoTranslate: false,
        uiLanguage: 'auto',
        enableShortcuts: true,
        translateOnSelect: false,
      }, (settings) => {
        // 安全自动平滑迁移：彻底消除老版本存留的明文 http:// 节点
        if (settings.cloudTtsEndpoint && (
            settings.cloudTtsEndpoint.includes('p-plus.duckdns.org') ||
            settings.cloudTtsEndpoint.includes('powerplus.blogsyte.com') ||
            settings.cloudTtsEndpoint.startsWith('http://')
        )) {
          settings.cloudTtsEndpoint = 'https://liang-studio.duckdns.org/edge-tts';
          chrome.storage.sync.set({ cloudTtsEndpoint: settings.cloudTtsEndpoint });
        }
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
          'Authorization': `Bearer ${apiKey || ''}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
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

    // ====== Edge TTS 代理 fetch（全程 HTTPS 加密传输，保障数据安全）====== 
    case 'proxyFetch': {
      const { url, options } = msg;
      (async () => {
        // 安全 HTTPS 云端 TTS 主节点
        const DEFAULT_SERVERS = [
          'https://liang-studio.duckdns.org/edge-tts'
        ];
        let urlsToTry = [url];
        for (const s of DEFAULT_SERVERS) {
          if (url && url.startsWith(s)) {
            const pathAndQuery = url.slice(s.length);
            urlsToTry = DEFAULT_SERVERS.map(srv => srv + pathAndQuery);
            urlsToTry = [url, ...urlsToTry.filter(u => u !== url)];
            break;
          }
        }

        let lastErr = null;
        for (let i = 0; i < urlsToTry.length; i++) {
          let targetUrl = urlsToTry[i];
          // 强制走安全加密通道，杜绝明文 HTTP 传输违规
          if (targetUrl && targetUrl.startsWith('http://')) {
            targetUrl = targetUrl.replace(/^http:\/\//i, 'https://');
          }
          try {
            const resp = await fetch(targetUrl, options || {});
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buffer = await resp.arrayBuffer();
            // 用分块字符串拼接 base64
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 1024;
            for (let j = 0; j < bytes.byteLength; j += chunkSize) {
              const chunk = bytes.subarray(j, j + chunkSize);
              for (let k = 0; k < chunk.length; k++) {
                binary += String.fromCharCode(chunk[k]);
              }
            }
            const base64 = btoa(binary);
            const dataUrl = 'data:audio/mpeg;base64,' + base64;
            return sendResponse({ ok: true, dataUrl });
          } catch(err) {
            lastErr = err;
          }
        }
        sendResponse({ ok: false, error: lastErr ? lastErr.message : 'All endpoints failed' });
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

    // ====== 全能双语翻译代理（支持免费免配置 Edge/Google 与 自定义 AI API） ======
    case 'proxyTranslate': {
      const { endpoint, apiKey, model, text, texts, targetLang, sourceLang, provider } = msg;
      executeTranslation({
        endpoint,
        apiKey,
        model,
        text,
        texts,
        targetLang,
        sourceLang,
        provider,
      })
        .then((res) => {
          sendResponse({ ok: true, ...res });
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

// ============================================================================
// 全语种通用双语翻译核心引擎（支持免费开箱即用接口与自定义 AI API）
// ============================================================================

function normalizeLangCode(lang) {
  if (!lang) return 'zh-Hans';
  const lower = String(lang).toLowerCase().trim();
  if (lower.includes('simplified') || lower === 'zh-cn' || lower === 'zh-hans' || lower === 'zh') return 'zh-Hans';
  if (lower.includes('traditional') || lower === 'zh-tw' || lower === 'zh-hant' || lower === 'zh-hk') return 'zh-Hant';
  if (lower.includes('english') || lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower.includes('japanese') || lower === 'ja' || lower.startsWith('ja-')) return 'ja';
  if (lower.includes('korean') || lower === 'ko' || lower.startsWith('ko-')) return 'ko';
  if (lower.includes('spanish') || lower === 'es' || lower.startsWith('es-')) return 'es';
  if (lower.includes('french') || lower === 'fr' || lower.startsWith('fr-')) return 'fr';
  if (lower.includes('german') || lower === 'de' || lower.startsWith('de-')) return 'de';
  if (lower.includes('russian') || lower === 'ru' || lower.startsWith('ru-')) return 'ru';
  if (lower.includes('portuguese') || lower === 'pt' || lower.startsWith('pt-')) return 'pt';
  if (lower.includes('italian') || lower === 'it' || lower.startsWith('it-')) return 'it';
  if (lower.includes('arabic') || lower === 'ar' || lower.startsWith('ar-')) return 'ar';
  if (lower.includes('vietnamese') || lower === 'vi' || lower.startsWith('vi-')) return 'vi';
  return lang;
}

/** 微软 Edge 翻译（免费免配置，超快响应，支持批量） */
async function translateWithMicrosoft(texts, targetLang, sourceLang = '') {
  const to = normalizeLangCode(targetLang);
  const from = sourceLang ? normalizeLangCode(sourceLang) : '';
  const url = `https://edge.microsoft.com/translate/translatetext?to=${encodeURIComponent(to)}&from=${encodeURIComponent(from)}&isEnterpriseClient=false`;

  const chunkSize = 20;
  const results = [];

  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(6000),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      throw new Error(`Microsoft Translate HTTP ${resp.status}: ${errTxt}`);
    }

    const data = await resp.json();
    for (const item of data) {
      const translated = item?.translations?.map(t => t.text).join(' ') || '';
      results.push(translated);
    }
  }

  return results;
}

/** 谷歌免 Key 翻译接口（备用兜底） */
async function translateWithGoogle(texts, targetLang, sourceLang = '') {
  let to = normalizeLangCode(targetLang);
  if (to === 'zh-Hans') to = 'zh-CN';
  if (to === 'zh-Hant') to = 'zh-TW';

  let from = 'auto';
  if (sourceLang) {
    from = normalizeLangCode(sourceLang);
    if (from === 'zh-Hans') from = 'zh-CN';
    if (from === 'zh-Hant') from = 'zh-TW';
  }

  const results = [];
  for (const text of texts) {
    if (!text || !text.trim()) {
      results.push('');
      continue;
    }
    const params = new URLSearchParams({
      client: 'gtx',
      dt: 't',
      dj: '1',
      ie: 'UTF-8',
      sl: from,
      tl: to,
      q: text,
    });
    const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      throw new Error(`Google Translate HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const translated = (data?.sentences || []).map(s => s.trans).join('') || '';
    results.push(translated);
  }
  return results;
}

/** 通用 OpenAI / DeepSeek / 自定义 API 翻译 */
async function translateWithOpenAI(texts, targetLang, endpoint, apiKey, model) {
  let ep = (endpoint || 'https://api.openai.com/v1').trim();
  if (!ep.endsWith('/chat/completions')) {
    ep = ep.replace(/\/+$/, '') + '/chat/completions';
  }

  const targetName = targetLang || 'Simplified Chinese';
  const systemPrompt = `You are a professional translator. Translate the given text accurately and naturally into ${targetName}. Output ONLY the direct translation without explanations or conversational filler.`;

  if (texts.length === 1) {
    const resp = await fetch(ep, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || ''}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: texts[0] },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenAI Translate HTTP ${resp.status}: ${err}`);
    }
    const data = await resp.json();
    return [data.choices?.[0]?.message?.content?.trim() || ''];
  }

  // 批量并发处理（每 5 个一组，保持稳定）
  const batchPrompt = `${systemPrompt} The user provides a JSON array of strings. You MUST return ONLY a strict JSON array of translated strings corresponding 1:1 in order: ["trans1", "trans2", ...]. No markdown, no extra keys.`;
  const resp = await fetch(ep, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || ''}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: batchPrompt },
        { role: 'user', content: JSON.stringify(texts) },
      ],
      temperature: 0.1,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI Batch Translate HTTP ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  let raw = data.choices?.[0]?.message?.content?.trim() || '[]';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch(e) {}
  return [raw];
}

/** 统一翻译执行入口：调度免费与自定义源，带智能自愈 fallback */
async function executeTranslation({ endpoint, apiKey, model, text, texts, targetLang, sourceLang, provider }) {
  const inputList = Array.isArray(texts) ? texts : (text ? [text] : []);
  if (inputList.length === 0) {
    return { text: '', results: [] };
  }

  // 读取已保存的设置以获取默认 provider
  const currentSettings = await new Promise((resolve) => {
    chrome.storage.sync.get(['translateProvider', 'translateTarget', 'aiApiKey', 'aiEndpoint', 'aiModel'], resolve);
  });

  const activeProvider = provider || currentSettings?.translateProvider || 'microsoft';
  const target = targetLang || currentSettings?.translateTarget || 'Simplified Chinese';
  const finalEndpoint = endpoint || currentSettings?.aiEndpoint;
  const finalApiKey = apiKey || currentSettings?.aiApiKey;
  const finalModel = model || currentSettings?.aiModel;

  let results = null;

  // 1. 若用户指定了自定义 AI API 且填写了 Key
  if ((activeProvider === 'openai' || activeProvider === 'custom') && finalApiKey) {
    try {
      results = await translateWithOpenAI(inputList, target, finalEndpoint, finalApiKey, finalModel);
    } catch(err) {
      console.warn('[ReadMate] OpenAI translate failed, falling back to Microsoft free:', err);
    }
  }

  // 2. 若用户选了 Google 翻译
  if (!results && activeProvider === 'google') {
    try {
      results = await translateWithGoogle(inputList, target, sourceLang);
    } catch(err) {
      console.warn('[ReadMate] Google translate failed, falling back to Microsoft:', err);
    }
  }

  // 3. 默认首选 / Fallback：微软 Edge 免费高速翻译
  if (!results) {
    try {
      results = await translateWithMicrosoft(inputList, target, sourceLang);
    } catch(err) {
      console.warn('[ReadMate] Microsoft translate failed, trying Google free:', err);
      try {
        results = await translateWithGoogle(inputList, target, sourceLang);
      } catch(gErr) {
        throw new Error(`All translation channels failed. MS: ${err.message}, Google: ${gErr.message}`);
      }
    }
  }

  return {
    text: results[0] || '',
    results: results,
  };
}

