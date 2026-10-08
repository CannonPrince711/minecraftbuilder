// The build environment (PCGRL "narrow" representation).
//
// An episode is one structure. The agent visits every cell of an 11x12x11 voxel lot
// in scan order (bottom layer first, then row by row) and picks which abstract block
// to place there. Each episode is conditioned on a random design brief for one
// structure type (src/structures/*.js), which paints *zones* on the lot: where walls,
// columns, roofs, openings... belong. The agent only sees local context plus the
// zone of the current cell and learns, from the rewards in src/zones.js plus the
// door / window / symmetry rules below, which block to put where.

import { AIR, FOUNDATION, PILLAR, WINDOW, DOOR, WALL, ROOF, N_BLOCKS, THEME_NAMES } from './blocks.js';
import { Z_OUT, Z_WALL, Z_GABLE, Z_CORNER, Z_INTERIOR, Z_ROOF, N_ZONES, ZONE_REWARD, VISIBLE, WALLISH, EASY } from './zones.js';
import { getStructure } from './structures/index.js';
import { randInt } from './rng.js';

import { GX, GY, GZ, N, idx } from './lot.js';
export { GX, GY, GZ, N, idx };

export const N_FEATURES = 1 + N_ZONES + 2 + 3 + 1 + 1 + 1 + 1 + 1 + N_BLOCKS * 4 + 1 + 1 + 1 + 1 + 4;

// Pick from [lo, hi] or [lo, hi, step]; a pinned value is snapped into range.
function pick(rng, range, pinned) {
  const [lo, hi, step = 1] = range;
  const n = Math.floor((hi - lo) / step);
  const k = pinned ? Math.round((Math.max(lo, Math.min(hi, pinned)) - lo) / step) : randInt(rng, 0, n);
  return lo + Math.min(n, k) * step;
}

// Sample a design brief for structure `type`. Any of width/depth/height/variant/theme can be pinned.
export function makeTarget(type, rng, opts = {}) {
  const spec = getStructure(type);
  const w = pick(rng, spec.size.w, opts.width);
  const d = spec.square ? w : spec.size.d ? pick(rng, spec.size.d, opts.depth) : w;
  const h = spec.size.h ? pick(rng, spec.size.h, opts.height) : 0;
  let variant = null;
  if (spec.variants) {
    variant = opts.variant || spec.variants[randInt(rng, 0, spec.variants.length - 1)];
    if (!spec.variants.includes(variant)) throw new Error(`${spec.label} ${spec.variantLabel ?? 'style'} must be one of ${spec.variants.join(', ')}`);
  }
  const t = {
    type, spec, w, d, h, variant,
    theme: opts.theme || spec.defaultTheme || THEME_NAMES[randInt(rng, 0, THEME_NAMES.length - 1)],
    noise: [0, 0, 0, 0].map(() => rng() * 2 - 1),
  };
  spec.derive?.(t, rng, opts); // may set h (pyramid) or resize from an example (custom types)
  t.x0 = randInt(rng, 0, GX - t.w); t.z0 = randInt(rng, 0, GZ - t.d);
  t.x1 = t.x0 + t.w - 1; t.z1 = t.z0 + t.d - 1;
  t.cx = (t.x0 + t.x1) / 2;
  spec.place?.(t); // custom types lay their example into the lot
  // Door goes on the front (z0) face within one block of centre.
  t.lastDoorX = Math.min(t.x1 - 1, Math.floor(t.cx + 1));
  const zones = new Int8Array(N);
  let wallCells = 0;
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const zn = spec.zone(t, x, y, z);
    zones[idx(x, y, z)] = zn;
    if (WALLISH[zn]) wallCells++;
  }
  t.zones = zones;
  t.wallCells = wallCells;
  return t;
}

// Mutable per-episode counters the agent can observe.
export function newState() {
  return { doorPlaced: 0, wallSeen: 0, windows: 0 };
}

// Observation vector for cell (x, y, z). Only already-placed cells are read.
export function features(t, grid, x, y, z, st, out) {
  out.fill(0);
  const zone = t.zones[idx(x, y, z)];
  let o = 0;
  out[o++] = 1; // bias
  out[o + zone] = 1; o += N_ZONES;
  out[o++] = y / GY;
  out[o++] = (y - t.h) / 5;
  if (t.variant) out[o + t.spec.variants.indexOf(t.variant)] = 1;
  o += 3;
  out[o++] = t.spec.windowBand(t, y) ? 1 : 0;
  const front = t.spec.door && zone === Z_WALL && z === t.z0 && y <= 2;
  out[o++] = front ? 1 : 0;
  out[o++] = front ? 1 - Math.min(1, Math.abs(x - t.cx) / (t.w / 2)) : 0; // centredness
  out[o++] = front && y === 1 && x === t.lastDoorX ? 1 : 0; // last chance for the door
  out[o++] = st.doorPlaced ? 1 : 0;
  // Neighbour context: below, left (x-1), back (z-1), mirror across the x centre.
  if (y > 0) out[o + grid[idx(x, y - 1, z)]] = 1;
  o += N_BLOCKS;
  if (x > 0) out[o + grid[idx(x - 1, y, z)]] = 1;
  o += N_BLOCKS;
  if (z > 0) out[o + grid[idx(x, y, z - 1)]] = 1;
  o += N_BLOCKS;
  const mx = t.x0 + t.x1 - x;
  const mirrorSeen = mx < x && mx >= 0;
  if (mirrorSeen) out[o + grid[idx(mx, y, z)]] = 1;
  o += N_BLOCKS;
  out[o++] = mirrorSeen ? 1 : 0;
  out[o++] = y === 0 ? 1 : 0;
  out[o++] = st.wallSeen ? st.windows / st.wallSeen : 0;
  out[o++] = zone === Z_WALL && (x === t.x0 || x === t.x1) ? 1 : 0; // side wall vs front/back
  for (let k = 0; k < 4; k++) out[o++] = t.noise[k];
  return out;
}

// Reward for placing block a at (x, y, z).
export function reward(t, grid, x, y, z, a, st) {
  // Custom types learned from schematics: reward copying the (stretched, mirrored) example.
  if (t.spec.imitate) {
    const want = t.example[idx(x, y, z)];
    return a === want ? 1 : want === AIR ? -0.6 : a === AIR ? -1 : -0.4;
  }
  const zone = t.zones[idx(x, y, z)];
  const below = y > 0 ? grid[idx(x, y - 1, z)] : -1;
  let r;

  if (zone === Z_WALL || zone === Z_GABLE) {
    const left = x > 0 ? grid[idx(x - 1, y, z)] : -1;
    const inBand = t.spec.windowBand(t, y);
    if (a === WALL) r = inBand && zone === Z_WALL ? 0.3 : 0.5;
    else if (a === AIR) r = zone === Z_GABLE ? -0.6 : -0.8;
    else if (a === PILLAR) r = 0;
    else if (a === WINDOW) {
      const ok = (zone === Z_GABLE || inBand) && left !== DOOR && below !== DOOR;
      r = ok ? (st.windows / Math.max(1, st.wallSeen) < t.spec.maxWindowRatio ? 0.8 : -0.3) : -0.4;
    } else if (a === ROOF) r = zone === Z_GABLE ? 0.2 : -0.3;
    else if (a === DOOR) r = -2;
    else r = -0.2;

    // Doors: one, on the front face near the centre (the env adds the upper half).
    if (t.spec.door) {
      const frontLow = zone === Z_WALL && z === t.z0 && y === 1;
      if (a === DOOR && frontLow && Math.abs(x - t.cx) <= 1 && !st.doorPlaced) r = Math.abs(x - t.cx) <= 0.5 ? 3 : 2;
      if (frontLow && x === t.lastDoorX && !st.doorPlaced && a !== DOOR) r -= 3;
    }
  } else {
    r = ZONE_REWARD[zone][a];
    if (zone === Z_CORNER && a === PILLAR && (below === PILLAR || below === FOUNDATION)) r += 0.2;
  }

  // Left-right symmetry across the structure's x centre for visible surfaces.
  if (VISIBLE[zone]) {
    const mx = t.x0 + t.x1 - x;
    if (mx < x) {
      const m = grid[idx(mx, y, z)];
      if (a !== DOOR && m !== DOOR) r += m === a ? 0.25 : -0.1;
    }
  }
  return r;
}

export function updateState(t, x, y, z, a, st) {
  const zone = t.zones[idx(x, y, z)];
  if (a === DOOR && y === 1) st.doorPlaced++;
  if (WALLISH[zone]) {
    st.wallSeen++;
    if (a === WINDOW) st.windows++;
  }
}

// Doors are a single action: the cell above a placed door is filled automatically.
const autoDoor = (grid, x, y, z) => y === 2 && grid[idx(x, 1, z)] === DOOR;

// Run one episode. With `record`, returns everything PPO needs. `explore` is the
// chance of a random action on non-trivial cells (training only).
export function rollout(model, t, rng, { temperature = 1, record = false, explore = 0 } = {}) {
  const grid = new Int8Array(N);
  const st = newState();
  const feat = new Float64Array(N_FEATURES);
  const rec = record
    ? {
      feats: new Float32Array(N * N_FEATURES), actions: new Int8Array(N).fill(-1), logp: new Float32Array(N),
      values: new Float32Array(N), rewards: new Float32Array(N), explored: new Uint8Array(N), zones: t.zones,
    }
    : null;
  let total = 0;
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const i = idx(x, y, z);
    if (autoDoor(grid, x, y, z)) { grid[i] = DOOR; continue; }
    features(t, grid, x, y, z, st, feat);
    const v = model.forward(feat);
    const zone = t.zones[i];
    const explored = explore > 0 && !EASY[zone] && rng() < explore;
    const a = explored ? Math.floor(rng() * N_BLOCKS) : sample(model.probs, temperature, rng);
    const r = reward(t, grid, x, y, z, a, st);
    updateState(t, x, y, z, a, st);
    grid[i] = a;
    total += r;
    if (rec) {
      rec.feats.set(feat, i * N_FEATURES);
      rec.actions[i] = a;
      rec.logp[i] = Math.log(model.probs[a] + 1e-12);
      rec.values[i] = v;
      rec.rewards[i] = r;
      rec.explored[i] = explored ? 1 : 0;
    }
  }
  return { grid, total, rec };
}

function sample(probs, temperature, rng) {
  const n = probs.length;
  if (temperature <= 0) {
    let best = 0;
    for (let k = 1; k < n; k++) if (probs[k] > probs[best]) best = k;
    return best;
  }
  let sum = 0;
  const p = new Float64Array(n);
  for (let k = 0; k < n; k++) sum += p[k] = Math.pow(probs[k], 1 / temperature);
  let u = rng() * sum;
  for (let k = 0; k < n; k++) if ((u -= p[k]) <= 0) return k;
  return n - 1;
}

// Quality metrics for a finished build. `score` (0-100) works for any structure type:
// how close each choice was to the best choice the rules allowed in that cell,
// over every cell that belongs to the structure. Other metrics are null when they
// don't apply to the structure type.
export function evaluate(t, grid) {
  const st = newState();
  let got = 0, range = 0, strays = 0, symPairs = 0, symMatch = 0, roofCells = 0, roofed = 0;
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const i = idx(x, y, z), zone = t.zones[i], b = grid[i];
    if (autoDoor(grid, x, y, z)) continue;
    if (zone === Z_OUT) { if (b !== AIR) strays++; }
    else {
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < N_BLOCKS; a++) {
        const r = reward(t, grid, x, y, z, a, st);
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
      got += reward(t, grid, x, y, z, b, st) - lo;
      range += hi - lo;
    }
    if (zone === Z_ROOF) { roofCells++; if (b === ROOF) roofed++; }
    const mx = t.x0 + t.x1 - x;
    if (VISIBLE[zone] && mx < x) { symPairs++; if (grid[idx(mx, y, z)] === b) symMatch++; }
    updateState(t, x, y, z, b, st);
  }
  let doors = 0;
  for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) if (grid[idx(x, 1, z)] === DOOR && grid[idx(x, 2, z)] === DOOR) doors++;
  return {
    score: Math.round(100 * (range ? got / range : 1)),
    enclosure: t.spec.door ? enclosure(t, grid) : null,
    doors: t.spec.door ? doors : null,
    symmetry: symPairs ? symMatch / symPairs : null,
    windowRatio: t.spec.maxWindowRatio > 0 && st.wallSeen ? st.windows / st.wallSeen : null,
    roofCoverage: roofCells ? roofed / roofCells : null,
    strayBlocks: strays,
  };
}

// Share of interior air the outside can't reach (doors and windows count as closed).
function enclosure(t, grid) {
  const seen = new Uint8Array(N);
  const queue = [];
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const edge = x === 0 || z === 0 || x === GX - 1 || z === GZ - 1 || y === GY - 1;
    const i = idx(x, y, z);
    if (edge && grid[i] === AIR) { seen[i] = 1; queue.push(i); }
  }
  while (queue.length) {
    const i = queue.pop();
    const x = i % GX, z = Math.floor(i / GX) % GZ, y = Math.floor(i / (GX * GZ));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= GX || ny >= GY || nz >= GZ) continue;
      const j = idx(nx, ny, nz);
      if (!seen[j] && grid[j] === AIR) { seen[j] = 1; queue.push(j); }
    }
  }
  let interior = 0, enclosed = 0;
  for (let i = 0; i < N; i++) if (t.zones[i] === Z_INTERIOR) { interior++; if (grid[i] === AIR && !seen[i]) enclosed++; }
  return interior ? enclosed / interior : null;
}
