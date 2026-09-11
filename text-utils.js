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
    const langCode = detectLanguage(text);
    return langCode.split('-')[0].toLowerCase();
  }

  /** 检测文本是否是中文 */
  function isChinese(text) {
    return detectScript(text) === 'zh';
  }

  /** 全面智能语言检测：结合正文样本特征与 HTML 声明，精准识别日韩中及欧洲主要语种（防误判英语） */
  function detectLanguage(text) {
    if (!text || !text.trim()) return "en-US";
    const cleaned = text.trim();
    if (!cleaned) return "en-US";

    // 1. 排他性字符集检测（第一优先级）
    const hangul = (cleaned.match(/[\uac00-\ud7af\u1100-\u11ff]/g) || []).length;
    const kana = (cleaned.match(/[\u3040-\u30ff]/g) || []).length;
    const cjk = (cleaned.match(/[\u4e00-\u9fa5\u3400-\u4dbf]/g) || []).length;
    const cyrillic = (cleaned.match(/[\u0400-\u04ff]/g) || []).length;
    const arabic = (cleaned.match(/[\u0600-\u06ff]/g) || []).length;

    if (kana >= 1) return "ja-JP";
    if (hangul >= 1) return "ko-KR";
    if (cyrillic >= 3) return "ru-RU";
    if (arabic >= 3) return "ar-SA";

    const docLang = (typeof document !== "undefined")
      ? (document.documentElement?.lang || (document.body && typeof document.body.getAttribute === 'function' ? document.body.getAttribute('lang') : '') || '').toLowerCase()
      : "";

    if (docLang.startsWith("ja") && cjk >= 1) return "ja-JP";
    if (cjk >= 2 || (cjk === 1 && cleaned.length < 10)) return "zh-CN";

    // 2. 欧洲拉丁语系特征加权打分
    const latin = (cleaned.match(/[a-zA-ZÀ-ÖØ-öø-ÿĀ-ž]/g) || []).length;
    if (latin >= 1) {
      const deChars = (cleaned.match(/[äöüßÄÖÜ]/g) || []).length;
      const frChars = (cleaned.match(/[éèêëàâùûôîïçœæÉÈÊËÀÂÙÛÔÎÏÇŒÆ]/g) || []).length;
      const esChars = (cleaned.match(/[áéíóúñ¿¡ÁÉÍÓÚÑ]/g) || []).length;
      const ptChars = (cleaned.match(/[ãõáéíóúâêôçÃÕÁÉÍÓÚÂÊÔÇ]/g) || []).length;
      const itChars = (cleaned.match(/[àèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ]/g) || []).length;

      const enMatches = (cleaned.match(/\b(the|this|that|these|those|with|have|from|which|would|there|their|what|about|when|make|time|just|know|take|into|year|your|good|some|could|them|other|than|then|now|look|only|come|its|over|think|also|back|after|use|two|how|our|work|first|well|way|even|new|want|because|any|give|day|most|us)\b/gi) || []).length;
      const deMatches = (cleaned.match(/\b(der|das|den|dem|des|und|nicht|von|sie|ist|sich|mit|als|fuer|auf|ein|eine|einer|einem|einen|eines|nach|wie|auch|wir|aus|hat|dass|bei|ihr|noch|ueber|haben|aber|sehr|deutsch|zeit)\b/gi) || []).length;
      const frMatches = (cleaned.match(/\b(les|des|dans|pour|avec|sur|qui|que|cette|ces|ils|elles|nous|vous|sont|plus|pas|par|faire|tout|merci|bonjour)\b|\b(c'|d'|l'|j'|m'|t'|s'|n'|qu')/gi) || []).length;
      const esMatches = (cleaned.match(/\b(los|las|unos|unas|del|por|para|son|sus|como|mas|pero|este|esta|estos|estas|muy|gracias|buenos|dias|todos)\b/gi) || []).length;
      const itMatches = (cleaned.match(/\b(gli|della|dei|degli|delle|sono|che|non|hanno|questo|questa|grazie|ciao|molto)\b|\b(dell'|all'|nell'|sull')/gi) || []).length;
      const ptMatches = (cleaned.match(/\b(dos|das|para|nao|sao|mais|como|muito|obrigado|ola)\b/gi) || []).length;

      const scores = {
        en: enMatches * 2 + (docLang.startsWith("en") ? 4 : 0),
        de: deChars * 4 + deMatches * 2 + (docLang.startsWith("de") ? 4 : 0),
        fr: frChars * 4 + frMatches * 2 + (docLang.startsWith("fr") ? 4 : 0),
        es: esChars * 4 + esMatches * 2 + (docLang.startsWith("es") ? 4 : 0),
        it: itChars * 4 + itMatches * 2 + (docLang.startsWith("it") ? 4 : 0),
        pt: ptChars * 4 + ptMatches * 2 + (docLang.startsWith("pt") ? 4 : 0)
      };

      let bestLang = "en";
      let maxScore = scores.en;
      for (const [k, s] of Object.entries(scores)) {
        if (s > maxScore) {
          maxScore = s;
          bestLang = k;
        }
      }

      const langMap = {
        en: "en-US",
        de: "de-DE",
        fr: "fr-FR",
        es: "es-ES",
        it: "it-IT",
        pt: "pt-PT"
      };

      if (maxScore <= 2 && docLang) {
        for (const k of ["de", "fr", "es", "it", "pt", "en"]) {
          if (docLang.startsWith(k)) return langMap[k];
        }
      }

      return langMap[bestLang] || "en-US";
    }

    return "en-US";
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
        // 当前段以英文常见缩写或单字母缩写结尾（如 Dr. / Mr. / Prof. / e.g. / U.S. / J. K.）→ 避免误切
        if (/\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|e\.g|i\.e|etc|approx|inc|corp|dept|fig|no|vol|est|[A-Za-z])\.$/i.test(cur)) {
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

    // ====== 超长句子自然呼吸微切（单句过长 > 220 字符时，按从句标点平滑微切，避免高亮过长或 TTS 响应迟缓） ======
    const finalSentences = [];
    for (const item of merged) {
      if (item.length > 220) {
        finalSentences.push(...splitByLength(item, 160));
      } else {
        finalSentences.push(item);
      }
    }

    return finalSentences.filter(s => s.length > 0);
  }

  /** 按最大字符数分割（向后或向前找最近的自然呼吸断点） */
  function splitByLength(text, maxLen) {
    const result = [];
    let pos = 0;
    while (pos < text.length) {
      if (pos + maxLen >= text.length) {
        result.push(text.slice(pos).trim());
        break;
      }
      let splitAt = -1;

      // 1. 在 [pos + maxLen - 40, pos + maxLen + 40] 范围内寻找强标点（句号/问号/感叹号/分号/冒号）
      const scanStart = Math.max(pos + 30, pos + maxLen - 40);
      const scanEnd = Math.min(pos + maxLen + 40, text.length);
      for (let j = scanStart; j < scanEnd; j++) {
        const ch = text[j];
        const isPeriodEnd = ch === '.' &&
          (j + 1 >= text.length || /\s/.test(text[j + 1])) &&
          !(j > 0 && /\d/.test(text[j - 1]) && j + 1 < text.length && /\d/.test(text[j + 1]));
        if (ch === '!' || ch === '?' || ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === ';' || ch === ':' || ch === '：' || isPeriodEnd) {
          splitAt = j + 1;
          if (j >= pos + maxLen - 20) break;
        }
      }

      // 2. 找不到强标点，在合理范围内寻找次级弱标点（逗号、破折号）
      if (splitAt < 0) {
        for (let j = scanStart; j < scanEnd; j++) {
          const ch = text[j];
          if (ch === ',' || ch === '，' || ch === '—' || (ch === '-' && text[j + 1] === '-')) {
            splitAt = j + 1;
            if (j >= pos + maxLen - 20) break;
          }
        }
      }

      if (splitAt > 0) {
        result.push(text.slice(pos, splitAt).trim());
        pos = splitAt;
      } else {
        // 3. 找不到标点 → 向前找单词边界（空格），避免腰斩单词
        let wordBoundary = -1;
        for (let j = Math.min(pos + maxLen, text.length - 1); j >= Math.max(pos + 20, pos + maxLen - 40); j--) {
          if (/\s/.test(text[j])) { wordBoundary = j + 1; break; }
        }
        if (wordBoundary > 0 && wordBoundary > pos) {
          result.push(text.slice(pos, wordBoundary).trim());
          pos = wordBoundary;
        } else {
          // 4. 极端情况（如无空格长串）硬切
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
    // 去除视频播放器隐藏无障碍提示（如 "0 seconds of 44 seconds Press shift question mark to access keyboard shortcuts"）
    result = result.replace(/\b\d+\s+seconds of\s+\d+\s+seconds[^\n.]*[\n.]?/gi, '');
    result = result.replace(/Press shift question mark[^\n.]*[\n.]?/gi, '');
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
