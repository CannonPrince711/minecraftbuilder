// Compression helpers built on the web-standard (De)CompressionStream API,
// which exists in all current browsers and in Node 18+.

async function pipe(u8, stream) {
  try {
    const res = new Response(new Blob([u8]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) { throw damaged(e); }
}
const damaged = (e) => new Error(`Compressed data is damaged or incomplete (${(e && (e.message || e.name)) || 'unknown'})`);

// Runtimes without (De)CompressionStream (the Bun-built .exe) fall back to node:zlib.
const native = typeof DecompressionStream !== 'undefined' && typeof CompressionStream !== 'undefined';
let zlibP;
const zlib = () => (zlibP ||= import('node:zlib'));
const viaZlib = (fn) => async (u8) => {
  const z = await zlib();
  try { return new Uint8Array(z[fn](u8)); } catch (e) { throw damaged(e); }
};

export const gunzip = native ? (u8) => pipe(u8, new DecompressionStream('gzip')) : viaZlib('gunzipSync');
export const inflate = native ? (u8) => pipe(u8, new DecompressionStream('deflate')) : viaZlib('inflateSync');
export const inflateRaw = native ? (u8) => pipe(u8, new DecompressionStream('deflate-raw')) : viaZlib('inflateRawSync');
export const gzip = native ? (u8) => pipe(u8, new CompressionStream('gzip')) : viaZlib('gzipSync');

/** Decompress if gzip/zlib-wrapped, otherwise return the bytes as-is. */
export async function maybeDecompress(u8) {
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) return gunzip(u8);
  if (u8.length > 2 && u8[0] === 0x78 && ((u8[0] << 8) | u8[1]) % 31 === 0) return inflate(u8);
  return u8;
}

// LZ4 as written by lz4-java's LZ4BlockOutputStream (region compression type 4, 1.20.5+).
export function lz4BlockStream(u8) {
  const out = [];
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 0;
  while (p + 21 <= u8.length) {
    const magic = String.fromCharCode(...u8.subarray(p, p + 8));
    if (magic !== 'LZ4Block') break;
    const token = u8[p + 8];
    const method = token & 0xf0;
    const clen = dv.getInt32(p + 9, true);
    const dlen = dv.getInt32(p + 13, true);
    p += 21;
    if (dlen === 0) break; // end mark
    const block = u8.subarray(p, p + clen);
    p += clen;
    out.push(method === 0x10 ? block.slice() : lz4Block(block, dlen));
  }
  let n = 0; for (const b of out) n += b.length;
  const all = new Uint8Array(n); let o = 0; for (const b of out) { all.set(b, o); o += b.length; }
  return all;
}

function lz4Block(src, dlen) {
  const dst = new Uint8Array(dlen);
  let s = 0, d = 0;
  while (s < src.length) {
    const tok = src[s++];
    let lit = tok >>> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    dst.set(src.subarray(s, s + lit), d); s += lit; d += lit;
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let ml = tok & 15;
    if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
    ml += 4;
    for (let i = 0; i < ml; i++, d++) dst[d] = dst[d - off];
  }
  return dst;
}
