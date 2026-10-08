// Turn abstract builds into Minecraft files for any version from 1.12.2 to latest:
//   - .schem (Sponge v2, WorldEdit 7+ / 1.13+) or .schematic (MCEdit, WorldEdit 6 / 1.12)
//   - a data pack (1.13+) or a functions folder (1.12) with /function commands
//   - an HTML preview gallery

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { AIR, FOUNDATION, WALL, PILLAR, WINDOW, DOOR, ROOF, THEMES } from './blocks.js';
import { GX, GY, GZ, idx } from './env.js';
import { Z_ROOF } from './zones.js';
import { blockArg, availableName, legacyBlock } from './versions.js';
import * as nbt from './nbt.js';
import { zip } from './zip.js';
import { packSpanning } from './bits.js';

// ---------- abstract block -> modern block name + state ----------

export function blockFor(b, t, grid, x, y, z) {
  const th = THEMES[t.theme];
  switch (b) {
    case FOUNDATION: return { name: th.foundation, props: {} };
    case WALL: return { name: th.wall, props: {} };
    case PILLAR: return { name: th.pillar, props: {} };
    case WINDOW: {
      const onX = x === t.x0 || x === t.x1;
      return { name: th.window, props: onX ? { north: 'true', south: 'true' } : { east: 'true', west: 'true' } };
    }
    case DOOR: {
      // Only complete two-block doors are exported.
      const props = { facing: 'south', hinge: 'left' };
      if (y >= 1 && grid[idx(x, y - 1, z)] === DOOR) return { name: th.door, props: { half: 'upper', ...props } };
      if (y + 1 < GY && grid[idx(x, y + 1, z)] === DOOR) return { name: th.door, props: { half: 'lower', ...props } };
      return null;
    }
    case ROOF: {
      const shape = t.zones[idx(x, y, z)] === Z_ROOF && t.spec.roofShape ? t.spec.roofShape(t, x, y, z, grid) : { kind: 'full' };
      if (shape.kind === 'stairs') return { name: th.roofStairs, props: { facing: shape.facing, half: 'bottom' } };
      if (shape.kind === 'slab') return { name: th.roofSlab, props: { type: 'bottom' } };
      return { name: th.roofFull, props: {} };
    }
  }
  return null;
}

function eachBlock(build, fn) {
  const { target: t, grid } = build;
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const i = idx(x, y, z);
    // Realism overrides (src/realism.js): a different block, an extra block, or null = air.
    if (build.realism?.has(i)) {
      const e = build.realism.get(i);
      if (e) fn(x, y, z, e);
      continue;
    }
    const b = grid[i];
    if (b === AIR) continue;
    const blk = blockFor(b, t, grid, x, y, z);
    if (blk) fn(x, y, z, blk);
  }
}

// ---------- /function commands ----------

const describe = (b) => {
  const t = b.target;
  return `${t.spec.label} ${t.w}x${t.d}${t.h ? `, height ${t.h}` : ''}${t.variant ? `, ${t.variant} ${t.spec.variantLabel ?? 'style'}` : ''}, ${t.theme} theme`;
};

// Built relative to the player: ground layer replaces the block under their feet, 2 blocks toward +X/+Z.
export function toMcfunction(build, version) {
  const ox = 2, oy = -1, oz = 2;
  const lines = [
    `# ${build.name}: ${describe(build)} | score ${build.metrics.score}/100 | Minecraft ${version.label}`,
    `fill ~${ox} ~ ~${oz} ~${ox + GX - 1} ~${GY - 2} ~${oz + GZ - 1} air`,
  ];
  eachBlock(build, (x, y, z, blk) => lines.push(`setblock ~${x + ox} ~${y + oy} ~${z + oz} ${blockArg(blk.name, blk.props, version)}`));
  return lines.join('\n') + '\n';
}

// Files for /function use: a data pack (1.13+) or a 1.12 functions folder.
export function functionPackage(builds, version) {
  const fns = builds.map((b) => ({ name: b.name, content: toMcfunction(b, version) }));
  fns.push({
    name: 'list',
    content: builds.map((b) =>
      `tellraw @s {"text":"rlbuild:${b.name}  ${describe(b)}  score ${b.metrics.score}","color":"gold"}`).join('\n') + '\n',
  });
  if (version.legacy) {
    return {
      kind: 'functions', root: 'rlbuild_functions_1.12',
      files: [
        ...fns.map((f) => ({ path: `data/functions/rlbuild/${f.name}.mcfunction`, content: f.content })),
        { path: 'HOW_TO_INSTALL.txt', content: 'Minecraft 1.12: copy the "data" folder into your world folder\n(so files end up in <world>/data/functions/rlbuild/), then /reload in game\nand run /function rlbuild:list\n' },
      ],
    };
  }
  const folder = version.format >= 48 ? 'function' : 'functions';
  const pack = version.format >= 88
    ? { description: 'RL-generated builds: /function rlbuild:list', min_format: version.format, max_format: 999 }
    : { pack_format: version.format, description: 'RL-generated builds: /function rlbuild:list' };
  return {
    kind: 'datapack', root: 'rlbuild_datapack',
    files: [
      { path: 'pack.mcmeta', content: JSON.stringify({ pack }, null, 2) },
      ...fns.map((f) => ({ path: `data/rlbuild/${folder}/${f.name}.mcfunction`, content: f.content })),
    ],
  };
}

export function writePackage(pkg, outDir) {
  const root = path.join(outDir, pkg.root);
  fs.rmSync(root, { recursive: true, force: true });
  for (const f of pkg.files) {
    const p = path.join(root, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }
  return root;
}

export const zipPackage = (pkg) => zip(pkg.files.map((f) => ({ path: `${pkg.root}/${f.path}`, content: f.content })));

// Install straight into a world folder; replaces a previous rlbuild install.
export function installPackage(pkg, worldDir) {
  if (!fs.existsSync(path.join(worldDir, 'level.dat'))) throw new Error(`Not a Minecraft world (no level.dat): ${worldDir}`);
  if (pkg.kind === 'datapack') {
    const dest = path.join(worldDir, 'datapacks', pkg.root);
    fs.rmSync(dest, { recursive: true, force: true });
    for (const f of pkg.files) {
      const p = path.join(dest, f.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.content);
    }
    return dest;
  }
  const dest = path.join(worldDir, 'data', 'functions', 'rlbuild');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of pkg.files) if (f.path.startsWith('data/')) fs.writeFileSync(path.join(worldDir, f.path), f.content);
  return dest;
}

// ---------- schematics ----------

// Cropped bounds of the non-air blocks.
function bounds(build) {
  const b = { x0: GX, y0: GY, z0: GZ, x1: -1, y1: -1, z1: -1 };
  eachBlock(build, (x, y, z) => {
    b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.z0 = Math.min(b.z0, z);
    b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); b.z1 = Math.max(b.z1, z);
  });
  if (b.x1 < 0) return { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
  return b;
}

// The build as a palette + block-index grid (cropped). Block names are resolved for the
// version: modern ids for 1.13+, pre-flattening ids + states for 1.12.
function gridOf(build, version) {
  const bb = bounds(build);
  const W = bb.x1 - bb.x0 + 1, H = bb.y1 - bb.y0 + 1, L = bb.z1 - bb.z0 + 1;
  const keys = ['minecraft:air'], parts = [{ name: 'minecraft:air', props: {} }], index = new Map([['minecraft:air', 0]]);
  const ids = new Uint32Array(W * H * L);
  eachBlock(build, (x, y, z, blk) => {
    let name, props;
    if (version.legacy) {
      const l = legacyBlock(availableName(blk.name, version), blk.props);
      name = `minecraft:${l.id}`; props = l.state;
    } else {
      name = `minecraft:${availableName(blk.name, version)}`; props = blk.props;
    }
    const st = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',');
    const key = st ? `${name}[${st}]` : name;
    let id = index.get(key);
    if (id === undefined) { id = keys.length; keys.push(key); parts.push({ name, props }); index.set(key, id); }
    ids[((y - bb.y0) * L + (z - bb.z0)) * W + (x - bb.x0)] = id;
  });
  return { W, H, L, keys, parts, ids };
}

// .schem (Sponge Schematic v2 for WorldEdit 7+, or v3 for WorldEdit 7.3+).
function spongeSchem(build, version, v3 = false) {
  const { W, H, L, keys, ids } = gridOf(build, version);
  const data = [];
  for (let v of ids) {
    while (v & ~0x7f) { data.push((v & 0x7f) | 0x80); v >>>= 7; }
    data.push(v);
  }
  const palette = nbt.compound(Object.fromEntries(keys.map((k, i) => [k, nbt.int(i)])));
  const meta = { Name: nbt.string(build.name), Author: nbt.string('RL Build Generator'), Date: nbt.long(Date.now()) };
  const dims = { Width: nbt.short(W), Height: nbt.short(H), Length: nbt.short(L) };
  if (v3) {
    const body = nbt.compound({
      Version: nbt.int(3), DataVersion: nbt.int(version.dataVersion), Metadata: nbt.compound(meta), ...dims,
      Offset: nbt.intArray([0, 0, 0]),
      Blocks: nbt.compound({ Palette: palette, Data: nbt.byteArray(Uint8Array.from(data)), BlockEntities: nbt.list('compound', []) }),
    });
    return zlib.gzipSync(nbt.encode('', nbt.compound({ Schematic: body })));
  }
  const root = nbt.compound({
    Version: nbt.int(2), DataVersion: nbt.int(version.dataVersion), ...dims,
    Offset: nbt.intArray([0, 0, 0]),
    PaletteMax: nbt.int(keys.length), Palette: palette,
    BlockData: nbt.byteArray(Uint8Array.from(data)),
    BlockEntities: nbt.list('compound', []),
    Metadata: nbt.compound({ ...meta, WEOffsetX: nbt.int(0), WEOffsetY: nbt.int(0), WEOffsetZ: nbt.int(0) }),
  });
  return zlib.gzipSync(nbt.encode('Schematic', root));
}

const paletteTag = ({ name, props }) => {
  const c = { Name: nbt.string(name) };
  if (Object.keys(props).length) c.Properties = nbt.compound(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, nbt.string(String(v))])));
  return nbt.compound(c);
};
const xyz = (x, y, z) => nbt.compound({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) });

// .litematic (Litematica mod): one region, air at palette index 0, spanning bit array.
function litematicFile(build, version) {
  const { W, H, L, parts, ids } = gridOf(build, version);
  const bits = Math.max(2, Math.ceil(Math.log2(parts.length)));
  const total = ids.reduce((n, v) => n + (v ? 1 : 0), 0);
  const now = Date.now();
  const region = nbt.compound({
    Position: xyz(0, 0, 0), Size: xyz(W, H, L),
    BlockStatePalette: nbt.list('compound', parts.map(paletteTag)),
    BlockStates: nbt.longArray(packSpanning(ids, bits)),
    TileEntities: nbt.list('compound', []), Entities: nbt.list('compound', []),
    PendingBlockTicks: nbt.list('compound', []), PendingFluidTicks: nbt.list('compound', []),
  });
  const root = nbt.compound({
    Version: nbt.int(6), SubVersion: nbt.int(1), MinecraftDataVersion: nbt.int(version.dataVersion),
    Metadata: nbt.compound({
      Name: nbt.string(build.name), Author: nbt.string('RL Build Generator'), Description: nbt.string(describe(build)),
      RegionCount: nbt.int(1), TotalVolume: nbt.int(W * H * L), TotalBlocks: nbt.int(total),
      TimeCreated: nbt.long(now), TimeModified: nbt.long(now), EnclosingSize: xyz(W, H, L),
    }),
    Regions: nbt.compound({ [build.name]: region }),
  });
  return zlib.gzipSync(nbt.encode('', root));
}

// Structure block .nbt (/place template or a structure block). Air is left out, so placing
// it keeps whatever is already there (like //paste -a).
function structureFile(build, version) {
  const { W, H, L, parts, ids } = gridOf(build, version);
  const blocks = [];
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
    const v = ids[(y * L + z) * W + x];
    if (v) blocks.push(nbt.compound({ pos: nbt.list('int', [nbt.int(x), nbt.int(y), nbt.int(z)]), state: nbt.int(v) }));
  }
  const root = nbt.compound({
    DataVersion: nbt.int(version.dataVersion),
    size: nbt.list('int', [nbt.int(W), nbt.int(H), nbt.int(L)]),
    palette: nbt.list('compound', parts.map(paletteTag)),
    blocks: nbt.list('compound', blocks),
    entities: nbt.list('compound', []),
  });
  return zlib.gzipSync(nbt.encode('', root));
}

// 1.12 numeric block ids and metadata for the legacy blocks the themes use.
const LEGACY_IDS = {
  stone: 1, cobblestone: 4, planks: 5, log: 17, sandstone: 24, brick_block: 45, wooden_door: 64,
  stonebrick: 98, glass_pane: 102, wooden_slab: 126, spruce_stairs: 134, stained_hardened_clay: 159,
  dark_oak_stairs: 164, hardened_clay: 172, red_sandstone_stairs: 180, stone_slab2: 182,
  spruce_door: 193, birch_door: 194, jungle_door: 195,
  // realism blocks
  grass: 2, gravel: 13, leaves: 18, web: 30, tallgrass: 31, yellow_flower: 37, red_flower: 38, bookshelf: 47,
  mossy_cobblestone: 48, torch: 50, chest: 54, crafting_table: 58, furnace: 61, trapdoor: 96, vine: 106,
  carpet: 171, grass_path: 208,
};
const WOOD = { oak: 0, spruce: 1, birch: 2, jungle: 3, acacia: 4, dark_oak: 5 };
const STAIR_FACING = { east: 0, west: 1, south: 2, north: 3 };
const DOOR_FACING = { east: 0, south: 1, west: 2, north: 3 };
const CHEST_FACING = { north: 2, south: 3, west: 4, east: 5 };
const TRAPDOOR_FACING = { north: 0, south: 1, west: 2, east: 3 };
const STONE = { stone: 0, granite: 1, smooth_granite: 2, diorite: 3, smooth_diorite: 4, andesite: 5, smooth_andesite: 6 };
const STONEBRICK = { stonebrick: 0, mossy_stonebrick: 1, cracked_stonebrick: 2, chiseled_stonebrick: 3 };

function legacyMeta(id, s) {
  if (id === 'planks' || id === 'wooden_slab') return (WOOD[s.variant] ?? 0) | (s.half === 'top' ? 8 : 0);
  if (id === 'log') return WOOD[s.variant] ?? 0;
  if (id === 'stone') return STONE[s.variant] ?? 0;
  if (id === 'stonebrick') return STONEBRICK[s.variant] ?? 0;
  if (id === 'leaves') return (WOOD[s.variant] ?? 0) | (s.decayable === 'false' ? 4 : 0);
  if (id === 'tallgrass') return 1;
  if (id === 'torch') return 5;
  if (id === 'chest' || id === 'furnace') return CHEST_FACING[s.facing] ?? 2;
  if (id === 'trapdoor') return (TRAPDOOR_FACING[s.facing] ?? 0) | (s.open === 'true' ? 4 : 0) | (s.half === 'top' ? 8 : 0);
  if (id === 'vine') return (s.south === 'true' ? 1 : 0) | (s.west === 'true' ? 2 : 0) | (s.north === 'true' ? 4 : 0) | (s.east === 'true' ? 8 : 0);
  if (id === 'carpet') return s.color === 'red' ? 14 : 0;
  if (id === 'sandstone') return { sandstone: 0, chiseled_sandstone: 1, smooth_sandstone: 2 }[s.type] ?? 0;
  if (id === 'stained_hardened_clay') return s.color === 'pink' ? 6 : 0;
  if (id.endsWith('_stairs')) return (STAIR_FACING[s.facing] ?? 0) | (s.half === 'top' ? 4 : 0);
  if (id.endsWith('_door')) return s.half === 'upper' ? 8 | (s.hinge === 'right' ? 1 : 0) : DOOR_FACING[s.facing] ?? 0;
  if (id === 'stone_slab2') return s.half === 'top' ? 8 : 0;
  return 0;
}

// .schematic (MCEdit/Alpha) for 1.12: numeric ids + nibble metadata.
function mceditSchematic(build, version) {
  const bb = bounds(build);
  const W = bb.x1 - bb.x0 + 1, H = bb.y1 - bb.y0 + 1, L = bb.z1 - bb.z0 + 1;
  const blocks = new Uint8Array(W * H * L), meta = new Uint8Array(W * H * L);
  eachBlock(build, (x, y, z, blk) => {
    const { id, state } = legacyBlock(availableName(blk.name, version), blk.props);
    const i = ((y - bb.y0) * L + (z - bb.z0)) * W + (x - bb.x0);
    blocks[i] = LEGACY_IDS[id] ?? 1;
    meta[i] = legacyMeta(id, state);
  });
  const root = nbt.compound({
    Width: nbt.short(W), Height: nbt.short(H), Length: nbt.short(L),
    Materials: nbt.string('Alpha'),
    Blocks: nbt.byteArray(blocks), Data: nbt.byteArray(meta),
    Entities: nbt.list('compound', []), TileEntities: nbt.list('compound', []),
  });
  return zlib.gzipSync(nbt.encode('Schematic', root));
}

// Pre-1.13 numeric blocks [x, y, z, 'minecraft:id', meta] (MineDojo runs Minecraft 1.11.2).
export function legacyPlacements(build, version) {
  const out = [];
  eachBlock(build, (x, y, z, blk) => {
    const { id, state } = legacyBlock(availableName(blk.name, version), blk.props);
    out.push([x, y, z, `minecraft:${id}`, legacyMeta(id, state)]);
  });
  return out;
}

// File formats offered for download (the same ones Build Scraper reads and writes).
export const FILE_FORMATS = {
  auto: { label: 'WorldEdit (.schem, or .schematic on 1.12)' },
  schem3: { label: 'WorldEdit 7.3+ (.schem v3)', ext: 'schem' },
  litematic: { label: 'Litematica (.litematic)', ext: 'litematic' },
  nbt: { label: 'Structure block (.nbt)', ext: 'nbt' },
};

export function schematicFile(build, version, format = 'auto') {
  if (format === 'litematic') return { filename: `${build.name}.litematic`, content: litematicFile(build, version) };
  if (format === 'nbt') return { filename: `${build.name}.nbt`, content: structureFile(build, version) };
  if (format === 'schem3' && !version.legacy) return { filename: `${build.name}.schem`, content: spongeSchem(build, version, true) };
  return version.legacy
    ? { filename: `${build.name}.schematic`, content: mceditSchematic(build, version) }
    : { filename: `${build.name}.schem`, content: spongeSchem(build, version) };
}

// ---------- HTML gallery ----------

export function galleryData(builds, log) {
  return {
    dims: [GX, GY, GZ],
    builds: builds.map((b) => ({
      id: b.id, name: b.name, type: b.target.type, label: b.target.spec.label, theme: b.target.theme,
      w: b.target.w, d: b.target.d, h: b.target.h, variant: b.target.variant,
      variantLabel: b.target.spec.variantLabel ?? 'style',
      metrics: b.metrics, grid: Array.from(b.grid).join(''), colors: THEMES[b.target.theme].colors,
      deco: b.deco ?? null, // realism preview overrides, see realism.js decoFor()
      fell: b.fell ?? 0, // blocks the physics slider made fall
    })),
    log,
  };
}

export function writeGallery(builds, log, file) {
  const tpl = fs.readFileSync(new URL('./gallery.html', import.meta.url), 'utf8');
  const render = fs.readFileSync(new URL('../web/render.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  fs.writeFileSync(file, tpl.replace('/*__RENDER__*/', render).replace('/*__DATA__*/null', JSON.stringify(galleryData(builds, log))));
}
