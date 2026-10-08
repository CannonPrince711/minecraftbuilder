// Post-processing for blocks read from pre-1.13 chunks.
// Before the Flattening many block states were computed from neighbours or stored in
// block entities instead of the block itself. This pass recreates what Minecraft's own
// 1.13 world upgrade does so builds look right after pasting.
import { T, get, tag } from './nbt.js';
import ITEMS from './data/legacy-items.json' with { type: 'json' };

export const LEGACY_DATA_VERSION = 1631; // 1.13.2: the block names produced by the legacy table

export function parseState(s) {
  const i = s.indexOf('[');
  if (i < 0) return { name: s, props: {} };
  const props = {};
  for (const kv of s.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); props[k] = v; }
  return { name: s.slice(0, i), props };
}
export function formatState(name, props) {
  const keys = Object.keys(props).sort();
  return keys.length ? `${name}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : name;
}

const DIRS = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const AXIS = { north: 'z', south: 'z', east: 'x', west: 'x' };
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

const NOT_FULL = /(air|slab|stairs|fence|wall|pane|iron_bars|door|trapdoor|carpet|snow$|cake|bed|chest|sign|banner|pressure_plate|button|lever|rail|torch|piston_head|anvil|cauldron|hopper|brewing_stand|enchanting_table|end_portal|daylight_detector|farmland|grass_path|skull|head|flower_pot|potted|ladder|vine|cocoa|lily_pad|cobweb|repeater|comparator|glass|leaves|water|lava|fire|sapling|grass$|fern|dead_bush|flower|poppy|dandelion|orchid|allium|bluet|tulip|daisy|mushroom$|wheat|carrots|potatoes|beetroots|sugar_cane|cactus|nether_wart|redstone_wire|tripwire|lilac|rose_bush|peony|sunflower|large_fern|tall_grass|beacon|end_rod|chorus|ice$|barrier|structure_void|portal|dragon_egg|melon_stem|pumpkin_stem|seagrass|kelp|bars)/;
const isFull = (name) => !NOT_FULL.test(name.replace('minecraft:', ''));

export function fixLegacy(sch) {
  const W = sch.width, H = sch.height, L = sch.length;
  const cache = new Map();
  const parsed = (pi) => { let p = cache.get(pi); if (!p) { p = parseState(sch.palette[pi]); cache.set(pi, p); } return p; };
  const at = (x, y, z) => (sch.inside(x, y, z) ? parsed(sch.blocks[sch.index(x, y, z)]) : { name: 'minecraft:air', props: {} });
  const put = (x, y, z, name, props) => { sch.blocks[sch.index(x, y, z)] = sch.paletteIndex(formatState(name, props)); };

  // 1) Block entity driven states.
  const beAt = new Map();
  for (const be of sch.blockEntities) {
    be.id = fixBlockEntityId(be.id);
    beAt.set(be.pos.join(','), be);
  }
  const removeBE = new Set();
  for (const be of sch.blockEntities) {
    if (!be.legacy) continue;
    const [x, y, z] = be.pos;
    const b = at(x, y, z);
    const d = be.data;
    if (be.id === 'minecraft:bed' && /_bed$/.test(b.name)) {
      const color = COLORS[get(d, 'color') ?? 14] || 'red';
      put(x, y, z, `minecraft:${color}_bed`, b.props);
      delete d.color;
    } else if (be.id === 'minecraft:banner' && /banner$/.test(b.name)) {
      const base = get(d, 'Base');
      const color = COLORS[15 - (base ?? 15)] || 'white';
      put(x, y, z, b.name.replace(/minecraft:(\w+?)_(wall_banner|banner)$/, `minecraft:${color}_$2`), b.props);
      delete d.Base;
      const pats = get(d, 'Patterns');
      if (pats) for (const p of pats.items) if (p.Color) p.Color = tag.int(15 - p.Color.value);
    } else if (be.id === 'minecraft:flower_pot' && b.name === 'minecraft:flower_pot') {
      const item = get(d, 'Item');
      const data = get(d, 'Data') ?? 0;
      const plant = item ? convertItemId(typeof item === 'string' ? item : `#${item}`, data) : null;
      const potted = plant && `minecraft:potted_${plant.replace('minecraft:', '').replace(/^grass$/, 'fern')}`;
      if (potted && plant !== 'minecraft:air') put(x, y, z, potted, {});
      removeBE.add(be);
    } else if (be.id === 'minecraft:skull' && /(skull|head)$/.test(b.name)) {
      const type = ['skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'player_head', 'creeper_head', 'dragon_head'][get(d, 'SkullType') ?? 0] || 'skeleton_skull';
      const wall = /wall/.test(b.name);
      if (wall) put(x, y, z, `minecraft:${type.replace(/_(skull|head)$/, '_wall_$1')}`, { facing: b.props.facing || 'north' });
      else put(x, y, z, `minecraft:${type}`, { rotation: String(get(d, 'Rot') ?? 0) });
      delete d.SkullType; delete d.Rot;
      if (d.Owner === undefined && d.SkullOwner) { d.Owner = d.SkullOwner; delete d.SkullOwner; }
    } else if (be.id === 'minecraft:noteblock' || be.id === 'minecraft:note_block') {
      if (b.name === 'minecraft:note_block') put(x, y, z, b.name, { ...b.props, note: String(get(d, 'note') ?? 0), instrument: b.props.instrument || 'harp', powered: 'false' });
      removeBE.add(be);
    }
    convertItemsDeep(d);
  }
  sch.blockEntities = sch.blockEntities.filter((b) => !removeBE.has(b));
  cache.clear();

  // 2) Neighbour driven states.
  const passes = [fixHalves, fixConnections];
  for (const pass of passes) {
    for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) pass(x, y, z, at, put);
    cache.clear();
  }
  sch.compact();
}

function fixHalves(x, y, z, at, put) {
  const b = at(x, y, z);
  const n = b.name;
  if (n.endsWith('_door') && b.props.half === 'lower') {
    const up = at(x, y + 1, z);
    if (up.name.endsWith('_door')) {
      const props = { ...b.props, hinge: up.props.hinge, powered: 'false' };
      put(x, y, z, n, props);
      put(x, y + 1, z, n, { ...props, half: 'upper' });
    }
  } else if (b.props.half === 'lower' && /(sunflower|lilac|tall_grass|large_fern|rose_bush|peony)$/.test(n)) {
    if (at(x, y + 1, z).props.half === 'upper') put(x, y + 1, z, n, { half: 'upper' });
  } else if (/(_trapdoor|_fence_gate)$/.test(n) && b.props.powered === 'true') {
    // the legacy table marks open trapdoors as powered; unpowered keeps them open after block updates
    put(x, y, z, n, { ...b.props, powered: 'false' });
  } else if (/(grass_block|podzol|mycelium)$/.test(n)) {
    const above = at(x, y + 1, z).name;
    put(x, y, z, n, { snowy: String(/snow/.test(above)) });
  }
}

const family = (name) => {
  const n = name.replace('minecraft:', '');
  if (n === 'nether_brick_fence') return 'nfence';
  if (n.endsWith('_fence')) return 'fence';
  if (n.endsWith('_fence_gate')) return 'gate';
  if (n.endsWith('glass_pane') || n === 'iron_bars') return 'pane';
  if (n.endsWith('_wall')) return 'wall';
  if (n.endsWith('_stairs')) return 'stairs';
  if (n === 'chest' || n === 'trapped_chest') return 'chest';
  if (n === 'redstone_wire') return 'wire';
  return null;
};

function fixConnections(x, y, z, at, put) {
  const b = at(x, y, z);
  const f = family(b.name);
  if (!f) return;
  if (f === 'fence' || f === 'nfence' || f === 'pane' || f === 'wall') {
    const props = { ...b.props };
    const con = {};
    for (const [d, [dx, , dz]] of Object.entries(DIRS)) {
      const nb = at(x + dx, y, z + dz);
      const nf = family(nb.name);
      let c = isFull(nb.name);
      if (f === 'fence' || f === 'nfence') c = c || nf === f || (nf === 'gate' && AXIS[nb.props.facing] !== AXIS[d]);
      if (f === 'pane') c = c || nf === 'pane' || nf === 'wall';
      if (f === 'wall') c = c || nf === 'wall' || nf === 'pane' || (nf === 'gate' && AXIS[nb.props.facing] !== AXIS[d]);
      con[d] = c;
      props[d] = String(c);
    }
    if (f === 'wall') {
      const straight = (con.north && con.south && !con.east && !con.west) || (con.east && con.west && !con.north && !con.south);
      props.up = String(!straight || at(x, y + 1, z).name !== 'minecraft:air');
    }
    put(x, y, z, b.name, props);
  } else if (f === 'stairs') {
    put(x, y, z, b.name, { ...b.props, shape: stairShape(x, y, z, b, at) });
  } else if (f === 'chest') {
    if (b.props.type !== 'single') return; // already paired by a neighbour
    const facing = b.props.facing || 'north';
    for (const [side, type] of [[CW[facing], 'left'], [CCW[facing], 'right']]) {
      const [dx, , dz] = DIRS[side];
      const nb = at(x + dx, y, z + dz);
      if (nb.name === b.name && nb.props.facing === facing && nb.props.type === 'single') {
        put(x, y, z, b.name, { ...b.props, type });
        put(x + dx, y, z + dz, nb.name, { ...nb.props, type: type === 'left' ? 'right' : 'left' });
        break;
      }
    }
  } else if (f === 'wire') {
    const props = { ...b.props };
    const aboveFull = isFull(at(x, y + 1, z).name);
    for (const [d, [dx, , dz]] of Object.entries(DIRS)) {
      const nb = at(x + dx, y, z + dz);
      let v = 'none';
      if (/redstone|repeater|comparator|lever|button|pressure_plate|observer|daylight|target|tripwire_hook|lectern|trapped_chest/.test(nb.name)) {
        if (nb.name.endsWith('repeater')) v = AXIS[nb.props.facing] === AXIS[d] ? 'side' : 'none';
        else v = 'side';
      }
      if (v === 'none' && !aboveFull && at(x + dx, y + 1, z + dz).name === 'minecraft:redstone_wire') v = 'up';
      if (v === 'none' && !isFull(nb.name) && at(x + dx, y - 1, z + dz).name === 'minecraft:redstone_wire') v = 'side';
      props[d] = v;
    }
    put(x, y, z, b.name, props);
  }
}

function stairShape(x, y, z, b, at) {
  const facing = b.props.facing, half = b.props.half;
  const isStairs = (s) => s.name.endsWith('_stairs');
  const differs = (dir) => {
    const [dx, , dz] = DIRS[dir];
    const o = at(x + dx, y, z + dz);
    return !isStairs(o) || o.props.facing !== facing || o.props.half !== half;
  };
  const [fx, , fz] = DIRS[facing];
  const front = at(x + fx, y, z + fz);
  if (isStairs(front) && front.props.half === half) {
    const d1 = front.props.facing;
    if (AXIS[d1] !== AXIS[facing] && differs(OPP[d1])) return d1 === CCW[facing] ? 'outer_left' : 'outer_right';
  }
  const back = at(x - fx, y, z - fz);
  if (isStairs(back) && back.props.half === half) {
    const d2 = back.props.facing;
    if (AXIS[d2] !== AXIS[facing] && differs(d2)) return d2 === CCW[facing] ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

// ---- block entity ids and item conversion ----

const OLD_BE_IDS = {
  Airportal: 'end_portal', Banner: 'banner', Beacon: 'beacon', Cauldron: 'brewing_stand', Chest: 'chest',
  Comparator: 'comparator', Control: 'command_block', DLDetector: 'daylight_detector', Dropper: 'dropper',
  EnchantTable: 'enchanting_table', EndGateway: 'end_gateway', EnderChest: 'ender_chest', FlowerPot: 'flower_pot',
  Furnace: 'furnace', Hopper: 'hopper', MobSpawner: 'mob_spawner', Music: 'noteblock', Piston: 'piston',
  RecordPlayer: 'jukebox', Sign: 'sign', Skull: 'skull', Structure: 'structure_block', Trap: 'dispenser', Bed: 'bed',
};
function fixBlockEntityId(id) {
  if (!id) return id;
  if (OLD_BE_IDS[id]) return `minecraft:${OLD_BE_IDS[id]}`;
  return id.includes(':') ? id : `minecraft:${id}`;
}

/** Convert a 1.12 item id (string or "#numeric") + damage into a 1.13 item id. */
function convertItemId(id, damage) {
  let num;
  if (id.startsWith('#')) num = +id.slice(1);
  else num = ITEMS.nameToId[id.includes(':') ? id : `minecraft:${id}`];
  if (num === undefined) return null;
  return ITEMS.items[`${num}:${damage}`] || ITEMS.items[`${num}:0`] || null;
}

/** Walk a compound and rewrite every { id, Damage } item stack in place. */
function convertItemsDeep(c) {
  for (const t of Object.values(c)) {
    if (!t) continue;
    if (t.type === T.Compound) { convertItemStack(t.value); convertItemsDeep(t.value); }
    else if (t.type === T.List && t.value.elementType === T.Compound) {
      for (const it of t.value.items) { convertItemStack(it); convertItemsDeep(it); }
    }
  }
}
function convertItemStack(it) {
  if (!it.id || it.id.type !== T.String || !it.Count) return;
  const damage = it.Damage ? it.Damage.value : 0;
  const exact = convertItemId(it.id.value, damage);
  if (exact) {
    const num = ITEMS.nameToId[it.id.value];
    const isVariant = ITEMS.items[`${num}:${damage}`] !== undefined;
    it.id = tag.string(exact);
    if (isVariant || damage === 0) delete it.Damage;
    else {
      // durability moved into tag.Damage
      if (!it.tag) it.tag = tag.compound({});
      it.tag.value.Damage = tag.int(damage);
      delete it.Damage;
    }
  }
}
