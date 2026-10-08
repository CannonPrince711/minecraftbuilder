// In-memory block volume shared by every reader and writer.
// Block index: x + z * width + y * width * length (the Sponge layout).
//   blockEntities: [{ pos: [x,y,z], id, data: compound payload (no x/y/z/id) }]
//   entities:      [{ pos: [x,y,z] (doubles, relative), id, data }]

export class Schematic {
  constructor(width, height, length) {
    this.width = width; this.height = height; this.length = length;
    this.palette = [];
    this.paletteMap = new Map();
    this.blocks = new Uint32Array(width * height * length);
    this.blockEntities = [];
    this.entities = [];
    this.offset = [0, 0, 0];
    this.dataVersion = 0;
    this.name = '';
  }

  paletteIndex(state) {
    let i = this.paletteMap.get(state);
    if (i === undefined) { i = this.palette.length; this.palette.push(state); this.paletteMap.set(state, i); }
    return i;
  }

  index(x, y, z) { return x + z * this.width + y * this.width * this.length; }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.width && y < this.height && z < this.length; }
  get(x, y, z) { return this.inside(x, y, z) ? this.palette[this.blocks[this.index(x, y, z)]] : 'minecraft:air'; }
  set(x, y, z, state) { this.blocks[this.index(x, y, z)] = this.paletteIndex(state); }

  /** New schematic containing the box [x0..x1] x [y0..y1] x [z0..z1] (inclusive). */
  crop(x0, y0, z0, x1, y1, z1) {
    const W = x1 - x0 + 1, H = y1 - y0 + 1, L = z1 - z0 + 1;
    const out = new Schematic(W, H, L);
    out.palette = this.palette.slice();
    out.paletteMap = new Map(this.paletteMap);
    for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) {
      const src = this.index(x0, y0 + y, z0 + z), dst = out.index(0, y, z);
      out.blocks.set(this.blocks.subarray(src, src + W), dst);
    }
    out.blockEntities = this.blockEntities
      .filter((b) => b.pos[0] >= x0 && b.pos[0] <= x1 && b.pos[1] >= y0 && b.pos[1] <= y1 && b.pos[2] >= z0 && b.pos[2] <= z1)
      .map((b) => ({ ...b, pos: [b.pos[0] - x0, b.pos[1] - y0, b.pos[2] - z0] }));
    out.entities = this.entities.map((e) => ({ ...e }));
    out.offset = [this.offset[0] + x0, this.offset[1] + y0, this.offset[2] + z0];
    for (const k of ['dataVersion', 'name', 'mixedVersions', 'missingChunks', 'badChunks', 'fromLegacy']) out[k] = this[k];
    out.compact();
    return out;
  }

  /** Drop unused palette entries, keeping air (if present) first. */
  compact() {
    const used = new Uint8Array(this.palette.length);
    for (let i = 0; i < this.blocks.length; i++) used[this.blocks[i]] = 1;
    const order = [];
    const airIdx = this.paletteMap.get('minecraft:air');
    if (airIdx !== undefined && used[airIdx]) order.push(airIdx);
    for (let i = 0; i < this.palette.length; i++) if (used[i] && i !== airIdx) order.push(i);
    const remap = new Uint32Array(this.palette.length);
    order.forEach((old, n) => { remap[old] = n; });
    for (let i = 0; i < this.blocks.length; i++) this.blocks[i] = remap[this.blocks[i]];
    this.palette = order.map((i) => this.palette[i]);
    this.paletteMap = new Map(this.palette.map((s, i) => [s, i]));
  }

  /** Bounding box of non-air blocks, or null when empty. */
  contentBounds() {
    const airs = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].map((s) => this.paletteMap.get(s)).filter((v) => v !== undefined));
    let b = null;
    for (let y = 0; y < this.height; y++) for (let z = 0; z < this.length; z++) for (let x = 0; x < this.width; x++) {
      if (airs.has(this.blocks[this.index(x, y, z)])) continue;
      if (!b) b = [x, y, z, x, y, z];
      else { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.min(b[2], z); b[3] = Math.max(b[3], x); b[4] = Math.max(b[4], y); b[5] = Math.max(b[5], z); }
    }
    return b;
  }

  /** Remove empty space around the build. */
  trimmed() {
    const b = this.contentBounds();
    if (!b) return this;
    const out = this.crop(...b);
    out.entities = this.entities
      .map((e) => ({ ...e, pos: [e.pos[0] - b[0], e.pos[1] - b[1], e.pos[2] - b[2]] }))
      .filter((e) => e.pos[0] >= 0 && e.pos[1] >= 0 && e.pos[2] >= 0 && e.pos[0] < out.width + 1 && e.pos[1] < out.height + 1 && e.pos[2] < out.length + 1);
    return out;
  }

  /** Map every cave_air / void_air to air (WorldEdit treats them as distinct). */
  normalizeAir() {
    for (const s of ['minecraft:cave_air', 'minecraft:void_air']) {
      const i = this.paletteMap.get(s);
      if (i === undefined) continue;
      this.palette[i] = 'minecraft:air';
    }
    // merge duplicates
    const seen = new Map(); const remap = this.palette.map((s, i) => { if (!seen.has(s)) seen.set(s, i); return seen.get(s); });
    for (let i = 0; i < this.blocks.length; i++) this.blocks[i] = remap[this.blocks[i]];
    this.compact();
  }

  /** Count blocks per state name (properties stripped), sorted descending. */
  materialCounts() {
    const per = new Float64Array(this.palette.length);
    for (let i = 0; i < this.blocks.length; i++) per[this.blocks[i]]++;
    const m = new Map();
    this.palette.forEach((s, i) => { const n = s.replace(/\[.*$/, ''); m.set(n, (m.get(n) || 0) + per[i]); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }
}
