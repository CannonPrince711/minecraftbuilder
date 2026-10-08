// Anvil region (.mca) file reading.
import { gunzip, inflate, lz4BlockStream } from './compress.js';
import * as nbt from './nbt.js';

export class RegionFile {
  /**
   * @param {Uint8Array} bytes  whole region file
   * @param {(name: string) => Promise<Uint8Array|null>} [getExternal]  loads c.X.Z.mcc for oversized chunks
   */
  constructor(bytes, getExternal) {
    this.u8 = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.getExternal = getExternal;
  }

  /** Local chunk coords 0..31 */
  hasChunk(lx, lz) {
    if (this.u8.length < 8192) return false;
    const loc = this.dv.getUint32(4 * ((lx & 31) + (lz & 31) * 32));
    return (loc >>> 8) !== 0 && (loc & 0xff) !== 0;
  }

  /** Returns the chunk root compound tag, or null if absent. */
  async readChunk(lx, lz, cx, cz) {
    if (!this.hasChunk(lx, lz)) return null;
    const loc = this.dv.getUint32(4 * ((lx & 31) + (lz & 31) * 32));
    const off = (loc >>> 8) * 4096;
    if (off + 5 > this.u8.length) return null;
    const len = this.dv.getUint32(off);
    const ctype = this.u8[off + 4];
    let data;
    if (ctype & 0x80) {
      if (!this.getExternal) throw new Error(`Chunk ${cx},${cz} is stored in an external .mcc file that was not provided`);
      data = await this.getExternal(`c.${cx}.${cz}.mcc`);
      if (!data) throw new Error(`Missing external chunk file c.${cx}.${cz}.mcc`);
    } else {
      data = this.u8.subarray(off + 5, off + 4 + len);
    }
    const raw = await decompress(ctype & 0x7f, data);
    return nbt.parse(raw).tag;
  }
}

async function decompress(type, data) {
  switch (type) {
    case 1: return gunzip(data);
    case 2: return inflate(data);
    case 3: return data;
    case 4: return lz4BlockStream(data);
    default: throw new Error(`Unsupported chunk compression type ${type}`);
  }
}
