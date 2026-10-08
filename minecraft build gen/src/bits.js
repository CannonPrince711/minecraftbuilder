// Litematica-style bit arrays: `bits` per entry, packed back to back across 64-bit
// longs (entries may span two longs). Works on 32-bit halves to avoid slow BigInt math.

// longs: array/BigInt64Array of signed 64-bit values -> Uint32Array of `count` entries.
export function unpackSpanning(longs, bits, count) {
  const words = new Uint32Array(longs.length * 2);
  for (let i = 0; i < longs.length; i++) {
    const v = BigInt.asUintN(64, BigInt(longs[i]));
    words[2 * i] = Number(v & 0xffffffffn);
    words[2 * i + 1] = Number(v >> 32n);
  }
  const out = new Uint32Array(count);
  const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const p = i * bits, w = p >>> 5, off = p & 31;
    let v = words[w] >>> off;
    if (off + bits > 32) v |= words[w + 1] << (32 - off);
    out[i] = (v & mask) >>> 0;
  }
  return out;
}

// values: entries < 2^bits -> BigInt64Array of packed longs.
export function packSpanning(values, bits) {
  const longs = Math.ceil((values.length * bits) / 64);
  const words = new Uint32Array(longs * 2 + 1);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] >>> 0, p = i * bits, w = p >>> 5, off = p & 31;
    words[w] |= v << off;
    if (off + bits > 32) words[w + 1] |= v >>> (32 - off);
  }
  const out = new BigInt64Array(longs);
  for (let i = 0; i < longs; i++) out[i] = BigInt.asIntN(64, (BigInt(words[2 * i + 1]) << 32n) | BigInt(words[2 * i]));
  return out;
}
