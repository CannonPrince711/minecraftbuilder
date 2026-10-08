// Custom structure types learned from the user's own schematics.
//
// Each type lives in custom/<id>.json: the examples (as abstract role grids) plus a
// theme made from the user's materials. Every training episode picks one example,
// stretches/squashes it (keeping its edges, like 9-slice scaling), maybe mirrors or
// turns it, and rewards the agent for rebuilding it. The agent sees only shape hints
// (zones), so it has to learn the user's style: which blocks go on corners, faces,
// tops, around openings... Generated builds are new sizes/variants of that style.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GX, GY, GZ, N, idx } from './lot.js';
import { AIR } from './blocks.js';
import { Z_OUT, Z_FOUND, Z_WALL, Z_CORNER, Z_INTERIOR, Z_ROOF, Z_CORE } from './zones.js';
import { readSchematic, toExample, deriveTheme, sliceMap, expandUploads } from './schematic-import.js';

export const CUSTOM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'custom');
export const themeId = (id) => `custom_${id}`;

export function slug(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  if (!s) throw new Error('Give your structure type a name (letters or numbers).');
  if (['house', 'tower', 'pyramid', 'arch', 'wall'].includes(s)) throw new Error(`"${s}" is a built-in type. Pick another name.`);
  return s;
}

export function loadDefs() {
  if (!fs.existsSync(CUSTOM_DIR)) return [];
  return fs.readdirSync(CUSTOM_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, f), 'utf8')); } catch { return null; }
  }).filter(Boolean);
}

// files: [{ filename, buffer }]. Adds to an existing type with the same name.
export function importSchematics(name, files) {
  const id = slug(name);
  const file = path.join(CUSTOM_DIR, `${id}.json`);
  const def = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { id, label: String(name).trim().slice(0, 40), examples: [] };
  const added = [], errors = [];
  let list = [];
  try { list = expandUploads(files); } catch (e) { errors.push({ filename: 'zip', error: e.message }); }
  for (const f of list) {
    try {
      const ex = toExample(readSchematic(f.buffer, f.filename), [GX, GY, GZ]);
      ex.filename = f.filename;
      def.examples.push(ex);
      added.push(ex);
    } catch (e) {
      errors.push({ filename: f.filename, error: e.message });
    }
  }
  if (!def.examples.length) throw new Error(errors.map((e) => `${e.filename}: ${e.error}`).join('; ') || 'No usable schematics');
  def.theme = deriveTheme(def.examples);
  def.updated = new Date().toISOString();
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(def));
  return { def, added, errors };
}

export function deleteDef(id) {
  fs.rmSync(path.join(CUSTOM_DIR, `${slug(id)}.json`), { force: true });
}

const clampRange = (lo, hi, max) => [Math.max(2, Math.min(lo, max)), Math.max(2, Math.min(hi, max))];

export function makeCustomSpec(def) {
  const ex = def.examples;
  const span = (k, max) => clampRange(Math.floor(Math.min(...ex.map((e) => e[k])) * 0.7), Math.ceil(Math.max(...ex.map((e) => e[k])) * 1.3), max);
  const words = def.label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return {
    id: def.id,
    label: def.label,
    description: `Learned from your ${ex.length} schematic${ex.length > 1 ? 's' : ''} (${[...new Set(ex.map((e) => e.filename))].slice(0, 3).join(', ')}${ex.length > 3 ? ', …' : ''}).`,
    custom: true,
    keywords: words.length ? words : [def.id],
    variants: null,
    size: { w: span('w', GX), d: span('d', GZ), h: span('h', GY) },
    door: false,
    maxWindowRatio: 0,
    windowBand: () => false,
    defaultTheme: themeId(def.id),
    imitate: true,

    // Pick an example and a new size around it (pinned sizes win), maybe turned 90°.
    derive(t, rng, opts = {}) {
      const e = ex[Math.floor(rng() * ex.length)];
      const turn = rng() < 0.5 && e.w <= GZ && e.d <= GX;
      const ew = turn ? e.d : e.w, ed = turn ? e.w : e.d;
      const s = () => 0.75 + rng() * 0.55;
      t.example0 = { e, turn, flip: rng() < 0.5 };
      t.w = opts.width ? Math.min(GX, opts.width) : Math.max(2, Math.min(GX, Math.round(ew * s())));
      t.d = opts.depth ? Math.min(GZ, opts.depth) : Math.max(2, Math.min(GZ, Math.round(ed * s())));
      t.h = opts.height ? Math.min(GY, opts.height) : Math.max(2, Math.min(GY, Math.round(e.h * s())));
    },

    // Lay the resized example into the lot (abstract roles, AIR elsewhere).
    place(t) {
      const { e, turn, flip } = t.example0;
      const ew = turn ? e.d : e.w, ed = turn ? e.w : e.d;
      const mx = sliceMap(t.w, ew), my = sliceMap(t.h, e.h), mz = sliceMap(t.d, ed);
      const grid = new Int8Array(N);
      for (let y = 0; y < t.h; y++) for (let z = 0; z < t.d; z++) for (let x = 0; x < t.w; x++) {
        let sx = mx[flip ? t.w - 1 - x : x], sz = mz[z];
        if (turn) [sx, sz] = [sz, ew - 1 - sx];
        grid[idx(t.x0 + x, y, t.z0 + z)] = +e.grid[(my[y] * e.d + sz) * e.w + sx];
      }
      t.example = grid;
    },

    // Shape hints only: where it is solid/empty and which solid cells are tops, corners, faces.
    zone(t, x, y, z) {
      const E = t.example;
      const inBox = x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1 && y < t.h;
      if (E[idx(x, y, z)] === AIR) return inBox ? Z_INTERIOR : Z_OUT;
      if (y === 0) return Z_FOUND;
      if (y + 1 >= GY || E[idx(x, y + 1, z)] === AIR) return Z_ROOF;
      if ((x === t.x0 || x === t.x1) && (z === t.z0 || z === t.z1)) return Z_CORNER;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= GX || nz >= GZ || E[idx(nx, y, nz)] === AIR) return Z_WALL;
      }
      return Z_CORE;
    },

    // Roof blocks become stairs facing the side that keeps rising, slabs on peaks.
    roofShape(t, x, y, z, grid) {
      const style = def.theme.roofStyle;
      if (style !== 'stairs') return { kind: style === 'slab' ? 'slab' : 'full' };
      const up = [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']].filter(([dx, dz]) => {
        const nx = x + dx, nz = z + dz;
        return y + 1 < GY && nx >= 0 && nz >= 0 && nx < GX && nz < GZ && grid[idx(nx, y + 1, nz)] !== AIR;
      });
      if (up.length === 1) return { kind: 'stairs', facing: up[0][2] };
      return { kind: up.length ? 'full' : 'slab' };
    },
  };
}
