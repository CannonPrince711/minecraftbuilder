// Minimal NBT writer (big-endian, uncompressed) for schematic files.
// Build values with the helpers below, e.g. compound({ Width: short(5) }).

const T = { byte: 1, short: 2, int: 3, long: 4, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12 };

export const byte = (v) => ({ t: T.byte, v });
export const short = (v) => ({ t: T.short, v });
export const int = (v) => ({ t: T.int, v });
export const long = (v) => ({ t: T.long, v: BigInt(v) });
export const longArray = (v) => ({ t: T.longArray, v }); // BigInt64Array or array of BigInt
export const string = (v) => ({ t: T.string, v });
export const byteArray = (v) => ({ t: T.byteArray, v }); // Uint8Array / Buffer
export const intArray = (v) => ({ t: T.intArray, v });
export const list = (itemType, v) => ({ t: T.list, itemType: T[itemType], v });
export const compound = (v) => ({ t: T.compound, v });

class Writer {
  constructor() { this.chunks = []; }
  u8(n) { this.chunks.push(Buffer.from([n & 255])); }
  i16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n); this.chunks.push(b); }
  i32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); this.chunks.push(b); }
  i64(n) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64, n)); this.chunks.push(b); }
  str(s) { const b = Buffer.from(s, 'utf8'); this.i16(b.length); this.chunks.push(b); }
  bytes(b) { this.chunks.push(Buffer.from(b)); }
}

function payload(w, tag) {
  switch (tag.t) {
    case T.byte: return w.u8(tag.v);
    case T.short: return w.i16(tag.v);
    case T.int: return w.i32(tag.v);
    case T.long: return w.i64(tag.v);
    case T.longArray: w.i32(tag.v.length); for (const n of tag.v) w.i64(n); return;
    case T.string: return w.str(tag.v);
    case T.byteArray: w.i32(tag.v.length); return w.bytes(tag.v);
    case T.intArray: w.i32(tag.v.length); for (const n of tag.v) w.i32(n); return;
    case T.list:
      w.u8(tag.v.length ? tag.itemType : 0);
      w.i32(tag.v.length);
      for (const item of tag.v) payload(w, item);
      return;
    case T.compound:
      for (const [name, child] of Object.entries(tag.v)) { w.u8(child.t); w.str(name); payload(w, child); }
      return w.u8(0);
  }
  throw new Error(`Unknown NBT tag ${tag.t}`);
}

// Decode uncompressed NBT into plain JS values (compounds -> objects, lists/arrays ->
// arrays, longs -> BigInt). Returns { name, value } for the root tag.
export function decode(buf) {
  let o = 0;
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  const read = (t) => {
    switch (t) {
      case 1: return buf.readInt8(o++);
      case 2: { const v = buf.readInt16BE(o); o += 2; return v; }
      case 3: { const v = buf.readInt32BE(o); o += 4; return v; }
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return v; }
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = buf.readInt32BE(o); o += 4; const v = buf.subarray(o, o + n); o += n; return v; }
      case 8: return str();
      case 9: { const it = buf[o++]; const n = buf.readInt32BE(o); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(read(it)); return a; }
      case 10: { const r = {}; for (;;) { const tt = buf[o++]; if (tt === 0) return r; const name = str(); r[name] = read(tt); } }
      case 11: { const n = buf.readInt32BE(o); o += 4; const a = new Int32Array(n); for (let i = 0; i < n; i++, o += 4) a[i] = buf.readInt32BE(o); return a; }
      case 12: { const n = buf.readInt32BE(o); o += 4; const a = []; for (let i = 0; i < n; i++, o += 8) a.push(buf.readBigInt64BE(o)); return a; }
    }
    throw new Error(`Bad NBT tag type ${t} at byte ${o}`);
  };
  const t = buf[o++];
  if (t !== 10) throw new Error('Not an NBT file');
  const name = str();
  return { name, value: read(10) };
}

// Encode a named root compound.
export function encode(rootName, root) {
  const w = new Writer();
  w.u8(T.compound);
  w.str(rootName);
  payload(w, root);
  return Buffer.concat(w.chunks);
}
