// Minimal Java Edition NBT reader/writer (big-endian).
// Tags are kept typed so block entity data survives a round trip:
//   { type: T.Compound, value: { name: tag, ... } }
// Long arrays keep their raw words as a Uint32Array of [lo, hi, lo, hi, ...].

export const T = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
};

const utf8d = new TextDecoder();
const utf8e = new TextEncoder();

// Java "modified UTF-8" differs from UTF-8 only for NUL and astral chars; good enough for block data.
function decodeString(bytes) { return utf8d.decode(bytes); }

class Reader {
  constructor(buf) {
    this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.p = 0;
  }
  byte() { return this.dv.getInt8(this.p++); }
  ubyte() { return this.u8[this.p++]; }
  short() { const v = this.dv.getInt16(this.p); this.p += 2; return v; }
  ushort() { const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  int() { const v = this.dv.getInt32(this.p); this.p += 4; return v; }
  long() { const v = this.dv.getBigInt64(this.p); this.p += 8; return v; }
  float() { const v = this.dv.getFloat32(this.p); this.p += 4; return v; }
  double() { const v = this.dv.getFloat64(this.p); this.p += 8; return v; }
  string() { const n = this.ushort(); const s = decodeString(this.u8.subarray(this.p, this.p + n)); this.p += n; return s; }
  payload(type) {
    switch (type) {
      case T.Byte: return this.byte();
      case T.Short: return this.short();
      case T.Int: return this.int();
      case T.Long: return this.long();
      case T.Float: return this.float();
      case T.Double: return this.double();
      case T.ByteArray: { const n = this.int(); const a = new Int8Array(this.u8.slice(this.p, this.p + n).buffer); this.p += n; return a; }
      case T.String: return this.string();
      case T.List: {
        const et = this.ubyte(); const n = this.int(); const items = new Array(Math.max(0, n));
        for (let i = 0; i < n; i++) items[i] = this.payload(et);
        return { elementType: et, items };
      }
      case T.Compound: {
        const obj = {};
        for (;;) {
          const t = this.ubyte();
          if (t === T.End) break;
          const name = this.string();
          obj[name] = { type: t, value: this.payload(t) };
        }
        return obj;
      }
      case T.IntArray: {
        const n = this.int(); const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = this.int();
        return a;
      }
      case T.LongArray: {
        const n = this.int(); const w = new Uint32Array(n * 2);
        for (let i = 0; i < n; i++) { w[2 * i + 1] = this.dv.getUint32(this.p); w[2 * i] = this.dv.getUint32(this.p + 4); this.p += 8; }
        return w;
      }
      default: throw new Error(`Bad NBT tag type ${type} at byte ${this.p}`);
    }
  }
}

/** Parse uncompressed NBT. Returns { name, tag } where tag is the root compound tag. */
export function parse(buf) {
  const r = new Reader(buf);
  const type = r.ubyte();
  if (type !== T.Compound) throw new Error('Not an NBT file (root is not a compound)');
  const name = r.string();
  return { name, tag: { type, value: r.payload(T.Compound) } };
}

class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.dv = new DataView(this.buf.buffer); this.p = 0; }
  ensure(n) {
    if (this.p + n <= this.buf.length) return;
    let len = this.buf.length * 2; while (len < this.p + n) len *= 2;
    const nb = new Uint8Array(len); nb.set(this.buf.subarray(0, this.p)); this.buf = nb; this.dv = new DataView(nb.buffer);
  }
  ubyte(v) { this.ensure(1); this.buf[this.p++] = v & 0xff; }
  short(v) { this.ensure(2); this.dv.setInt16(this.p, v); this.p += 2; }
  int(v) { this.ensure(4); this.dv.setInt32(this.p, v); this.p += 4; }
  bytes(u8) { this.ensure(u8.length); this.buf.set(u8, this.p); this.p += u8.length; }
  string(s) { const b = utf8e.encode(s); this.ensure(2); this.dv.setUint16(this.p, b.length); this.p += 2; this.bytes(b); }
  payload(type, v) {
    switch (type) {
      case T.Byte: this.ubyte(v); break;
      case T.Short: this.short(v); break;
      case T.Int: this.int(v); break;
      case T.Long: this.ensure(8); this.dv.setBigInt64(this.p, BigInt(v)); this.p += 8; break;
      case T.Float: this.ensure(4); this.dv.setFloat32(this.p, v); this.p += 4; break;
      case T.Double: this.ensure(8); this.dv.setFloat64(this.p, v); this.p += 8; break;
      case T.ByteArray: this.int(v.length); this.bytes(new Uint8Array(v.buffer, v.byteOffset, v.length)); break;
      case T.String: this.string(v); break;
      case T.List: {
        const et = v.items.length ? v.elementType : (v.elementType || T.End);
        this.ubyte(et); this.int(v.items.length);
        for (const it of v.items) this.payload(et, it);
        break;
      }
      case T.Compound:
        for (const [k, tag] of Object.entries(v)) {
          if (!tag) continue;
          this.ubyte(tag.type); this.string(k); this.payload(tag.type, tag.value);
        }
        this.ubyte(T.End);
        break;
      case T.IntArray: this.int(v.length); for (const x of v) this.int(x); break;
      case T.LongArray: {
        const n = v.length / 2; this.int(n); this.ensure(n * 8);
        for (let i = 0; i < n; i++) { this.dv.setUint32(this.p, v[2 * i + 1]); this.dv.setUint32(this.p + 4, v[2 * i]); this.p += 8; }
        break;
      }
      default: throw new Error(`Cannot write NBT tag type ${type}`);
    }
  }
}

/** Serialize a root compound tag to uncompressed NBT bytes. */
export function write(rootTag, name = '') {
  const w = new Writer();
  w.ubyte(T.Compound); w.string(name); w.payload(T.Compound, rootTag.value);
  return w.buf.slice(0, w.p);
}

// ---- small helpers for building and reading typed tags ----
export const tag = {
  byte: (v) => ({ type: T.Byte, value: v }),
  short: (v) => ({ type: T.Short, value: v }),
  int: (v) => ({ type: T.Int, value: v }),
  long: (v) => ({ type: T.Long, value: BigInt(v) }),
  float: (v) => ({ type: T.Float, value: v }),
  double: (v) => ({ type: T.Double, value: v }),
  string: (v) => ({ type: T.String, value: v }),
  byteArray: (v) => ({ type: T.ByteArray, value: v }),
  intArray: (v) => ({ type: T.IntArray, value: Int32Array.from(v) }),
  list: (elementType, items) => ({ type: T.List, value: { elementType, items } }),
  compound: (obj = {}) => ({ type: T.Compound, value: obj }),
};

/** Get a child payload from a compound payload (plain object of tags). */
export function get(compound, key) { const t = compound && compound[key]; return t ? t.value : undefined; }

/** Convert a typed tag into plain JS (for inspection; loses exact types). */
export function simplify(t) {
  switch (t.type) {
    case T.Compound: { const o = {}; for (const [k, v] of Object.entries(t.value)) o[k] = simplify(v); return o; }
    case T.List: return t.value.items.map((v) => simplify({ type: t.value.elementType, value: v }));
    case T.Long: return Number(t.value);
    case T.ByteArray: case T.IntArray: return Array.from(t.value);
    default: return t.value;
  }
}

/** Deep clone a compound payload. */
export function cloneCompound(c) { return structuredClone(c); }
