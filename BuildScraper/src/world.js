// A Minecraft Java world save, read through a file provider:
//   provider.paths: string[]  (relative paths inside the world folder, '/' separated)
//   provider.read(path): Promise<Uint8Array>
import * as nbt from './nbt.js';
import { get, T } from './nbt.js';
import { maybeDecompress } from './compress.js';
import { RegionFile } from './region.js';
import { decodeChunk } from './chunk.js';
import { blockColor } from './colors.js';

const WATERY = /^minecraft:(water|kelp|kelp_plant|seagrass|tall_seagrass|bubble_column)\b/;
import { Schematic } from './schematic.js';
import { fixLegacy, LEGACY_DATA_VERSION } from './legacy-fix.js';

const AIRS = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);
export const isAir = (s) => AIRS.has(s);

export class World {
  static async open(provider) {
    const w = new World(provider);
    await w.init();
    return w;
  }

  constructor(provider) {
    // Strip a common leading folder (zips usually contain "MyWorld/level.dat").
    const levelPath = provider.paths.filter((p) => /(^|\/)level\.dat$/.test(p)).sort((a, b) => a.length - b.length)[0];
    this.prefix = levelPath ? levelPath.slice(0, -'level.dat'.length) : '';
    this.provider = provider;
    this.paths = new Set(provider.paths.filter((p) => p.startsWith(this.prefix)).map((p) => p.slice(this.prefix.length)));
    this.regionCache = new Map();
    this.chunkCache = new Map();
  }

  read(rel) { return this.provider.read(this.prefix + rel); }

  /** Errors are passed to onError(where, item, err) when set, so callers can log them. */
  report(where, item, err) { if (this.onError) this.onError(where, item, err); else console.warn(where, item, err); }

  async init() {
    this.info = { name: 'Unknown world', version: null, dataVersion: null, spawn: null, player: null };
    if (this.paths.has('level.dat')) {
      try {
        const root = nbt.parse(await maybeDecompress(await this.read('level.dat'))).tag.value;
        const d = get(root, 'Data') || root;
        const ver = get(d, 'Version');
        this.info.name = get(d, 'LevelName') || this.info.name;
        this.info.dataVersion = get(d, 'DataVersion') ?? null;
        this.info.version = ver ? get(ver, 'Name') : null;
        const spawn = get(d, 'spawn');
        if (spawn && get(spawn, 'pos')) { const p = get(spawn, 'pos'); this.info.spawn = [p[0], p[1], p[2]]; }
        else if (get(d, 'SpawnX') !== undefined) this.info.spawn = [get(d, 'SpawnX'), get(d, 'SpawnY'), get(d, 'SpawnZ')];
        const player = get(d, 'Player');
        if (player && get(player, 'Pos')) {
          const pos = get(player, 'Pos').items;
          this.info.player = { pos: pos.map(Math.floor), dimension: get(player, 'Dimension') };
        }
      } catch (e) { this.info.levelError = String(e.message || e); }
    }
    this.info.hasLevel = this.paths.has('level.dat');
    this.dimensions = this.findDimensions();
  }

  findDimensions() {
    const dirs = new Map();
    for (const p of this.paths) {
      const m = p.match(/^(.*?)(?:^|\/)?region\/r\.(-?\d+)\.(-?\d+)\.mca$/);
      if (!m) continue;
      const dir = p.slice(0, p.lastIndexOf('region/'));
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir).push([+m[2], +m[3]]);
    }
    const label = (dir) => {
      const d = dir.replace(/\/$/, '');
      if (d === '' || d === 'dimensions/minecraft/overworld') return 'Overworld';
      if (d === 'DIM-1' || d === 'dimensions/minecraft/the_nether') return 'Nether';
      if (d === 'DIM1' || d === 'dimensions/minecraft/the_end') return 'The End';
      const m = d.match(/^dimensions\/([^/]+)\/(.+)$/);
      return m ? `${m[1]}:${m[2]}` : d;
    };
    const order = { Overworld: 0, Nether: 1, 'The End': 2 };
    return [...dirs.entries()]
      .map(([dir, regions]) => ({ id: dir, label: label(dir), regions }))
      .sort((a, b) => (order[a.label] ?? 9) - (order[b.label] ?? 9) || a.label.localeCompare(b.label));
  }

  async region(dir, rx, rz, kind = 'region') {
    const key = `${dir}|${kind}|${rx}|${rz}`;
    if (this.regionCache.has(key)) return this.regionCache.get(key);
    const path = `${dir}${kind}/r.${rx}.${rz}.mca`;
    let reg = null;
    if (this.paths.has(path)) {
      const bytes = await this.read(path);
      reg = new RegionFile(bytes, async (name) => {
        const ext = `${dir}${kind}/${name}`;
        return this.paths.has(ext) ? this.read(ext) : null;
      });
    }
    this.regionCache.set(key, reg);
    if (this.regionCache.size > 24) this.regionCache.delete(this.regionCache.keys().next().value);
    return reg;
  }

  /** Block coordinates of the middle of the saved chunks in one region file. */
  async regionCentroid(dir, rx, rz) {
    const reg = await this.region(dir, rx, rz);
    let sx = 0, sz = 0, n = 0;
    if (reg) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if (reg.hasChunk(x, z)) { sx += x; sz += z; n++; }
    if (!n) return [rx * 512 + 256, rz * 512 + 256];
    return [rx * 512 + Math.round(sx / n) * 16 + 8, rz * 512 + Math.round(sz / n) * 16 + 8];
  }

  /** Decoded chunk or null. */
  async chunk(dir, cx, cz) {
    const key = `${dir}|${cx}|${cz}`;
    if (this.chunkCache.has(key)) return this.chunkCache.get(key);
    let c = null;
    try {
      const reg = await this.region(dir, cx >> 5, cz >> 5);
      if (reg) {
        const root = await reg.readChunk(cx & 31, cz & 31, cx, cz);
        if (root) c = decodeChunk(root);
      }
    } catch (e) {
      // a damaged chunk shouldn't sink the whole export: report it and treat it as missing
      this.report('Read chunk', `chunk ${cx}, ${cz} in ${dir || ''}region/r.${cx >> 5}.${cz >> 5}.mca`, e);
      this.badChunks = (this.badChunks || 0) + 1;
      c = null;
    }
    this.chunkCache.set(key, c);
    if (this.chunkCache.size > 2048) this.chunkCache.delete(this.chunkCache.keys().next().value);
    return c;
  }

  /** Entities stored in entities/r.X.Z.mca (1.17+). */
  async entityChunk(dir, cx, cz) {
    const reg = await this.region(dir, cx >> 5, cz >> 5, 'entities');
    if (!reg) return [];
    const root = await reg.readChunk(cx & 31, cz & 31, cx, cz);
    const list = root && get(root.value, 'Entities');
    return list ? list.items : [];
  }

  /**
   * Render a 512x512 top-down map tile for region (rx, rz).
   * Returns { rgba: Uint8ClampedArray, heights: Int16Array, present: boolean }.
   */
  async renderRegionMap(dir, rx, rz) {
    const rgba = new Uint8ClampedArray(512 * 512 * 4);
    const heights = new Int16Array(512 * 512).fill(-32768);
    let reg;
    try { reg = await this.region(dir, rx, rz); }
    catch (e) { this.report('Read region file', `${dir}region/r.${rx}.${rz}.mca`, e); throw e; }
    if (!reg) return { rgba, heights, present: false };
    let bad = 0, firstErr = null;
    const colors = new Int32Array(512 * 512).fill(-1);
    const depth = new Uint8Array(512 * 512);
    for (let lz = 0; lz < 32; lz++) {
      for (let lx = 0; lx < 32; lx++) {
        if (!reg.hasChunk(lx, lz)) continue;
        let c;
        try {
          const root = await reg.readChunk(lx, lz, rx * 32 + lx, rz * 32 + lz);
          if (!root) continue;
          c = decodeChunk(root);
        } catch (e) { bad++; firstErr = firstErr || e; continue; }
        topDownChunk(c, lx * 16, lz * 16, colors, heights, depth);
      }
    }
    if (bad) this.report('Draw map', `${bad} unreadable chunk(s) in ${dir}region/r.${rx}.${rz}.mca (shown blank)`, firstErr);
    for (let z = 0; z < 512; z++) {
      for (let x = 0; x < 512; x++) {
        const i = z * 512 + x;
        const col = colors[i];
        if (col < 0) continue;
        let r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255;
        let k = 1;
        if (depth[i]) k = Math.max(0.55, 1 - depth[i] * 0.04);
        else if (z > 0 && heights[i - 512] !== -32768) {
          const dh = heights[i] - heights[i - 512];
          k = dh > 0 ? 1.12 : dh < 0 ? 0.82 : 1;
        }
        rgba[i * 4] = r * k; rgba[i * 4 + 1] = g * k; rgba[i * 4 + 2] = b * k; rgba[i * 4 + 3] = 255;
      }
    }
    return { rgba, heights, present: true };
  }

  /** Highest non-air block per column for a box's footprint (used to suggest a Y range). */
  async surfaceHeights(dir, x0, z0, x1, z1) {
    const out = [];
    for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
      for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) {
        const c = await this.chunk(dir, cx, cz);
        if (!c) continue;
        const colors = new Int32Array(256).fill(-1), heights = new Int16Array(256).fill(-32768), depth = new Uint8Array(256);
        topDownChunk(c, 0, 0, colors, heights, depth, 16);
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
          const wx = cx * 16 + x, wz = cz * 16 + z;
          if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
          const h = heights[z * 16 + x];
          if (h !== -32768) out.push({ x: wx, z: wz, y: h });
        }
      }
    }
    return out;
  }

  /**
   * Copy a box (inclusive world coords) into a Schematic.
   * opts: { blockEntities = true, entities = true, onProgress(fraction) }
   */
  async extract(dir, min, max, opts = {}) {
    const { blockEntities = true, entities = true, onProgress } = opts;
    const lo = [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])];
    const hi = [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])];
    // Pad by one block so legacy neighbour-dependent states (fences, stairs, doors) resolve at the edges.
    const pmin = [lo[0] - 1, lo[1] - 1, lo[2] - 1], pmax = [hi[0] + 1, hi[1] + 1, hi[2] + 1];
    const W = pmax[0] - pmin[0] + 1, H = pmax[1] - pmin[1] + 1, L = pmax[2] - pmin[2] + 1;
    if (W * H * L > 120_000_000) throw new Error('Selection is too large (over ~120 million blocks). Select a smaller area.');
    const sch = new Schematic(W, H, L);
    sch.offset = pmin.slice();
    const air = sch.paletteIndex('minecraft:air');
    sch.blocks.fill(air);
    const legacyTE = [];
    let anyLegacy = false, minDV = Infinity, maxDV = 0, missing = 0, chunksRead = 0;
    const badBefore = this.badChunks || 0;

    const cx0 = pmin[0] >> 4, cx1 = pmax[0] >> 4, cz0 = pmin[2] >> 4, cz1 = pmax[2] >> 4;
    const total = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
    let done = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = await this.chunk(dir, cx, cz);
        done++;
        if (onProgress && done % 4 === 0) onProgress(done / total);
        if (!c) { missing++; continue; }
        chunksRead++;
        if (c.legacy) anyLegacy = true;
        const dv = c.legacy ? LEGACY_DATA_VERSION : c.dataVersion;
        if (dv) { minDV = Math.min(minDV, dv); maxDV = Math.max(maxDV, dv); }
        const bx0 = Math.max(pmin[0], cx * 16), bx1 = Math.min(pmax[0], cx * 16 + 15);
        const bz0 = Math.max(pmin[2], cz * 16), bz1 = Math.min(pmax[2], cz * 16 + 15);
        for (const [sy, sec] of c.sections) {
          const y0 = Math.max(pmin[1], sy * 16), y1 = Math.min(pmax[1], sy * 16 + 15);
          if (y0 > y1) continue;
          const map = sec.palette.map((s) => sch.paletteIndex(s));
          for (let y = y0; y <= y1; y++) {
            const ly = y - sy * 16, oy = (y - pmin[1]) * W * L;
            for (let z = bz0; z <= bz1; z++) {
              const lz = z - cz * 16, oz = oy + (z - pmin[2]) * W;
              for (let x = bx0; x <= bx1; x++) {
                const lx = x - cx * 16;
                sch.blocks[oz + x - pmin[0]] = sec.idx ? map[sec.idx[ly * 256 + lz * 16 + lx]] : map[0];
              }
            }
          }
        }
        if (blockEntities || c.legacy) {
          for (const be of c.blockEntities) {
            const x = get(be, 'x'), y = get(be, 'y'), z = get(be, 'z');
            if (x < pmin[0] || x > pmax[0] || y < pmin[1] || y > pmax[1] || z < pmin[2] || z > pmax[2]) continue;
            const id = get(be, 'id') || '';
            const data = { ...be };
            delete data.x; delete data.y; delete data.z; delete data.id; delete data.keepPacked;
            const entry = { pos: [x - pmin[0], y - pmin[1], z - pmin[2]], id, data, legacy: c.legacy };
            sch.blockEntities.push(entry);
          }
        }
        if (entities) {
          let list = c.entities;
          if (!list.length && (c.dataVersion >= 2724)) {
            try { list = await this.entityChunk(dir, cx, cz); }
            catch (e) { this.report('Read entities', `chunk ${cx}, ${cz} in ${dir}entities/r.${cx >> 5}.${cz >> 5}.mca`, e); list = []; }
          }
          for (const e of list) addEntity(sch, e, lo, hi, pmin);
        }
      }
    }
    const bad = (this.badChunks || 0) - badBefore;
    if (!chunksRead) throw new Error(bad ? `All ${bad} chunk(s) in that area could not be read. See the error log for details.` : 'No saved chunks were found in that area. Check the coordinates and dimension.');
    if (anyLegacy) fixLegacy(sch);
    sch.dataVersion = minDV === Infinity ? (this.info.dataVersion || 0) : minDV;
    sch.mixedVersions = minDV !== maxDV && maxDV > 0;
    sch.missingChunks = missing - bad;
    sch.badChunks = bad;
    sch.fromLegacy = anyLegacy;
    if (!blockEntities) sch.blockEntities = [];
    const out = sch.crop(1, 1, 1, W - 2, H - 2, L - 2);
    out.offset = lo.slice();
    out.entities.forEach((e) => { e.pos = [e.pos[0] - 1, e.pos[1] - 1, e.pos[2] - 1]; });
    return out;
  }
}

function addEntity(sch, e, lo, hi, pmin) {
  const pos = get(e, 'Pos');
  if (!pos) return;
  const [x, y, z] = pos.items;
  if (x < lo[0] || x >= hi[0] + 1 || y < lo[1] || y >= hi[1] + 1 || z < lo[2] || z >= hi[2] + 1) return;
  const id = get(e, 'id') || '';
  if (id === 'minecraft:player') return;
  const data = { ...e };
  for (const k of ['Pos', 'id', 'UUID', 'UUIDMost', 'UUIDLeast']) delete data[k];
  sch.entities.push({ pos: [x - pmin[0], y - pmin[1], z - pmin[2]], id, data });
}

/** Fill colours/heights for a decoded chunk at offset (ox, oz) in a grid of the given width. */
function topDownChunk(c, ox, oz, colors, heights, depth, gridW = 512) {
  const ys = [...c.sections.keys()].sort((a, b) => b - a);
  const secs = ys.map((y) => c.sections.get(y));
  const solidPal = secs.map((s) => s.palette.map((st) => blockColor(st)));
  const waterPal = secs.map((s) => s.palette.map((st) => WATERY.test(st)));
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const gi = (oz + z) * gridW + ox + x;
      let waterTop = null, wd = 0;
      outer: for (let si = 0; si < secs.length; si++) {
        const s = secs[si], pal = solidPal[si], wp = waterPal[si];
        if (!s.idx && pal[0] < 0) continue;
        for (let ly = 15; ly >= 0; ly--) {
          const p = s.idx ? s.idx[ly * 256 + z * 16 + x] : 0;
          if (pal[p] < 0) continue;
          const y = ys[si] * 16 + ly;
          if (wp[p]) {
            if (waterTop === null) waterTop = y;
            wd++;
            if (wd < 16) continue;
          }
          if (waterTop !== null) {
            colors[gi] = 0x3f76e4; heights[gi] = waterTop; depth[gi] = Math.min(wd, 15);
          } else {
            colors[gi] = pal[p]; heights[gi] = y;
          }
          break outer;
        }
      }
      if (colors[gi] < 0 && waterTop !== null) { colors[gi] = 0x3f76e4; heights[gi] = waterTop; depth[gi] = 15; }
    }
  }
}
