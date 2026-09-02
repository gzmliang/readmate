// Minimal test harness for TextUtils and NumberNormalizer
// Run: node test-utils.js

// Mock chrome for modules that reference it
global.chrome = { storage: { local: { get: ()=>{}, set: ()=>{} } } };

// Load modules (use vm.runInThisContext so const declarations become global)
const fs = require('fs');
const vm = require('vm');
vm.runInThisContext(fs.readFileSync('text-utils.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('number-normalizer.js', 'utf8'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.log('  ❌ ' + msg); }
}

console.log('\n=== TextUtils.splitSentences ===');

// 1. 小数不应被切断
(function testDecimal() {
  console.log('\n-- Decimal protection --');
  const r = TextUtils.splitSentences('The value is 7.5 meters. It works.');
  assert(r.length === 2, '7.5 not split: got ' + r.length + ' sentences');
  assert(r[0].includes('7.5'), 'first sentence contains 7.5');
})();

// 2. Pi 等多位数小数
(function testPi() {
  console.log('\n-- Multi-digit decimal --');
  const r = TextUtils.splitSentences('Pi is 3.14159 approximately. Yes.');
  assert(r.length === 2, '3.14159 not split: got ' + r.length);
  assert(r[0].includes('3.14159'), 'first sentence contains pi');
})();

// 3. 中文句号
(function testCnPeriod() {
  console.log('\n-- Chinese period --');
  const r = TextUtils.splitSentences('你好世界。这是测试。');
  assert(r.length === 2, 'Chinese period split: got ' + r.length);
})();

// 4. 中英文混合
(function testMixed() {
  console.log('\n-- Mixed CJK+Latin --');
  const r = TextUtils.splitSentences('Hello world. 你好世界。How are you?');
  assert(r.length === 3, 'Mixed split: got ' + r.length);
})();

// 5. 感叹号问号
(function testQm() {
  console.log('\n-- Question/exclamation --');
  const r = TextUtils.splitSentences('Hi there! How are you? I am fine.');
  assert(r.length === 3, 'Punctuation types: got ' + r.length);
})();

// 6. 无标点长文本走 splitByLength
(function testNoPunct() {
  console.log('\n-- Long text without punctuation --');
  const long = 'a'.repeat(300);
  const r = TextUtils.splitSentences(long);
  assert(r.length > 1, 'Long no-punct text split by length: got ' + r.length);
})();

// 7. 连字符单词不被腰斩（splitByLength）
(function testHyphen() {
  console.log('\n-- Hyphenated word preservation in splitByLength --');
  // Build a string where maxLen falls inside a hyphenated word
  const prefix = 'x '.repeat(70); // ~140 chars
  const target = 'multi-faceted';
  const r = TextUtils.splitByLength(prefix + target + ' and more text here', 150);
  // The hyphenated word should not be split across segments
  const firstHas = r[0].includes('multi-faceted');
  const secondHas = r.length > 1 && r[1].includes('multi-faceted');
  assert(firstHas || secondHas, 'Hyphenated word intact in one segment');
  assert(!(firstHas && secondHas), 'Hyphenated word not duplicated');
})();

// 8. 软连字符清理
(function testSoftHyphen() {
  console.log('\n-- Soft hyphen (U+00AD) removal --');
  const text = 'soft\u00ADhyphen test';
  const clean = TextUtils.preprocess(text, { collapseWhitespace: true });
  assert(!clean.includes('\u00AD'), 'Soft hyphen removed');
  assert(clean === 'softhyphen test', 'Result: "' + clean + '"');
})();

// 9. 句末小数点
(function testEndDecimal() {
  console.log('\n-- Decimal at end of sentence --');
  const r = TextUtils.splitSentences('The answer is 42. Next sentence.');
  assert(r.length === 2, 'Sentence-ending number period: got ' + r.length);
})();

// 10. 英文省略号 / 缩写
(function testAbbr() {
  console.log('\n-- Common abbreviation protection --');
  const r = TextUtils.splitSentences('Dr. Smith went home. He saw Mr. Jones.');
  console.log('  ℹ️  Abbreviation test (info only): ' + r.length + ' sentences');
  r.forEach((s,i) => console.log('    [' + i + '] "' + s.substring(0,50) + '"'));
})();

// 11. 超长句子自然呼吸微切
(function testUltraLongSentence() {
  console.log('\n-- Ultra-long sentence sub-clause splitting --');
  const longSentence = 'The Federal Reserve decided to hold interest rates steady after a two-day policy meeting, signaling that inflation remains somewhat elevated above their target, although economic indicators suggest consumer spending is moderating gradually, and labor markets continue to demonstrate unexpected resilience across multiple key sectors.';
  const r = TextUtils.splitSentences(longSentence);
  assert(r.length >= 2, 'Ultra-long sentence smoothly split into ' + r.length + ' sub-clauses');
  assert(r.every(seg => seg.length < 220), 'All sub-clauses are comfortable reading length (<220 chars)');
})();

console.log('\n=== NumberNormalizer ===');

// 11. 基本整数
(function testInt() {
  console.log('\n-- Integer normalization --');
  const r = NumberNormalizer.normalize('I have 42 apples.');
  assert(r.includes('forty-two'), '42 → forty-two: "' + r + '"');
})();

// 12. 小数
(function testDecNorm() {
  console.log('\n-- Decimal normalization --');
  const r = NumberNormalizer.normalize('Pi is 3.14 approximately.');
  assert(r.includes('three point one four'), '3.14 → three point one four: "' + r + '"');
})();

// 13. 百分比
(function testPct() {
  console.log('\n-- Percentage --');
  const r = NumberNormalizer.normalize('Growth is 50.5% this year.');
  assert(r.includes('fifty point five percent'), '50.5% → fifty point five percent');
})();

// 14. 货币
(function testCurrency() {
  console.log('\n-- Currency --');
  const r = NumberNormalizer.normalize('Price is $25.50 each.');
  assert(r.includes('twenty-five dollars and fifty cents'), '$25.50: "' + r + '"');
})();

// 15. 时间 12h
(function testTime12() {
  console.log('\n-- 12h time --');
  const r = NumberNormalizer.normalize('Meet at 3:30 PM tomorrow.');
  assert(r.includes('three thirty PM'), '3:30 PM: "' + r + '"');
})();

// 16. needsNormalization
(function testNeedsNorm() {
  console.log('\n-- needsNormalization --');
  assert(NumberNormalizer.needsNormalization('hello 123 world'), 'has digits → true');
  assert(!NumberNormalizer.needsNormalization('hello world'), 'no digits → false');
})();

// 17. 序数词
(function testOrdinal() {
  console.log('\n-- Ordinal numbers --');
  const r = NumberNormalizer.normalize('He finished 1st and she finished 3rd.');
  assert(r.includes('first'), '1st → first');
  assert(r.includes('third'), '3rd → third');
})();

// 18. 温度
(function testTemp() {
  console.log('\n-- Temperature --');
  const r = NumberNormalizer.normalize('It is 25°C outside.');
  assert(r.includes('twenty-five degrees Celsius'), '25°C → twenty-five degrees Celsius');
})();

// 19. 度量衡
(function testMeasure() {
  console.log('\n-- Measurement units --');
  const r = NumberNormalizer.normalize('The car was going 100 km/h.');
  assert(r.includes('kilometers per hour'), 'km/h → kilometers per hour');
})();

// 20. 数字范围（分数）
(function testFraction() {
  console.log('\n-- Fractions --');
  const r = NumberNormalizer.normalize('Add 1/2 cup of sugar.');
  assert(r.includes('one half'), '1/2 → one half');
})();

console.log('\n=== TextUtils.preprocess ===');

// 21. HTML 标签清理
(function testHtml() {
  console.log('\n-- HTML strip --');
  const r = TextUtils.preprocess('<p>Hello <b>world</b></p>', { stripHtml: true, collapseWhitespace: true });
  assert(r === 'Hello world', 'HTML stripped: "' + r + '"');
})();

// 22. 脚注标记
(function testFootnote() {
  console.log('\n-- Footnote removal --');
  const r = TextUtils.preprocess('Some text[1] with notes[2,3].', { stripFootnotes: true, collapseWhitespace: true });
  assert(!r.includes('[1]'), 'Footnote [1] removed');
  assert(!r.includes('[2,3]'), 'Footnote [2,3] removed');
})();

// 23. 装饰行
(function testDecor() {
  console.log('\n-- Decorative line removal --');
  const r = TextUtils.preprocess('Hello\n-----\nWorld', { stripDecorative: true, collapseWhitespace: false });
  assert(!r.includes('-----'), 'Decorative line removed');
})();

// 24. 拼音清理
(function testPinyin() {
  console.log('\n-- Pinyin strip --');
  const r = TextUtils.preprocess('你好（nǐ hǎo）世界', { stripPinyin: true });
  assert(!r.includes('nǐ'), 'Pinyin removed: "' + r + '"');
})();

// 25. validateSpeed
(function testSpeed() {
  console.log('\n-- Speed validation --');
  assert(TextUtils.validateSpeed(1.5) === 1.5, '1.5 stays 1.5');
  assert(TextUtils.validateSpeed(10) === 5.0, '10 clamped to 5.0');
  assert(TextUtils.validateSpeed(0.01) === 0.5, '0.01 clamped to 0.5');
  assert(TextUtils.validateSpeed('abc') === 0.5, 'invalid → 0.5');
})();

// 26. detectScript
(function testDetect() {
  console.log('\n-- Script detection --');
  assert(TextUtils.detectScript('你好世界') === 'zh', 'Chinese → zh');
  assert(TextUtils.detectScript('Hello world') === 'latin', 'English → latin');
  assert(TextUtils.detectScript('こんにちは') === 'ja', 'Japanese → ja');
  assert(TextUtils.detectScript('안녕하세요') === 'ko', 'Korean → ko');
})();

console.log('\n========================================');
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
