// ReadMate / 读伴 — 极简 ZIP 读取器（供 epub 电子书解析使用）
//
// 设计原则：
//   1. 零依赖：只用浏览器原生 DecompressionStream('deflate-raw') 解压，不引任何第三方库
//   2. 只读内存：整包 ArrayBuffer 已在内存里，按需解出单个条目，不解压整本书
//   3. 不做 UI：本文件不含任何界面文案，报错只给错误码（由 reader.js 走 i18n 提示）
//
// 输出：
//   BookZip.open(arrayBuffer) → {
//     names: string[],
//     has(name), get(name) → entry | null,
//     read(name) → Promise<ArrayBuffer>,      // 解压后的原始字节
//     readText(name) → Promise<string>,       // 自动识别 UTF-8 / UTF-16 / GBK
//   }

const BookZip = (() => {
  'use strict';

  const SIG_EOCD = 0x06054b50;       // End of central directory
  const SIG_Z64_EOCD = 0x06064b50;   // ZIP64 end of central directory
  const SIG_Z64_LOC = 0x07064b50;    // ZIP64 end of central directory locator
  const SIG_CEN = 0x02014b50;        // Central directory file header
  const SIG_LOCAL = 0x04034b50;      // Local file header

  function zipError(code) {
    const e = new Error(code);
    e.code = code;
    return e;
  }

  function decodeName(bytes, isUtf8) {
    if (isUtf8) {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* fallthrough */ }
    } else {
      // 很多国产工具打包的 epub 用 GBK 存文件名且没有置 UTF-8 标记
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* not utf8 */ }
      try { return new TextDecoder('gbk').decode(bytes); } catch (e) { /* no gbk */ }
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  /** 解压 raw deflate 数据（ZIP method 8） */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw zipError('ZIP_NO_DEFLATE');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer();
  }

  /** 扫描尾部定位 EOCD（允许尾部有最多 64KB 注释） */
  function findEocd(dv, len) {
    const stop = Math.max(0, len - 22 - 65535);
    for (let i = len - 22; i >= stop; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  function readExtraSizes(dv, start, end) {
    // ZIP64 扩展字段：id=0x0001，按顺序给 未压缩大小 / 压缩大小 / 本地头偏移
    let p = start;
    const out = {};
    while (p + 4 <= end) {
      const id = dv.getUint16(p, true);
      const size = dv.getUint16(p + 2, true);
      if (p + 4 + size > end) break;
      if (id === 0x0001) {
        let q = p + 4;
        const end2 = p + 4 + size;
        if (out.uncomp === undefined && q + 8 <= end2) { out.uncomp = Number(dv.getBigUint64(q, true)); q += 8; }
        if (out.comp === undefined && q + 8 <= end2) { out.comp = Number(dv.getBigUint64(q, true)); q += 8; }
        if (out.offset === undefined && q + 8 <= end2) { out.offset = Number(dv.getBigUint64(q, true)); q += 8; }
      }
      p += 4 + size;
    }
    return out;
  }

  function parseCentralDirectory(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const len = u8.length;
    if (len < 22) throw zipError('ZIP_BAD');

    const eocd = findEocd(dv, len);
    if (eocd < 0) throw zipError('ZIP_BAD');

    let entryCount = dv.getUint16(eocd + 10, true);
    let cdSize = dv.getUint32(eocd + 12, true);
    let cdOffset = dv.getUint32(eocd + 16, true);

    // ZIP64：EOCD 里出现 0xFFFF/0xFFFFFFFF 哨兵值时，真正的信息在 ZIP64 EOCD
    if (entryCount === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
      const locOff = eocd - 20;
      if (locOff >= 0 && dv.getUint32(locOff, true) === SIG_Z64_LOC) {
        const z64Off = Number(dv.getBigUint64(locOff + 8, true));
        if (z64Off >= 0 && z64Off + 56 <= len && dv.getUint32(z64Off, true) === SIG_Z64_EOCD) {
          entryCount = Number(dv.getBigUint64(z64Off + 32, true));
          cdSize = Number(dv.getBigUint64(z64Off + 40, true));
          cdOffset = Number(dv.getBigUint64(z64Off + 48, true));
        }
      }
    }

    if (cdOffset + 4 > len) throw zipError('ZIP_BAD');

    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < entryCount && p + 46 <= len; i++) {
      if (dv.getUint32(p, true) !== SIG_CEN) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      let compSize = dv.getUint32(p + 20, true);
      let uncompSize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      let localOffset = dv.getUint32(p + 42, true);

      const nameBytes = u8.subarray(p + 46, p + 46 + nameLen);
      const name = decodeName(nameBytes, (flags & 0x0800) !== 0);

      if (uncompSize === 0xFFFFFFFF || compSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
        const z = readExtraSizes(dv, p + 46 + nameLen, p + 46 + nameLen + extraLen);
        if (z.uncomp !== undefined && uncompSize === 0xFFFFFFFF) uncompSize = z.uncomp;
        if (z.comp !== undefined && compSize === 0xFFFFFFFF) compSize = z.comp;
        if (z.offset !== undefined && localOffset === 0xFFFFFFFF) localOffset = z.offset;
      }

      entries.push({
        name: name,
        method: method,
        compSize: compSize,
        uncompSize: uncompSize,
        offset: localOffset,
        isDir: /\/$/.test(name),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
  }

  async function open(buf) {
    const entries = parseCentralDirectory(buf);
    const byName = new Map();
    entries.forEach(function (e) { if (!byName.has(e.name)) byName.set(e.name, e); });
    const u8 = new Uint8Array(buf);

    function get(name) { return byName.get(name) || null; }

    function localData(entry) {
      const dv = new DataView(buf);
      if (entry.offset + 30 > u8.length) throw zipError('ZIP_BAD');
      if (dv.getUint32(entry.offset, true) !== SIG_LOCAL) throw zipError('ZIP_BAD');
      const nameLen = dv.getUint16(entry.offset + 26, true);
      const extraLen = dv.getUint16(entry.offset + 28, true);
      const start = entry.offset + 30 + nameLen + extraLen;
      const end = start + entry.compSize;
      if (end > u8.length) throw zipError('ZIP_BAD');
      return u8.subarray(start, end);
    }

    async function read(name) {
      const entry = get(name);
      if (!entry) return null;
      const raw = localData(entry);
      if (entry.method === 0) return raw.slice().buffer;
      if (entry.method === 8) {
        const out = await inflateRaw(raw);
        return out;
      }
      throw zipError('ZIP_UNSUPPORTED_METHOD');
    }

    async function readText(name) {
      const ab = await read(name);
      if (!ab) return null;
      return decodeBytes(ab);
    }

    return {
      names: entries.map(function (e) { return e.name; }),
      entries: entries,
      has: function (name) { return byName.has(name); },
      get: get,
      read: read,
      readText: readText,
      size: u8.length,
    };
  }

  /** 自动识别 UTF-8(BOM) / UTF-16 / UTF-8 / GBK */
  function decodeBytes(ab) {
    const bytes = new Uint8Array(ab);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(ab);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(ab);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(ab);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(ab);
    } catch (e) {
      try { return new TextDecoder('gbk').decode(ab); } catch (e2) { return new TextDecoder('utf-8').decode(ab); }
    }
  }

  return { open: open, decodeBytes: decodeBytes };
})();
