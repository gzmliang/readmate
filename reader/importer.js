// ReadMate / 读伴 — 书稿解析器 (Book Importer)
// M1: txt / md（自动识别 UTF-8 / GBK / UTF-16，自动切章节）
// M2: epub（reader/epub.js + reader/zip-reader.js，零依赖原生解压）
// M3: PDF 文字层（reader/pdf-book.js，内置 pdf.js，扫描版/加密版明确报错）
//
// 三个格式共用同一套输出结构与切章引擎（splitChapters），书页完全无需区分格式。
//
// 输出统一结构（不含任何 UI 文案，界面文字一律由 reader.js 走 i18n 渲染）：
// {
//   title, author, encoding, fingerprint, sourceName, charCount, format,
//   chapters: [ { title, auto, charCount, paragraphs: [string] } ]
// }

const BookImporter = (() => {
  'use strict';

  const TEXT_EXTS = ['txt', 'text', 'md', 'markdown', 'log'];
  const EPUB_EXTS = ['epub'];
  const PDF_EXTS = ['pdf'];
  const SUPPORTED_EXTS = TEXT_EXTS.concat(EPUB_EXTS, PDF_EXTS);
  // 已明确支持之外的扩展名（保留给未来的格式）
  const PLANNED_EXTS = [];

  // ====== 章节标题识别 ======
  const CN_NUM = '0-9零〇一二三四五六七八九十百千万两';
  const HEAD_PATTERNS = [
    // 第一章 / 第 1 回 / 卷三 / 第十二节 / 第三篇
    new RegExp('^\\s*第\\s*[' + CN_NUM + ']{1,12}\\s*[章回卷節节篇部集話话折]'),
    // Chapter 7 / CHAPTER VII
    /^\s*(?:Chapter|CHAPTER|Chapitre)\s+[0-9IVXLCivxlc]+/,
    // PART TWO / BOOK I / SECTION 3
    /^\s*(?:PART|Part|BOOK|Book|SECTION|Section)\s+(?:[0-9]+|[IVXLC]+|[A-Za-z]+)\s*$/,
    // Markdown 标题
    /^\s*#{1,4}\s*\S/,
    // 中文单行篇名
    /^\s*(?:序|序言|自序|代序|前言|引子|楔子|尾声|终章|后记|跋|附录|番外|外传|目录)\s*$/,
    // 西文单行篇名
    /^\s*(?:Prologue|Epilogue|Preface|Foreword|Afterword|Introduction|Appendix|Contents)\s*[:：]?\s*$/i,
  ];

  // 行尾出现这些标点，基本可以判定是正文而不是标题
  const SENTENCE_END = /[。！？；…]$/;
  const MID_SENTENCE = /[。！？；，、]/;

  function isHeadingLine(line) {
    const raw = line.replace(/\r$/, '');
    const t = raw.trim();
    if (!t) return false;
    // 标题行不会太长（中文标题 30 字以内、西文 80 字符以内）
    if (t.length > 80) return false;
    if (SENTENCE_END.test(t)) return false;

    let matched = false;
    for (const re of HEAD_PATTERNS) {
      if (re.test(t)) { matched = true; break; }
    }
    if (!matched) return false;

    // 「第一章 的内容其实很长」这类正文误判防护：
    // 去掉章回标记后剩下的部分不能是长句，也不能夹带句读标点
    const rest = t
      .replace(/^\s*第\s*[0-9零〇一二三四五六七八九十百千万两]{1,12}\s*[章回卷節节篇部集話话折]\s*/, '')
      .replace(/^\s*#{1,4}\s*/, '')
      .replace(/^\s*(?:Chapter|CHAPTER|Chapitre|PART|Part|BOOK|Book|SECTION|Section)\s+[0-9IVXLCivxlc]+\s*/, '');
    if (rest.length > 40) return false;
    if (MID_SENTENCE.test(rest)) return false;

    return true;
  }

  function cleanHeadingText(line) {
    return line
      .replace(/\r$/, '')
      .replace(/^\s*#{1,4}\s*/, '')
      .replace(/\s+$/, '')
      .trim();
  }

  // ====== 段落切分 ======
  const ORNAMENT_LINE = /^[\s*\-_=~·•※◆◇✦✧#|]{1,12}$/;

  function isCjkDominant(s) {
    const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    if (cjk === 0 && latin === 0) return true;
    return cjk >= latin;
  }

  /** 把一段原始文本块整理成一段可朗读正文 */
  function normalizeBlock(block) {
    const lines = block.split('\n').map(l => l.replace(/\r$/, '').trim()).filter(l => l !== '');
    if (lines.length === 0) return '';
    let text;
    if (lines.length === 1) {
      text = lines[0];
    } else if (isCjkDominant(lines.join(''))) {
      // 中文换行通常是硬折行，直接拼接（不加空格）
      text = lines.join('');
    } else {
      text = lines.join(' ');
    }
    // 去掉中文 txt 常见的全角缩进（缩进交给 CSS 控制）
    text = text.replace(/^[\u3000\s]+/, '').replace(/[\u3000\s]+$/, '');
    // 折叠重复空格
    text = text.replace(/[ \t]{2,}/g, ' ');
    return text;
  }

  function splitParagraphs(text) {
    const blocks = text.split(/\n{2,}/);
    const out = [];
    for (const b of blocks) {
      if (!b || !b.trim()) continue;
      const single = b.split('\n').length === 1 ? b.trim() : '';
      if (single && ORNAMENT_LINE.test(single)) continue;
      const norm = normalizeBlock(b);
      if (!norm) continue;
      if (ORNAMENT_LINE.test(norm)) continue;
      out.push(norm);
    }
    return out;
  }

  // ====== 超长段落拆解（epub / PDF 共用：抓取来的「一整页一个段落」不能直接进排版） ======
  const PARA_SOFT_LIMIT = 4000;     // 单个段落超过这个长度就按句子切开
  const PARA_SPLIT_TARGET = 2000;   // 切开后每段的目标长度

  function explodeParagraphs(paras) {
    const out = [];
    const push = function (piece) {
      if (!piece) return;
      if (piece.length <= PARA_SOFT_LIMIT) { out.push(piece); return; }
      // 整段没有任何句末标点（OCR 渣、无标点长文）→ 硬切，否则排版与翻译队列会被拖垮
      for (let i = 0; i < piece.length; i += PARA_SPLIT_TARGET) out.push(piece.slice(i, i + PARA_SPLIT_TARGET));
    };
    (paras || []).forEach(function (p) {
      const text = String(p || '');
      if (!text) return;
      if (text.length <= PARA_SOFT_LIMIT) { out.push(text); return; }
      let buf = '';
      // 先按句末标点切（保留标点），攒够目标长度就落一段
      text.split(/(?<=[。！？；…”」』!?;.])/).forEach(function (s) {
        if (!s) return;
        if (buf && (buf.length + s.length) > PARA_SPLIT_TARGET) { push(buf); buf = ''; }
        buf += s;
      });
      push(buf);
    });
    return out;
  }

  function countChars(paras) {
    return paras.join('').replace(/\s+/g, '').length;
  }

  // ====== 书名 / 作者（尽力而为的启发式） ======
  function guessMeta(frontLines, fileName) {
    let title = '';
    let author = '';

    for (const line of frontLines) {
      const t = line.trim();
      if (!t) continue;
      let m = t.match(/^(?:作者|著者|著|Author|By)\s*[:：]\s*(.+)$/i);
      if (m && !author) { author = m[1].trim().slice(0, 60); continue; }
      m = t.match(/^(?:书名|标题|Title)\s*[:：]\s*(.+)$/i);
      if (m && !title) { title = m[1].trim().slice(0, 80); continue; }
    }

    if (!title) {
      for (const line of frontLines) {
        const t = line.trim();
        if (!t) continue;
        if (t.length > 40) break;
        if (isHeadingLine(t)) break;
        if (/^(?:作者|著者|Author|By)\s*[:：]/i.test(t)) continue;
        title = t;
        break;
      }
    }

    if (!title) {
      title = (fileName || '').replace(/\.[^.]+$/, '').trim() || 'Untitled';
    }
    return { title, author };
  }

  // ====== 章节切分 ======
  function splitChapters(text, meta) {
    const lines = text.split('\n');
    const chapters = [];
    let cur = { title: '', auto: false, lines: [] };
    const frontLines = [];
    let seenHeading = false;

    for (const line of lines) {
      if (isHeadingLine(line)) {
        // 收尾上一章
        if (!seenHeading) {
          // 首个标题之前的内容 = 卷首/前言
          const frontParas = splitParagraphs(cur.lines.join('\n'));
          if (countChars(frontParas) > 300) {
            chapters.push({ title: '', auto: true, paragraphs: frontParas, charCount: countChars(frontParas) });
          } else {
            frontLines.push(...cur.lines);
          }
          seenHeading = true;
        } else {
          const paras = splitParagraphs(cur.lines.join('\n'));
          if (paras.length > 0) {
            chapters.push({ title: cur.title, auto: cur.auto, paragraphs: paras, charCount: countChars(paras) });
          }
        }
        cur = { title: cleanHeadingText(line), auto: false, lines: [] };
        continue;
      }
      cur.lines.push(line);
      if (!seenHeading && frontLines.length < 30) frontLines.push(line);
    }

    // 最后一章
    const lastParas = splitParagraphs(cur.lines.join('\n'));
    if (lastParas.length > 0) {
      if (!seenHeading) {
        chapters.push({ title: '', auto: true, paragraphs: lastParas, charCount: countChars(lastParas) });
      } else {
        chapters.push({ title: cur.title, auto: cur.auto, paragraphs: lastParas, charCount: countChars(lastParas) });
      }
    }

    // 若无任何章节标记：长文按体量切分成「节」，避免一章几万字
    if (chapters.length <= 1) {
      const allParas = chapters.length === 1 ? chapters[0].paragraphs : [];
      if (allParas.length > 0 && countChars(allParas) > 8000) {
        const SECTIONS = [];
        let bucket = [];
        let bucketChars = 0;
        for (const p of allParas) {
          bucket.push(p);
          bucketChars += p.length;
          if (bucketChars >= 5000) {
            SECTIONS.push({ title: '', auto: true, paragraphs: bucket, charCount: countChars(bucket) });
            bucket = [];
            bucketChars = 0;
          }
        }
        if (bucket.length) SECTIONS.push({ title: '', auto: true, paragraphs: bucket, charCount: countChars(bucket) });
        return { chapters: SECTIONS, frontLines };
      }
      return { chapters, frontLines };
    }

    // 清理：丢掉空章节
    return { chapters: chapters.filter(c => c.paragraphs.length > 0), frontLines };
  }

  // ====== 编码识别 ======
  function decodeBuffer(buf) {
    const bytes = new Uint8Array(buf);

    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(buf), encoding: 'UTF-8 (BOM)' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'UTF-16LE' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'UTF-16BE' };
    }

    // 先按严格 UTF-8 试解，失败就按 GBK
    let utf8Text = null;
    try {
      utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      utf8Text = null;
    }

    if (utf8Text !== null) {
      return { text: utf8Text, encoding: 'UTF-8' };
    }

    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      return { text: gbk, encoding: 'GBK/GB18030' };
    } catch (e) {
      // 最后的兜底：非严格 UTF-8（替换坏字节）
      return { text: new TextDecoder('utf-8').decode(buf), encoding: 'UTF-8 (lossy)' };
    }
  }

  // ====== 指纹（用于记住阅读进度；只存指纹不存书稿） ======
  function makeFingerprint(name, size, lastModified) {
    const raw = `${name}|${size}|${lastModified}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0;
      h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + c * (i + 7)) >>> 0;
    }
    return `${h1.toString(36)}${h2.toString(36)}`;
  }

  // ====== 组装一本书 ======
  function buildBook(text, meta) {
    const { chapters, frontLines } = splitChapters(text, meta);
    const guessed = guessMeta(frontLines, meta.sourceName);
    const title = (meta.title || '').trim() || guessed.title;
    const author = (meta.author || '').trim() || guessed.author;
    const charCount = chapters.reduce((sum, c) => sum + c.charCount, 0);
    return {
      format: meta.format || 'txt',
      sourceName: meta.sourceName || '',
      fingerprint: meta.fingerprint || '',
      encoding: meta.encoding || '',
      title,
      author,
      charCount,
      chapters,
    };
  }

  function formatOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function isSupported(name) {
    const ext = formatOf(name);
    return SUPPORTED_EXTS.includes(ext);
  }

  function isPlanned(name) {
    return PLANNED_EXTS.includes(formatOf(name));
  }

  /** 解析 ArrayBuffer（txt / md） */
  function parseBuffer(buf, meta) {
    const { text, encoding } = decodeBuffer(buf);
    const cleaned = text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
    return buildBook(cleaned, Object.assign({}, meta, { encoding }));
  }

  /**
   * 解析 File 对象（txt / md / epub / pdf）
   * @param file File
   * @param opts { onProgress(done, total) 解析进度，可选 }
   */
  async function parseFile(file, opts) {
    const name = file.name || '';
    const ext = formatOf(name);
    const supported = SUPPORTED_EXTS.includes(ext) || PLANNED_EXTS.includes(ext);
    if (!supported) {
      const err = new Error('FORMAT_UNSUPPORTED');
      err.code = 'FORMAT_UNSUPPORTED';
      err.ext = ext;
      throw err;
    }
    const buf = await file.arrayBuffer();
    const meta = {
      sourceName: name,
      format: ext,
      fingerprint: makeFingerprint(name, file.size, file.lastModified),
    };
    if (EPUB_EXTS.includes(ext)) {
      if (typeof BookEpub === 'undefined') throw missingModule('BookEpub');
      return BookEpub.parseBuffer(buf, meta, opts);
    }
    if (PDF_EXTS.includes(ext)) {
      if (typeof BookPdf === 'undefined') throw missingModule('BookPdf');
      return BookPdf.parseBuffer(buf, meta, opts);
    }
    return parseBuffer(buf, meta);
  }

  /**
   * 按文件内容嗅探格式：远程书稿链接常常没有扩展名
   * （例如 arXiv 的 /pdf/2301.00001、网盘直链）
   */
  function sniffFormat(buf, name) {
    const ext = formatOf(name);
    if (ext && SUPPORTED_EXTS.includes(ext)) return ext;
    const b = new Uint8Array(buf.slice(0, 4));
    if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';  // %PDF
    if (b.length >= 2 && b[0] === 0x50 && b[1] === 0x4B) return 'epub';   // PK\x03\x04 → zip（epub 本体就是 zip）
    return ext;
  }

  function missingModule(name) {
    const err = new Error('IMPORTER_MODULE_MISSING: ' + name);
    err.code = 'IMPORTER_MODULE_MISSING';
    return err;
  }

  function parseText(text, meta) {
    return buildBook(String(text || '').replace(/\r\n?/g, '\n'), meta || {});
  }

  return {
    TEXT_EXTS,
    EPUB_EXTS,
    PDF_EXTS,
    SUPPORTED_EXTS,
    PLANNED_EXTS,
    formatOf,
    sniffFormat,
    isSupported,
    isPlanned,
    parseFile,
    parseBuffer,
    parseText,
    makeFingerprint,
    decodeBuffer,
    // 供自测台直接调用
    _internal: { isHeadingLine, splitChapters, splitParagraphs, guessMeta, explodeParagraphs },
  };
})();
