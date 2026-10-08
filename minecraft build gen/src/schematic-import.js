// Read user schematics (.schem Sponge v1-3, .schematic MCEdit, .litematic, .nbt structure
// files - everything Build Scraper writes),
// translate every block into the agent's abstract roles, and pick out the user's
// materials as a custom theme.

import zlib from 'node:zlib';
import { decode } from './nbt.js';
import { unpackSpanning } from './bits.js';
import { unzip } from './zip.js';
import { AIR, FOUNDATION, WALL, PILLAR, WINDOW, DOOR, ROOF, THEMES } from './blocks.js';

// ---------- readers -> { W, H, L, names: string[] (y, z, x order) } ----------

function inflate(buf) {
  return buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
}

function varints(bytes, count) {
  const out = new Int32Array(count);
  let i = 0, o = 0;
  while (i < count && o < bytes.length) {
    let v = 0, shift = 0, b;
    do { b = bytes[o++] & 0xff; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    out[i++] = v;
  }
  return out;
}

const stripState = (s) => s.replace(/^minecraft:/, '').replace(/\[.*$/, '');

function readSponge(root) {
  const s = root.Schematic ?? root; // v3 nests everything under "Schematic"
  const W = s.Width, H = s.Height, L = s.Length;
  const blocks = s.Blocks ?? s; // v3: Blocks { Palette, Data }; v1/v2: Palette + BlockData
  const palette = blocks.Palette, data = blocks.Data ?? blocks.BlockData;
  if (!palette || !data) throw new Error('missing block palette');
  const byId = [];
  for (const [state, id] of Object.entries(palette)) byId[id] = stripState(state);
  const ids = varints(data, W * H * L);
  return { W, H, L, names: Array.from(ids, (id) => byId[id] ?? 'air') };
}

function readStructureNbt(root) {
  const [W, H, L] = root.size;
  const palette = (root.palette ?? root.palettes?.[0]).map((p) => stripState(p.Name));
  const names = new Array(W * H * L).fill('air');
  for (const b of root.blocks) {
    const [x, y, z] = b.pos;
    names[(y * L + z) * W + x] = palette[b.state] ?? 'air';
  }
  return { W, H, L, names };
}

// MCEdit numeric ids -> modern names (the common building blocks; others become stone/air).
const WOOD = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
const LEGACY_NAMES = {
  1: 'stone', 2: 'grass_block', 3: 'dirt', 4: 'cobblestone', 5: (m) => `${WOOD[m & 7] ?? 'oak'}_planks`, 7: 'bedrock',
  12: 'sand', 13: 'gravel', 17: (m) => `${WOOD[m & 3]}_log`, 162: (m) => `${WOOD[4 + (m & 1)]}_log`, 20: 'glass',
  24: 'sandstone', 35: 'white_wool', 41: 'gold_block', 42: 'iron_block', 43: 'stone', 44: 'stone_slab', 45: 'bricks',
  47: 'bookshelf', 48: 'mossy_cobblestone', 49: 'obsidian', 53: 'oak_stairs', 57: 'diamond_block', 64: 'oak_door',
  67: 'cobblestone_stairs', 71: 'iron_door', 80: 'snow_block', 82: 'clay', 85: 'oak_fence', 87: 'netherrack',
  89: 'glowstone', 95: 'white_stained_glass', 98: 'stone_bricks', 101: 'iron_bars', 102: 'glass_pane',
  108: 'brick_stairs', 109: 'stone_brick_stairs', 112: 'nether_bricks', 113: 'nether_brick_fence', 114: 'nether_brick_stairs',
  121: 'end_stone', 125: (m) => `${WOOD[m & 7] ?? 'oak'}_planks`, 126: (m) => `${WOOD[m & 7] ?? 'oak'}_slab`,
  128: 'sandstone_stairs', 134: 'spruce_stairs', 135: 'birch_stairs', 136: 'jungle_stairs', 139: 'cobblestone_wall',
  155: 'quartz_block', 156: 'quartz_stairs', 159: 'terracotta', 160: 'glass_pane', 163: 'acacia_stairs',
  164: 'dark_oak_stairs', 168: 'prismarine', 172: 'terracotta', 179: 'red_sandstone', 180: 'red_sandstone_stairs',
  182: 'red_sandstone_slab', 188: 'spruce_fence', 189: 'birch_fence', 190: 'jungle_fence', 191: 'dark_oak_fence',
  192: 'acacia_fence', 193: 'spruce_door', 194: 'birch_door', 195: 'jungle_door', 196: 'acacia_door', 197: 'dark_oak_door',
  201: 'purpur_block', 202: 'purpur_pillar', 203: 'purpur_stairs', 205: 'purpur_slab', 206: 'end_stone_bricks',
  251: 'white_concrete',
};
const LEGACY_AIR = new Set([0, 6, 8, 9, 10, 11, 18, 30, 31, 32, 37, 38, 39, 40, 50, 51, 55, 59, 63, 65, 66, 68, 69, 70, 72, 75, 76, 77, 78, 83, 93, 94, 106, 111, 115, 131, 132, 141, 142, 143, 147, 148, 149, 150, 157, 161, 171, 175, 176, 177, 207]);

function readMcedit(root) {
  const W = root.Width, H = root.Height, L = root.Length;
  const ids = root.Blocks, meta = root.Data ?? new Uint8Array(ids.length), add = root.AddBlocks;
  const names = new Array(W * H * L);
  for (let i = 0; i < names.length; i++) {
    let id = ids[i] & 0xff;
    if (add) id |= ((add[i >> 1] >> ((i & 1) ? 0 : 4)) & 0xf) << 8;
    if (LEGACY_AIR.has(id)) { names[i] = 'air'; continue; }
    const n = LEGACY_NAMES[id];
    names[i] = typeof n === 'function' ? n(meta[i] & 0xf) : n ?? 'stone';
  }
  return { W, H, L, names };
}

// Litematica: one or more regions, each with its own palette and spanning bit array.
function readLitematic(root) {
  const boxes = Object.values(root.Regions).map((reg) => {
    const p = [reg.Position.x, reg.Position.y, reg.Position.z], s = [reg.Size.x, reg.Size.y, reg.Size.z];
    return { reg, min: p.map((v, i) => (s[i] < 0 ? v + s[i] + 1 : v)), size: s.map(Math.abs) };
  });
  const gmin = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
  const gmax = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.min[i] + b.size[i] - 1)));
  const W = gmax[0] - gmin[0] + 1, H = gmax[1] - gmin[1] + 1, L = gmax[2] - gmin[2] + 1;
  const names = new Array(W * H * L).fill('air');
  for (const b of boxes) {
    const pal = b.reg.BlockStatePalette.map((e) => stripState(e.Name));
    const [sx, sy, sz] = b.size;
    const bits = Math.max(2, Math.ceil(Math.log2(pal.length)));
    const ids = unpackSpanning(b.reg.BlockStates, bits, sx * sy * sz);
    const [ox, oy, oz] = [0, 1, 2].map((i) => b.min[i] - gmin[i]);
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const n = pal[ids[(y * sz + z) * sx + x]] ?? 'air';
      if (n !== 'air') names[((oy + y) * L + (oz + z)) * W + (ox + x)] = n;
    }
  }
  return { W, H, L, names };
}

export function readSchematic(buffer, filename = '') {
  const { value: root } = decode(inflate(buffer));
  if (root.Regions) return readLitematic(root);
  if (root.Blocks && root.Materials !== undefined) return readMcedit(root);
  if (root.size && root.blocks) return readStructureNbt(root);
  if (root.Schematic || root.Palette || root.Blocks) return readSponge(root);
  throw new Error('Unrecognised schematic format');
}

// Uploads may be single files or .zip bundles (e.g. from Build Scraper's Convert / fetch).
export const SCHEMATIC_FILE = /\.(schem|schematic|litematic|nbt)$/i;
export function expandUploads(files) {
  const out = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.filename)) {
      for (const e of unzip(f.buffer)) {
        if (SCHEMATIC_FILE.test(e.path) && !e.path.startsWith('__MACOSX/')) out.push({ filename: e.path.split('/').pop(), buffer: e.content });
      }
    } else out.push(f);
  }
  return out;
}

// ---------- block name -> abstract role ----------

const DECOR = /(^|_)(torch|lantern|flower|sapling|grass$|tall_grass|fern|vine|carpet|banner|sign|button|pressure_plate|lever|rail|ladder|redstone|candle|pot$|flower_pot|head|skull|bed|chest|barrel|furnace|crafting|table|anvil|bell|campfire|cobweb|snow$|water|lava|kelp|seagrass|coral|mushroom$|dead_bush|leaves|scaffolding|item_frame|painting|lily|chain$|hanging)/;

export function roleOf(name, y) {
  if (/^(air|cave_air|void_air|structure_void|barrier|light)$/.test(name)) return AIR;
  if (DECOR.test(name)) return AIR;
  if (/_door$/.test(name)) return DOOR;
  if (/glass|iron_bars/.test(name)) return WINDOW;
  if (/_stairs$|_slab$/.test(name)) return ROOF;
  if (/_log$|_wood$|_stem$|_hyphae$|_pillar$|_fence$|_wall$|^bamboo_block$|basalt|chain/.test(name)) return PILLAR;
  return y === 0 ? FOUNDATION : WALL;
}

// ---------- fit into the lot ----------

// Map n target cells onto s source cells keeping both ends (9-slice style stretch/shrink).
export function sliceMap(n, s) {
  if (n === s) return Array.from({ length: n }, (_, i) => i);
  if (n === 1) return [0];
  if (n === 2 || s <= 2) return Array.from({ length: n }, (_, i) => Math.round((i * (s - 1)) / (n - 1)));
  return Array.from({ length: n }, (_, i) => (i === 0 ? 0 : i === n - 1 ? s - 1 : 1 + Math.round(((i - 1) * (s - 3)) / Math.max(1, n - 3))));
}

// Crop air around the build, then scale down (nearest) if it is bigger than the lot.
export function toExample(sch, lot) {
  const [GX, GY, GZ] = lot;
  const { W, H, L, names } = sch;
  const roles = new Int8Array(W * H * L);
  let x0 = W, y0 = H, z0 = L, x1 = -1, y1 = -1, z1 = -1;
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
    const i = (y * L + z) * W + x;
    const r = roleOf(names[i], 1);
    roles[i] = r;
    if (r !== AIR) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
  }
  if (x1 < 0) throw new Error('the schematic is empty');
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1, sl = z1 - z0 + 1;
  const w = Math.min(sw, GX), h = Math.min(sh, GY), d = Math.min(sl, GZ);
  const mx = sliceMap(w, sw), my = sliceMap(h, sh), mz = sliceMap(d, sl);
  const grid = new Int8Array(w * h * d);
  const counts = {};
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const src = ((y0 + my[y]) * L + (z0 + mz[z])) * W + (x0 + mx[x]);
    let r = roles[src];
    if (r === WALL && y === 0) r = FOUNDATION;
    grid[(y * d + z) * w + x] = r;
  }
  for (let i = 0; i < names.length; i++) {
    if (roles[i] === AIR) continue;
    const y = Math.floor(i / (W * L));
    const role = roles[i] === WALL && y === y0 ? FOUNDATION : roles[i];
    (counts[role] ??= {})[names[i]] = ((counts[role] ??= {})[names[i]] ?? 0) + 1;
  }
  return { w, h, d, grid: Array.from(grid).join(''), original: [sw, sh, sl], scaled: w !== sw || h !== sh || d !== sl, counts };
}

// ---------- materials -> theme ----------

const top = (obj, test = () => true) => Object.entries(obj ?? {}).filter(([n]) => test(n)).sort((a, b) => b[1] - a[1])[0]?.[0];
const WOODS = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped|pale_oak)$/;

function fullFromStairs(stairs) {
  const base = stairs.replace(/_(stairs|slab)$/, '');
  if (WOODS.test(base)) return `${base}_planks`;
  if (base === 'brick' || /_(brick|tile)$/.test(base)) return `${base}s`;
  if (base === 'quartz' || base === 'purpur') return `${base}_block`;
  return base;
}

export function deriveTheme(examples) {
  const merged = {};
  for (const ex of examples) for (const [role, names] of Object.entries(ex.counts)) {
    merged[role] ??= {};
    for (const [n, c] of Object.entries(names)) merged[role][n] = (merged[role][n] ?? 0) + c;
  }
  const base = THEMES.oak;
  const wall = top(merged[WALL]) ?? top(merged[FOUNDATION]) ?? base.wall;
  const stairs = top(merged[ROOF], (n) => n.endsWith('_stairs'));
  const slab = top(merged[ROOF], (n) => n.endsWith('_slab'));
  const roofSrc = stairs ?? slab;
  const theme = {
    foundation: top(merged[FOUNDATION]) ?? wall,
    wall,
    pillar: top(merged[PILLAR]) ?? base.pillar,
    window: top(merged[WINDOW]) ?? base.window,
    door: top(merged[DOOR], (n) => n.endsWith('_door')) ?? base.door,
    roofStairs: stairs ?? (slab ? slab.replace(/_slab$/, '_stairs') : base.roofStairs),
    roofSlab: slab ?? (stairs ? stairs.replace(/_stairs$/, '_slab') : base.roofSlab),
    roofFull: roofSrc ? fullFromStairs(roofSrc) : base.roofFull,
    roofStyle: !roofSrc ? 'full' : (merged[ROOF]?.[stairs] ?? 0) >= (merged[ROOF]?.[slab] ?? 0) ? 'stairs' : 'slab',
  };
  theme.colors = ['#000', colorOf(theme.foundation), colorOf(theme.wall), colorOf(theme.pillar), '#bfe3ef', colorOf(theme.door), colorOf(theme.roofFull)];
  return theme;
}

// Rough preview colour from a block name.
const COLORS = [
  [/white|quartz|snow|calcite|bone/, '#e9e6df'], [/light_gray/, '#a5a5a0'], [/gray|andesite|tuff/, '#6e6e6e'], [/black|blackstone|obsidian/, '#2a2730'],
  [/red|crimson|nether_brick/, '#8e3a2e'], [/orange|terracotta|acacia/, '#b5643a'], [/yellow|gold|sand|end_stone|bamboo/, '#d9c88f'],
  [/lime|moss|slime/, '#7fae4a'], [/green|cactus/, '#556b2f'], [/cyan|prismarine|warped/, '#4a8f8a'], [/light_blue|ice/, '#8fb8de'],
  [/blue|lapis/, '#3c4f9e'], [/purple|purpur|amethyst/, '#8a63a8'], [/magenta/, '#b04aa8'], [/pink|cherry/, '#e8b8b4'],
  [/brown|dark_oak|mud/, '#4a3220'], [/spruce|mangrove/, '#6e4f2e'], [/birch|pale_oak/, '#d7cb8d'], [/jungle/, '#a8794f'],
  [/oak|planks|wood|log/, '#b8945f'], [/brick/, '#9a5642'], [/deepslate|basalt/, '#3a3a3f'], [/diorite/, '#cfcfcf'],
  [/granite/, '#9a6b57'], [/copper/, '#c06b4a'], [/iron/, '#d8d8d8'], [/stone|cobble/, '#8b8b8b'],
];
export const colorOf = (name) => COLORS.find(([re]) => re.test(name))?.[1] ?? '#9a9a9a';
