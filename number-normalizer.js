// ReadMate / 读伴 — 数字朗读标准化模块
// 将数字/金额/时间/温度等转换为自然语言拼写，让 TTS 读出正确发音
// 使用说明：NumberNormalizer.normalize(text) → 朗读友好文本

const NumberNormalizer = (() => {
  'use strict';

  // ====== 基础词表 ======
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

  /** 整数转英文单词（0 ~ 999,999,999,999） */
  function numberToWords(n) {
    if (n === 0) return 'zero';
    if (n < 0) return 'minus ' + numberToWords(-n);

    function under1000(num) {
      const parts = [];
      const h = Math.floor(num / 100);
      if (h > 0) parts.push(ONES[h] + ' hundred');
      const r = num % 100;
      if (r > 0) {
        if (r < 20) parts.push(ONES[r]);
        else {
          const t = Math.floor(r / 10);
          const o = r % 10;
          parts.push(TENS[t] + (o > 0 ? '-' + ONES[o] : ''));
        }
      }
      return parts.join(' ');
    }

    const chunks = [];
    let remaining = n;
    let scaleIdx = 0;
    while (remaining > 0) {
      const chunk = remaining % 1000;
      if (chunk > 0) {
        const words = under1000(chunk);
        chunks.unshift(words + (SCALES[scaleIdx] ? ' ' + SCALES[scaleIdx] : ''));
      }
      remaining = Math.floor(remaining / 1000);
      scaleIdx++;
    }
    return chunks.join(' ');
  }

  // ====== 规则引擎 ======

  /**
   * 所有规则按优先级执行，每条规则：
   *  - name: 规则名（调试用）
   *  - test: (text) => matches or null
   *  - replace: (match) => replacement string
   */

  const RULES = [

    // ====== 1. 温度：25°C / 25° / -10°F ======
    {
      name: 'temperature',
      re: /(-?\d+(?:\.\d+)?)\s*°([CFcf])/g,
      replace: (m, val, unit) => {
        const deg = normalizeNumberValue(val);
        const u = unit.toUpperCase() === 'C' ? 'Celsius' : 'Fahrenheit';
        return `${deg} degrees ${u}`;
      }
    },

    // ====== 2. 货币：$25.50 / $1.2M / $5k / €10 / £99.99 ======
    {
      name: 'currency',
      re: /([\$€£¥])\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmMbB])?/g,
      replace: (m, symbol, amount, suffix) => {
        const currencyName = { '$': 'dollar', '€': 'euro', '£': 'pound', '¥': 'yen' }[symbol] || 'dollar';
        const num = parseFloat(amount.replace(/,/g, ''));

        if (currencyName === 'yen') {
          return numberToWords(num) + ' yen';
        }

        // 带后缀（K/M/B）且含小数 → "one point two million dollars"
        if (suffix && amount.includes('.')) {
          const scaleWord = { 'K': 'thousand', 'M': 'million', 'B': 'billion' }[suffix.toUpperCase()] || '';
          const numStr = normalizeNumberValue(amount);
          return numStr + ' ' + scaleWord + ' ' + currencyName + (num !== 1 ? 's' : '');
        }

        // 带后缀但无小数 → 先乘再读
        if (suffix) {
          const s = suffix.toUpperCase();
          const factor = { 'K': 1000, 'M': 1000000, 'B': 1000000000 }[s] || 1;
          const total = Math.round(num * factor);
          return numberToWords(total) + ' ' + currencyName + (total !== 1 ? 's' : '');
        }

        // 无后缀：处理小数金额
        const whole = Math.floor(num);
        const cents = Math.round((num - whole) * 100);
        if (cents === 0) {
          return numberToWords(whole) + ' ' + currencyName + (whole !== 1 ? 's' : '');
        } else {
          return numberToWords(whole) + ' ' + currencyName + (whole !== 1 ? 's' : '') +
            ' and ' + numberToWords(cents) + ' cent' + (cents !== 1 ? 's' : '');
        }
      }
    },

    // ====== 3. 百分比：50% / 12.5% ======
    {
      name: 'percentage',
      re: /(-?\d+(?:\.\d+)?)\s*%/g,
      replace: (m, val) => normalizeNumberValue(val) + ' percent'
    },

    // ====== 4. 时间（12小时制）：3:30 PM / 12:00 AM ======
    {
      name: 'time_12h',
      re: /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/g,
      replace: (m, h, min, period) => {
        const hour = parseInt(h);
        const minute = parseInt(min);
        const mer = period.toUpperCase();
        const hourWord = hour === 0 ? 'twelve' : hour <= 12 ? numberToWords(hour) : numberToWords(hour - 12);
        if (minute === 0) {
          if (hour === 12 && mer === 'AM') return 'midnight';
          if (hour === 12 && mer === 'PM') return 'noon';
          return hourWord + " o'clock " + mer;
        }
        const minWord = minute < 10 ? 'oh ' + numberToWords(minute) : numberToWords(minute);
        return hourWord + ' ' + minWord + ' ' + mer;
      }
    },

    // ====== 5. 时间（24小时制）：23:45 / 14:30 ======
    {
      name: 'time_24h',
      re: /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g,
      replace: (m, h, min) => {
        const hour = parseInt(h);
        const minute = parseInt(min);
        if (minute === 0) {
          if (hour === 0) return 'midnight';
          if (hour === 12) return 'noon';
          return numberToWords(hour) + ' hundred hours';
        }
        const hourWord = numberToWords(hour);
        const minWord = minute < 10 ? 'oh ' + numberToWords(minute) : numberToWords(minute);
        return hourWord + ' ' + minWord;
      }
    },

    // ====== 6. 小数 + 数字范围：7.2 → "seven point two" ======
    // 注意：匹配小数时排除版本号（v2.0）、IP地址等情况
    // lookahead 不排除句点——允许 3.14. 这样的句尾小数
    {
      name: 'decimal_number',
      re: /(?<![a-zA-Z./\\])(\d+)\.(\d+)(?![a-zA-Z/\\])/g,
      replace: (m, integer, fraction) => {
        const intPart = parseInt(integer);
        const intWord = intPart === 0 ? 'zero' : integer; // "zero point five" vs "seven point two"
        // 小数部分逐位读
        const fracDigits = fraction.split('').map(d => ONES[parseInt(d)]).join(' ');
        return numberToWords(intPart) + ' point ' + fracDigits;
      }
    },

    // ====== 7. 分数：1/2 → "one half", 3/4 → "three quarters" ======
    {
      name: 'fraction',
      re: /(\d+)\s*\/\s*(\d+)/g,
      replace: (m, num, den) => {
        const n = parseInt(num);
        const d = parseInt(den);

        // 常见分数有特殊说法
        const specialDen = { 2: 'half', 4: 'quarter' };
        const denWord = specialDen[d] ? specialDen[d] : numberToWords(d) + 'th';

        if (n === 1) {
          if (d === 2) return 'one half';
          if (d === 4) return 'one quarter';
          return 'one ' + denWord;
        }
        if (d === 2) {
          // 3/2 → "three halves" 比较少见，用 "three over two"
          return numberToWords(n) + ' ' + denWord + 's';
        }
        if (d === 4) {
          return numberToWords(n) + ' quarters';
        }
        if (n > d) {
          // 假分数：7/4 → "seven over four"（连读更自然）
          return numberToWords(n) + ' over ' + numberToWords(d);
        }
        return numberToWords(n) + ' ' + denWord + 's';
      }
    },

    // ====== 8. 序数词：1st → "first", 2nd → "second", 3rd → "third" ======
    {
      name: 'ordinal',
      re: /\b(\d+)(st|nd|rd|th)\b/g,
      replace: (m, num, suffix) => {
        const n = parseInt(num);
        // 特殊序数
        const special = { 1: 'first', 2: 'second', 3: 'third',
          4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh',
          8: 'eighth', 9: 'ninth', 10: 'tenth',
          11: 'eleventh', 12: 'twelfth', 13: 'thirteenth',
          14: 'fourteenth', 15: 'fifteenth', 16: 'sixteenth',
          17: 'seventeenth', 18: 'eighteenth',
          19: 'nineteenth', 20: 'twentieth' };
        if (special[n]) return special[n];

        // 两位数以上：取最后一位决定序数后缀
        const lastTwo = n % 100;
        if (lastTwo >= 11 && lastTwo <= 13) {
          // 11th→eleventh, 12th→twelfth, 13th→thirteenth
          return numberToWords(n) + 'th'; // 退化，但 readers get it
        }
        const lastDigit = n % 10;
        const suffixMap = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth',
          5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth',
          9: 'ninth', 0: 'th' };
        const word = numberToWords(n);
        // 检测最后一个词前的分隔符（连字符或空格）
        const parts = word.split(/[-\s]/);
        const lastWord = parts.pop();
        const sep = word.endsWith(lastWord) ? '' : word.charAt(word.length - lastWord.length - 1);
        // 替换最后一个词
        if (lastDigit === 1 && lastWord === 'one') {
          return word.slice(0, word.length - lastWord.length - (sep ? 1 : 0)) + 'first';
        }
        if (lastDigit === 2 && lastWord === 'two') {
          return word.slice(0, word.length - lastWord.length - (sep ? 1 : 0)) + 'second';
        }
        if (lastDigit === 3 && lastWord === 'three') {
          return word.slice(0, word.length - lastWord.length - (sep ? 1 : 0)) + 'third';
        }
        if (lastDigit === 5 && lastWord === 'five') {
          if (word === 'five') return 'fifth';
          return word.slice(0, word.length - lastWord.length - (sep ? 1 : 0)) + 'fifth';
        }
        if (lastDigit === 8 && lastWord === 'eight') {
          if (word === 'eight') return 'eighth';
          return word.slice(0, word.length - lastWord.length - (sep ? 1 : 0)) + 'eighth';
        }
        if (lastDigit === 9 && lastWord === 'nine') {
          if (word === 'nine') return 'ninth';
          return word.slice(0, word.length - lastWord.length - (sep ? 1 : 0)) + 'ninth';
        }
        if (lastDigit === 0) return word + 'th';
        if (lastDigit === 1) return word + '-first';
        if (lastDigit === 2) return word + '-second';
        if (lastDigit === 3) return word + '-third';
        return word + 'th';
      }
    },

    // ====== 9. 纯整数（3-6位，独立出现，非年份/非大数）======
    // 先处理大数（≥1000）
    {
      name: 'large_integer',
      // 匹配1000到999999（有逗号或独立出现）
      re: /\b(\d{1,3}(?:,\d{3})+)\b/g,
      replace: (m, numStr) => {
        const n = parseInt(numStr.replace(/,/g, ''));
        return numberToWords(n);
      }
    },

    // 无逗号的数字 1000~9999（年份除外）
    {
      name: 'medium_integer',
      // 匹配1000-9999，但排除年份（前后有年份上下文提示）
      // 使用更保守的匹配：前面有介词/数量词，或是独立的数字
      re: /(?<=\b(?:about|approximately|around|over|under|more than|less than|nearly|roughly|some|about|an?|the|which|total|sum|count|number|of|is|are|was|were|with|at|by|magnitude|magnitudes|rating|ratings)\s+)(\d{4})(?=\b)/gi,
      replace: (m, numStr) => {
        const n = parseInt(numStr);
        // 年份范围 1900-2099 读年份方式
        if (n >= 1900 && n <= 2099) {
          return readYear(n);
        }
        return numberToWords(n);
      }
    },

    // 独立数字（2-3位）："42" → "forty-two"
    {
      name: 'small_integer',
      re: /(?<![a-zA-Z0-9.])'?(\d{2,3})(?![a-zA-Z0-9.])(?!\s*:\s*\d)/g,
      replace: (m, numStr) => {
        const n = parseInt(numStr);
        // 100→一百整体，99→ninety-nine
        return numberToWords(n);
      }
    },

    // ====== 10. 数字范围：7.2 and 7.5 → 小数规则已覆盖 ======

    // ====== 11. 度量衡单位 ======
    {
      name: 'measurement',
      re: /(\d+(?:\.\d+)?)\s*(km|m|cm|mm|kg|g|mg|lb|lbs|oz|mph|km\/h|m\/s|°C|°F|°)(?:\b|(?=\s))/gi,
      replace: (m, val, unit) => {
        const num = normalizeNumberValue(val);
        const unitMap = {
          'km': 'kilometers', 'm': 'meters', 'cm': 'centimeters', 'mm': 'millimeters',
          'kg': 'kilograms', 'g': 'grams', 'mg': 'milligrams',
          'lb': 'pounds', 'lbs': 'pounds', 'oz': 'ounces',
          'mph': 'miles per hour', 'km/h': 'kilometers per hour', 'm/s': 'meters per second',
        };
        const spoken = unitMap[unit.toLowerCase()] || unit;
        return num + ' ' + spoken;
      }
    },

  ];

  // ====== 工具函数 ======

  /** 数值字符串 → 朗读文本（含小数处理） */
  function normalizeNumberValue(val) {
    if (val.includes('.')) {
      const parts = val.split('.');
      const intPart = parseInt(parts[0]);
      const fracDigits = parts[1].split('').map(d => ONES[parseInt(d)]).join(' ');
      if (intPart === 0 && parts[1].length > 0) {
        return 'point ' + fracDigits;
      }
      return numberToWords(intPart) + ' point ' + fracDigits;
    }
    return numberToWords(parseInt(val));
  }

  /** 年份朗读：2024 → "twenty twenty-four", 2000 → "two thousand" */
  function readYear(y) {
    if (y === 2000) return 'two thousand';
    if (y >= 2001 && y <= 2009) return 'two thousand ' + ONES[y - 2000];
    if (y >= 2010) {
      const first = Math.floor(y / 100);
      const second = y % 100;
      if (second === 0) return numberToWords(first * 100);
      return numberToWords(first) + ' ' + numberToWords(second);
    }
    if (y >= 1900 && y <= 1999) {
      const first = Math.floor(y / 100);
      const second = y % 100;
      if (second === 0) return numberToWords(first * 100);
      return numberToWords(first) + ' ' + numberToWords(second);
    }
    return numberToWords(y);
  }

  // ====== 主接口 ======

  /**
   * 将文本中的数字/金额/时间/温度等转为朗读友好的英文形式
   * @param {string} text - 原始文本
   * @returns {string} 数字转写后的文本
   */
  function normalize(text) {
    if (!text || text.length === 0) return text;

    let result = text;

    // 按规则顺序处理（高优先级先处理，避免冲突）
    for (const rule of RULES) {
      if (!rule.re) continue;
      result = result.replace(rule.re, rule.replace);
    }

    return result;
  }

  // ====== 辅助接口 ======

  /** 判断文本是否包含需要数字转写的场景 */
  function needsNormalization(text) {
    if (!text) return false;
    return /\d/.test(text);
  }

  // ====== 导出 ======
  return {
    normalize,
    numberToWords,
    normalizeNumberValue,
    readYear,
    needsNormalization,
    ONES,
  };
})();
