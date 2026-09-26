// ReadMate / 读伴 — EPUB 书稿解析器（M2）
//
// 目标：把 epub（EPUB 2 / EPUB 3）读成与 txt 完全一致的「书」结构，
//       交给 M1 已经调好的书页（排版 / 朗读 / 双语 / 导出）复用，一行不改老引擎。
//
// 设计要点：
//   1. 零依赖：用 reader/zip-reader.js 原生解压，不引 jszip 等第三方库
//   2. 只取正文文字：脚本 / 样式 / 图片 / 目录页 / 脚注角标一律不读出声
//   3. 章节目录优先：先按 epub 自带 TOC（EPUB3 nav / EPUB2 ncx）切章，
//      再套用 M1 的 splitChapters 做二次细分（部分 epub 只有「卷」级目录）
//   4. 本文件不含任何界面文案，报错只给错误码（由 reader.js 走 i18n 提示）
//
// 错误码：EPUB_INVALID / EPUB_DRM / EPUB_NO_TEXT / ZIP_BAD / ZIP_NO_DEFLATE ...

const BookEpub = (() => {
  'use strict';

  const READER_NS = 'http://www.idpf.org/2007/ops';
  const XHTML_TYPES = ['application/xhtml+xml', 'text/html', 'application/html+xml', 'application/x-dtbook+xml'];
  // 整本 epub 切成超过这个体量就再分段（防止一章几万字拖垮排版与翻译队列）
  const MAX_CHAPTER_CHARS = 20000;
  const SPLIT_TARGET_CHARS = 10000;
  const MERGE_MIN_CHARS = 220;   // 小于这个体量的独立文件合并进相邻章节

  function epubError(code, detail) {
    const e = new Error(code + (detail ? ': ' + detail : ''));
    e.code = code;
    if (detail) e.detail = detail;
    return e;
  }

  // ====== 路径处理（epub 里的 href 有相对路径、百分号编码、锚点） ======
  function decodeHref(href) {
    let h = String(href || '').trim();
    const hash = h.indexOf('#');
    let frag = '';
    if (hash >= 0) { frag = h.slice(hash + 1); h = h.slice(0, hash); }
    try { h = decodeURIComponent(h); } catch (e) { /* 有些书里是非法编码，保持原样 */ }
    try { frag = decodeURIComponent(frag); } catch (e) { /* 同上 */ }
    return { path: h, fragment: frag };
  }

  function normalizePath(p) {
    const out = [];
    String(p || '').split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') { out.pop(); return; }
      out.push(seg);
    });
    return out.join('/');
  }

  function resolvePath(baseDir, href) {
    const raw = decodeHref(href).path;
    if (!raw) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return raw;   // 远程资源，忽略
    return normalizePath(baseDir ? baseDir + '/' + raw : raw);
  }

  function dirOf(p) {
    const i = String(p || '').lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  }

  // ====== XML / HTML 解析 ======
  function parseMarkup(text, mime) {
    const parser = new DOMParser();
    if (mime === 'text/html') {
      const h = parser.parseFromString(text, 'text/html');
      if (h) return h;
    }
    const doc = parser.parseFromString(text, 'application/xhtml+xml');
    if (doc && !doc.getElementsByTagName('parsererror').length) return doc;
    // 有些 epub 的 xhtml 并不严格合法：退回宽松的 HTML 解析
    return parser.parseFromString(text, 'text/html');
  }

  function tagList(root, localName) {
    if (!root) return [];
    return Array.prototype.slice.call(root.getElementsByTagNameNS('*', localName)).concat(
      // getElementsByTagNameNS('*',...) 对无命名空间的 HTML 文档同样有效，
      // 但个别解析路径下需要补一次普通查找
      Array.prototype.slice.call(root.getElementsByTagName(localName)).filter(function (el) {
        return !el.namespaceURI || el.namespaceURI.indexOf('xhtml') >= 0 || el.namespaceURI.indexOf('html') >= 0;
      })
    ).filter(function (el, i, arr) { return arr.indexOf(el) === i; });
  }

  function firstTag(root, localName) {
    const list = tagList(root, localName);
    return list.length ? list[0] : null;
  }

  function attrNS(el, prefix, localName) {
    if (!el || !el.getAttribute) return '';
    return el.getAttribute(prefix + ':' + localName) ||
      el.getAttributeNS(READER_NS, localName) ||
      el.getAttribute(localName) || '';
  }

  // ====== 正文提取 ======
  // rt / rp = 注音（拼音）标注。注音绘本里每个字都挂一段拼音，
  // 拼进正文会变成「列liè那nà狐hú」，既不美观也会被朗读引擎当字母念出来。
  const INLINE_SKIP = { script: 1, style: 1, title: 1, meta: 1, link: 1, head: 1, noscript: 1, svg: 1, iframe: 1, audio: 1, video: 1, nav: 1, template: 1, rt: 1, rp: 1 };
  const PARA_TAGS = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, pre: 1, figcaption: 1, dd: 1, dt: 1, caption: 1, address: 1 };
  const CONTAINER_TAGS = { body: 1, div: 1, section: 1, article: 1, main: 1, aside: 1, header: 1, footer: 1, blockquote: 1, li: 1, ul: 1, ol: 1, dl: 1, table: 1, tbody: 1, thead: 1, tfoot: 1, tr: 1, td: 1, th: 1, figure: 1, center: 1, form: 1, fieldset: 1 };
  const HEADING_TAGS = { h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1 };

  function inlineText(node) {
    // 把一段内联内容拼成纯文本：<br> 当换行，脚注角标丢掉
    let out = '';
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.nodeType === 3) { out += k.nodeValue; continue; }
      if (k.nodeType !== 1) continue;
      const tag = (k.localName || k.nodeName || '').toLowerCase();
      if (INLINE_SKIP[tag]) continue;
      if (tag === 'br') { out += '\n'; continue; }
      if (tag === 'img') { continue; }
      if (tag === 'a') {
        const href = k.getAttribute('href') || '';
        const t = (k.textContent || '').trim();
        // 脚注回链：<a href="#fn1">1</a>，念出来只是噪音
        if (/^#/.test(href) && t.length <= 8 && /^[\d\s*†‡§¶]+$/.test(t)) continue;
        out += inlineText(k);
        continue;
      }
      if (tag === 'sup' || tag === 'sub') {
        const t = (k.textContent || '').trim();
        // 纯数字角标（[1] / 1 / 1,2）不读
        if (t.length <= 6 && /^[\d\s,，、\-–—.\[\]()]+$/.test(t)) continue;
      }
      out += inlineText(k);
    }
    return out;
  }

  /** 把一个正文文档拆成 [{text, heading, anchor}] */
  function collectBlocks(doc) {
    const body = firstTag(doc, 'body') || doc.documentElement;
    const blocks = [];
    let anchor = '';

    function push(raw, heading) {
      const text = String(raw || '').replace(/[\u00a0\u3000]/g, ' ').replace(/[ \t\r]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
      if (!text) return;
      blocks.push({ text: text, heading: !!heading, anchor: anchor });
    }

    function walk(el) {
      const kids = el.childNodes || [];
      let buf = '';
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (k.nodeType === 3) { buf += k.nodeValue; continue; }
        if (k.nodeType !== 1) continue;
        const tag = (k.localName || k.nodeName || '').toLowerCase();
        if (INLINE_SKIP[tag]) continue;
        if (k.getAttribute && k.getAttribute('id')) anchor = k.getAttribute('id');
        if (k.getAttribute && k.getAttribute('name') && tag === 'a') anchor = k.getAttribute('name');
        if (PARA_TAGS[tag]) {
          if (buf.trim()) { push(buf, false); buf = ''; }
          push(inlineText(k), !!HEADING_TAGS[tag]);
          continue;
        }
        if (CONTAINER_TAGS[tag]) {
          if (buf.trim()) { push(buf, false); buf = ''; }
          walk(k);
          continue;
        }
        buf += inlineText(k);
      }
      if (buf.trim()) push(buf, false);
    }

    walk(body);

    const anchors = new Map();
    blocks.forEach(function (b, i) { if (b.anchor && !anchors.has(b.anchor)) anchors.set(b.anchor, i); });
    return { blocks: blocks, anchors: anchors };
  }

  // ====== container.xml / OPF ======
  async function readOpfPath(zip) {
    const xml = await zip.readText('META-INF/container.xml');
    if (!xml) throw epubError('EPUB_INVALID', 'no container.xml');
    const doc = parseMarkup(xml, 'application/xml');
    const rootfiles = tagList(doc, 'rootfile');
    for (let i = 0; i < rootfiles.length; i++) {
      const p = rootfiles[i].getAttribute('full-path');
      if (p) return normalizePath(p);
    }
    throw epubError('EPUB_INVALID', 'no rootfile');
  }

  function parseOpf(opfText, opfPath) {
    const doc = parseMarkup(opfText, 'application/xml');
    const opfDir = dirOf(opfPath);

    const titleEl = firstTag(doc, 'title');
    const creatorEl = firstTag(doc, 'creator');
    const langEl = firstTag(doc, 'language');

    const manifest = {};
    tagList(doc, 'item').forEach(function (el) {
      const id = el.getAttribute('id');
      const href = el.getAttribute('href');
      if (!id || !href) return;
      manifest[id] = {
        id: id,
        href: resolvePath(opfDir, href),
        mediaType: (el.getAttribute('media-type') || '').toLowerCase(),
        properties: (el.getAttribute('properties') || '').toLowerCase(),
      };
    });

    const spineEl = firstTag(doc, 'spine');
    const spine = [];
    if (spineEl) {
      tagList(spineEl, 'itemref').forEach(function (el) {
        const idref = el.getAttribute('idref');
        if (!idref || !manifest[idref]) return;
        spine.push({ item: manifest[idref], linear: (el.getAttribute('linear') || 'yes').toLowerCase() !== 'no' });
      });
    }

    const tocId = spineEl ? spineEl.getAttribute('toc') : '';
    return {
      title: titleEl ? (titleEl.textContent || '').trim() : '',
      author: creatorEl ? (creatorEl.textContent || '').trim() : '',
      language: langEl ? (langEl.textContent || '').trim() : '',
      version: (firstTag(doc, 'package') && firstTag(doc, 'package').getAttribute('version')) || '',
      manifest: manifest,
      spine: spine,
      tocId: tocId,
      opfDir: opfDir,
    };
  }

  // ====== 目录（EPUB3 nav / EPUB2 ncx） ======
  async function readNavToc(zip, navItem) {
    const text = await zip.readText(navItem.href);
    if (!text) return [];
    const doc = parseMarkup(text, 'application/xhtml+xml');
    const navs = tagList(doc, 'nav');
    let nav = null;
    for (let i = 0; i < navs.length; i++) {
      if (attrNS(navs[i], 'epub', 'type') === 'toc') { nav = navs[i]; break; }
    }
    if (!nav) nav = navs.length ? navs[0] : firstTag(doc, 'ol') ? doc.documentElement : null;
    if (!nav) return [];
    const out = [];
    const baseDir = dirOf(navItem.href);

    function walkList(listEl, level) {
      const lis = Array.prototype.slice.call(listEl.children || []).filter(function (c) {
        return (c.localName || '').toLowerCase() === 'li';
      });
      lis.forEach(function (li) {
        let link = null;
        const kids = Array.prototype.slice.call(li.children || []);
        for (let i = 0; i < kids.length; i++) {
          const t = (kids[i].localName || '').toLowerCase();
          if (t === 'a' || t === 'span') { link = kids[i]; break; }
        }
        const label = link ? (link.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const href = link ? (link.getAttribute('href') || '') : '';
        if (label || href) {
          const resolved = resolvePath(baseDir, href);
          const frag = decodeHref(href).fragment;
          out.push({ title: label, path: resolved, fragment: frag, level: level });
        }
        kids.forEach(function (c) {
          if ((c.localName || '').toLowerCase() === 'ol') walkList(c, level + 1);
        });
      });
    }

    const firstOl = nav.querySelector ? nav.querySelector('ol') : null;
    if (firstOl) walkList(firstOl, 0);
    return out;
  }

  async function readNcxToc(zip, ncxItem) {
    const text = await zip.readText(ncxItem.href);
    if (!text) return [];
    const doc = parseMarkup(text, 'application/xml');
    const baseDir = dirOf(ncxItem.href);
    const out = [];
    const navMap = firstTag(doc, 'navMap');
    if (!navMap) return out;

    function walkPoints(container, level) {
      const points = Array.prototype.slice.call(container.children || []).filter(function (c) {
        return (c.localName || '').toLowerCase() === 'navpoint';
      });
      if (!points.length) {
        // 某些书里 navPoint 直接挂在 navMap 下但解析器给了 namespace，兜底用 tagList
        tagList(container, 'navPoint').forEach(function (p) { points.push(p); });
      }
      points.forEach(function (p) {
        const labelEl = firstTag(p, 'text');
        const contentEl = tagList(p, 'content').filter(function (c) { return c.getAttribute('src'); })[0];
        const label = labelEl ? (labelEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const src = contentEl ? contentEl.getAttribute('src') : '';
        if (label || src) {
          out.push({
            title: label,
            path: resolvePath(baseDir, src),
            fragment: decodeHref(src).fragment,
            level: level,
          });
        }
        walkPoints(p, level + 1);
      });
    }

    walkPoints(navMap, 0);
    return out;
  }

  async function readToc(zip, opf) {
    // EPUB3：manifest 里有 properties="nav" 的文档
    let navItem = null;
    Object.keys(opf.manifest).forEach(function (id) {
      const it = opf.manifest[id];
      if (!navItem && it.href && it.properties.split(/\s+/).indexOf('nav') >= 0) navItem = it;
    });
    if (navItem) {
      try {
        const toc = await readNavToc(zip, navItem);
        if (toc.length) return { toc: toc, type: 'nav' };
      } catch (e) { /* 坏目录不影响正文，退回 ncx */ }
    }
    // EPUB2：ncx
    let ncxItem = opf.tocId && opf.manifest[opf.tocId] ? opf.manifest[opf.tocId] : null;
    if (!ncxItem) {
      Object.keys(opf.manifest).forEach(function (id) {
        const it = opf.manifest[id];
        if (!ncxItem && it.mediaType === 'application/x-dtbncx+xml') ncxItem = it;
      });
    }
    if (ncxItem) {
      try {
        const toc = await readNcxToc(zip, ncxItem);
        if (toc.length) return { toc: toc, type: 'ncx' };
      } catch (e) { /* 同上 */ }
    }
    return { toc: [], type: 'none' };
  }

  // ====== 章节组装 ======
  function chapterChars(paragraphs) {
    return paragraphs.join('').replace(/\s+/g, '').length;
  }

  /** 给超长章节分段（按段落边界切，标题保持原样，界面仍显示「第 N 章」） */
  function capChapter(ch) {
    const paras = BookImporter._internal.explodeParagraphs(ch.paragraphs);
    if (chapterChars(paras) <= MAX_CHAPTER_CHARS) {
      const single = makeChapter(ch.title, paras, ch.auto);
      return single ? [single] : [];
    }
    const out = [];
    let bucket = [];
    let size = 0;
    paras.forEach(function (p) {
      bucket.push(p);
      size += p.length;
      if (size >= SPLIT_TARGET_CHARS) {
        out.push({ title: ch.title, auto: ch.auto, paragraphs: bucket, charCount: chapterChars(bucket) });
        bucket = [];
        size = 0;
      }
    });
    if (bucket.length) out.push({ title: ch.title, auto: ch.auto, paragraphs: bucket, charCount: chapterChars(bucket) });
    return out;
  }

  function makeChapter(title, paragraphs, auto) {
    const clean = paragraphs.filter(function (p) { return p && p.trim(); });
    if (!clean.length) return null;
    return { title: title || '', auto: !!auto || !title, paragraphs: clean, charCount: chapterChars(clean) };
  }

  /** 把一段 blocks 摊平成 M1 的文本格式（标题加 # 前缀），交给 splitChapters 复用原有切章逻辑 */
  function flatten(blocks) {
    return blocks.map(function (b) { return b.heading ? '# ' + b.text : b.text; }).join('\n\n');
  }

  function splitViaM1(fallbackTitle, blocks) {
    const flat = flatten(blocks);
    if (!flat.trim()) return [];
    const parts = BookImporter._internal.splitChapters(flat, {});
    const list = (parts && parts.chapters) || [];
    if (!list.length) return [];
    return list.map(function (ch, i) {
      const title = ch.title || (i === 0 ? (fallbackTitle || '') : '');
      return makeChapter(title, ch.paragraphs, !ch.title);
    }).filter(Boolean);
  }

  async function parseBuffer(buf, meta, opts) {
    opts = opts || {};
    const progress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const sourceName = (meta && meta.sourceName) || '';
    const fingerprint = (meta && meta.fingerprint) || '';

    const zip = await BookZip.open(buf);

    // DRM 检测：只关心正文是否被加密（字体混淆是正常现象，不算 DRM）
    if (zip.has('META-INF/encryption.xml')) {
      const enc = await zip.readText('META-INF/encryption.xml');
      if (enc && /\.(x?html?|opf|ncx)\b/i.test(enc)) throw epubError('EPUB_DRM');
    }

    const opfPath = await readOpfPath(zip);
    const opfText = await zip.readText(opfPath);
    if (!opfText) throw epubError('EPUB_INVALID', 'opf missing');
    const opf = parseOpf(opfText, opfPath);

    const docs = opf.spine.filter(function (s) {
      if (!s.linear) return false;
      const mt = s.item.mediaType;
      return !mt || XHTML_TYPES.indexOf(mt) >= 0 || /\.x?html?$/i.test(s.item.href);
    });
    if (!docs.length) throw epubError('EPUB_INVALID', 'empty spine');

    const tocInfo = await readToc(zip, opf);

    // ---- 读取每个正文文档并抽出段落 ----
    const loaded = [];
    let blockIndexBase = 0;
    for (let i = 0; i < docs.length; i++) {
      progress(i, docs.length);
      const href = docs[i].item.href;
      let text = null;
      try { text = await zip.readText(href); } catch (e) { text = null; }
      if (!text) continue;
      const doc = parseMarkup(text, docs[i].item.mediaType || 'application/xhtml+xml');
      const collected = collectBlocks(doc);
      loaded.push({
        href: href,
        blocks: collected.blocks,
        anchors: collected.anchors,
        base: blockIndexBase,
      });
      blockIndexBase += collected.blocks.length;
    }
    progress(docs.length, docs.length);

    if (!loaded.length) throw epubError('EPUB_NO_TEXT');

    // 全局段落序列（TOC 锚点定位用）
    const globalBlocks = [];
    const docStartIndex = new Map();
    loaded.forEach(function (d) {
      docStartIndex.set(d.href, globalBlocks.length);
      d.blocks.forEach(function (b) { globalBlocks.push(b); });
    });

    const byHref = new Map();
    loaded.forEach(function (d) { if (!byHref.has(d.href)) byHref.set(d.href, d); });

    // ---- 方案一：按 epub 自带目录切章 ----
    let chapters = [];
    const starts = [];
    tocInfo.toc.forEach(function (e) {
      if (!e.path) return;
      const doc = byHref.get(e.path);
      if (!doc) return;
      const docStart = docStartIndex.get(e.path) || 0;
      let idx = docStart;
      if (e.fragment && doc.anchors.has(e.fragment)) idx = docStart + doc.anchors.get(e.fragment);
      starts.push({ title: e.title, index: idx });
    });

    if (starts.length >= 2) {
      // 目录里可能有多条指向同一处（卷 + 章）：只保留第一条
      const dedup = [];
      starts.forEach(function (s) {
        const last = dedup[dedup.length - 1];
        if (last && last.index === s.index) return;
        dedup.push(s);
      });
      dedup.sort(function (a, b) { return a.index - b.index; });

      // 首个目录项之前的内容（前言 / 版权页）
      if (dedup[0].index > 0) {
        const front = globalBlocks.slice(0, dedup[0].index);
        const frontChs = splitViaM1('', front);
        if (frontChs.length && frontChs[0].charCount > 300) chapters = chapters.concat(frontChs);
      }

      dedup.forEach(function (s, i) {
        const end = i + 1 < dedup.length ? dedup[i + 1].index : globalBlocks.length;
        if (end <= s.index) return;
        const seg = globalBlocks.slice(s.index, end);
        const chs = splitViaM1(s.title, seg);
        if (chs.length) chapters = chapters.concat(chs);
        else {
          const single = makeChapter(s.title, seg.filter(function (b) { return !b.heading; }).map(function (b) { return b.text; }), false);
          if (single) chapters.push(single);
        }
      });
    }

    // ---- 方案二（兜底）：按正文文件切章，小文件合并、大文件按标题细分 ----
    if (chapters.length < 2) {
      const tocTitleByPath = new Map();
      tocInfo.toc.forEach(function (e) { if (e.path && !tocTitleByPath.has(e.path)) tocTitleByPath.set(e.path, e.title); });

      const perDoc = [];
      loaded.forEach(function (d) {
        if (!d.blocks.length) return;
        const fallback = tocTitleByPath.get(d.href) || '';
        const chs = splitViaM1(fallback, d.blocks);
        chs.forEach(function (c) {
          const last = perDoc[perDoc.length - 1];
          if (last && c.charCount < MERGE_MIN_CHARS) {
            last.paragraphs = last.paragraphs.concat(c.paragraphs);
            last.charCount = chapterChars(last.paragraphs);
          } else {
            perDoc.push(c);
          }
        });
      });
      // 开头若是一小段（封面/版权），并入下一章
      if (perDoc.length >= 2 && perDoc[0].charCount < MERGE_MIN_CHARS && !perDoc[0].title) {
        perDoc[1].paragraphs = perDoc[0].paragraphs.concat(perDoc[1].paragraphs);
        perDoc[1].charCount = chapterChars(perDoc[1].paragraphs);
        perDoc.shift();
      }
      if (perDoc.length >= chapters.length) chapters = perDoc;
    }

    // ---- 收尾：分段 / 过滤空章 ----
    const finalChapters = [];
    chapters.forEach(function (ch) {
      if (!ch || !ch.paragraphs.length) return;
      capChapter(ch).forEach(function (c) { finalChapters.push(c); });
    });

    if (!finalChapters.length) throw epubError('EPUB_NO_TEXT');

    const title = (opf.title || '').trim() ||
      ((sourceName || '').replace(/\.[^.]+$/, '').trim()) || 'Untitled';

    return {
      format: 'epub',
      sourceName: sourceName,
      fingerprint: fingerprint,
      encoding: 'EPUB' + (opf.version ? ' ' + opf.version : ''),
      title: title,
      author: (opf.author || '').trim(),
      language: opf.language || '',
      charCount: finalChapters.reduce(function (s, c) { return s + c.charCount; }, 0),
      chapters: finalChapters,
    };
  }

  return {
    parseBuffer: parseBuffer,
    _internal: { collectBlocks, parseOpf, parseMarkup, resolvePath, normalizePath, decodeHref, capChapter },
  };
})();
