// Approximate top-down map colours for block names. Exact matches first,
// then keyword rules, then a stable hash colour so unknown blocks still differ.

const DYES = {
  white: 0xe9ecec, orange: 0xf07613, magenta: 0xbd44b3, light_blue: 0x3aafd9, yellow: 0xf8c627,
  lime: 0x70b919, pink: 0xed8dac, gray: 0x3e4447, light_gray: 0x8e8e86, cyan: 0x158991,
  purple: 0x792aac, blue: 0x35399d, brown: 0x724728, green: 0x546d1b, red: 0xa12722, black: 0x141519,
};
const WOODS = {
  oak: 0xa2834f, spruce: 0x725431, birch: 0xc0af79, jungle: 0xa07351, acacia: 0xa8592f, dark_oak: 0x432b14,
  mangrove: 0x753630, cherry: 0xe3b3ad, pale_oak: 0xe0d6d2, bamboo: 0xc3ae55, crimson: 0x6a344b, warped: 0x2b6963,
};

const EXACT = {
  'grass_block': 0x7cbd6b, 'dirt': 0x866043, 'coarse_dirt': 0x77553b, 'podzol': 0x5c3f18, 'mycelium': 0x6f6265,
  'farmland': 0x8f6646, 'dirt_path': 0x947a41, 'grass_path': 0x947a41, 'rooted_dirt': 0x90684c, 'mud': 0x3c393d,
  'stone': 0x7d7d7d, 'cobblestone': 0x7a7a7a, 'mossy_cobblestone': 0x6e7c5e, 'granite': 0x956756, 'diorite': 0xbcbcbc,
  'andesite': 0x888889, 'deepslate': 0x505052, 'cobbled_deepslate': 0x4d4d50, 'tuff': 0x6c6d66, 'calcite': 0xdfe0dc,
  'bedrock': 0x555555, 'sand': 0xdbd3a0, 'red_sand': 0xbe6621, 'gravel': 0x837f7e, 'clay': 0xa0a6b3,
  'sandstone': 0xd8cb9b, 'red_sandstone': 0xb5621f, 'water': 0x3f76e4, 'lava': 0xd4600a, 'ice': 0x91b7fd,
  'packed_ice': 0x8db4fa, 'blue_ice': 0x74a8fd, 'snow': 0xf9fefe, 'snow_block': 0xf9fefe, 'powder_snow': 0xf8fdfd,
  'obsidian': 0x0f0b19, 'crying_obsidian': 0x210a3c, 'netherrack': 0x6f3534, 'soul_sand': 0x51403a, 'soul_soil': 0x4b3a30,
  'glowstone': 0xab8654, 'end_stone': 0xdbde9e, 'purpur_block': 0xa97da9, 'prismarine': 0x63a090, 'dark_prismarine': 0x335b4b,
  'sea_lantern': 0xacc7be, 'bricks': 0x966153, 'stone_bricks': 0x7a797a, 'nether_bricks': 0x2c161a, 'quartz_block': 0xebe5de,
  'smooth_stone': 0x9e9e9e, 'terracotta': 0x985e43, 'glass': 0xc0f0f8, 'tnt': 0xdb441a, 'bookshelf': 0x6c5a38,
  'hay_block': 0xa68b0c, 'melon': 0x6f9123, 'pumpkin': 0xc6761c, 'carved_pumpkin': 0xc6761c, 'jack_o_lantern': 0xd5961d,
  'cactus': 0x5a8a2a, 'sugar_cane': 0x94c065, 'bamboo': 0x5d8f2a, 'kelp': 0x56822b, 'seagrass': 0x3d7a29,
  'lily_pad': 0x208030, 'vine': 0x4a7a20, 'iron_block': 0xdcdcdc, 'gold_block': 0xf6d03d, 'diamond_block': 0x62ede4,
  'emerald_block': 0x2acb57, 'lapis_block': 0x1f43a3, 'redstone_block': 0xaf1906, 'coal_block': 0x101010,
  'netherite_block': 0x433e40, 'copper_block': 0xc06c50, 'amethyst_block': 0x8561bf, 'moss_block': 0x596e2d,
  'basalt': 0x515156, 'blackstone': 0x2a2328, 'magma_block': 0x8e3f1f, 'slime_block': 0x70c05a, 'honey_block': 0xfbb935,
  'sponge': 0xc3c04a, 'torch': 0xffd85a, 'lantern': 0xdba04a, 'campfire': 0xd38e33, 'crafting_table': 0x7b5733,
  'furnace': 0x6e6e6e, 'chest': 0xa16b2b, 'barrel': 0x8c6538, 'rail': 0x7f7362, 'redstone_wire': 0xa00000,
  'short_grass': 0x6a9e38, 'grass': 0x6a9e38, 'tall_grass': 0x6a9e38, 'fern': 0x5e8f33, 'dead_bush': 0x7b4f19,
  'mangrove_roots': 0x4a3b2a, 'sculk': 0x0c1e24, 'dripstone_block': 0x866b5c, 'end_rod': 0xe6dccf,
};

const RULES = [
  [/_leaves$/, (n) => n.startsWith('cherry') ? 0xe8a8c0 : n.startsWith('azalea') || n.startsWith('flowering') ? 0x5d7a2a : n.startsWith('pale') ? 0x8a9488 : 0x4b8a2a],
  [/glass_pane$|^glass_pane$/, () => 0xc0f0f8],
  [/(concrete_powder|concrete|wool|carpet|terracotta|glass|shulker_box|bed|banner|candle)/, null],
  [/(_log|_wood|_stem|_hyphae)$/, (n) => woodBase(n, -0.25)],
  [/(planks|_stairs|_slab|_fence|_fence_gate|_door|_trapdoor|_sign|_button|_pressure_plate)$/, (n) => woodBase(n, 0)],
  [/_ore$/, () => 0x7f7f7f],
  [/copper/, (n) => n.includes('oxidized') ? 0x52a284 : n.includes('weathered') ? 0x6c9a6f : n.includes('exposed') ? 0xa07e68 : 0xc06c50],
  [/sandstone/, (n) => n.startsWith('red') ? 0xb5621f : 0xd8cb9b],
  [/quartz/, () => 0xebe5de], [/purpur/, () => 0xa97da9], [/prismarine/, () => 0x63a090],
  [/nether_brick/, () => 0x2c161a], [/blackstone/, () => 0x2a2328], [/deepslate/, () => 0x505052],
  [/stone_brick|stone/, () => 0x7d7d7d], [/brick/, () => 0x966153], [/mud/, () => 0x89664b],
  [/coral/, () => 0xd25a8a], [/(tulip|poppy|rose|dandelion|orchid|allium|bluet|daisy|cornflower|lily|flower|peony|lilac|sunflower)/, () => 0xc8b23a],
  [/(sapling|bush|roots|sprouts|fungus|mushroom|wart)/, () => 0x5f7f3a],
  [/(rail|lever|tripwire|string|torch|lantern|chain|bars)/, () => 0x8c8c8c],
];

function woodBase(n, shade) {
  for (const [w, c] of Object.entries(WOODS)) if (n.startsWith(w + '_')) return shadeColor(c, shade);
  if (n.startsWith('nether_brick')) return 0x2c161a;
  if (n.startsWith('iron')) return 0xc8c8c8;
  return shadeColor(0x7d7d7d, shade);
}

function shadeColor(c, f) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const k = 1 + f;
  return (clamp(r * k) << 16) | (clamp(g * k) << 8) | clamp(b * k);
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

const cache = new Map();
/** RGB int for a block state string. Returns -1 for blocks that are invisible from above. */
export function blockColor(state) {
  let c = cache.get(state);
  if (c !== undefined) return c;
  let name = state.replace(/^minecraft:/, '').replace(/\[.*$/, '');
  c = colorForName(name);
  cache.set(state, c);
  return c;
}

const INVISIBLE = new Set(['air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void', 'moving_piston']);

function colorForName(name) {
  if (INVISIBLE.has(name)) return -1;
  if (EXACT[name] !== undefined) return EXACT[name];
  if (/(concrete|wool|carpet|terracotta|glass|shulker|bed|banner|candle)/.test(name)) {
    // longest prefix so light_gray / light_blue win over gray / blue
    const dye = Object.keys(DYES).filter((d) => name.startsWith(d + '_')).sort((a, b) => b.length - a.length)[0];
    if (dye) return name.includes('terracotta') ? shadeColor(DYES[dye], -0.35) : DYES[dye];
  }
  for (const [re, fn] of RULES) if (re.test(name) && fn) return fn(name);
  if (name.startsWith('potted_')) return 0x7b4a35;
  if (name.startsWith('waxed_')) return colorForName(name.slice(6));
  if (name.startsWith('infested_')) return colorForName(name.slice(9));
  if (name.startsWith('stripped_')) return shadeColor(woodBase(name.slice(9), 0), 0.1);
  // stable hash colour
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return ((h >>> 8) & 0x7f7f7f) + 0x404040;
}

export function isWater(state) {
  return state === 'minecraft:water' || state.startsWith('minecraft:water[') || state.includes('waterlogged=true')
    || /minecraft:(kelp|kelp_plant|seagrass|tall_seagrass|bubble_column)\b/.test(state);
}
