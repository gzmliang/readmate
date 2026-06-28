// ReadMate / 读伴 — Background Service Worker
// 右键菜单、消息路由、设置存储、AI翻译代理、键盘快捷键、脚本注入

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
      // 注入 CSS
      for (const css of CONTENT_CSS) {
        try {
          await chrome.scripting.insertCSS({
            target: { tabId },
            files: [css],
          });
        } catch(e) {
          // CSS 可能已存在，忽略
        }
      }
      // 注入 JS（按顺序）
      for (const js of CONTENT_FILES) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [js],
        });
      }
      resolve(true);
    } catch (e) {
      reject(new Error('注入失败: ' + e.message));
    }
  });
}

// ====== 右键菜单 ======
chrome.runtime.onInstalled.addListener((details) => {
  // 首次安装：设置连续模式默认开启
  if (details.reason === 'install') {
    chrome.storage.local.set({ readmate_continuous: true });
    chrome.runtime.openOptionsPage();
  } else if (details.reason === 'update') {
    // 更新时确保连续模式存储存在
    chrome.storage.local.get('readmate_continuous', (result) => {
      if (result.readmate_continuous === undefined) {
        chrome.storage.local.set({ readmate_continuous: true });
      }
    });
  }

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
      id: 'separator-1',
      type: 'separator',
      contexts: ['selection', 'page'],
    });
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: chrome.i18n.getMessage('menuTranslateSelection'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'separator-2',
      type: 'separator',
      contexts: ['selection', 'page'],
    });
    chrome.contextMenus.create({
      id: 'copy-to-clipboard',
      title: '复制朗读内容到剪贴板',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'export-markdown',
      title: '导出选中内容为 Markdown',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'open-options',
      title: chrome.i18n.getMessage('menuOpenOptions') || 'ReadMate 设置',
      contexts: ['action'],
    });
  });
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

    case 'copy-to-clipboard':
      if (info.selectionText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'copyToClipboard',
          text: info.selectionText,
        });
      }
      break;

    case 'export-markdown':
      if (info.selectionText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'exportMarkdown',
          text: info.selectionText,
          title: tab.title || 'ReadMate Export',
          url: info.pageUrl,
        });
      }
      break;

    case 'open-options':
      chrome.runtime.openOptionsPage();
      break;
  }
});

// ====== 键盘快捷键 ======
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const tab = tabs[0];
    if (!tab?.id) return;
    readState.tabId = tab.id;

    switch (command) {
      case 'read-selection':
        chrome.tabs.sendMessage(tab.id, { action: 'readSelection' });
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
    // ====== 注入 content scripts ======
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
        ttsEngine: 'browser', // 'browser' 或 'cloud'
        ttsBuffer: 1,        // 云端预读句数
        // 云端 Edge TTS
        cloudTtsEndpoint: 'http://powerplus.blogsyte.com:5001',
        cloudTtsVoice: '',
        // AI 翻译
        aiEndpoint: 'https://api.deepseek.com/v1',
        aiApiKey: '',
        aiModel: 'deepseek-chat',
        translateEnabled: true,
        translateTarget: 'Simplified Chinese',
        highlightEnabled: true,
        autoTranslate: false,
        uiLanguage: 'auto',
        enableShortcuts: true,
        translateOnSelect: false,
      }, (settings) => {
        // === 设置迁移：兼容 v1.2.0 的旧键名 ===
        let changed = false;
        if (!settings.cloudTtsEndpoint && settings.edgeTtsEndpoint) {
          settings.cloudTtsEndpoint = settings.edgeTtsEndpoint;
          changed = true;
        }
        if (!settings.cloudTtsVoice && settings.edgeTtsVoice) {
          settings.cloudTtsVoice = settings.edgeTtsVoice;
          changed = true;
        }
        if (settings.ttsEngine === 'edge-tts') {
          settings.ttsEngine = 'cloud';
          changed = true;
        }
        if (changed) {
          chrome.storage.sync.set({
            cloudTtsEndpoint: settings.cloudTtsEndpoint,
            cloudTtsVoice: settings.cloudTtsVoice,
            ttsEngine: settings.ttsEngine,
          });
        }
        sendResponse(settings);
      });
      return true;

    case 'saveSettings':
      // 合并保存，防止丢字段
      chrome.storage.sync.get(null, (existing) => {
        const merged = Object.assign({}, existing, msg.settings);
        chrome.storage.sync.set(merged, () => sendResponse({ ok: true }));
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

    // ====== Edge TTS 代理 fetch（支持 HTTPS 页面）====== 
    case 'proxyFetch': {
      const { url, options, requestId } = msg;
      fetch(url, options || {})
        .then(async (resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buffer = await resp.arrayBuffer();
          const key = 'proxy_audio_' + requestId;
          const data = {
            [key]: {
              bytes: Array.from(new Uint8Array(buffer)),
              byteLength: buffer.byteLength
            }
          };
          chrome.storage.local.set(data, () => {
            sendResponse({ ok: true, storageKey: key, byteLength: buffer.byteLength });
          });
        })
        .catch((err) => {
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
      return true;
    }

    // ====== 导出 Markdown（后台下载）======
    case 'doExportMarkdown': {
      const { title, url, text } = msg;
      const markdown = `# ${title}\n\n${url}\n\n---\n\n${text}\n\n---\n*Exported by ReadMate / 读伴*`;
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const reader = new FileReader();
      reader.onload = () => {
        chrome.downloads.download({
          url: reader.result,
          filename: 'readmate-export-' + Date.now() + '.md',
          saveAs: true,
        });
      };
      reader.readAsDataURL(blob);
      sendResponse({ ok: true });
      return true;
    }
  }
});
