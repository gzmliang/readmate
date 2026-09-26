// ReadMate / 读伴 — 读伴书页（Reader Page）M1
// 导入 txt/md → 精美书页排版 → 复用老引擎朗读/双语 → 导出 PDF / 双语 HTML
//
// 设计铁律（与本项目总纲一致）：
//   1. 界面文案 100% 走 i18n 词典（T('key') 引用），本文件不含任何硬编码界面中文
//   2. 一行不改老引擎：朗读/翻译/TTS/划词/生词本/AI 摘要 全部直接复用 content.js 的全局函数
//   3. 只存阅读进度，不存用户书稿（用户选择 4B）
//
// 老引擎协作要点：
//   · startReading / stopReading / fetchTranslationsBatch / detectTextLanguage 均为 content.js 顶层函数
//   · 段落用 data-readmate-skip 标记，让 ContentExtractor 只提取「要被朗读的那一栏」
//   · 老引擎的 cachedReaderContent 在切章时必须清空，否则会读到上一章的句子

(function () {
  'use strict';

  // ============================================================
  // 常量 / 状态
  // ============================================================
  var LS = { typo: 'rdrTypo', prog: 'rdrProgress', trans: 'rdrTransCache' };
  var DEFAULT_TYPO = {
    fs: 19, lh: 1.90, ms: 42, gp: 1.05, indent: 2,
    font: 'song', align: 'justify', mode: 'stacked', theme: 'sepia',
    indentOn: true, autoTrans: false,
  };
  var FONTS = {
    song: '"Songti SC","Source Han Serif SC","Noto Serif CJK SC","SimSun",Georgia,serif',
    hei: '"PingFang SC","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC",sans-serif',
    kai: '"Kaiti SC","KaiTi","STKaiti","Noto Serif CJK SC",serif',
    sans: '-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  };
  var MODES = ['original', 'stacked', 'columns', 'translated'];
  var TRANS_CACHE_MAX = 3000;
  var RECENT_MAX = 30;

  /** 独立 HTML 自带的打印样式：章节另起一页，Ctrl+P 直接得到整本 PDF */
  var PRINT_CSS = [
    '@page { margin: 18mm 16mm; }',
    '@media print {',
    '  body { background:#fff !important; color:#000 !important; }',
    '  .rdr-chap-sep { break-before:page; page-break-before:always; }',
    '  .rdr-chap-sep:first-of-type { break-before:auto; page-break-before:auto; }',
    '  .rdr-pair { break-inside:avoid; page-break-inside:avoid; }',
    '}',
  ].join('\n');

  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };

  var dict = null;                 // 本页独立加载的 i18n 词典
  var S = {};                      // 排版设置
  var book = null;                 // 当前书
  var chapIdx = 0;
  var view = 'library';
  var progMap = {};                // fingerprint -> { title, chapterIndex, pct, ... }
  var charsBefore = [], totalChars = 0;

  var transCache = new Map();      // 'target|hash' -> 译文
  var cacheTimer = null;
  var transToken = 0;              // 切章 / 取消时自增，使在途任务失效
  var transQueue = [];
  var transPumping = false;
  var transObserver = null;
  var transTotal = 0, transDone = 0;
  var exportToken = 0;

  // ============================================================
  // i18n
  // ============================================================
  function _i18n(key) {
    if (dict && dict[key] != null && dict[key] !== '') return dict[key];
    try { if (typeof _t === 'function') return _t(key); } catch (e) {}
    return key;
  }
  /** 取词典文案并填充 {name} 变量 */
  function T(key, vars) {
    var s = _i18n(key);
    if (vars) {
      for (var k in vars) {
        if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
        s = s.split('{' + k + '}').join(String(vars[k]));
      }
    }
    return s;
  }

  function loadI18nDict() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ action: 'getSettings' }, function (st) {
          var lang = (st && st.uiLanguage) || 'auto';
          chrome.runtime.sendMessage({ action: 'getI18nMessages', lang: lang }, function (res) {
            if (!chrome.runtime.lastError && res && res.ok && res.messages) dict = res.messages;
            resolve();
          });
        });
      } catch (e) { resolve(); }
    });
  }

  /** 把 HTML 里的 data-i18n / data-i18n-title 全部填上 */
  function applyStaticI18n() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (key) nodes[i].textContent = T(key);
    }
    var titles = document.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < titles.length; j++) {
      var tkey = titles[j].getAttribute('data-i18n-title');
      if (tkey) titles[j].title = T(tkey);
    }
    document.title = T('rdrDocTitle');
  }

  // ============================================================
  // 存储
  // ============================================================
  function storeGet(keys) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(keys, function (d) { resolve(d || {}); }); }
      catch (e) { resolve({}); }
    });
  }
  function storeSet(obj) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.set(obj, function () { resolve(); }); }
      catch (e) { resolve(); }
    });
  }

  function loadTypo() {
    return storeGet(LS.typo).then(function (d) {
      S = Object.assign({}, DEFAULT_TYPO, d[LS.typo] || {});
      if (MODES.indexOf(S.mode) < 0) S.mode = DEFAULT_TYPO.mode;
      if (!FONTS[S.font]) S.font = DEFAULT_TYPO.font;
    });
  }
  var typoTimer = null;
  function saveTypo() {
    clearTimeout(typoTimer);
    typoTimer = setTimeout(function () {
      var o = {}; o[LS.typo] = S; storeSet(o);
    }, 400);
  }

  function loadProgress() {
    return storeGet(LS.prog).then(function (d) { progMap = d[LS.prog] || {}; });
  }
  function entryOf(fp) { return fp ? progMap[fp] : null; }
  function saveProgress() {
    if (!book || !book.fingerprint) return;
    var cur = entryOf(book.fingerprint) || {};
    progMap[book.fingerprint] = {
      title: book.title,
      author: book.author || '',
      chapterIndex: chapIdx,
      chapters: book.chapters.length,
      pct: currentPct(),
      charCount: book.charCount,
      format: book.format,
      updatedAt: Date.now(),
      reintroduced: true,
      // 只记进度：书稿正文不落盘（用户选择 4B）
    };
    var list = Object.keys(progMap).map(function (k) { return { k: k, t: progMap[k].updatedAt || 0 }; });
    list.sort(function (a, b) { return b.t - a.t; });
    if (list.length > RECENT_MAX) {
      for (var i = RECENT_MAX; i < list.length; i++) delete progMap[list[i].k];
    }
    var o = {}; o[LS.prog] = progMap; storeSet(o);
  }

  function loadTransCache() {
    return storeGet(LS.trans).then(function (d) {
      var o = d[LS.trans] || {};
      Object.keys(o).forEach(function (k) { transCache.set(k, o[k]); });
    });
  }
  function scheduleCacheSave() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () {
      var keys = Array.from(transCache.keys());
      var out = {};
      if (keys.length > TRANS_CACHE_MAX) keys = keys.slice(keys.length - TRANS_CACHE_MAX);
      keys.forEach(function (k) { out[k] = transCache.get(k); });
      var o = {}; o[LS.trans] = out; storeSet(o);
    }, 1500);
  }

  // ============================================================
  // 小工具
  // ============================================================
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function hash(str) {
    var s = String(str), h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
      h2 = (h2 + c * (i + 7)) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
  }

  var toastTimer = null;
  function toast(msg, sticky) {
    var el = $('rdr-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2800);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    var el = $('rdr-toast');
    if (el) el.classList.remove('on');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isCjkDominant(s) {
    var cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    if (cjk === 0 && latin === 0) return true;
    return cjk >= latin;
  }

  function targetCode() {
    try {
      if (typeof settings !== 'undefined' && settings.translateTarget) {
        if (typeof LANG_NAME_TO_CODE !== 'undefined' && LANG_NAME_TO_CODE[settings.translateTarget]) {
          return LANG_NAME_TO_CODE[settings.translateTarget];
        }
      }
    } catch (e) {}
    return 'zh-CN';
  }

  function detectLang(text) {
    try { if (typeof detectTextLanguage === 'function') return detectTextLanguage(text); } catch (e) {}
    return isCjkDominant(text) ? 'zh-CN' : 'en-US';
  }

  /** 这段文字是否需要翻译（源语言 == 目标语言就跳过） */
  function needsTrans(text) {
    if (!text || !text.trim()) return false;
    if (!/[A-Za-z\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) return false;
    var src = detectLang(text).toLowerCase();
    var tgt = targetCode().toLowerCase();
    return src.split('-')[0] !== tgt.split('-')[0];
  }

  function transKey(text) { return targetCode() + '|' + hash(text); }

  function stopAnyReading() {
    try { if (typeof stopReading === 'function') stopReading(true); } catch (e) {}
  }

  // ============================================================
  // 排版设置应用
  // ============================================================
  function applyTypo() {
    root.style.setProperty('--fs', S.fs + 'px');
    root.style.setProperty('--lh', S.lh);
    root.style.setProperty('--measure', S.ms);
    root.style.setProperty('--gap', S.gp);
    root.style.setProperty('--indent', S.indent);
    root.style.setProperty('--font-body', FONTS[S.font] || FONTS.song);
    root.style.setProperty('--align', S.align);
    root.setAttribute('data-theme', S.theme);
    root.setAttribute('data-mode', S.mode);

    var body = $('rdr-body');
    if (body) body.classList.toggle('rdr-indent', !!S.indentOn);

    setSlider('rdr-fs', S.fs, S.fs + 'px');
    setSlider('rdr-lh', S.lh, Number(S.lh).toFixed(2));
    setSlider('rdr-ms', S.ms, T('rdrUnitChars', { n: S.ms }));
    setSlider('rdr-gp', S.gp, Number(S.gp).toFixed(2));
    setSlider('rdr-in', S.indent, T('rdrUnitChars', { n: S.indent }));

    markSeg('#rdr-seg-font button', 'font', S.font);
    markSeg('#rdr-seg-align button', 'align', S.align);
    markSeg('#rdr-seg-mode button', 'mode', S.mode);
    markSeg('#rdr-dots .rdr-dot', 'theme', S.theme);

    var tgIndent = $('rdr-tg-indent');
    if (tgIndent) tgIndent.classList.toggle('on', !!S.indentOn);
    var tgAuto = $('rdr-tg-auto');
    if (tgAuto) tgAuto.classList.toggle('on', !!S.autoTrans);
    var biBtn = $('rdr-bilingual-btn');
    if (biBtn) biBtn.classList.toggle('on', S.mode !== 'original');

    saveTypo();
  }

  function setSlider(id, v, text) {
    var el = $(id);
    if (!el) return;
    el.value = v;
    var s = $(id + '-v');
    if (s) s.textContent = text;
  }
  function markSeg(sel, attr, val) {
    var list = document.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) {
      list[i].classList.toggle('on', list[i].getAttribute('data-' + attr) === val);
    }
  }

  // ============================================================
  // 视图切换
  // ============================================================
  function setView(v) {
    view = v;
    root.setAttribute('data-view', v);
    var lib = $('rdr-library'), rdr = $('rdr-reader');
    if (lib) lib.hidden = (v !== 'library');
    if (rdr) rdr.hidden = (v !== 'reader');
    if (v === 'library') {
      stopAnyReading();
      cancelTranslation();
      closeToc();
      var p = $('rdr-panel'); if (p) p.classList.remove('open');
      var pb = $('rdr-panel-btn'); if (pb) pb.classList.remove('on');
      saveProgress();
      document.title = T('rdrDocTitle');
      renderRecent();
    }
  }

  function closeToc() {
    var toc = $('rdr-toc');
    if (toc) toc.classList.remove('open');
  }

  // ============================================================
  // 书库 / 最近阅读
  // ============================================================
  function renderRecent() {
    var list = $('rdr-recent-list');
    var wrap = $('rdr-recent-wrap');
    if (!list) return;
    list.innerHTML = '';
    var entries = Object.keys(progMap).map(function (k) {
      var e = Object.assign({ fp: k }, progMap[k]);
      return e;
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, 8);

    if (!entries.length) {
      if (wrap) wrap.hidden = true;
      return;
    }
    if (wrap) wrap.hidden = false;

    entries.forEach(function (e) {
      var item = document.createElement('div');
      item.className = 'rdr-recent-item';

      var icon = document.createElement('div');
      icon.className = 'rdr-ri-icon';
      icon.textContent = e.format === 'md' ? '📝' : (e.format === 'epub' ? '📖' : (e.format === 'pdf' ? '📕' : '📄'));

      var main = document.createElement('div');
      main.className = 'rdr-ri-main';
      var t = document.createElement('div');
      t.className = 'rdr-ri-title';
      t.textContent = e.title || T('rdrUntitled');
      var m = document.createElement('div');
      m.className = 'rdr-ri-meta';
      var parts = [];
      parts.push(T('rdrChapterOf', { cur: (e.chapterIndex || 0) + 1, total: e.chapters || 1 }));
      parts.push(T('rdrReadPct', { n: Math.round((e.pct || 0) * 100) }));
      if (e.charCount) parts.push(T('rdrUnitChars', { n: e.charCount }));
      m.textContent = parts.join(' · ') + ' · ' + T('rdrNeedReimport');
      main.appendChild(t);
      main.appendChild(m);

      var del = document.createElement('div');
      del.className = 'rdr-ri-del';
      del.textContent = '✕';
      del.title = T('rdrRemove');
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        delete progMap[e.fp];
        var o = {}; o[LS.prog] = progMap; storeSet(o);
        renderRecent();
      });

      item.appendChild(icon);
      item.appendChild(main);
      item.appendChild(del);
      item.addEventListener('click', function () {
        toast(T('rdrNeedReimport'), true);
        setTimeout(hideToast, 3200);
        var input = $('rdr-file-input');
        if (input) input.click();
      });
      list.appendChild(item);
    });
  }

  // ============================================================
  // 导入
  // ============================================================
  /** 把导入失败的错误码翻译成人话（界面文案全部走 i18n 词典） */
  function importErrorText(err) {
    var code = (err && err.code) || '';
    var ext = ((err && err.ext) || '?').toUpperCase();
    switch (code) {
      case 'EPUB_DRM': return T('rdrEpubDrm');
      case 'EPUB_INVALID': return T('rdrEpubInvalid');
      case 'EPUB_NO_TEXT': return T('rdrEpubNoText');
      case 'ZIP_BAD': case 'ZIP_UNSUPPORTED_METHOD': case 'ZIP_NO_DEFLATE': return T('rdrEpubInvalid');
      case 'PDF_ENCRYPTED': return T('rdrPdfEncrypted');
      case 'PDF_INVALID': return T('rdrPdfInvalid');
      case 'PDF_NO_TEXT': return T('rdrPdfNoText');
      case 'PDF_TOO_LARGE': return T('rdrPdfTooLarge');
      case 'PDF_LIB_FAILED': return T('rdrPdfLibFailed');
      case 'FORMAT_PLANNED': return T('rdrFormatPlanned', { ext: ext });
      case 'FORMAT_UNSUPPORTED': return T('rdrFormatUnsupported', { ext: ext });
      default: return T('rdrImportFailed');
    }
  }

  function importFile(file) {
    if (!file) return Promise.resolve();
    var ext = BookImporter.formatOf(file.name);
    if (!BookImporter.isSupported(file.name)) {
      if (BookImporter.isPlanned(file.name)) toast(T('rdrFormatPlanned', { ext: ext.toUpperCase() }));
      else toast(T('rdrFormatUnsupported', { ext: (ext || '?').toUpperCase() }));
      return Promise.resolve();
    }
    // epub / pdf 需要解包或逐页抽字，给个进度提示（大书也不像死住）
    var heavy = ext === 'epub' || ext === 'pdf';
    toast(T('rdrImporting'), true);
    var onProgress = heavy ? function (done, total) {
      if (total > 1) toast(T('rdrImportProgress', { done: done, total: total }), true);
    } : null;
    return BookImporter.parseFile(file, { onProgress: onProgress }).then(function (b) {
      hideToast();
      if (!b.chapters || !b.chapters.length) { toast(T('rdrImportEmpty')); return; }
      return openBook(b);
    }).catch(function (err) {
      hideToast();
      console.warn('[Reader] import failed', err);
      toast(importErrorText(err));
    });
  }

  function openBook(b) {
    book = b;
    totalChars = 0;
    charsBefore = [];
    for (var i = 0; i < b.chapters.length; i++) {
      charsBefore.push(totalChars);
      totalChars += b.chapters[i].charCount || 0;
    }
    var saved = entryOf(b.fingerprint);
    var startChap = (saved && saved.chapterIndex < b.chapters.length) ? saved.chapterIndex : 0;
    buildTOC();
    setView('reader');
    return renderChapter(startChap, saved ? saved.pct : 0).then(function () {
      toast(saved ? T('rdrResumed') : T('rdrImported') + ' · ' + T('rdrReadTip'), true);
      setTimeout(hideToast, saved ? 3000 : 4600);
    });
  }

  function buildTOC() {
    var list = $('rdr-toc-list');
    if (!list) return;
    list.innerHTML = '';
    book.chapters.forEach(function (ch, i) {
      var a = document.createElement('a');
      a.href = '#';   // 扩展页 CSP 禁止 javascript: URL，用 # + preventDefault
      a.className = 'rdr-toc-link';
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(i + 1);
      a.appendChild(n);
      var label = document.createElement('span');
      label.textContent = ch.title || T('rdrChapter', { n: i + 1 });
      a.appendChild(label);
      a.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        closeToc();
        renderChapter(i, 0);
      });
      list.appendChild(a);
    });
  }

  function markTocCurrent() {
    var links = document.querySelectorAll('#rdr-toc-list a');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('cur', i === chapIdx);
  }

  // ============================================================
  // 渲染章节
  // ============================================================
  function renderChapter(i, restorePct) {
    if (!book || !book.chapters.length) return Promise.resolve();
    stopAnyReading();
    cancelTranslation();
    chapIdx = Math.max(0, Math.min(book.chapters.length - 1, i));
    var ch = book.chapters[chapIdx];

    // 老引擎的语料缓存必须清掉，否则会读到上一章
    try { cachedReaderContent = null; } catch (e) {}

    var chapLabel = ch.title || T('rdrChapter', { n: chapIdx + 1 });
    var titleEl = $('rdr-chap-title');
    if (titleEl) titleEl.textContent = chapLabel;
    var numEl = $('rdr-chnum');
    if (numEl) {
      numEl.textContent = T('rdrChapterOf', { cur: chapIdx + 1, total: book.chapters.length }) +
        ' · ' + T('rdrUnitChars', { n: ch.charCount });
    }
    var nowEl = $('rdr-chap-now');
    if (nowEl) nowEl.textContent = chapLabel;
    var nameEl = $('rdr-book-name');
    if (nameEl) nameEl.textContent = book.title || '';
    document.title = (book.title || 'ReadMate') + ' · ' + chapLabel;

    var body = $('rdr-body');
    if (!body) return Promise.resolve();
    Array.prototype.slice.call(body.querySelectorAll('.rdr-pair')).forEach(function (el) { el.remove(); });

    var frag = document.createDocumentFragment();
    ch.paragraphs.forEach(function (text) {
      var isEn = !isCjkDominant(text);
      var wrap = document.createElement('div');
      wrap.className = 'rdr-pair';
      wrap._orig = text;

      var o = document.createElement('p');
      o.className = 'rdr-orig' + (isEn ? ' rdr-en' : '');
      o.textContent = text;

      var tg = document.createElement('p');
      tg.className = 'rdr-tgt rdr-pending';

      wrap.appendChild(o);
      wrap.appendChild(tg);
      setupPair(wrap);
      frag.appendChild(wrap);
    });
    body.appendChild(frag);

    var prev = $('rdr-prev'), next = $('rdr-next');
    if (prev) prev.disabled = chapIdx === 0;
    if (next) next.disabled = chapIdx === book.chapters.length - 1;
    var pos = $('rdr-nav-pos');
    if (pos) pos.textContent = T('rdrChapterOf', { cur: chapIdx + 1, total: book.chapters.length });

    markTocCurrent();
    syncReadable();
    updateProgressBar();

    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        var pct = restorePct || 0;
        if (pct > 0) {
          var h = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, Math.max(0, h * pct));
        } else {
          window.scrollTo(0, 0);
        }
        updateProgressBar();
        // 本章翻译：开卷先铺好首屏，其余按需
        restartTranslation();
        resolve();
      });
    });
  }

  // ============================================================
  // 双语：段落配对与翻译
  // ============================================================
  /** 译文块的「待翻译」标记统一放在 .rdr-tgt 上（CSS 也按它变色） */
  function tgOf(wrap) { return wrap.querySelector('.rdr-tgt'); }
  function isPending(wrap) { var t = tgOf(wrap); return !!(t && t.classList.contains('rdr-pending')); }
  function clearPending(wrap) { var t = tgOf(wrap); if (t) t.classList.remove('rdr-pending'); }

  function setupPair(wrap) {
    var tg = wrap.querySelector('.rdr-tgt');
    if (!needsTrans(wrap._orig)) {
      wrap.classList.add('rdr-same');
      clearPending(wrap);
      tg.textContent = '';
      return;
    }
    var cached = transCache.get(transKey(wrap._orig));
    if (cached) {
      tg.textContent = cached;
      clearPending(wrap);
    }
  }

  function fillPair(wrap, text) {
    var tg = wrap.querySelector('.rdr-tgt');
    if (!tg) return;
    tg.textContent = text;
    clearPending(wrap);
  }

  function pendingPairs() {
    var out = [];
    var pairs = document.querySelectorAll('#rdr-body .rdr-pair');
    for (var i = 0; i < pairs.length; i++) {
      var w = pairs[i];
      if (w.classList.contains('rdr-same')) continue;
      if (isPending(w)) out.push(w);
    }
    return out;
  }

  function cancelTranslation() {
    transToken++;
    transQueue = [];
    transPumping = false;
    transTotal = 0;
    transDone = 0;
    if (transObserver) { transObserver.disconnect(); transObserver = null; }
  }

  /** 切章 / 切双语模式后重新安排翻译任务 */
  function restartTranslation() {
    cancelTranslation();
    if (!book || S.mode === 'original') return;
    var pairs = pendingPairs();
    if (!pairs.length) return;

    if (S.autoTrans) {
      transTotal = pairs.length;
      transDone = 0;
      enqueue(pairs);
      return;
    }
    // 懒翻译：首屏 + 视口附近优先，滚到哪儿翻到哪儿
    transObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          transObserver.unobserve(en.target);
          enqueue([en.target]);
        }
      });
    }, { rootMargin: '140% 0px 140% 0px' });
    var firstScreen = [];
    var vh = window.innerHeight || 800;
    pairs.forEach(function (w) {
      var top = w.getBoundingClientRect().top;
      if (top < vh * 2.2) firstScreen.push(w);
      else transObserver.observe(w);
    });
    transTotal = pairs.length;
    transDone = 0;
    enqueue(firstScreen);
  }

  function enqueue(items) {
    if (!items || !items.length) return;
    items.forEach(function (w) {
      if (transQueue.indexOf(w) < 0 && isPending(w)) transQueue.push(w);
    });
    if (!transPumping) pumpQueue(transToken);
  }

  function pumpQueue(token) {
    if (transPumping) return;
    transPumping = true;
    var batch = [];
    while (transQueue.length && batch.length < 8) {
      var w = transQueue.shift();
      if (!w.isConnected) continue;
      if (!isPending(w)) continue;
      batch.push(w);
    }
    if (!batch.length) { transPumping = false; onTranslationIdle(token); return; }

    var texts = batch.map(function (w) { return w._orig; });
    Promise.resolve()
      .then(function () {
        if (typeof fetchTranslationsBatch !== 'function') throw new Error('engine unavailable');
        return fetchTranslationsBatch(texts);
      })
      .then(function (res) {
        if (token !== transToken) { transPumping = false; return; }
        var okCount = 0;
        batch.forEach(function (w, i) {
          var tr = res && res[i];
          if (tr && tr.trim()) {
            transCache.set(transKey(w._orig), tr);
            fillPair(w, tr);
            okCount++;
          } else {
            clearPending(w); // 失败不再无限重试
          }
        });
        if (okCount) scheduleCacheSave();
        transDone += batch.length;
        updateTransToast(token);
        transPumping = false;
        sleep(260).then(function () {
          if (token !== transToken) return;
          pumpQueue(token);
        });
      })
      .catch(function () {
        if (token !== transToken) { transPumping = false; return; }
        batch.forEach(function (w) { clearPending(w); });
        transPumping = false;
        toast(T('rdrTransFailed'));
        onTranslationIdle(token);
      });
  }

  function updateTransToast(token) {
    if (token !== transToken) return;
    var left = transQueue.length + pendingPairs().length;
    if (!transTotal) return;
    if (left > 0 && S.autoTrans) {
      toast(T('rdrTransProgress', { done: Math.min(transDone, transTotal), total: transTotal }), true);
    }
  }

  function onTranslationIdle(token) {
    if (token !== transToken) return;
    if (!pendingPairs().length) {
      hideToast();
      if (S.autoTrans) {
        toast(T('rdrTransDone'));
      }
    }
  }

  /** 把缓存里已有的译文填回当前章节 DOM（不发起网络请求） */
  function applyCachedToChapter(i) {
    if (i !== chapIdx) return;
    var pairs = document.querySelectorAll('#rdr-body .rdr-pair');
    for (var k = 0; k < pairs.length; k++) {
      var w = pairs[k];
      if (w.classList.contains('rdr-same')) continue;
      var c = transCache.get(transKey(w._orig));
      if (c) fillPair(w, c);
    }
  }

  /**
   * 翻译指定章节（供界面与自动化使用）
   * @param {number} i 章序号（0 起）
   * @param {{silent?:boolean}} opts silent=true 时不弹进度提示
   * @returns {Promise<void>}
   */
  function translateChapter(i, opts) {
    opts = opts || {};
    if (!book || !book.chapters[i]) return Promise.resolve();
    var ch = book.chapters[i];
    var todo = [];
    ch.paragraphs.forEach(function (p) {
      if (!needsTrans(p)) return;
      if (transCache.has(transKey(p))) return;
      todo.push(p);
    });
    if (!todo.length) { applyCachedToChapter(i); return Promise.resolve(); }

    var total = todo.length, done = 0;
    var chain = Promise.resolve();
    for (var s = 0; s < total; s += 8) {
      (function (start) {
        chain = chain.then(function () {
          var slice = todo.slice(start, start + 8);
          return Promise.resolve()
            .then(function () {
              if (typeof fetchTranslationsBatch !== 'function') throw new Error('engine unavailable');
              return fetchTranslationsBatch(slice);
            })
            .then(function (res) {
              slice.forEach(function (p, k) {
                var tr = res && res[k];
                if (tr && tr.trim()) transCache.set(transKey(p), tr);
              });
              done += slice.length;
              if (!opts.silent) {
                toast(T('rdrTransProgress', { done: Math.min(done, total), total: total }), true);
              }
              scheduleCacheSave();
              return sleep(260);
            });
        });
      })(s);
    }
    return chain.then(function () {
      applyCachedToChapter(i);
      if (!opts.silent) hideToast();
    });
  }

  /** 只让「当前要朗读的那一栏」被老引擎提取 */
  function syncReadable() {
    var pairs = document.querySelectorAll('#rdr-body .rdr-pair');
    for (var i = 0; i < pairs.length; i++) {
      var w = pairs[i];
      var o = w.querySelector('.rdr-orig');
      var tg = w.querySelector('.rdr-tgt');
      var same = w.classList.contains('rdr-same');
      var translatedOnly = (S.mode === 'translated') && !same;
      if (o) {
        if (translatedOnly) o.setAttribute('data-readmate-skip', '');
        else o.removeAttribute('data-readmate-skip');
      }
      if (tg) {
        if (translatedOnly) tg.removeAttribute('data-readmate-skip');
        else tg.setAttribute('data-readmate-skip', '');
      }
    }
  }

  // ============================================================
  // 阅读进度
  // ============================================================
  function currentPct() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / h));
  }

  function updateProgressBar() {
    var bar = document.querySelector('#rdr-progress i');
    if (!bar || !book || !totalChars) return;
    var ch = book.chapters[chapIdx];
    var done = charsBefore[chapIdx] + (ch ? (ch.charCount || 0) * currentPct() : 0);
    var pct = Math.min(100, Math.max(0, done / totalChars * 100));
    bar.style.width = pct.toFixed(1) + '%';
  }

  var saveTimer = null;
  function onScroll() {
    updateProgressBar();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (view === 'reader') saveProgress();
    }, 700);
  }

  // ============================================================
  // 导出
  // ============================================================
  function openModal(titleText, subText, options) {
    var modal = $('rdr-modal');
    if (!modal) return null;
    var card = document.createElement('div');
    card.className = 'rdr-card';
    var h3 = document.createElement('h3');
    h3.textContent = titleText;
    var sub = document.createElement('p');
    sub.className = 'rdr-cardsub';
    sub.textContent = subText;
    card.appendChild(h3);
    card.appendChild(sub);

    options.forEach(function (opt) {
      var b = document.createElement('div');
      b.className = 'rdr-opt';
      var box = document.createElement('div');
      var t = document.createElement('div');
      t.className = 'rdr-opt-t';
      t.textContent = opt.t;
      var d = document.createElement('div');
      d.className = 'rdr-opt-d';
      d.textContent = opt.d;
      box.appendChild(t);
      box.appendChild(d);
      b.appendChild(box);
      b.addEventListener('click', function () { opt.run(card, b); });
      card.appendChild(b);
    });

    var actions = document.createElement('div');
    actions.className = 'rdr-actions';
    var cancel = document.createElement('button');
    cancel.className = 'rdr-btn';
    cancel.textContent = T('rdrCancel');
    cancel.addEventListener('click', function () { exportToken++; closeModal(); });
    actions.appendChild(cancel);
    card.appendChild(actions);

    modal.innerHTML = '';
    modal.appendChild(card);
    modal.hidden = false;
    return card;
  }

  function closeModal() {
    var modal = $('rdr-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.innerHTML = '';
  }

  function modalProgress(card) {
    var old = card.querySelector('.rdr-prog-wrap');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.className = 'rdr-prog-wrap';
    var bar = document.createElement('div');
    bar.className = 'rdr-bar';
    var i = document.createElement('i');
    bar.appendChild(i);
    var txt = document.createElement('div');
    txt.className = 'rdr-progtext';
    wrap.appendChild(bar);
    wrap.appendChild(txt);
    card.appendChild(wrap);
    return {
      set: function (done, total, label) {
        i.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
        txt.textContent = label || T('rdrExportWorking', { done: done, total: total });
      },
    };
  }

  /** 打印 / 导出 PDF：直接打印书页本身（所见即所得），reader.css 已备好 @media print 规则 */
  function startPrint() {
    setTimeout(function () { window.print(); }, 160);
  }

  function exportMenu() {
    if (!book) { toast(T('rdrOpenFirst')); return; }
    openModal(T('rdrExportTitle'), T('rdrExportSub'), [
      {
        t: T('rdrExportPdfT'), d: T('rdrExportPdfD'),
        run: function () {
          closeModal();
          startPrint();
        },
      },
      {
        t: T('rdrExportHtmlT'), d: T('rdrExportHtmlD'),
        run: function (card) {
          exportHtml(card, true);
        },
      },
      {
        t: T('rdrExportPlainT'), d: T('rdrExportPlainD'),
        run: function (card) {
          exportHtml(card, false);
        },
      },
    ]);
  }

  function exportHtml(card, withTrans) {
    var token = ++exportToken;
    var prog = card ? modalProgress(card) : null;
    prog && prog.set(0, 1, T('rdrExportWorking', { done: 0, total: 1 }));

    translateBook(withTrans ? token : -1, function (done, total) {
      if (prog) prog.set(done, total);
    }).then(function () {
      if (token !== exportToken && withTrans) return;
      return buildHtmlFile(withTrans).then(function (html) {
        var name = (book.title || 'ReadMate').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 48) +
          (withTrans ? '-bilingual' : '') + '.html';
        download(name, html);
        closeModal();
        toast(T('rdrExportDone', { name: name }));
      });
    }).catch(function (e) {
      console.warn('[Reader] export failed', e);
      closeModal();
      toast(T('rdrExportFailed'));
    });
  }

  /** 把整本书的译文补齐（token < 0 表示不做翻译，只用缓存） */
  function translateBook(token, progressCb) {
    if (!book) return Promise.resolve();
    var uniq = [];
    var seen = {};
    book.chapters.forEach(function (ch) {
      ch.paragraphs.forEach(function (p) {
        if (!needsTrans(p)) return;
        var k = transKey(p);
        if (transCache.has(k) || seen[k]) return;
        seen[k] = 1;
        uniq.push(p);
      });
    });
    if (token < 0 || !uniq.length) {
      if (progressCb) progressCb(1, 1);
      return Promise.resolve();
    }
    var total = uniq.length, done = 0, failed = 0;
    if (progressCb) progressCb(0, total);
    var chain = Promise.resolve();
    for (var i = 0; i < total; i += 8) {
      (function (start) {
        chain = chain.then(function () {
          if (token !== exportToken) return;
          var slice = uniq.slice(start, start + 8);
          return Promise.resolve()
            .then(function () { return fetchTranslationsBatch(slice); })
            .then(function (res) {
              var hit = 0;
              slice.forEach(function (p, k) {
                var tr = res && res[k];
                if (tr && tr.trim()) { transCache.set(transKey(p), tr); hit++; }
              });
              if (!hit) failed++;
              done += slice.length;
              scheduleCacheSave();
              if (progressCb) progressCb(done, total);
              return sleep(260);
            })
            .catch(function () {
              failed++;
              done += slice.length;
              if (progressCb) progressCb(done, total);
            });
        });
      })(i);
    }
    return chain.then(function () {
      if (failed && token === exportToken) toast(T('rdrTransFailed'));
    });
  }

  function buildHtmlFile(withTrans) {
    return fetch(chrome.runtime.getURL('reader/reader.css'))
      .then(function (r) { return r.text(); })
      .catch(function () { return ''; })
      .then(function (css) {
        var mode = withTrans ? (S.mode === 'original' ? 'stacked' : S.mode) : 'original';
        var vars = ':root{--fs:' + S.fs + 'px;--lh:' + S.lh + ';--measure:' + S.ms +
          ';--gap:' + S.gp + ';--indent:' + S.indent + ';--font-body:' + FONTS[S.font] +
          ';--align:' + S.align + ';}';
        var out = [];
        out.push('<!DOCTYPE html>');
        out.push('<html lang="' + esc(targetCode()) + '" data-theme="' + S.theme + '" data-mode="' + mode + '">');
        out.push('<head><meta charset="utf-8">');
        out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
        out.push('<title>' + esc(book.title) + '</title>');
        out.push('<style>' + css + vars + PRINT_CSS + '</style>');
        out.push('</head><body>');
        out.push('<div id="rdr-stage"><div class="rdr-chaphead"><div class="rdr-chnum">' +
          esc(book.author || '') + '</div><div class="rdr-ornament">❋ ❋ ❋</div></div>');
        out.push('<article id="rdr-body" class="rdr-body' + (S.indentOn ? ' rdr-indent' : '') + '">');
        out.push('<h1>' + esc(book.title) + '</h1>');
        book.chapters.forEach(function (ch, i) {
          out.push('<h2 class="rdr-chap-sep">' + esc(ch.title || '') + '</h2>');
          ch.paragraphs.forEach(function (p) {
            var isEn = !isCjkDominant(p);
            var tr = '';
            if (withTrans && needsTrans(p)) tr = transCache.get(transKey(p)) || '';
            out.push('<div class="rdr-pair">');
            out.push('<p class="rdr-orig' + (isEn ? ' rdr-en' : '') + '">' + esc(p) + '</p>');
            if (tr) out.push('<p class="rdr-tgt">' + esc(tr) + '</p>');
            out.push('</div>');
          });
        });
        out.push('</article></div></body></html>');
        return out.join('\n');
      });
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 4000);
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindUI() {
    // ---- 拖放 / 选文件 ----
    var dz = $('rdr-dropzone');
    var input = $('rdr-file-input');
    var chooseBtn = $('rdr-choose-btn');

    if (chooseBtn && input) chooseBtn.addEventListener('click', function () { input.click(); });
    if (input) {
      input.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f) importFile(f);
      });
    }
    if (dz) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hot'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hot'); });
      });
      dz.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) importFile(f);
      });
    }

    // 整页拖放
    var dragDepth = 0;
    var overlay = $('rdr-drop-overlay');
    window.addEventListener('dragenter', function (e) {
      e.preventDefault();
      dragDepth++;
      if (overlay && view === 'library') overlay.hidden = false;
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('dragleave', function () {
      dragDepth--;
      if (dragDepth <= 0) { dragDepth = 0; if (overlay) overlay.hidden = true; }
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      if (overlay) overlay.hidden = true;
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importFile(f);
    });

    // ---- 顶栏 ----
    var tocBtn = $('rdr-toc-btn');
    if (tocBtn) tocBtn.addEventListener('click', function () {
      var toc = $('rdr-toc');
      if (toc) toc.classList.toggle('open');
    });
    var panelBtn = $('rdr-panel-btn');
    if (panelBtn) panelBtn.addEventListener('click', function () {
      var p = $('rdr-panel');
      if (!p) return;
      var open = p.classList.toggle('open');
      panelBtn.classList.toggle('on', open);
    });
    var biBtn = $('rdr-bilingual-btn');
    if (biBtn) biBtn.addEventListener('click', function () {
      var next = MODES[(MODES.indexOf(S.mode) + 1) % MODES.length];
      S.mode = next;
      applyTypo();
      syncReadable();
      restartTranslation();
      toast(T('rdrModeTip') + ': ' + T('rdrMode' + next.charAt(0).toUpperCase() + next.slice(1)));
    });
    var expBtn = $('rdr-export-btn');
    if (expBtn) expBtn.addEventListener('click', exportMenu);
    var libBtn = $('rdr-library-btn');
    if (libBtn) libBtn.addEventListener('click', function () { setView('library'); });

    // ---- 章节导航 ----
    var prev = $('rdr-prev'), next = $('rdr-next');
    if (prev) prev.addEventListener('click', function () { renderChapter(chapIdx - 1, 0); });
    if (next) next.addEventListener('click', function () { renderChapter(chapIdx + 1, 0); });

    // ---- 排版面板：滑块 ----
    bindSlider('rdr-fs', 'fs', true);
    bindSlider('rdr-lh', 'lh', false);
    bindSlider('rdr-ms', 'ms', true);
    bindSlider('rdr-gp', 'gp', false);
    bindSlider('rdr-in', 'indent', false);

    // ---- 排版面板：分段按钮 ----
    bindSeg('#rdr-seg-font', function (v) { S.font = v; });
    bindSeg('#rdr-seg-align', function (v) { S.align = v; });
    bindSeg('#rdr-seg-mode', function (v) {
      S.mode = v;
      syncReadable();
      restartTranslation();
    });

    // ---- 主题彩点 ----
    var dots = $('rdr-dots');
    if (dots) dots.addEventListener('click', function (e) {
      var d = e.target.closest ? e.target.closest('.rdr-dot') : null;
      if (!d) return;
      S.theme = d.getAttribute('data-theme');
      applyTypo();
    });

    // ---- 其它开关 ----
    var tgIndent = $('rdr-tg-indent');
    if (tgIndent) tgIndent.addEventListener('click', function () {
      S.indentOn = !S.indentOn;
      applyTypo();
    });
    var tgAuto = $('rdr-tg-auto');
    if (tgAuto) tgAuto.addEventListener('click', function () {
      S.autoTrans = !S.autoTrans;
      applyTypo();
      restartTranslation();
    });
    var tgPrint = $('rdr-tg-print');
    if (tgPrint) tgPrint.addEventListener('click', function () {
      var p = $('rdr-panel'); if (p) p.classList.remove('open');
      startPrint();
    });
    var tgReset = $('rdr-tg-reset');
    if (tgReset) tgReset.addEventListener('click', function () {
      S = Object.assign({}, DEFAULT_TYPO);
      applyTypo();
      syncReadable();
      restartTranslation();
      toast(T('rdrResetDone'));
    });

    // 点击遮罩关闭弹窗
    var modal = $('rdr-modal');
    if (modal) modal.addEventListener('click', function (e) {
      if (e.target === modal) { exportToken++; closeModal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { exportToken++; closeModal(); closeToc(); return; }
      // Alt + ←/→ 翻章（与「下一章」按钮同一套逻辑）
      if (e.altKey && view === 'reader' && book) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); renderChapter(chapIdx - 1, 0); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); renderChapter(chapIdx + 1, 0); }
      }
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', saveProgress);
  }

  function bindSlider(id, key, isInt) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', function () {
      S[key] = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
      applyTypo();
    });
  }

  function bindSeg(sel, onPick) {
    var box = document.querySelector(sel);
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var v = b.getAttribute('data-font') || b.getAttribute('data-align') || b.getAttribute('data-mode');
      if (!v) return;
      onPick(v);
      applyTypo();
    });
  }

  /**
   * 右键「在读伴书页打开」入口：reader.html?src=<书稿链接>
   * 拉取远程 txt/md 后走与拖入本地文件完全相同的解析链路
   */
  function loadFromQuery() {
    var m = /[?&]src=([^&]+)/.exec(location.search);
    if (!m) return Promise.resolve();
    var url = '';
    try { url = decodeURIComponent(m[1]); } catch (e) { url = m[1]; }
    if (!url) return Promise.resolve();
    var name = (url.split('?')[0].split('/').pop() || 'book.txt');
    toast(T('rdrDownloading', { name: name }), true);
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        hideToast();
        // 链接常常没有扩展名（arXiv 的 /pdf/xxxx、网盘直链）：按内容嗅探后再决定解析器
        var ext = BookImporter.sniffFormat(buf, name);
        if (ext && BookImporter.formatOf(name) !== ext) name = name + '.' + ext;
        var mime = ext === 'epub' ? 'application/epub+zip'
          : (ext === 'pdf' ? 'application/pdf' : 'text/plain');
        return importFile(new File([buf], name, { type: mime }));
      })
      .catch(function (e) {
        hideToast();
        console.warn('[Reader] remote import failed', e);
        toast(T('rdrDownloadFailed'));
      });
  }

  // ============================================================
  // 启动
  // ============================================================
  function init() {
    return loadI18nDict()
      .then(function () { return Promise.all([loadTypo(), loadProgress(), loadTransCache()]); })
      .then(function () {
        applyStaticI18n();
        bindUI();
        applyTypo();
        setView('library');
        return loadFromQuery();
      });
  }

  // ============================================================
  // 对外接口（书页内部状态给自动化测试 / 未来的 popup 入口复用）
  // ============================================================
  window.__rmReader = {
    getBook: function () { return book; },
    getPrefs: function () { return Object.assign({}, S); },
    getChapterIndex: function () { return chapIdx; },
    getTransCacheKeys: function () { return Array.from(transCache.keys()); },
    getView: function () { return view; },
    renderChapter: renderChapter,
    translateChapter: translateChapter,
    showLibrary: function () { setView('library'); },
    openBook: openBook,
    importText: function (text, name) {
      var b = BookImporter.parseText(text, { sourceName: name || 'untitled.txt' });
      if (!b.chapters || !b.chapters.length) return Promise.resolve(null);
      return openBook(b).then(function () { return b; });
    },
    buildStandaloneHtml: function () { return buildHtmlFile(true); },
    loadFromQuery: loadFromQuery,
    importFile: importFile,
    print: startPrint,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
