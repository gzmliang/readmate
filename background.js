// ReadMate / 读伴 — Background Service Worker
// 右键菜单、消息路由、设置存储、代理 fetch（避开 HTTPS 页面 CSP）

let readState = {
  isPlaying: false,
  isPaused: false,
  tabId: null,
};

// 构建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'read-selection',
      title: chrome.i18n.getMessage('menuReadSelection'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'read-page',
      title: chrome.i18n.getMessage('menuReadPage'),
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: chrome.i18n.getMessage('menuTranslateSelection'),
      contexts: ['selection'],
    });
  });
});

// 点击右键菜单
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  readState.tabId = tab.id;

  if (info.menuItemId === 'read-selection') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'readSelection',
      text: info.selectionText,
      pageUrl: info.pageUrl,
    });
  } else if (info.menuItemId === 'read-page') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'readPage',
    });
  } else if (info.menuItemId === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateSelection',
      text: info.selectionText,
    });
  }
});

// 接收消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'getSettings':
      chrome.storage.sync.get({
        ttsEngine: 'web-speech',
        ttsSpeed: 1.0,
        ttsVoice: '',
        ttsVoiceLang: 'en-US',
        // Edge TTS
        edgeTtsEndpoint: 'http://192.168.199.159:5001',
        edgeTtsVoice: 'zh-CN-XiaoxiaoNeural',
        // Custom TTS
        customTtsEndpoint: '',
        customTtsApiKey: '',
        customTtsModel: '',
        customTtsVoice: '',
        // AI 翻译
        aiEndpoint: 'https://api.deepseek.com/v1',
        aiApiKey: '',
        aiModel: 'deepseek-chat',
        translateEnabled: true,
        translateTarget: 'zh-CN',
        highlightEnabled: true,
        autoTranslate: false,
      }, (settings) => sendResponse(settings));
      return true;

    case 'saveSettings':
      chrome.storage.sync.set(msg.settings, () => sendResponse({ ok: true }));
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

    // ====== 后台代理 fetch（避开 HTTPS 页面 CSP 限制）======
    case 'proxyFetch': {
      const { url, options, requestId } = msg;
      fetch(url, options || {})
        .then(async (resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buffer = await resp.arrayBuffer();
          const contentType = resp.headers.get('content-type') || 'audio/mpeg';
          console.log('[ReadMate BG] proxyFetch got', buffer.byteLength, 'bytes');
          
          // 存到 chrome.storage.local（比消息传递容量大得多）
          const key = 'proxy_audio_' + requestId;
          const data = {
            [key]: {
              contentType: contentType,
              bytes: Array.from(new Uint8Array(buffer)),
              byteLength: buffer.byteLength
            }
          };
          chrome.storage.local.set(data, () => {
            sendResponse({ ok: true, storageKey: key, byteLength: buffer.byteLength });
          });
        })
        .catch((err) => {
          console.error('[ReadMate BG] proxyFetch error:', err.message);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // ====== AI 翻译代理 ======
    case 'proxyTranslate': {
      const { endpoint, apiKey, model, text, targetLang } = msg;
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: `You are a translator. Translate the following text to ${targetLang || 'Simplified Chinese'}. Return ONLY the translation, no explanation.` },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
        }),
      })
        .then(async (resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          const result = data.choices?.[0]?.message?.content?.trim() || null;
          sendResponse({ ok: true, text: result });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
      return true; // 异步响应
    }
  }
});
