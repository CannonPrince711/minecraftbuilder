// Turn a Schematic into Minecraft 1.11 commands for MineDojo (which runs Minecraft 1.11.2).
// Modern block states are mapped back to numeric-era names + data values, and runs of the
// same block along X become one /fill so large builds need fewer simulator steps.
import LEGACY from './data/legacy-blocks.json' with { type: 'json' };
import ITEMS from './data/legacy-items.json' with { type: 'json' };
import { parseState, formatState } from './legacy-fix.js';
import { blockColor } from './colors.js';

const ID_TO_NAME = new Map(Object.entries(ITEMS.blockIdToName).map(([id, n]) => [+id, n]));
// 1.12-only blocks that 1.11 does not have
const NOT_IN_111 = /(concrete|glazed_terracotta)/;

// Renames after 1.13 that the 1.13 table does not know.
const RENAMES = {
  'minecraft:short_grass': 'minecraft:grass', 'minecraft:dirt_path': 'minecraft:grass_path',
  'minecraft:oak_sign': 'minecraft:sign', 'minecraft:oak_wall_sign': 'minecraft:wall_sign',
  'minecraft:cave_air': 'minecraft:air', 'minecraft:void_air': 'minecraft:air',
  'minecraft:smooth_stone_slab': 'minecraft:stone_slab', 'minecraft:smooth_stone': 'minecraft:double_stone_slab',
};

let byName = null;
function index() {
  if (byName) return byName;
  byName = new Map();
  for (const [key, state] of Object.entries(LEGACY)) {
    const [id, meta] = key.split(':').map(Number);
    const legacyName = ID_TO_NAME.get(id);
    if (!legacyName) continue;
    const { name, props } = parseState(state);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ props, legacyName, meta });
  }
  return byName;
}

const cache = new Map();
/** Returns { block: 'minecraft:planks', data: 1 } or null when there is no 1.11 equivalent. */
export function toLegacy(state) {
  if (cache.has(state)) return cache.get(state);
  let { name, props } = parseState(state);
  name = RENAMES[name] || name;
  let out = null;
  if (name === 'minecraft:air') out = { block: 'minecraft:air', data: 0 };
  else {
    const cands = index().get(name) || index().get(name.replace(/^minecraft:(waxed_|stripped_)/, 'minecraft:'));
    if (cands) {
      let best = null, bestScore = -1;
      for (const c of cands) {
        let score = 0;
        for (const [k, v] of Object.entries(c.props)) if (props[k] === v) score++;
        if (score > bestScore) { best = c; bestScore = score; }
      }
      if (best && !NOT_IN_111.test(best.legacyName)) out = { block: best.legacyName, data: best.meta };
    }
  }
  if (!out && name !== 'minecraft:air') out = nearest(name, props);
  cache.set(state, out);
  return out;
}

// Shape families used to pick a stand-in for blocks added after 1.11 (deepslate, new woods, walls...).
const FAMILY = (n) => (/_stairs$/.test(n) ? 'stairs' : /_slab$/.test(n) ? 'slab' : /_wall$/.test(n) ? 'wall' : /_fence$/.test(n) ? 'fence'
  : /_fence_gate$/.test(n) ? 'gate' : /_trapdoor$/.test(n) ? 'trapdoor' : /_door$/.test(n) ? 'door' : /_pane$/.test(n) ? 'pane'
  : /_carpet$/.test(n) ? 'carpet' : /_button$/.test(n) ? 'button' : /_pressure_plate$/.test(n) ? 'plate' : /_sign$/.test(n) ? 'sign' : 'other');
let families = null;
function nearest(name, props) {
  if (!families) {
    families = new Map();
    for (const n of index().keys()) {
      const f = FAMILY(n.replace('minecraft:', ''));
      if (!families.has(f)) families.set(f, []);
      families.get(f).push(n);
    }
  }
  const fam = FAMILY(name.replace('minecraft:', ''));
  const want = blockColor(name);
  if (want < 0) return null;
  let best = null, bestD = Infinity;
  for (const cand of families.get(fam) || []) {
    if (fam === 'other' && /(bedrock|ore|leaves|log|sapling|flower|mushroom|_bed|water|lava|fire|portal|spawner|chest|command|structure|piston|rail|torch|redstone|lever|button|plate|cake|banner|skull|head|pot|vine|grass$|fern|bush|crops|wheat|carrots|potatoes|beetroots|cactus|cane|stem|melon|pumpkin|tnt|ice|snow|farmland|path|anvil|beacon|hopper|cauldron|brewing|enchanting|ender|jukebox|note|sponge|web|glass|barrier|dispenser|dropper|furnace|crafting|bookshelf|daylight|observer|shulker|frame|egg|chorus|end_rod|slime|magma|bone|nether_wart|sea_lantern|glowstone|jack|repeater|comparator|tripwire|ladder|carpet)/.test(cand)) continue;
    const c = blockColor(cand);
    if (c < 0) continue;
    const d = ((c >> 16) - (want >> 16)) ** 2 + (((c >> 8) & 255) - ((want >> 8) & 255)) ** 2 + ((c & 255) - (want & 255)) ** 2;
    if (d < bestD) { bestD = d; best = cand; }
  }
  if (!best) return fam === 'other' ? { block: 'minecraft:stone', data: 0 } : null;
  const r = toLegacy(formatState(best, props));
  return r && r.block !== 'minecraft:air' ? r : null;
}

/**
 * Commands that rebuild `sch` with its minimum corner at (ox, oy, oz).
 * Returns { commands: string[], unmapped: { state: count } }.
 */
export function minedojoCommands(sch, [ox, oy, oz] = [0, 4, 0], { clear = true } = {}) {
  const commands = [];
  const unmapped = {};
  const W = sch.width, H = sch.height, L = sch.length;
  if (clear) {
    // /fill is capped at 32768 blocks per command in 1.11
    const stepY = Math.max(1, Math.floor(32768 / (W * L))) || 1;
    for (let y = 0; y < H; y += stepY) {
      const y1 = Math.min(H - 1, y + stepY - 1);
      if (W * L * (y1 - y + 1) <= 32768) commands.push(`/fill ${ox} ${oy + y} ${oz} ${ox + W - 1} ${oy + y1} ${oz + L - 1} minecraft:air`);
      else for (let z = 0; z < L; z++) commands.push(`/fill ${ox} ${oy + y} ${oz + z} ${ox + W - 1} ${oy + y} ${oz + z} minecraft:air`);
    }
  }
  const legacyOf = sch.palette.map((s) => {
    const l = toLegacy(s);
    if (!l) unmapped[s] = 0;
    return l;
  });
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) {
    let x = 0;
    while (x < W) {
      const p = sch.blocks[sch.index(x, y, z)];
      let x2 = x;
      while (x2 + 1 < W && sch.blocks[sch.index(x2 + 1, y, z)] === p) x2++;
      const l = legacyOf[p];
      if (!l) unmapped[sch.palette[p]] += x2 - x + 1;
      else if (l.block !== 'minecraft:air') {
        const tail = `${l.block} ${l.data}`;
        commands.push(x2 === x ? `/setblock ${ox + x} ${oy + y} ${oz + z} ${tail}` : `/fill ${ox + x} ${oy + y} ${oz + z} ${ox + x2} ${oy + y} ${oz + z} ${tail}`);
      }
      x = x2 + 1;
    }
  }
  return { commands, unmapped };
}
