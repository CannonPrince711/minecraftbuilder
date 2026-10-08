// Realism sliders: rule-based finishing touches applied *after* the RL agent builds.
// Each slider is 0-100. Every cell gets fixed pseudo-random numbers (seeded by the
// build name), so raising a slider only adds effects and the preview always matches
// the downloaded files.
//
// Result: Map<cell index, { name, props } | null> that overrides the agent's blocks
// (null = make it air). export.js reads it via build.realism.

import { AIR, WINDOW, DOOR, THEMES } from './blocks.js';
import { GX, GY, GZ, idx } from './lot.js';
import { Z_OUT, Z_INTERIOR } from './zones.js';
import { blockFor } from './export.js';
import { colorOf } from './schematic-import.js';

export const REALISM = [
  { key: 'weathering', label: 'Weathering', hint: 'Moss and cracks on stone' },
  { key: 'variety', label: 'Block variety', hint: 'Mixes in similar blocks, like real builds' },
  { key: 'details', label: 'Exterior details', hint: 'Path to the door, lanterns, window shutters' },
  { key: 'interior', label: 'Interior', hint: 'Furniture, carpet and a light inside' },
  { key: 'nature', label: 'Nature', hint: 'Grass, flowers, bushes and vines' },
  { key: 'ruin', label: 'Ruin', hint: 'Missing blocks, broken windows, cobwebs' },
  { key: 'physics', label: 'Physics', hint: 'Unsupported parts collapse and fall. Higher = stricter' },
];
export const KEYS = REALISM.map((r) => r.key);

export const PRESETS = {
  clean: { weathering: 0, variety: 0, details: 0, interior: 0, nature: 0, ruin: 0, physics: 0 },
  'lived-in': { weathering: 15, variety: 35, details: 75, interior: 75, nature: 30, ruin: 0, physics: 0 },
  'old village': { weathering: 55, variety: 50, details: 55, interior: 45, nature: 50, ruin: 8, physics: 40 },
  overgrown: { weathering: 50, variety: 30, details: 20, interior: 10, nature: 95, ruin: 20, physics: 40 },
  'abandoned ruin': { weathering: 80, variety: 40, details: 10, interior: 15, nature: 70, ruin: 55, physics: 70 },
};

// Accepts an object, a preset name, or "w,v,d,i,n,r,p" numbers. Returns { key: 0..100 }.
export function parseRealism(input) {
  const out = { ...PRESETS.clean };
  if (!input) return out;
  if (typeof input === 'string') {
    const preset = PRESETS[input.toLowerCase()];
    if (preset) return { ...preset };
    const nums = input.split(',').map(Number);
    KEYS.forEach((k, i) => { if (Number.isFinite(nums[i])) out[k] = nums[i]; });
  } else {
    for (const k of KEYS) if (Number.isFinite(Number(input[k]))) out[k] = Number(input[k]);
  }
  for (const k of KEYS) out[k] = Math.max(0, Math.min(100, Math.round(out[k])));
  return out;
}
export const realismQuery = (r) => KEYS.map((k) => r[k] ?? 0).join(',');
const isOff = (r) => KEYS.every((k) => !r[k]);

// ---------- deterministic per-cell randomness ----------

function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function hash01(n, seed) {
  let h = (n ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const DIRS = [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']];
const OPPOSITE = { north: 'south', south: 'north', west: 'east', east: 'west' };
const inLot = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ;

const WEATHERED = {
  cobblestone: ['mossy_cobblestone'],
  stone: ['mossy_cobblestone', 'cobblestone'],
  stone_bricks: ['mossy_stone_bricks', 'cracked_stone_bricks'],
  deepslate_tiles: ['cracked_deepslate_tiles'],
  andesite: ['mossy_cobblestone'],
};
const VARIETY = {
  cobblestone: ['andesite', 'stone'],
  stone: ['andesite', 'cobblestone'],
  stone_bricks: ['stone', 'polished_andesite'],
  cut_sandstone: ['sandstone', 'smooth_sandstone'],
  smooth_sandstone: ['cut_sandstone', 'sandstone'],
  mud_bricks: ['packed_mud'],
  deepslate_tiles: ['deepslate_bricks', 'polished_deepslate'],
};
const woodOf = (th) => (/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry)_/.exec(th.door ?? '') ?? [, 'oak'])[1];

export function realismMap(build, r) {
  const map = new Map();
  if (!r || isOff(r)) return map;
  const { target: t, grid } = build;
  const th = THEMES[t.theme];
  const wood = woodOf(th);
  const seed = strHash(build.name);
  const u = (i, k) => hash01(i * 32 + k, seed);
  const lv = (k) => (r[k] ?? 0) / 100;
  const zoneAt = (x, y, z) => (inLot(x, y, z) ? t.zones[idx(x, y, z)] : Z_OUT);
  // Is there a solid block here after the changes so far?
  const solid = (x, y, z) => {
    if (!inLot(x, y, z)) return false;
    const i = idx(x, y, z);
    if (map.has(i)) return map.get(i) !== null && map.get(i).full !== false;
    return grid[i] !== AIR;
  };
  const free = (x, y, z) => inLot(x, y, z) && !map.has(idx(x, y, z)) && grid[idx(x, y, z)] === AIR;
  const outsideFree = (x, y, z) => free(x, y, z) && zoneAt(x, y, z) === Z_OUT;
  const put = (x, y, z, name, props = {}, full = false) => map.set(idx(x, y, z), { name, props, full });

  let top = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] !== AIR) top = Math.max(top, Math.floor(i / (GX * GZ)));

  // Doors (lower halves) with the direction that leads outside.
  const doors = [];
  for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    if (grid[idx(x, 1, z)] !== DOOR || grid[idx(x, 2, z)] !== DOOR) continue;
    const out = DIRS.find(([dx, dz]) => outsideFree(x + dx, 1, z + dz));
    if (out) doors.push({ x, z, dx: out[0], dz: out[1], face: out[2] });
  }

  // 1. Ruin: blocks go missing, more often higher up; windows break first.
  const ruin = lv('ruin');
  if (ruin > 0) {
    for (let y = 1; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
      const i = idx(x, y, z), b = grid[i];
      if (b === AIR || (b === DOOR && ruin < 0.7)) continue;
      const rel = top ? y / top : 1;
      const p = ruin * (0.12 + 0.88 * rel * rel) * (b === WINDOW ? 2.2 : 1);
      if (u(i, 1) < p) map.set(i, null);
    }
  }

  // 1b. Physics: structural support, then collapse.
  map.fell = collapse(build, map, lv('physics'), u);

  // Cobwebs under the ceilings that are left.
  if (ruin > 0) {
    for (let y = 1; y < GY - 1; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
      const i = idx(x, y, z);
      if (zoneAt(x, y, z) === Z_INTERIOR && free(x, y, z) && solid(x, y + 1, z) && u(i, 2) < ruin * 0.35) put(x, y, z, 'cobweb');
    }
  }

  // 2 + 3. Weathering, then block variety, on the remaining full blocks.
  const weathering = lv('weathering'), variety = lv('variety');
  if (weathering > 0 || variety > 0) {
    for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
      const i = idx(x, y, z);
      if (grid[i] === AIR || map.has(i)) continue;
      const blk = blockFor(grid[i], t, grid, x, y, z);
      if (!blk || Object.keys(blk.props).length) continue; // only plain full blocks
      const w = WEATHERED[blk.name];
      if (w && u(i, 3) < weathering * 0.7 * (y === 0 ? 1.3 : 1)) { put(x, y, z, w[Math.floor(u(i, 4) * w.length)], {}, true); continue; }
      const v = VARIETY[blk.name] ?? (blk.name === `${wood}_planks` ? [`stripped_${wood}_wood`] : null);
      if (v && u(i, 5) < variety * 0.4) put(x, y, z, v[Math.floor(u(i, 6) * v.length)], {}, true);
    }
  }

  // 4. Exterior details: path, lanterns by the door, shutters beside windows.
  const details = lv('details');
  if (details > 0) {
    for (const d of doors) {
      for (let k = 1; k <= 3; k++) {
        const px = d.x + d.dx * k, pz = d.z + d.dz * k;
        if (k > 1 && u(idx(px, 0, pz), 7) > details * 1.3) break;
        if (outsideFree(px, 0, pz)) put(px, 0, pz, 'dirt_path', {}, true);
      }
      if (details > 0.3) {
        const sides = details > 0.6 ? [1, -1] : [1];
        for (const s of sides) {
          const lx = d.x + d.dx + s * d.dz, lz = d.z + d.dz + s * d.dx;
          if (outsideFree(lx, 1, lz)) put(lx, 1, lz, 'lantern');
        }
      }
    }
    for (let y = 1; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
      const i = idx(x, y, z);
      if (grid[i] !== WINDOW || map.has(i)) continue;
      const out = DIRS.find(([dx, dz]) => outsideFree(x + dx, y, z + dz));
      if (!out || u(i, 8) > details) continue;
      const [dx, dz, face] = out;
      for (const s of [1, -1]) {
        const sx = x + s * dz + dx, sz = z + s * dx + dz;
        if (outsideFree(sx, y, sz) && solid(x + s * dz, y, z + s * dx)) put(sx, y, sz, `${wood}_trapdoor`, { facing: face, open: 'true', half: 'bottom' });
      }
    }
  }

  // 5. Interior: furniture along walls, carpet, one light per floor.
  const interior = lv('interior');
  if (interior > 0) {
    const inside = new Set(doors.map((d) => idx(d.x - d.dx, 1, d.z - d.dz)));
    const levels = new Map();
    for (let y = 1; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
      const i = idx(x, y, z);
      if (zoneAt(x, y, z) !== Z_INTERIOR || !free(x, y, z) || !solid(x, y - 1, z) || inside.has(i)) continue;
      const wall = DIRS.find(([dx, dz]) => solid(x + dx, y, z + dz) && grid[idx(x + dx, y, z + dz)] !== DOOR);
      if (!levels.has(y)) levels.set(y, []);
      levels.get(y).push({ x, y, z, i, wall });
    }
    const furniture = ['crafting_table', 'barrel', 'bookshelf', 'furnace', 'chest', 'bookshelf'];
    const warm = /cherry|desert/.test(t.theme);
    for (const cells of levels.values()) {
      const open = cells.filter((c) => !c.wall);
      const light = (open.length ? open : cells)[Math.floor(u(cells[0].i, 9) * (open.length || cells.length))];
      let n = 0;
      for (const c of cells) {
        if (c === light) { if (interior > 0.15) put(c.x, c.y, c.z, 'lantern'); continue; }
        if (c.wall && u(c.i, 10) < interior * 0.45) {
          const name = furniture[n++ % furniture.length];
          const facing = OPPOSITE[c.wall[2]];
          put(c.x, c.y, c.z, name, name === 'furnace' || name === 'chest' ? { facing } : {}, true);
        } else if (!c.wall && interior > 0.3 && u(c.i, 11) < (interior - 0.3) * 1.5) {
          put(c.x, c.y, c.z, warm ? 'red_carpet' : 'white_carpet');
        }
      }
    }
  }

  // 6. Nature: bushes at the corners, grass and flowers around, vines on walls.
  const nature = lv('nature');
  if (nature > 0) {
    const foot = (x, z) => inLot(x, 0, z) && (grid[idx(x, 0, z)] !== AIR || grid[idx(x, 1, z)] !== AIR);
    const near = (x, z, r) => { for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (foot(x + a, z + b)) return true; return false; };
    for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
      if (foot(x, z) || !near(x, z, 2) || !outsideFree(x, 1, z) || !outsideFree(x, 0, z)) continue;
      const i = idx(x, 1, z);
      const diagonal = near(x, z, 1) && !foot(x - 1, z) && !foot(x + 1, z) && !foot(x, z - 1) && !foot(x, z + 1);
      if (diagonal && u(i, 12) < nature) {
        put(x, 1, z, 'oak_leaves', { persistent: 'true' }, true);
        if (nature > 0.7 && outsideFree(x, 2, z) && u(i, 13) < nature - 0.3) put(x, 2, z, 'oak_leaves', { persistent: 'true' }, true);
      } else if (u(i, 14) < nature * 0.55) {
        const f = u(i, 15);
        put(x, 1, z, f < 0.2 ? 'poppy' : f < 0.32 ? 'dandelion' : 'short_grass');
      }
    }
    for (let y = 2; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
      const i = idx(x, y, z), b = grid[i];
      if (b === AIR || b === WINDOW || b === DOOR || map.get(i) === null) continue;
      DIRS.forEach(([dx, dz, face], k) => {
        let vx = x + dx, vz = z + dz;
        if (!outsideFree(vx, y, vz) || u(i, 16 + k) > nature * 0.3) return;
        const props = { [OPPOSITE[face]]: 'true' };
        put(vx, y, vz, 'vine', props);
        for (let h = 1; h <= 2; h++) {
          if (!outsideFree(vx, y - h, vz) || !solid(x, y - h, z) || y - h < 1 || u(i, 20 + h) > nature) break;
          put(vx, y - h, vz, 'vine', props);
        }
      });
    }
  }
  // Extras outside the footprint grow the schematic's box; give its ground layer grass so
  // pasting doesn't leave air holes around the build.
  let x0 = GX, x1 = -1, z0 = GZ, z1 = -1;
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    if (!solid(x, y, z) && !(map.get(idx(x, y, z)))) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (free(x, 0, z)) put(x, 0, z, 'grass_block', {}, true);
  return map;
}

// ---------- physics ----------
//
// Support spreads up from the ground layer (y = 0). Resting straight on a supported
// block costs nothing; every sideways step (overhang, span, hanging) costs 1 / (reach+1),
// a diagonal step down (stepped roofs, corbels) costs a third of that. Reach shrinks as
// the slider rises (stone 12 -> 2 blocks); wood reaches 1.5x further, glass half as far,
// and doors hold nothing up. Blocks left with no support fall straight down and land as
// rubble; glass shatters and doors break.

const WOODY = /(^|_)(oak|spruce|birch|jungle|acacia|dark_oak|cherry|mangrove|bamboo|crimson|warped)_(planks|log|wood|stairs|slab|trapdoor|fence)$|_log$|_wood$/;
const reachFactor = (name) => (/glass|pane/.test(name) ? 0.5 : WOODY.test(name) ? 1.5 : 1);
const STONY = /stone|brick|cobble|andesite|deepslate|sandstone|terracotta|mud|tiles/;

function collapse(build, map, physics, u) {
  if (physics <= 0) return 0;
  const { target: t, grid } = build;
  const reach = 12 - 10 * physics;
  const n = grid.length;
  const isSolid = (i) => grid[i] !== AIR && map.get(i) !== null;
  const names = new Array(n), loss = new Float32Array(n), integ = new Float32Array(n).fill(-1);
  const cells = [];
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const i = idx(x, y, z);
    if (!isSolid(i)) continue;
    names[i] = blockFor(grid[i], t, grid, x, y, z)?.name ?? '';
    loss[i] = 1 / (reach * reachFactor(names[i]) + 1);
    if (y === 0) integ[i] = 1;
    else cells.push([x, y, z, i]);
  }
  const holds = (x, y, z) => inLot(x, y, z) && isSolid(idx(x, y, z)) && grid[idx(x, y, z)] !== DOOR;
  const from = (x, y, z) => (holds(x, y, z) ? integ[idx(x, y, z)] : -1);
  for (let pass = 0, changed = true; changed && pass < 80; pass++) {
    changed = false;
    for (const [x, y, z, i] of cells) {
      const l = loss[i];
      const diag = /_(stairs|slab)$/.test(names[i]) ? l * 0.35 : l; // only roof steps rest cheaply on the step below
      let best = from(x, y - 1, z);
      for (const [dx, dz] of DIRS) {
        best = Math.max(best, from(x + dx, y, z + dz) - l, from(x + dx, y - 1, z + dz) - diag);
      }
      best = Math.max(best, from(x, y + 1, z) - l * 1.5);
      if (best > integ[i] + 1e-6) { integ[i] = best; changed = true; }
    }
  }
  // Fall, lowest first, so blocks pile up on what already landed.
  const falling = cells.filter(([, , , i]) => integ[i] <= 0);
  const fallen = new Set(falling.map((c) => c[3]));
  const occupied = (x, y, z) => y <= 0 || (isSolid(idx(x, y, z)) && !fallen.has(idx(x, y, z))) || (map.get(idx(x, y, z))?.full ?? false);
  for (const [x, y, z, i] of falling) map.set(i, null);
  for (const [x, y, z, i] of falling) {
    const name = names[i];
    if (grid[i] === WINDOW || grid[i] === DOOR) continue; // shatters / breaks
    let ly = y;
    while (!occupied(x, ly - 1, z)) ly--;
    const rubble = name.endsWith('_stairs') ? { name: name.replace(/_stairs$/, '_slab'), props: { type: 'bottom' } }
      : STONY.test(name) && u(i, 30) < 0.5 ? { name: 'cobblestone', props: {} } : { name, props: {} };
    map.set(idx(x, ly, z), { ...rubble, full: true });
  }
  return falling.length;
}

export const withRealism = (build, r) => ({ ...build, realism: realismMap(build, r) });

// Preview data for the browser: [cell, colour | null (removed), width, height].
const DECO = {
  lantern: ['#f2c45a', 0.3, 0.45], torch: ['#f2c45a', 0.2, 0.5], cobweb: ['#e8e8e8', 0.7, 0.7],
  short_grass: ['#6aa84f', 0.45, 0.45], poppy: ['#c0392b', 0.3, 0.5], dandelion: ['#f1c40f', 0.3, 0.45],
  vine: ['#3f6f2a', 0.85, 0.9], oak_leaves: ['#4f7f2f', 1, 1], white_carpet: ['#e9e6df', 1, 0.1], red_carpet: ['#a93226', 1, 0.1],
  dirt_path: ['#9b7b4a', 1, 0.94], grass_block: ['#6a9a3f', 1, 1], mossy_cobblestone: ['#6f7f5a', 1, 1], mossy_stone_bricks: ['#6f7f5a', 1, 1],
  cracked_stone_bricks: ['#7a7a7a', 1, 1], crafting_table: ['#8a6a3c', 1, 1], bookshelf: ['#7a5233', 1, 1],
  barrel: ['#7d5a32', 1, 1], chest: ['#a0703f', 0.85, 0.85], furnace: ['#6e6e6e', 1, 1],
};
export function decoFor(map) {
  const out = [];
  for (const [i, e] of map) {
    if (!e) { out.push([i, null, 1, 1]); continue; }
    const d = DECO[e.name] ?? (e.name.endsWith('_trapdoor') ? [colorOf(e.name), 0.55, 0.9] : [colorOf(e.name), 1, 1]);
    out.push([i, ...d]);
  }
  return out;
}
