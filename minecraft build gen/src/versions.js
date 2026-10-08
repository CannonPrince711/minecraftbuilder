// Minecraft Java versions the exporter supports, newest first, and how block names
// change across them. Browser-safe (no Node imports): the web UI imports this too.

// format = data pack format (minecraft.wiki/w/Pack_format), dataVersion = world data
// version (minecraft.wiki/w/Data_version, used in .schem files). 1.12 has no data packs:
// it loads functions from <world>/data/functions and uses pre-1.13 block ids.
export const VERSIONS = [
  { id: '26.3', label: '26.3 (latest)', group: '26.x', format: 121, dataVersion: 5023 },
  { id: '26.2', label: '26.2', group: '26.x', format: 107, dataVersion: 4903 },
  { id: '26.1', label: '26.1 – 26.1.2', group: '26.x', format: 101, dataVersion: 4786 },
  { id: '1.21.11', label: '1.21.11', group: '1.21', format: 94, dataVersion: 4671 },
  { id: '1.21.9', label: '1.21.9 – 1.21.10', group: '1.21', format: 88, dataVersion: 4554 },
  { id: '1.21.7', label: '1.21.7 – 1.21.8', group: '1.21', format: 81, dataVersion: 4438 },
  { id: '1.21.6', label: '1.21.6', group: '1.21', format: 80, dataVersion: 4435 },
  { id: '1.21.5', label: '1.21.5', group: '1.21', format: 71, dataVersion: 4325 },
  { id: '1.21.4', label: '1.21.4', group: '1.21', format: 61, dataVersion: 4189 },
  { id: '1.21.2', label: '1.21.2 – 1.21.3', group: '1.21', format: 57, dataVersion: 4080 },
  { id: '1.21', label: '1.21 – 1.21.1', group: '1.21', format: 48, dataVersion: 3953 },
  { id: '1.20.5', label: '1.20.5 – 1.20.6', group: '1.20', format: 41, dataVersion: 3837 },
  { id: '1.20.3', label: '1.20.3 – 1.20.4', group: '1.20', format: 26, dataVersion: 3698 },
  { id: '1.20.2', label: '1.20.2', group: '1.20', format: 18, dataVersion: 3578 },
  { id: '1.20', label: '1.20 – 1.20.1', group: '1.20', format: 15, dataVersion: 3463 },
  { id: '1.19.4', label: '1.19.4', group: '1.19', format: 12, dataVersion: 3337 },
  { id: '1.19', label: '1.19 – 1.19.3', group: '1.19', format: 10, dataVersion: 3105 },
  { id: '1.18.2', label: '1.18.2', group: '1.18', format: 9, dataVersion: 2975 },
  { id: '1.18', label: '1.18 – 1.18.1', group: '1.18', format: 8, dataVersion: 2860 },
  { id: '1.17', label: '1.17 – 1.17.1', group: '1.17', format: 7, dataVersion: 2724 },
  { id: '1.16.2', label: '1.16.2 – 1.16.5', group: '1.13 – 1.16', format: 6, dataVersion: 2578 },
  { id: '1.15', label: '1.15 – 1.16.1', group: '1.13 – 1.16', format: 5, dataVersion: 2225 },
  { id: '1.13', label: '1.13 – 1.14.4', group: '1.13 – 1.16', format: 4, dataVersion: 1519 },
  { id: '1.12.2', label: '1.12 – 1.12.2', group: '1.12', format: 0, dataVersion: 1343, legacy: true },
];
export const LATEST = VERSIONS[0].id;

export function getVersion(id) {
  const v = VERSIONS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown Minecraft version "${id}". Pick one of: ${VERSIONS.map((x) => x.id).join(', ')}`);
  return v;
}

export function atLeast(id, min) {
  const a = id.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

// Blocks added after 1.13: [first version, stand-in for older versions].
const NEWER = {
  deepslate_tiles: ['1.17', 'dark_oak_planks'],
  deepslate_tile_stairs: ['1.17', 'dark_oak_stairs'],
  deepslate_tile_slab: ['1.17', 'dark_oak_slab'],
  mud_bricks: ['1.19', 'bricks'],
  cherry_planks: ['1.20', 'pink_terracotta'],
  stripped_cherry_log: ['1.20', 'stripped_birch_log'],
  cherry_door: ['1.20', 'birch_door'],
  // Realism blocks
  lantern: ['1.14', 'torch'],
  barrel: ['1.14', 'chest'],
  dirt_path: ['1.17', 'grass_path'],
  short_grass: ['1.20.3', 'grass'],
  cracked_deepslate_tiles: ['1.17', 'dark_oak_planks'],
  deepslate_bricks: ['1.17', 'dark_oak_planks'],
  polished_deepslate: ['1.17', 'dark_oak_planks'],
  packed_mud: ['1.19', 'bricks'],
  cherry_trapdoor: ['1.20', 'birch_trapdoor'],
  spruce_trapdoor: ['1.13', 'oak_trapdoor'],
  birch_trapdoor: ['1.13', 'oak_trapdoor'],
  jungle_trapdoor: ['1.13', 'oak_trapdoor'],
  acacia_trapdoor: ['1.13', 'oak_trapdoor'],
  dark_oak_trapdoor: ['1.13', 'oak_trapdoor'],
  stripped_oak_wood: ['1.13', 'oak_planks'],
  stripped_spruce_wood: ['1.13', 'spruce_planks'],
  stripped_birch_wood: ['1.13', 'birch_planks'],
  stripped_jungle_wood: ['1.13', 'jungle_planks'],
  stripped_acacia_wood: ['1.13', 'acacia_planks'],
  stripped_dark_oak_wood: ['1.13', 'dark_oak_planks'],
  stripped_cherry_wood: ['1.20', 'cherry_planks'],
};

// 1.12 ("pre-flattening") ids + state for every block the themes can produce.
const LEGACY = {
  cobblestone: ['cobblestone', {}],
  stone: ['stone', { variant: 'stone' }],
  stone_bricks: ['stonebrick', { variant: 'stonebrick' }],
  bricks: ['brick_block', {}],
  oak_planks: ['planks', { variant: 'oak' }],
  spruce_planks: ['planks', { variant: 'spruce' }],
  birch_planks: ['planks', { variant: 'birch' }],
  dark_oak_planks: ['planks', { variant: 'dark_oak' }],
  oak_log: ['log', { variant: 'oak', axis: 'y' }],
  spruce_log: ['log', { variant: 'spruce', axis: 'y' }],
  birch_log: ['log', { variant: 'birch', axis: 'y' }],
  stripped_birch_log: ['log', { variant: 'birch', axis: 'y' }],
  glass_pane: ['glass_pane', {}],
  oak_door: ['wooden_door', {}],
  spruce_door: ['spruce_door', {}],
  birch_door: ['birch_door', {}],
  jungle_door: ['jungle_door', {}],
  dark_oak_stairs: ['dark_oak_stairs', {}],
  spruce_stairs: ['spruce_stairs', {}],
  red_sandstone_stairs: ['red_sandstone_stairs', {}],
  dark_oak_slab: ['wooden_slab', { variant: 'dark_oak' }],
  spruce_slab: ['wooden_slab', { variant: 'spruce' }],
  red_sandstone_slab: ['stone_slab2', { variant: 'red_sandstone' }],
  cut_sandstone: ['sandstone', { type: 'smooth_sandstone' }],
  smooth_sandstone: ['sandstone', { type: 'smooth_sandstone' }],
  chiseled_sandstone: ['sandstone', { type: 'chiseled_sandstone' }],
  terracotta: ['hardened_clay', {}],
  pink_terracotta: ['stained_hardened_clay', { color: 'pink' }],
  jungle_planks: ['planks', { variant: 'jungle' }],
  acacia_planks: ['planks', { variant: 'acacia' }],
  // Realism blocks
  mossy_cobblestone: ['mossy_cobblestone', {}],
  mossy_stone_bricks: ['stonebrick', { variant: 'mossy_stonebrick' }],
  cracked_stone_bricks: ['stonebrick', { variant: 'cracked_stonebrick' }],
  andesite: ['stone', { variant: 'andesite' }],
  polished_andesite: ['stone', { variant: 'smooth_andesite' }],
  sandstone: ['sandstone', { type: 'sandstone' }],
  gravel: ['gravel', {}],
  torch: ['torch', { facing: 'up' }],
  chest: ['chest', {}],
  crafting_table: ['crafting_table', {}],
  bookshelf: ['bookshelf', {}],
  furnace: ['furnace', {}],
  white_carpet: ['carpet', { color: 'white' }],
  red_carpet: ['carpet', { color: 'red' }],
  oak_trapdoor: ['trapdoor', {}],
  oak_leaves: ['leaves', { variant: 'oak', decayable: 'false' }],
  grass: ['tallgrass', { type: 'tall_grass' }],
  poppy: ['red_flower', { type: 'poppy' }],
  dandelion: ['yellow_flower', { type: 'dandelion' }],
  vine: ['vine', {}],
  cobweb: ['web', {}],
  grass_path: ['grass_path', {}],
  grass_block: ['grass', {}],
};

// The block actually used for `name` on this version (after stand-ins).
export function availableName(name, version) {
  let n = name;
  while (NEWER[n] && !atLeast(version.id, NEWER[n][0])) n = NEWER[n][1];
  return n;
}

// Full block argument for setblock. `props` are modern (1.13+) state properties.
export function blockArg(name, props, version) {
  const n = availableName(name, version);
  if (version.legacy) {
    const { id, state } = legacyBlock(n, props);
    const str = Object.entries(state).map(([k, v]) => `${k}=${v}`).join(',');
    return `minecraft:${id}${str ? ' ' + str : ''}`;
  }
  const state = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',');
  return `minecraft:${n}${state ? `[${state}]` : ''}`;
}

// 1.12 id + state for an (already available) modern block name.
export function legacyBlock(name, props) {
  const [id, base] = LEGACY[name] ?? [name, {}];
  return { id, state: { ...base, ...legacyProps(props, id) } };
}

// 1.12 stores fewer properties: pane connections are computed, slabs use "half",
// and each door half only keeps some of its state.
function legacyProps(p, id) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (['north', 'south', 'east', 'west'].includes(k) && id !== 'vine') continue;
    if (k === 'persistent') continue;
    if (k === 'type') out.half = v;
    else out[k] = v;
  }
  if (p.half === 'lower') delete out.hinge;
  if (p.half === 'upper') delete out.facing;
  return out;
}

// Theme blocks that get a stand-in on this version: [[wanted, used], ...].
export function substitutions(theme, version) {
  const out = [];
  for (const [k, v] of Object.entries(theme)) {
    if (typeof v !== 'string') continue;
    const used = availableName(v, version);
    if (used !== v) out.push([v, used]);
  }
  return out;
}
