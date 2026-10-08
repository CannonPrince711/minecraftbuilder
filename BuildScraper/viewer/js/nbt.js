/* Minimal big-endian NBT reader (Java Edition). Works in browsers and Node. */
(function (root) {
  'use strict';

  // Long arrays are kept as Uint32Array of [lo, hi, lo, hi, ...] words so that
  // bit-packed data (litematic, 1.16+ chunk style) can be read without BigInt.
  function LongArray(words) { this.words = words; this.length = words.length >> 1; }
  LongArray.prototype.toNumber = function (i) {
    var lo = this.words[i * 2], hi = this.words[i * 2 + 1] | 0;
    return hi * 4294967296 + lo;
  };

  function readNBT(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var p = 0;
    var td = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

    function str() {
      var len = dv.getUint16(p); p += 2;
      var s = td ? td.decode(u8.subarray(p, p + len)) : Buffer.from(u8.subarray(p, p + len)).toString('utf8');
      p += len; return s;
    }
    function payload(t) {
      var n, i, a;
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: n = dv.getInt16(p); p += 2; return n;
        case 3: n = dv.getInt32(p); p += 4; return n;
        case 4: { var hi = dv.getInt32(p), lo = dv.getUint32(p + 4); p += 8; return hi * 4294967296 + lo; }
        case 5: n = dv.getFloat32(p); p += 4; return n;
        case 6: n = dv.getFloat64(p); p += 8; return n;
        case 7: n = dv.getInt32(p); p += 4; a = new Int8Array(u8.buffer, u8.byteOffset + p, n); p += n; return a;
        case 8: return str();
        case 9: {
          var et = dv.getUint8(p++); n = dv.getInt32(p); p += 4;
          var list = new Array(Math.max(0, n));
          for (i = 0; i < n; i++) list[i] = payload(et);
          return list;
        }
        case 10: {
          var obj = {};
          for (;;) {
            var ct = dv.getUint8(p++);
            if (ct === 0) break;
            var name = str();
            obj[name] = payload(ct);
          }
          return obj;
        }
        case 11: n = dv.getInt32(p); p += 4; a = new Int32Array(n);
          for (i = 0; i < n; i++) { a[i] = dv.getInt32(p); p += 4; } return a;
        case 12: n = dv.getInt32(p); p += 4; a = new Uint32Array(n * 2);
          for (i = 0; i < n; i++) { a[i * 2 + 1] = dv.getUint32(p); a[i * 2] = dv.getUint32(p + 4); p += 8; }
          return new LongArray(a);
        default: throw new Error('Unknown NBT tag type ' + t + ' at byte ' + (p - 1));
      }
    }

    var t = dv.getUint8(p++);
    if (t !== 10) throw new Error('Not an NBT file (root tag is ' + t + ', expected compound)');
    var rootName = str();
    return { name: rootName, value: payload(10) };
  }

  function isGzip(u8) { return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b; }
  function isZlib(u8) { return u8.length > 2 && u8[0] === 0x78 && (u8[1] === 0x9c || u8[1] === 0x01 || u8[1] === 0xda || u8[1] === 0x5e); }

  // Browser decompression (DecompressionStream). Node callers decompress themselves.
  async function decompress(u8) {
    if (!isGzip(u8) && !isZlib(u8)) return u8;
    var fmt = isGzip(u8) ? 'gzip' : 'deflate';
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress files (DecompressionStream missing). Please update your browser.');
    var ds = new DecompressionStream(fmt);
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  var api = { readNBT: readNBT, LongArray: LongArray, isGzip: isGzip, isZlib: isZlib, decompress: decompress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NBT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
