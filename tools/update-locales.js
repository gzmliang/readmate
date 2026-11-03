'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, '_locales');

async function translateChunk(texts, to, from = 'en') {
  const url = `https://edge.microsoft.com/translate/translatetext?to=${encodeURIComponent(to)}&from=${encodeURIComponent(from)}&isEnterpriseClient=false`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(texts)
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.map(item => item.translations[0].text);
}

async function translateAll(texts, to, from = 'en') {
  const chunkSize = 25;
  const results = [];
  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    let attempts = 0;
    while (attempts < 3) {
      try {
        const trans = await translateChunk(chunk, to, from);
        results.push(...trans);
        break;
      } catch (e) {
        attempts++;
        if (attempts >= 3) throw e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  return results;
}

// 保护并恢复花括号占位符，如 {count}, {name}
function restorePlaceholders(src, trans) {
  const placeholders = src.match(/\{[a-zA-Z0-9_]+\}/g) || [];
  let result = trans;
  // 检查是否有一些占位符被错误翻译成 {număr} 等
  // 如果占位符数量一致且名称一致，保留；如果损坏，尝试从 src 恢复
  for (const ph of placeholders) {
    if (!result.includes(ph)) {
      // 尝试正则替换常见被译走的情况，或者直接智能修复
      const name = ph.slice(1, -1);
      const rogueRegex = new RegExp(`\\{\\s*${name}\\s*\\}`, 'i');
      if (rogueRegex.test(result)) {
        result = result.replace(rogueRegex, ph);
      }
    }
  }
  return result;
}

async function main() {
  const enPath = path.join(LOCALES_DIR, 'en', 'messages.json');
  const zhPath = path.join(LOCALES_DIR, 'zh_CN', 'messages.json');
  const enDict = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const zhDict = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

  // 1. 确保 en 和 zh_CN 中有 noTextFound 和 btnReadSelection
  if (!enDict.noTextFound) {
    enDict.noTextFound = { message: "No readable text found on this page", description: "Toast when no content" };
  }
  if (!zhDict.noTextFound) {
    zhDict.noTextFound = { message: "当前网页未找到可提取的正文", description: "Toast when no content" };
  }
  if (!enDict.btnReadSelection) {
    enDict.btnReadSelection = { message: "Click to read aloud", description: "Tooltip to read selected text" };
  }
  if (!zhDict.btnReadSelection) {
    zhDict.btnReadSelection = { message: "点击朗读", description: "Tooltip to read selected text" };
  }

  fs.writeFileSync(enPath, JSON.stringify(enDict, null, 2), 'utf8');
  fs.writeFileSync(zhPath, JSON.stringify(zhDict, null, 2), 'utf8');
  console.log("en and zh_CN base dictionaries updated.");

  const allKeys = Object.keys(enDict);
  console.log(`Total keys to process: ${allKeys.length}`);

  // 2. 检查补全已有语言 (de, es, fr, ja, ko, ru) 缺失的键
  const existingLocales = ['de', 'es', 'fr', 'ja', 'ko', 'ru'];
  for (const loc of existingLocales) {
    const locPath = path.join(LOCALES_DIR, loc, 'messages.json');
    if (!fs.existsSync(locPath)) continue;
    const locDict = JSON.parse(fs.readFileSync(locPath, 'utf8'));
    const missingKeys = allKeys.filter(k => !locDict[k]);
    if (missingKeys.length > 0) {
      console.log(`Translating ${missingKeys.length} missing keys for ${loc}...`);
      const textsToTrans = missingKeys.map(k => enDict[k].message);
      const transResults = await translateAll(textsToTrans, loc, 'en');
      missingKeys.forEach((k, idx) => {
        locDict[k] = {
          message: restorePlaceholders(enDict[k].message, transResults[idx]),
          description: enDict[k].description || ''
        };
      });
      fs.writeFileSync(locPath, JSON.stringify(locDict, null, 2), 'utf8');
      console.log(`Updated ${loc} with ${missingKeys.length} keys.`);
    }
  }

  // 3. 构建罗马尼亚语 (ro) 完整字典
  const roDir = path.join(LOCALES_DIR, 'ro');
  if (!fs.existsSync(roDir)) fs.mkdirSync(roDir, { recursive: true });
  const roPath = path.join(roDir, 'messages.json');

  let roDict = {};
  if (fs.existsSync(roPath)) {
    try { roDict = JSON.parse(fs.readFileSync(roPath, 'utf8')); } catch (e) {}
  }

  const roMissingKeys = allKeys.filter(k => !roDict[k]);
  if (roMissingKeys.length > 0) {
    console.log(`Translating ${roMissingKeys.length} keys for Romanian (ro)...`);
    const textsToTrans = roMissingKeys.map(k => enDict[k].message);
    const transResults = await translateAll(textsToTrans, 'ro', 'en');
    roMissingKeys.forEach((k, idx) => {
      roDict[k] = {
        message: restorePlaceholders(enDict[k].message, transResults[idx]),
        description: enDict[k].description || ''
      };
    });
  }

  // 针对扩展名称应用品牌规范
  roDict['appName'] = {
    message: "ReadMate: Lectură vocală și Text to Speech (TTS)",
    description: "App name"
  };
  roDict['appDesc'] = {
    message: "Asistent inteligent de lectură TTS & citire cu voce tare — Voci naturale AI Edge-TTS, evidențiere bilingvă a propozițiilor și traducere instantanee.",
    description: "App description"
  };

  fs.writeFileSync(roPath, JSON.stringify(roDict, null, 2), 'utf8');
  console.log(`Romanian (ro) dictionary complete with ${Object.keys(roDict).length} keys.`);
}

main().catch(err => {
  console.error("Error generating locales:", err);
  process.exit(1);
});
