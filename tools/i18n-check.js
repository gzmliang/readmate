#!/usr/bin/env node
/**
 * ReadMate i18n 守卫（零依赖，直接 `node tools/i18n-check.js`）
 *
 * 四道红线，任一违反即退出码 1：
 *   1) 代码里引用的词典键必须在 _locales/en/messages.json 存在（否则界面会直接显示键名）
 *   2) 8 种语言的键集合必须与 en 完全一致（缺键 = 报错，多余键 = 警告）
 *   3) JS 里严禁出现「中文兜底」：_t('key', '中文…') / _('key', '中文…')
 *   4) HTML 里严禁出现中文静态文案（HTML 注释与显式标注 data-no-i18n 的元素除外）
 *
 * 为什么要有它：2026-09 曾经因为 lblEngineOpenAI / btnCancel 两个键漏写，
 * 设置页直接显示 "lblEngineOpenAI" 这种原始键名；optCloudTransAuto 又在 7 种语言里缺失。
 * 靠人眼盯 8 种语言 × 200 个键必然出事，所以固化成脚本。
 *
 * 用法：node tools/i18n-check.js          # 检查全仓库
 *       node tools/i18n-check.js --quiet  # 只输出结论
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'de', 'fr', 'es', 'ru'];
const JS_FILES = ['content.js', 'background.js', 'options/options.js', 'popup/popup.js', 'reader/reader.js', 'reader/importer.js'];
const HTML_FILES = ['options/options.html', 'popup/popup.html', 'reader.html'];
const BASE_LOCALE = 'en';

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const quiet = process.argv.includes('--quiet');
const fail = [];
const warn = [];
const log = (...a) => { if (!quiet) console.log(...a); };

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

// ---------- 词典 ----------
const localesDir = path.join(ROOT, '_locales');
const available = fs.existsSync(localesDir)
  ? fs.readdirSync(localesDir).filter(d => fs.existsSync(path.join(localesDir, d, 'messages.json')))
  : [];
const dicts = {};
for (const loc of available) dicts[loc] = readJSON(path.join(localesDir, loc, 'messages.json'));

if (!dicts[BASE_LOCALE]) {
  console.error('✗ 缺少基准词典 _locales/en/messages.json');
  process.exit(1);
}
const baseKeys = Object.keys(dicts[BASE_LOCALE]);
log(`词典：${available.join(', ')}   基准(en)键数：${baseKeys.length}`);

// ---------- 1) 代码引用的键必须存在 ----------
const KEY_CALL = /(?:\b_t|\b_|\bmsg)\(\s*['"]([A-Za-z0-9_]+)['"]/g;
const referenced = new Map(); // key -> Set(file)
for (const f of JS_FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = read(p);
  let m;
  while ((m = KEY_CALL.exec(src))) {
    if (!referenced.has(m[1])) referenced.set(m[1], new Set());
    referenced.get(m[1]).add(f);
  }
}
const missingInBase = [...referenced.keys()].filter(k => !baseKeys.includes(k));
log(`代码引用的词典键：${referenced.size}`);
if (missingInBase.length) {
  fail.push('代码引用了词典中不存在的键（界面会直接显示键名）：');
  missingInBase.forEach(k => fail.push(`   ✗ ${k}  ← ${[...referenced.get(k)].join(', ')}`));
}

// ---------- 2) 各语言键集合必须与 en 一致 ----------
for (const loc of available) {
  const keys = Object.keys(dicts[loc]);
  const missing = baseKeys.filter(k => !keys.includes(k));
  const extra = keys.filter(k => !baseKeys.includes(k));
  if (missing.length) {
    fail.push(`词典 ${loc} 缺失 ${missing.length} 个键（会回落到英文/键名）：${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`);
  }
  if (extra.length) warn.push(`词典 ${loc} 多出 ${extra.length} 个键（en 里没有，可能是废弃键）：${extra.slice(0, 8).join(', ')}`);
}

// ---------- 3) JS 严禁中文兜底 ----------
const FALLBACK_PATTERNS = [
  /(?:\b_t|\b_|\bmsg)\(\s*'([A-Za-z0-9_]+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g,
  /(?:\b_t|\b_|\bmsg)\(\s*"([A-Za-z0-9_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
];
let fallbackHits = 0;
for (const f of JS_FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = read(p);
  for (const re of FALLBACK_PATTERNS) {
    let m;
    while ((m = re.exec(src))) {
      if (!CJK.test(m[2])) continue;
      fallbackHits++;
      const line = src.slice(0, m.index).split('\n').length;
      fail.push(`中文兜底：${f}:${line}  _t('${m[1]}', '${m[2].slice(0, 24)}…')`);
    }
  }
}
log(`JS 中文兜底：${fallbackHits} 处（要求 0）`);

// ---------- 4) HTML 严禁中文静态文案 ----------
let htmlHits = 0;
for (const f of HTML_FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  let src = read(p);
  // 去掉 HTML 注释
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  // 去掉显式豁免的元素（原生语言名等），支持同名标签一层嵌套
  src = src.replace(/<([a-zA-Z0-9]+)([^>]*\sdata-no-i18n[^>]*)>[\s\S]*?<\/\1>/g, '');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!CJK.test(line)) return;
    htmlHits++;
    fail.push(`HTML 未国际化中文：${f} 片段「${line.trim().slice(0, 50)}」`);
  });
}
log(`HTML 中文静态文案：${htmlHits} 处（要求 0）`);

// ---------- 结论 ----------
log('');
if (warn.length) { console.log('⚠️  警告：'); warn.forEach(w => console.log('   ' + w)); }
if (fail.length) {
  console.error('❌ i18n 守卫未通过：');
  fail.forEach(l => console.error('   ' + l));
  console.error(`\n共 ${fail.length} 项违规。修复后重跑：node tools/i18n-check.js`);
  process.exit(1);
}
console.log('✅ i18n 守卫全部通过：无缺键、无中文兜底、无未国际化中文文案。');
process.exit(0);
