// ReadMate / 读伴 — 文本预处理工具模块
// 语言检测、句段分割、内容净化、排版修正

const TextUtils = (() => {
  'use strict';

  // ====== 语言检测 ======

  /** CJK 正则 */
  const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
  const JP_RE = /[\u3040-\u309f\u30a0-\u30ff]/;
  const KO_RE = /[\uac00-\ud7af]/;
  const LATIN_RE = /[a-zA-ZÀ-ÖØ-öø-ÿĀ-ž]/;

  /** 检测文本主要语言类型 */
  function detectScript(text) {
    if (!text || text.trim().length === 0) return 'unknown';
    const cleaned = text.replace(/\s+/g, '');
    if (cleaned.length === 0) return 'unknown';

    let cjk = 0, jp = 0, ko = 0, latin = 0, other = 0;
    for (const ch of cleaned) {
      if (CJK_RE.test(ch)) cjk++;
      else if (JP_RE.test(ch)) jp++;
      else if (KO_RE.test(ch)) ko++;
      else if (LATIN_RE.test(ch)) latin++;
      else other++;
    }
    const total = cjk + jp + ko + latin + other;
    const ratio = (count) => (count / total);
    if (ratio(cjk) > 0.3) return 'zh';
    if (ratio(jp) > 0.3) return 'ja';
    if (ratio(ko) > 0.3) return 'ko';
    if (ratio(latin) > 0.5) return 'latin';
    return 'mixed';
  }

  /** 检测文本是否是中文 */
  function isChinese(text) {
    return detectScript(text) === 'zh';
  }

  /** 检测文本是否需要中文语音 */
  function detectLanguage(text) {
    const script = detectScript(text);
    const langMap = { zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', latin: 'en-US', mixed: 'en-US', unknown: 'en-US' };
    return langMap[script] || 'en-US';
  }

  // ====== 句子分割 ======

  /** 将文本分割为句子列表（逐字符扫描，绝对不切小数） */
  function splitSentences(text) {
    if (!text || text.trim().length === 0) return [];

    const result = [];
    let start = 0;
    let decimalProtected = 0; // 统计小数保护次数

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      // 检查是否小数点（前数字后数字）→ 标记受保护
      if (ch === '.' && i > 0 && /\d/.test(text[i - 1]) && i + 1 < text.length && /\d/.test(text[i + 1])) {
        decimalProtected++;
      }
      const isEnd =
        ch === '!' || ch === '?' ||
        ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === ';' ||
        // 句点：①在文末 或 ②后面是空白字符（空格/换行）且不是小数点才切
        (ch === '.' && (
          i + 1 >= text.length ||
          (/\s/.test(text[i + 1]) &&
           !(i > 0 && /\d/.test(text[i - 1]) && /\d/.test(text[i + 1])))
        ));

      if (isEnd) {
        const seg = text.slice(start, i + 1).trim();
        if (seg) result.push(seg);
        start = i + 1;
      }
    }
    // 剩余部分
    const remaining = text.slice(start).trim();
    if (remaining) result.push(remaining);

    // 如果完全没有切割或只有1句且文本很长，走splitByLength
    if (result.length === 0 || (result.length === 1 && text.length > 200)) {
      // 这种情况极少发生（全文无标点或只有一个小数点），直接按长度切
      return splitByLength(text, 150);
    }

    // ====== 后处理：合并被误切的句子 ======
    // 场景1：小数被切断——当前段以 "数字." 结尾，下一段以数字开头
    // 场景2：当前段以 and/or/the/a/an 结尾（明显不是句末）
    const merged = [];
    for (let i = 0; i < result.length; i++) {
      if (i < result.length - 1) {
        const cur = result[i].trim();
        const nxt = result[i + 1].trim();
        // 当前段以数字+点结尾且下一段以数字开头 → 合并（恢复小数）
        if (/^\d+\.$/.test(cur) && /^\d/.test(nxt)) {
          result[i + 1] = cur + ' ' + nxt;
          continue;
        }
        // 当前段以连词结尾 → 明显不是句末，合并到下一段
        if (/\b(and|or|the|a|an|but|for|nor|yet|so|with|from|this|that)$/i.test(cur)) {
          result[i + 1] = cur + ' ' + nxt;
          continue;
        }
        // 当前段以连字符结尾（如 multi-）→ 连字符单词被误切，合并
        if (/-\s*$/.test(cur) && /[a-zA-Z-]/.test(nxt.charAt(0))) {
          result[i + 1] = cur + nxt;
          continue;
        }
        // 当前段以字母结尾且下一段以连字符+字母开头（如 -stage）→ 合并
        if (/[a-zA-Z]$/.test(cur) && /^-[a-zA-Z]/.test(nxt)) {
          result[i + 1] = cur + nxt;
          continue;
        }
      }
      merged.push(result[i]);
    }

    return merged.filter(s => s.length > 0);
  }

  /** 按最大字符数分割（向后找最近的自然断点） */
  function splitByLength(text, maxLen) {
    const result = [];
    let pos = 0;
    while (pos < text.length) {
      if (pos + maxLen >= text.length) {
        result.push(text.slice(pos).trim());
        break;
      }
      // 从 maxLen 位置向后扫描最多 30 字符，找自然断点
      const scanEnd = Math.min(pos + maxLen + 30, text.length);
      let splitAt = -1;
      for (let j = pos + maxLen; j < scanEnd; j++) {
        const ch = text[j];
        // 确定是否是句末符号
        const isPeriodEnd = ch === '.' &&
          (j + 1 >= text.length || /\s/.test(text[j + 1])) &&
          !(j > 0 && /\d/.test(text[j - 1]) && j + 1 < text.length && /\d/.test(text[j + 1]));
        if (ch === '!' || ch === '?' || ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === ';' || isPeriodEnd) {
          splitAt = j + 1; // 包含标点
          break;
        }
      }
      if (splitAt > 0) {
        result.push(text.slice(pos, splitAt).trim());
        pos = splitAt;
      } else {
        // 找不到自然断点 → 向前找最后一个空格（单词边界），避免腰斩单词
        let wordBoundary = -1;
        for (let j = pos + maxLen; j > pos; j--) {
          if (/\s/.test(text[j])) { wordBoundary = j + 1; break; }
        }
        if (wordBoundary > 0 && wordBoundary > pos) {
          result.push(text.slice(pos, wordBoundary).trim());
          pos = wordBoundary;
        } else {
          // 真的找不到任何空格了，才硬切
          result.push(text.slice(pos, pos + maxLen).trim());
          pos += maxLen;
        }
      }
    }
    return result.filter(s => s.length > 0);
  }

  /** 获取句子的预估朗读时长（秒） */
  function estimateDuration(text, rate) {
    if (!text || text.length === 0) return 0;
    const base = isChinese(text) ? text.length * 0.25 : text.split(/\s+/).length * 0.3;
    return base / (rate || 1.0);
  }

  // ====== 内容净化 ======

  /** 清除脚注标记如 [1] [2] [3] 等 */
  const FOOTNOTE_RE = /\[\d+(?:[,，\s]*\d+)*\]/g;
  /** 清除装饰符号段落 */
  const DECORATIVE_RE = /^[\s*#\-_—=~·•○●※✦✧]+$/gm;
  /** 连续空白 */
  const MULTI_SPACE_RE = /[ \t]{2,}/g;
  /** 连续换行 */
  const MULTI_NEWLINE_RE = /\n{3,}/g;
  /** HTML 标签 */
  const HTML_TAG_RE = /<[^>]*>/g;

  /** 净化文本用于朗读 */
  function sanitizeForSpeech(text) {
    if (!text) return '';
    let result = text;
    // 去除软连字符 &shy; (U+00AD) — 某些网站用此标记断词
    result = result.replace(/\u00AD/g, '');
    // 去除 HTML 标签
    result = result.replace(HTML_TAG_RE, '');
    // 去除脚注标记
    result = result.replace(FOOTNOTE_RE, '');
    // 去除装饰行
    result = result.replace(DECORATIVE_RE, '');
    // 压缩连续空白
    result = result.replace(MULTI_SPACE_RE, ' ');
    // 压缩连续换行
    result = result.replace(MULTI_NEWLINE_RE, '\n\n');
    // 去除首尾空白
    result = result.trim();
    return result;
  }

  /** 清除拼音注音：保留汉字，去掉括号注音 */
  function stripPinyin(text) {
    if (!text) return '';
    // 去掉（拼音）格式
    return text
      .replace(/[（(][a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s]+[）)]/g, '')
      // 去掉 span.ruby 注音
      .replace(/<ruby>|<\/ruby>|<rt>.*?<\/rt>|<rp>.*?<\/rp>/gi, '')
      .trim();
  }

  /** CJK 间空格清理：Edge TTS 对汉字间空格敏感会逐字朗读 */
  function cleanCjkSpacing(text) {
    if (!text) return '';
    // 移除 CJK 字符之间的空格
    return text.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
  }

  /** 完整预处理流水线 */
  function preprocess(text, options = {}) {
    let result = text;
    // 软连字符 &shy; (U+00AD) 始终清理，不需要选项
    result = result.replace(/\u00AD/g, '');
    if (options.stripHtml) result = result.replace(HTML_TAG_RE, '');
    if (options.stripPinyin) result = stripPinyin(result);
    if (options.stripFootnotes) result = result.replace(FOOTNOTE_RE, '');
    if (options.stripDecorative) result = result.replace(DECORATIVE_RE, '');
    if (options.cleanCjk) result = cleanCjkSpacing(result);
    if (options.collapseWhitespace) {
      result = result.replace(MULTI_SPACE_RE, ' ').replace(MULTI_NEWLINE_RE, '\n\n');
    }
    return result.trim();
  }

  /** 获取默认预处理选项 */
  function getDefaultOptions() {
    return {
      stripHtml: true,
      stripPinyin: true,
      stripFootnotes: true,
      stripDecorative: true,
      collapseWhitespace: true,
      cleanCjk: false,
    };
  }

  // ====== 字数统计 ======

  /** 统计有效朗读字数 */
  function countReadableChars(text) {
    if (!text) return { chars: 0, words: 0, sentences: 0 };
    const cleaned = text.replace(/\s+/g, '');
    const chars = cleaned.length;
    const words = text.split(/\s+/).filter(w => w.length > 0).length;
    const sentences = splitSentences(text).length;
    return { chars, words, sentences };
  }

  // ====== 语音速率转换 ======

  /** 验证速度值有效性 */
  function validateSpeed(speed) {
    const s = parseFloat(speed);
    if (isNaN(s) || s < 0.1) return 0.5;
    if (s > 5.0) return 5.0;
    return Math.round(s * 10) / 10;
  }

  /** 语速预设配置 */
  const SPEED_PRESETS = {
    verySlow: 0.5,
    slow: 0.75,
    normal: 1.0,
    fast: 1.25,
    veryFast: 1.5,
    max: 2.0,
  };

  // 导出公共 API
  return {
    detectScript,
    isChinese,
    detectLanguage,
    splitSentences,
    splitByLength,
    estimateDuration,
    sanitizeForSpeech,
    stripPinyin,
    cleanCjkSpacing,
    preprocess,
    getDefaultOptions,
    countReadableChars,
    validateSpeed,
    SPEED_PRESETS,
  };
})();
