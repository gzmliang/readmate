// ReadMate / 读伴 — 书页本地书架缓存（IndexedDB）
//
// 2026-11 梁老师拍板：由「只存进度」改为「缓存解析后的书稿」，
//   目的是书架点开即读，不用每次重新选文件。
//
// 铁律：
//   1. 只缓存【解析后的纯文本】（章节 + 段落），绝不保存原始 epub / PDF 二进制；
//   2. 只存在本机 IndexedDB，不上传任何服务器；
//   3. 有容量上限 + 最久未读自动淘汰，用户可逐本删除（书架条目 ✕）；
//   4. 界面文案一律由 reader.js 侧走 i18n，这里不产出任何界面文字。

var BookShelf = (function () {
  'use strict';

  var DB_NAME = 'readmateReader';
  var DB_VER = 1;
  var STORE_BOOKS = 'books';   // { fp, savedAt, book }（体积大）
  var STORE_META = 'meta';     // { fp, title, author, format, charCount, chapters, size, savedAt }（体积小）

  // 上限：单本上限不设，但总量与本数都封顶，超出按「最久未打开」淘汰
  var MAX_BYTES = 400 * 1024 * 1024;   // 400MB（纯文本估算）
  var MAX_BOOKS = 60;

  var dbPromise = null;

  function supported() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; }
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!supported()) { reject(new Error('IDB_UNSUPPORTED')); return; }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_BOOKS)) {
          db.createObjectStore(STORE_BOOKS, { keyPath: 'fp' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          var ms = db.createObjectStore(STORE_META, { keyPath: 'fp' });
          ms.createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  /** 估算纯文本占用（UTF-16 双字节近似），不 stringify，避免大书卡顿 */
  function sizeOf(book) {
    var n = 0;
    var chapters = (book && book.chapters) || [];
    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      n += (ch.title || '').length;
      var ps = ch.paragraphs || [];
      for (var j = 0; j < ps.length; j++) n += (ps[j] || '').length + 2;
    }
    return n * 2;
  }

  function metaOf(book, savedAt) {
    return {
      fp: book.fingerprint,
      title: book.title || '',
      author: book.author || '',
      format: book.format || 'txt',
      charCount: book.charCount || 0,
      chapters: (book.chapters || []).length,
      size: sizeOf(book),
      savedAt: savedAt || Date.now(),
    };
  }

  /** 写入（覆盖）一本书的缓存，并触发容量淘汰 */
  function put(book) {
    if (!book || !book.fingerprint) return Promise.resolve(null);
    var savedAt = Date.now();
    var meta = metaOf(book, savedAt);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([STORE_BOOKS, STORE_META], 'readwrite');
        t.objectStore(STORE_BOOKS).put({ fp: book.fingerprint, savedAt: savedAt, book: book });
        t.objectStore(STORE_META).put(meta);
        t.oncomplete = function () { resolve(meta); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    }).then(function (m) {
      return trim().then(function () { return m; }, function () { return m; });
    });
  }

  /** 取整本书；没有则 null */
  function get(fp) {
    if (!fp) return Promise.resolve(null);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE_BOOKS, 'readonly');
        var r = t.objectStore(STORE_BOOKS).get(fp);
        r.onsuccess = function () { resolve(r.result && r.result.book ? r.result.book : null); };
        r.onerror = function () { reject(r.error); };
      });
    }).catch(function () { return null; });
  }

  /** 只取元信息（不含正文），用于书架列表 */
  function metaAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE_META, 'readonly');
        var r = t.objectStore(STORE_META).getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { reject(r.error); };
      });
    }).catch(function () { return []; });
  }

  function remove(fp) {
    if (!fp) return Promise.resolve();
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([STORE_BOOKS, STORE_META], 'readwrite');
        t.objectStore(STORE_BOOKS).delete(fp);
        t.objectStore(STORE_META).delete(fp);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    }).catch(function () {});
  }

  /** 改书名（书架显示 + 打开后顶栏书名都要跟着变） */
  function rename(fp, title) {
    var name = String(title || '').trim();
    if (!fp || !name) return Promise.resolve(false);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([STORE_BOOKS, STORE_META], 'readwrite');
        var books = t.objectStore(STORE_BOOKS);
        var mete = t.objectStore(STORE_META);
        var g = books.get(fp);
        g.onsuccess = function () {
          var rec = g.result;
          if (rec && rec.book) { rec.book.title = name; books.put(rec); }
        };
        var gm = mete.get(fp);
        gm.onsuccess = function () {
          var m = gm.result;
          if (m) { m.title = name; mete.put(m); }
        };
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error); };
      });
    }).catch(function () { return false; });
  }

  function usage() {
    return metaAll().then(function (list) {
      var bytes = 0;
      for (var i = 0; i < list.length; i++) bytes += list[i].size || 0;
      return { count: list.length, bytes: bytes };
    });
  }

  /** 超出「本数 / 总量」上限时，按 savedAt 最久优先删除（progress 记录不受影响） */
  function trim() {
    return metaAll().then(function (list) {
      if (!list.length) return 0;
      list.sort(function (a, b) { return (a.savedAt || 0) - (b.savedAt || 0); });
      var bytes = 0;
      for (var i = 0; i < list.length; i++) bytes += list[i].size || 0;
      var drop = [];
      var count = list.length;
      for (var k = 0; k < list.length; k++) {
        if (count <= MAX_BOOKS && bytes <= MAX_BYTES) break;
        drop.push(list[k].fp);
        count--;
        bytes -= (list[k].size || 0);
      }
      if (!drop.length) return 0;
      return drop.reduce(function (p, fp) {
        return p.then(function () { return remove(fp); });
      }, Promise.resolve()).then(function () { return drop.length; });
    }).catch(function () { return 0; });
  }

  function clearAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([STORE_BOOKS, STORE_META], 'readwrite');
        t.objectStore(STORE_BOOKS).clear();
        t.objectStore(STORE_META).clear();
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    }).catch(function () {});
  }

  return {
    supported: supported,
    put: put,
    get: get,
    metaAll: metaAll,
    remove: remove,
    rename: rename,
    usage: usage,
    trim: trim,
    clearAll: clearAll,
    limits: { maxBytes: MAX_BYTES, maxBooks: MAX_BOOKS },
  };
})();

if (typeof window !== 'undefined') window.BookShelf = BookShelf;
