// Tiny ZIP support: lazy reader over a Blob/File (for world .zip files of any size)
// and a store-only writer (for bundling several .schem files).
import { inflateRaw } from './compress.js';

const td = new TextDecoder();

export async function openZip(blob) {
  const size = blob.size;
  const tailLen = Math.min(size, 65557 + 20);
  const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a valid .zip');
  const dv = new DataView(tail.buffer);
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  // ZIP64 end of central directory locator
  if (cdOff === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64off = Number(dv.getBigUint64(loc + 8, true));
      const z = new DataView(await blob.slice(z64off, z64off + 56).arrayBuffer());
      count = Number(z.getBigUint64(32, true));
      cdSize = Number(z.getBigUint64(40, true));
      cdOff = Number(z.getBigUint64(48, true));
    }
  }
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const cdv = new DataView(cd.buffer);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cdv.getUint32(p, true) !== 0x02014b50) break;
    const method = cdv.getUint16(p + 10, true);
    let csize = cdv.getUint32(p + 20, true);
    let usize = cdv.getUint32(p + 24, true);
    const nlen = cdv.getUint16(p + 28, true), xlen = cdv.getUint16(p + 30, true), clen = cdv.getUint16(p + 32, true);
    let off = cdv.getUint32(p + 42, true);
    const name = td.decode(cd.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
    // zip64 extra field
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cdv.getUint16(x, true), len = cdv.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(cdv.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cdv.getBigUint64(q, true)); q += 8; }
        if (off === 0xffffffff) { off = Number(cdv.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + len;
    }
    if (!name.endsWith('/') && !name.startsWith('__MACOSX/')) entries.set(name, { method, csize, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  return {
    paths: [...entries.keys()],
    async read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`Missing ${name} in zip`);
      const h = new DataView(await blob.slice(e.off, e.off + 30).arrayBuffer());
      const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const data = new Uint8Array(await blob.slice(start, start + e.csize).arrayBuffer());
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data);
      throw new Error(`Unsupported zip compression in ${name}`);
    },
  };
}

// ---- writer (store only; .schem files are already gzipped) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** files: [{ name, data: Uint8Array }] -> Uint8Array zip */
export function makeZip(files) {
  const te = new TextEncoder();
  const parts = []; const central = []; let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = te.encode(f.name); const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
