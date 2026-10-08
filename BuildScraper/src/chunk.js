// Decode a chunk compound (any Java version from 1.12.2 to current) into
// a uniform shape:
//   { dataVersion, legacy, sections: Map<sectionY, { palette: string[], idx: Uint16Array(4096) | null }>,
//     blockEntities: compound payload[], entities: compound payload[] }
// Section block index is y*256 + z*16 + x. idx === null means every block is palette[0].
import { T, get } from './nbt.js';
import LEGACY from './data/legacy-blocks.json' with { type: 'json' };

const legacyCache = new Map();
/** Map a pre-1.13 numeric block id + metadata to a modern block state string. */
export function legacyState(id, meta) {
  const key = (id << 4) | meta;
  let s = legacyCache.get(key);
  if (s === undefined) {
    s = LEGACY[`${id}:${meta}`] || LEGACY[`${id}:0`] || (id === 0 ? 'minecraft:air' : `minecraft:unknown_legacy_${id}_${meta}`);
    legacyCache.set(key, s);
  }
  return s;
}

/** Build "minecraft:name[a=b,c=d]" from a palette compound { Name, Properties }. Properties are sorted. */
export function stateFromPaletteEntry(entry) {
  const name = get(entry, 'Name');
  const props = get(entry, 'Properties');
  if (!props) return name;
  const keys = Object.keys(props).sort();
  if (!keys.length) return name;
  return `${name}[${keys.map((k) => `${k}=${props[k].value}`).join(',')}]`;
}

/** Read `count` values of `bits` bits from a long array (words = [lo,hi,...]). */
export function unpack(words, bits, count, spanning) {
  const out = new Uint16Array(count);
  const mask = (1 << bits) - 1;
  const perLong = Math.floor(64 / bits);
  for (let i = 0; i < count; i++) {
    let p;
    if (spanning) p = i * bits;
    else p = Math.floor(i / perLong) * 64 + (i % perLong) * bits;
    const w = p >>> 5, o = p & 31;
    let v = words[w] >>> o;
    if (o + bits > 32 && w + 1 < words.length) v |= words[w + 1] << (32 - o);
    out[i] = v & mask;
  }
  return out;
}

/** Inverse of unpack (used for writing litematics/tests). */
export function pack(values, bits, spanning) {
  const perLong = Math.floor(64 / bits);
  const nLongs = spanning ? Math.ceil(values.length * bits / 64) : Math.ceil(values.length / perLong);
  const words = new Uint32Array(nLongs * 2);
  for (let i = 0; i < values.length; i++) {
    const p = spanning ? i * bits : Math.floor(i / perLong) * 64 + (i % perLong) * bits;
    const w = p >>> 5, o = p & 31, v = values[i];
    words[w] |= v << o;
    if (o + bits > 32) words[w + 1] |= v >>> (32 - o);
  }
  return words;
}

// 1.16 (20w17a, DataVersion 2529) stopped packed entries from spanning two longs.
const NO_SPAN_DV = 2529;

export function decodeChunk(root) {
  const top = root.value;
  const dataVersion = get(top, 'DataVersion') ?? 0;
  const level = get(top, 'Level'); // absent from 1.18 on
  const c = level || top;
  const sectionsTag = get(c, 'Sections') || get(c, 'sections');
  const sections = new Map();
  let legacy = false;

  for (const sec of sectionsTag ? sectionsTag.items : []) {
    const sy = get(sec, 'Y');
    if (get(sec, 'Blocks')) {
      legacy = true;
      sections.set(sy, decodeLegacySection(sec));
      continue;
    }
    let paletteList, data;
    const bs = get(sec, 'block_states');
    if (bs) { paletteList = get(bs, 'palette'); data = get(bs, 'data'); }
    else { paletteList = get(sec, 'Palette'); data = get(sec, 'BlockStates'); }
    if (!paletteList || !paletteList.items.length) continue;
    const palette = paletteList.items.map(stateFromPaletteEntry);
    if (palette.length === 1 && !data) { sections.set(sy, { palette, idx: null }); continue; }
    if (!data) continue;
    const bits = Math.max(4, Math.ceil(Math.log2(palette.length)));
    const spanning = dataVersion < NO_SPAN_DV;
    // Guard against unusual bit widths by inferring from array length.
    const actualBits = spanning ? Math.round((data.length / 2) * 64 / 4096) : bits;
    sections.set(sy, { palette, idx: unpack(data, spanning ? actualBits : bits, 4096, spanning) });
  }

  const be = get(c, 'TileEntities') || get(c, 'block_entities');
  const ent = get(c, 'Entities') || get(c, 'entities');
  return {
    dataVersion, legacy,
    sections,
    blockEntities: be ? be.items : [],
    entities: ent && ent.elementType === T.Compound ? ent.items : [],
  };
}

function decodeLegacySection(sec) {
  const blocks = get(sec, 'Blocks');
  const add = get(sec, 'Add');
  const data = get(sec, 'Data');
  const palette = [];
  const lookup = new Map();
  const idx = new Uint16Array(4096);
  for (let i = 0; i < 4096; i++) {
    let id = blocks[i] & 0xff;
    if (add) id |= ((i & 1 ? add[i >> 1] >> 4 : add[i >> 1]) & 0xf) << 8;
    const meta = data ? (i & 1 ? data[i >> 1] >> 4 : data[i >> 1]) & 0xf : 0;
    const key = (id << 4) | meta;
    let p = lookup.get(key);
    if (p === undefined) { p = palette.length; palette.push(legacyState(id, meta)); lookup.set(key, p); }
    idx[i] = p;
  }
  return { palette, idx };
}
