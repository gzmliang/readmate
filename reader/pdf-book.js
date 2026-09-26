// ReadMate / 读伴 — PDF 书稿解析器（M3）
//
// 目标：把 PDF 的「文字层」抽出来，重排成一页干净的书页（和 txt / epub 完全同一条阅读链路：
//       排版 / 朗读 / 声画高亮 / 双语对照 / 导出）。
//
// 设计要点：
//   1. pdf.js 全部内置在扩展里（vendor/pdfjs/），**不联网、不引 CDN**；
//      只在真的导入 PDF 时才动态加载 pdf.min.js，txt / epub 用户零开销
//   2. 逐页抽文字 → 按 y 坐标重建「行」→ 按缩进 / 行宽 / 行距重建「段落」
//   3. 清洗管道（TTS 听感关键）：修连字符断词、删页码与页眉页脚、删 [12] 角标、
//      康熙部首（Chromium 导出 PDF 会把「民」写成「⺠」）归一化恢复成正常汉字
//   4. 扫描版（没有文字层）与加密 PDF **明确报错**，绝不假装成功
//   5. 本文件不含任何界面文案，报错只给错误码（由 reader.js 走 i18n 提示）
//
// 错误码：PDF_INVALID / PDF_ENCRYPTED / PDF_NO_TEXT / PDF_TOO_LARGE / PDF_LIB_FAILED ...

const BookPdf = (() => {
  'use strict';

  const MAX_BYTES = 300 * 1024 * 1024;      // 单文件上限（防止内存爆掉）
  const LIB_PATH = 'vendor/pdfjs/pdf.min.js';
  const WORKER_PATH = 'vendor/pdfjs/pdf.worker.min.js';
  const CMAP_PATH = 'vendor/pdfjs/cmaps/';
  const FONT_PATH = 'vendor/pdfjs/standard_fonts/';

  function pdfError(code, detail) {
    const e = new Error(code + (detail ? ': ' + detail : ''));
    e.code = code;
    if (detail) e.detail = detail;
    return e;
  }

  // ====== 康熙部首 / CJK 部首补遗 → 正常汉字 ======
  // 依据 Unicode CJKRadicals.txt（243 组）。Chromium 打印成 PDF 时，共用字形的字
  // 会被反向 cmap 写成部首码位（「民」→「⺠」、「风」→「⻛」），不还原就是错字。
  const RADICAL_PAIRS = [
    '⼀一', '⼁丨', '⼂丶', '⼃丿', '⼄乙', '⼅亅', '⼆二', '⼇亠', 
    '⼈人', '⼉儿', '⼊入', '⼋八', '⼌冂', '⼍冖', '⼎冫', '⼏几', 
    '⼐凵', '⼑刀', '⼒力', '⼓勹', '⼔匕', '⼕匚', '⼖匸', '⼗十', 
    '⼘卜', '⼙卩', '⼚厂', '⼛厶', '⼜又', '⼝口', '⼞囗', '⼟土', 
    '⼠士', '⼡夂', '⼢夊', '⼣夕', '⼤大', '⼥女', '⼦子', '⼧宀', 
    '⼨寸', '⼩小', '⼪尢', '⼫尸', '⼬屮', '⼭山', '⼮巛', '⼯工', 
    '⼰己', '⼱巾', '⼲干', '⼳幺', '⼴广', '⼵廴', '⼶廾', '⼷弋', 
    '⼸弓', '⼹彐', '⼺彡', '⼻彳', '⼼心', '⼽戈', '⼾戶', '⼿手', 
    '⽀支', '⽁攴', '⽂文', '⽃斗', '⽄斤', '⽅方', '⽆无', '⽇日', 
    '⽈曰', '⽉月', '⽊木', '⽋欠', '⽌止', '⽍歹', '⽎殳', '⽏毋', 
    '⽐比', '⽑毛', '⽒氏', '⽓气', '⽔水', '⽕火', '⽖爪', '⽗父', 
    '⽘爻', '⽙爿', '⺦丬', '⽚片', '⽛牙', '⽜牛', '⽝犬', '⽞玄', 
    '⽟玉', '⽠瓜', '⽡瓦', '⽢甘', '⽣生', '⽤用', '⽥田', '⽦疋', 
    '⽧疒', '⽨癶', '⽩白', '⽪皮', '⽫皿', '⽬目', '⽭矛', '⽮矢', 
    '⽯石', '⽰示', '⽱禸', '⽲禾', '⽳穴', '⽴立', '⽵竹', '⽶米', 
    '⽷糸', '⺰纟', '⽸缶', '⽹网', '⽺羊', '⽻羽', '⽼老', '⽽而', 
    '⽾耒', '⽿耳', '⾀聿', '⾁肉', '⾂臣', '⾃自', '⾄至', '⾅臼', 
    '⾆舌', '⾇舛', '⾈舟', '⾉艮', '⾊色', '⾋艸', '⾌虍', '⾍虫', 
    '⾎血', '⾏行', '⾐衣', '⾑襾', '⾒見', '⻅见', '⾓角', '⾔言', 
    '⻈讠', '⾕谷', '⾖豆', '⾗豕', '⾘豸', '⾙貝', '⻉贝', '⾚赤', 
    '⾛走', '⾜足', '⾝身', '⾞車', '⻋车', '⾟辛', '⾠辰', '⾡辵', 
    '⾢邑', '⾣酉', '⾤釆', '⾥里', '⾦金', '⻐钅', '⾧長', '⻓长', 
    '⾨門', '⻔门', '⾩阜', '⾪隶', '⾫隹', '⾬雨', '⾭靑', '⾮非', 
    '⾯面', '⾰革', '⾱韋', '⻙韦', '⾲韭', '⾳音', '⾴頁', '⻚页', 
    '⾵風', '⻛风', '⾶飛', '⻜飞', '⾷食', '⻠饣', '⾸首', '⾹香', 
    '⾺馬', '⻢马', '⾻骨', '⾼高', '⾽髟', '⾾鬥', '⾿鬯', '⿀鬲', 
    '⿁鬼', '⿂魚', '⻥鱼', '⿃鳥', '⻦鸟', '⿄鹵', '⻧卤', '⿅鹿', 
    '⿆麥', '⻨麦', '⿇麻', '⿈黃', '⻩黄', '⿉黍', '⿊黑', '⿋黹', 
    '⿌黽', '⻪黾', '⿍鼎', '⿎鼓', '⿏鼠', '⿐鼻', '⿑齊', '⻬齐', 
    '⻫斉', '⿒齒', '⻮齿', '⻭歯', '⿓龍', '⻰龙', '⻯竜', '⿔龜', 
    '⻳龟', '⻲亀', '⿕龠',
  ];
  const RADICAL_MAP = (function () {
    const m = new Map();
    RADICAL_PAIRS.forEach(function (pair) { m.set(pair[0], pair[1]); });
    // Unicode CJKRadicals.txt 未收录的 87 个「部首变体」（CJK 部首补遗块 U+2E80–U+2EFF）。
    // 这些变体没有 NFKC 分解，只能显式映射回所属部首的规范字：
    // 例：⺅→人 ⺡→水 ⺮→竹 ⺟→母 ⺠→民 ⺼→肉 ⻂→衣 ⻌→辵 ⻏→邑 ⻖→阜
    // 依据：每个变体所属的 Kangxi 部首编号 → 该编号的规范汉字（与 RADICAL_PAIRS 同源）。
    const RADICAL_VARIANTS = {
      '⺀': '丶', '⺁': '厂', '⺂': '乙', '⺃': '乙', '⺄': '乙', '⺅': '人', '⺆': '冂', '⺇': '几',
      '⺈': '刀', '⺉': '刀', '⺊': '卜', '⺋': '卩', '⺌': '小', '⺍': '小', '⺎': '尢', '⺏': '尢',
      '⺐': '尢', '⺑': '尢', '⺒': '己', '⺓': '幺', '⺔': '彐', '⺕': '彐', '⺖': '心', '⺗': '心',
      '⺘': '手', '⺙': '攴', '⺛': '无', '⺜': '日', '⺝': '月', '⺞': '歹', '⺟': '母', '⺠': '民',
      '⺡': '水', '⺢': '水', '⺣': '火', '⺤': '爪', '⺥': '爪', '⺧': '牛', '⺨': '犬', '⺩': '玉',
      '⺪': '疋', '⺫': '目', '⺬': '示', '⺭': '示', '⺮': '竹', '⺯': '糸', '⺱': '网', '⺲': '网',
      '⺳': '网', '⺴': '网', '⺵': '网', '⺶': '羊', '⺷': '羊', '⺸': '羊', '⺹': '老', '⺺': '而',
      '⺻': '而', '⺼': '肉', '⺽': '臼', '⺾': '艸', '⺿': '艸', '⻀': '艸', '⻁': '虍', '⻂': '衣',
      '⻃': '襾', '⻄': '襾', '⻆': '角', '⻇': '角', '⻊': '足', '⻌': '辵', '⻍': '辵', '⻎': '辵',
      '⻏': '邑', '⻑': '長', '⻒': '長', '⻕': '阜', '⻖': '阜', '⻗': '雨', '⻘': '青', '⻝': '食',
      '⻞': '食', '⻟': '食', '⻡': '首', '⻣': '骨', '⻤': '鬼', '⻱': '龜',
    };
    Object.keys(RADICAL_VARIANTS).forEach(function (k) { m.set(k, RADICAL_VARIANTS[k]); });
    return m;
  })();

  const RE_RADICAL = /[\u2e80-\u2eff\u2f00-\u2fdf]/;
  const RE_COMPAT_IDEO = /[\uf900-\ufaff]/;

  function normalizeGlyphs(s) {
    if (!RE_RADICAL.test(s) && !RE_COMPAT_IDEO.test(s)) return s;
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const code = s.charCodeAt(i);
      if (code >= 0x2e80 && code <= 0x2fdf) {
        out += RADICAL_MAP.get(ch) || (code >= 0x2f00 ? ch.normalize('NFKC') : ch);
      } else if (code >= 0xf900 && code <= 0xfaff) {
        out += ch.normalize('NFKC');
      } else {
        out += ch;
      }
    }
    return out;
  }

  // ====== 文字清洗 ======
  const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;
  const SENT_END = /[。！？；!?;…]$/;
  const PAGE_NUM_RE = /^[\s\-–—_·.()\[\]【】]*(\d{1,4}|[ivxlcIVXLC]{1,7})[\s\-–—_·.()\[\]【】]*$/;
  const ORNAMENT_RE = /^[\s\-–—_=~·•※◆◇✦✧*#]+$/;

  function stripControls(s) {
    return String(s)
      .replace(/[\u00ad\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g, '')
      .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
  }

  /** 去掉 [12] [1,3] [1-3] 这类纯数字角标（朗读时是噪音） */
  function stripRefs(s) {
    return s.replace(/\[\s*\d{1,4}(?:\s*[,\-–]\s*\d{1,4})*\s*\]/g, '')
      .replace(/\s{2,}/g, ' ');
  }

  function cleanLineText(s) {
    let t = stripControls(s).replace(/[\u00a0\u3000]/g, ' ');
    t = stripRefs(t);
    t = t.replace(/[ \t]{2,}/g, ' ').trim();
    t = normalizeGlyphs(t);
    return t;
  }

  function isCjkChar(ch) { return !!ch && CJK_RE.test(ch); }

  // ====== pdf.js 懒加载 ======
  let libPromise = null;

  function loadLib() {
    if (typeof window !== 'undefined' && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      let url;
      try { url = chrome.runtime.getURL(LIB_PATH); } catch (e) { url = LIB_PATH; }
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = function () {
        if (window.pdfjsLib) resolve(window.pdfjsLib);
        else reject(pdfError('PDF_LIB_FAILED'));
      };
      s.onerror = function () { reject(pdfError('PDF_LIB_FAILED')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // ====== 行重建 ======
  function joinItems(parts) {
    // parts: [{str, x, w, h}]，已按 x 排序
    let out = '';
    let prev = null;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const s = p.str;
      if (!s) continue;
      if (out && prev) {
        const gap = p.x - (prev.x + prev.w);
        const a = out.charAt(out.length - 1);
        const b = s.charAt(0);
        const bothCjk = isCjkChar(a) && isCjkChar(b);
        const joinable = /\s$/.test(out) || /^\s/.test(s);
        if (!joinable && !bothCjk) {
          const cw = prev.w > 0 && prev.str.length ? prev.w / prev.str.length : p.h * 0.5;
          const thresh = Math.max(0.35, Math.min(cw, p.h) * 0.16);
          if (gap > thresh) out += ' ';
        }
      }
      out += s;
      prev = p;
    }
    return out;
  }

  function buildLines(textContent) {
    const raw = (textContent && textContent.items) || [];
    const lines = [];
    let cur = null;

    for (let i = 0; i < raw.length; i++) {
      const it = raw[i];
      if (!it || typeof it.str !== 'string' || it.str === '') {
        if (it && it.hasEOL && cur) cur.ended = true;
        continue;
      }
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4];
      const y = tr[5];
      const h = Math.abs(tr[3]) || it.height || 10;
      const w = typeof it.width === 'number' ? it.width : 0;

      if (cur && (cur.ended || Math.abs(cur.y - y) > Math.max(1.2, cur.h * 0.45))) cur = null;
      if (!cur) {
        cur = { y: y, h: h, x0: x, x1: x + w, ended: false, parts: [] };
        lines.push(cur);
      }
      cur.h = Math.max(cur.h, h);
      cur.x0 = Math.min(cur.x0, x);
      cur.x1 = Math.max(cur.x1, x + w);
      cur.parts.push({ str: it.str, x: x, w: w, h: h });
      if (it.hasEOL) cur.ended = true;
    }

    lines.forEach(function (l) {
      l.parts.sort(function (a, b) { return a.x - b.x; });
      l.text = joinItems(l.parts).replace(/\s{2,}/g, ' ').trim();
      l.parts = null;
    });
    return lines.filter(function (l) { return l.text !== ''; });
  }

  // ====== 行 → 段落 ======
  function percentile(arr, p) {
    if (!arr.length) return 0;
    const a = arr.slice().sort(function (x, y) { return x - y; });
    const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
    return a[i];
  }

  /** 全局版面尺寸：正文宽度/字号/行距按「整本书」统计，单页统计会被短行（末行、标题、页码）带偏 */
  function docGeometry(pagesLines) {
    const lefts = [], rights = [], heights = [], gaps = [];
    pagesLines.forEach(function (lines) {
      lines.forEach(function (l) { lefts.push(l.x0); rights.push(l.x1); heights.push(l.h); });
      for (let i = 1; i < lines.length; i++) {
        const g = lines[i - 1].y - lines[i].y;
        if (g > 0 && g < 200) gaps.push(g);
      }
    });
    const h = percentile(heights, 0.5) || 10;
    return {
      left: percentile(lefts, 0.05),
      right: percentile(rights, 0.95),
      h: h,
      gap: gaps.length ? percentile(gaps, 0.5) : h * 1.5,
    };
  }

  function linesToParagraphs(lines, stats) {
    if (!lines.length) return { paragraphs: [] };
    const sorted = lines.slice().sort(function (a, b) { return b.y - a.y; });
    const lefts = [], rights = [], heights = [], gaps = [];
    sorted.forEach(function (l) { lefts.push(l.x0); rights.push(l.x1); heights.push(l.h); });
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i - 1].y - sorted[i].y);
    const bodyLeft = stats ? stats.left : percentile(lefts, 0.08);
    const bodyRight = stats ? stats.right : percentile(rights, 0.92);
    const bodyH = (stats && stats.h) || percentile(heights, 0.5) || 10;
    // 行间距必须用实测值，不能写死倍数：行高 1.9 的排版会让「行距」远大于字号
    const lineGap = (stats && stats.gap) || (gaps.length ? percentile(gaps, 0.5) : bodyH * 1.5);

    const paragraphs = [];
    let buf = null;          // {text, top, bottom, maxH, isHeading}

    function flush() {
      if (buf && buf.text.trim()) {
        buf.text = buf.text.replace(/\s{2,}/g, ' ').trim();
        paragraphs.push(buf);
      }
      buf = null;
    }

    for (let i = 0; i < sorted.length; i++) {
      const l = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : null;
      const text = cleanLineText(l.text);
      if (!text) continue;
      const chars = Math.max(1, text.replace(/\s/g, '').length);
      const charW = Math.max(0.6, (l.x1 - l.x0) / chars);
      const cjkCount = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
      // 标题判定：① 字号明显大于正文（且不長） ② 命中老引擎的章节标题规则
      // （M1 的 isHeadingLine 已排除「第二章的内容其实还有一句话」这类陷阱行，直接复用）
      const isHeading = (l.h >= bodyH * 1.16 && chars <= 60) ||
        (chars <= 60 && BookImporter._internal.isHeadingLine(text));
      // 中文排版惯例：段首缩进 2 个全角空格（缩进是字符，x 坐标看不出来）
      const rawIndent = /^[\u3000\s]{2,}\S/.test(l.text) || /^\u3000/.test(l.text);

      let brk = false;
      if (!prev || !buf) brk = true;
      else {
        const gap = prev.y - l.y;
        const prevHyphen = /[A-Za-z]-\s*$/.test(prev.text);   // 英文断词：行尾连字符 → 绝不能断段
        const gapBreak = gap > Math.max(lineGap * 1.6, bodyH * 0.95);
        const indentBreak = rawIndent || (l.x0 - bodyLeft > Math.max(charW * 1.1, 3));
        // 中文段落末行往往也接近满行，阈值给宽松些；西文则看末行是否明显短
        // 西文额外要求「句末标点或下一行大写开头」：行尾差几个字放不下一个单词 ≠ 段落结束
        const slack = bodyRight - prev.x1;
        const prevCjk = (prev.text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g) || []).length >= 2;
        const prevEndsSentence = /[.!?。！？…]["'”’)\]]?$/.test(prev.text.trim());
        const nextStartsUpper = /^[A-Z0-9“"'(]/.test(text);
        const prevShort = slack > (prevCjk ? Math.max(charW * 4, 14) : Math.max(charW * 2.5, 8));
        const shortBreak = prevShort && (prevCjk || prevEndsSentence || nextStartsUpper);
        const sentenceBreak = /[.!?:]["'”)]?$/.test(prev.text) && nextStartsUpper;
        brk = gapBreak || (!prevHyphen && (indentBreak || shortBreak || sentenceBreak)) || (isHeading !== buf.isHeading);
      }
      if (brk) flush();

      if (!buf) {
        buf = { text: text, top: l.y, bottom: l.y, maxH: l.h, isHeading: isHeading };
        continue;
      }
      // 拼接行：英文连字符断词还原，中文行尾直接连
      const a = buf.text.replace(/\s+$/, '');
      const b = text.replace(/^\s+/, '');
      if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) {
        buf.text = a.slice(0, -1) + b;
      } else if (isCjkChar(a.charAt(a.length - 1)) && isCjkChar(b.charAt(0))) {
        buf.text = a + b;
      } else {
        buf.text = a + (a === '' ? '' : ' ') + b;
      }
      buf.bottom = l.y;
      buf.maxH = Math.max(buf.maxH, l.h);
      if (isHeading) buf.isHeading = true;
    }
    flush();
    return { paragraphs: paragraphs };
  }

  /** 抽掉页眉页脚（跨页重复出现的首行/末行）与孤立页码 */
  function stripRunningHeads(pages) {
    const counts = new Map();
    const firstLast = [];
    pages.forEach(function (pg) {
      const pa = pg.paragraphs;
      if (!pa.length) { firstLast.push([]); return; }
      const idxs = pa.length >= 2 ? [0, pa.length - 1] : [0];
      idxs.forEach(function (i) {
        const key = pa[i].text.replace(/\d+/g, '#').slice(0, 60);
        if (key.length > 2) counts.set(key, (counts.get(key) || 0) + 1);
      });
      firstLast.push(idxs);
    });
    const threshold = Math.max(3, Math.ceil(pages.length * 0.25));
    pages.forEach(function (pg, pi) {
      const idxs = firstLast[pi] || [];
      const keep = [];
      pg.paragraphs.forEach(function (p, i) {
        const isEdge = idxs.indexOf(i) >= 0;
        const key = p.text.replace(/\d+/g, '#').slice(0, 60);
        const repeated = counts.get(key) >= threshold && p.text.length <= 60;
        if (isEdge && PAGE_NUM_RE.test(p.text)) return;              // 孤立页码
        if (isEdge && repeated && !isLooksLikeHeading(p)) return;    // 重复页眉页脚
        if (ORNAMENT_RE.test(p.text)) return;
        keep.push(p);
      });
      pg.paragraphs = keep;
    });
  }

  function isLooksLikeHeading(p) {
    const t = p.text;
    return /^[\s·•#]*第\s*[0-9零〇一二三四五六七八九十百千万两]{1,12}\s*[章回卷節节篇部集話话折]/.test(t) ||
      /^\s*(?:Chapter|CHAPTER|Part|PART|Book|BOOK)\s+[0-9IVXLC]/i.test(t);
  }

  // ====== 主流程 ======
  async function parseBuffer(buf, meta, opts) {
    opts = opts || {};
    const progress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const sourceName = (meta && meta.sourceName) || '';
    const fingerprint = (meta && meta.fingerprint) || '';

    if (buf.byteLength > MAX_BYTES) throw pdfError('PDF_TOO_LARGE');

    const lib = await loadLib();
    try {
      lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(WORKER_PATH);
    } catch (e) { /* 非扩展环境（自测台）忽略 */ }

    let doc;
    try {
      doc = await lib.getDocument({
        data: new Uint8Array(buf),
        cMapUrl: safeUrl(CMAP_PATH),
        cMapPacked: true,
        standardFontDataUrl: safeUrl(FONT_PATH),
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
      }).promise;
    } catch (e) {
      const name = e && e.name;
      if (name === 'PasswordException') throw pdfError('PDF_ENCRYPTED');
      if (name === 'InvalidPDFException') throw pdfError('PDF_INVALID');
      throw pdfError('PDF_INVALID', (e && e.message) || '');
    }

    let info = {};
    try { info = (await doc.getMetadata()).info || {}; } catch (e) { info = {}; }

    const pages = [];
    const pageLines = [];
    const total = doc.numPages;
    for (let i = 1; i <= total; i++) {
      progress(i - 1, total);
      let textContent = null;
      try {
        const page = await doc.getPage(i);
        textContent = await page.getTextContent();
        if (page.cleanup) page.cleanup();
      } catch (e) {
        textContent = null;
      }
      pageLines.push(textContent ? buildLines(textContent) : []);
    }
    progress(total, total);
    try { doc.destroy(); } catch (e) { /* noop */ }

    const stats = docGeometry(pageLines);
    pageLines.forEach(function (lines, idx) {
      const res = linesToParagraphs(lines, stats);
      pages.push({ index: idx + 1, paragraphs: res.paragraphs || [] });
    });

    stripRunningHeads(pages);

    // ---- 摊平成 M1 文本（标题加 # 前缀），完全复用书稿切章引擎 ----
    const blocks = [];
    pages.forEach(function (pg) {
      pg.paragraphs.forEach(function (p) {
        const text = stripRefs(stripControls(p.text)).replace(/\s{2,}/g, ' ').trim();
        if (!text) return;
        if (p.isHeading) { blocks.push({ text: text, heading: true, page: pg.index }); return; }
        // 一整页挤成一个段落的 PDF 很常见：按句子炸开，否则排版与翻译队列都会被拖垮
        BookImporter._internal.explodeParagraphs([text]).forEach(function (piece) {
          const t = piece.trim();
          if (t) blocks.push({ text: t, heading: false, page: pg.index });
        });
      });
    });

    const totalChars = blocks.reduce(function (s, b) { return s + b.text.replace(/\s+/g, '').length; }, 0);
    if (totalChars < 100 || (total >= 3 && totalChars / total < 15)) {
      throw pdfError('PDF_NO_TEXT', String(total));
    }

    const flat = blocks.map(function (b) { return b.heading ? '# ' + b.text : b.text; }).join('\n\n');
    const parts = BookImporter._internal.splitChapters(flat, {});
    let chapters = (parts && parts.chapters) || [];

    // 无任何章节标记时：按页分组（每章约 4000 字），保证每章体量温和
    if (chapters.length <= 1) {
      const byPage = new Map();
      blocks.forEach(function (b) {
        const arr = byPage.get(b.page) || [];
        arr.push(b.text);
        byPage.set(b.page, arr);
      });
      const pageKeys = Array.from(byPage.keys()).sort(function (a, b) { return a - b; });
      const out = [];
      let bucket = [];
      let size = 0;
      pageKeys.forEach(function (k) {
        const text = (byPage.get(k) || []).join('\n\n');
        if (!text.trim()) return;
        bucket.push(text);
        size += text.replace(/\s/g, '').length;
        if (size >= 4000) {
          const paras = BookImporter._internal.splitParagraphs(bucket.join('\n\n'));
          if (paras.length) out.push({ title: '', auto: true, paragraphs: paras, charCount: paras.join('').replace(/\s+/g, '').length });
          bucket = [];
          size = 0;
        }
      });
      if (bucket.length) {
        const paras = BookImporter._internal.splitParagraphs(bucket.join('\n\n'));
        if (paras.length) out.push({ title: '', auto: true, paragraphs: paras, charCount: paras.join('').replace(/\s+/g, '').length });
      }
      if (out.length >= chapters.length) chapters = out;
    }

    chapters = chapters.filter(function (c) { return c && c.paragraphs && c.paragraphs.length; });
    if (!chapters.length) throw pdfError('PDF_NO_TEXT', String(total));

    const metaTitle = String(info.Title || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const title = (metaTitle && metaTitle.length >= 2 && metaTitle.length <= 120 ? metaTitle : '') ||
      ((sourceName || '').replace(/\.[^.]+$/, '').trim()) || 'Untitled';

    return {
      format: 'pdf',
      sourceName: sourceName,
      fingerprint: fingerprint,
      encoding: 'PDF',
      title: title,
      author: String(info.Author || '').slice(0, 80),
      pageCount: total,
      charCount: chapters.reduce(function (s, c) { return s + c.charCount; }, 0),
      chapters: chapters,
    };
  }

  function safeUrl(path) {
    try { return chrome.runtime.getURL(path); } catch (e) { return path; }
  }

  return {
    parseBuffer: parseBuffer,
    loadLib: loadLib,
    _internal: { buildLines, linesToParagraphs, docGeometry, stripRunningHeads, cleanLineText, normalizeGlyphs, joinItems },
  };
})();
