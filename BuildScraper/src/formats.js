// Readers for .schem / .schematic / .litematic / structure .nbt, and the .schem writer.
import * as nbt from './nbt.js';
import { T, get, tag } from './nbt.js';
import { gzip, maybeDecompress } from './compress.js';
import { Schematic } from './schematic.js';
import { legacyState, stateFromPaletteEntry, unpack } from './chunk.js';
import { fixLegacy, LEGACY_DATA_VERSION } from './legacy-fix.js';

// ---------------- writing .schem ----------------

function varints(blocks) {
  const out = new Uint8Array(blocks.length * 5);
  let p = 0;
  for (let i = 0; i < blocks.length; i++) {
    let v = blocks[i];
    while (v >= 0x80) { out[p++] = (v & 0x7f) | 0x80; v >>>= 7; }
    out[p++] = v;
  }
  return new Int8Array(out.buffer, 0, p);
}

function readVarints(bytes, count) {
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  const out = new Uint32Array(count);
  let p = 0;
  for (let i = 0; i < count; i++) {
    let v = 0, shift = 0, b;
    do { b = u8[p++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    out[i] = v;
  }
  return out;
}

/**
 * Encode a Schematic as Sponge .schem bytes (gzipped).
 * version: 2 (WorldEdit 7.0+, FAWE, Litematica, Amulet) or 3 (WorldEdit 7.3+).
 */
export async function writeSchem(sch, { version = 2, name, author = 'MC Build Scraper' } = {}) {
  if (sch.width > 65535 || sch.height > 65535 || sch.length > 65535) throw new Error('Schematic dimensions must be under 65536');
  const palette = {};
  sch.palette.forEach((s, i) => { palette[s] = tag.int(i); });
  const data = tag.byteArray(varints(sch.blocks));
  const metadata = {
    Name: tag.string(name || sch.name || 'Build'),
    Author: tag.string(author),
    Date: tag.long(Date.now()),
  };
  const dims = { Width: tag.short(sch.width << 16 >> 16), Height: tag.short(sch.height << 16 >> 16), Length: tag.short(sch.length << 16 >> 16) };
  const dv = sch.dataVersion || 3953;

  if (version === 3) {
    const blockEntities = sch.blockEntities.map((b) => tag.compound({
      Pos: tag.intArray(b.pos), Id: tag.string(b.id), Data: tag.compound({ ...b.data }),
    }));
    const entities = sch.entities.map((e) => tag.compound({
      Pos: tag.list(T.Double, e.pos.slice()), Id: tag.string(e.id), Data: tag.compound({ ...e.data, id: tag.string(e.id) }),
    }));
    const body = {
      Version: tag.int(3), DataVersion: tag.int(dv), Metadata: tag.compound(metadata), ...dims,
      Offset: tag.intArray([0, 0, 0]),
      Blocks: tag.compound({
        Palette: tag.compound(palette), Data: data,
        BlockEntities: tag.list(T.Compound, blockEntities.map((t) => t.value)),
      }),
    };
    if (entities.length) body.Entities = tag.list(T.Compound, entities.map((t) => t.value));
    return gzip(nbt.write(tag.compound({ Schematic: tag.compound(body) }), ''));
  }

  metadata.WEOffsetX = tag.int(0); metadata.WEOffsetY = tag.int(0); metadata.WEOffsetZ = tag.int(0);
  const body = {
    Version: tag.int(2), DataVersion: tag.int(dv), Metadata: tag.compound(metadata), ...dims,
    Offset: tag.intArray(sch.offset), PaletteMax: tag.int(sch.palette.length), Palette: tag.compound(palette), BlockData: data,
    BlockEntities: tag.list(T.Compound, sch.blockEntities.map((b) => ({ ...b.data, Pos: tag.intArray(b.pos), Id: tag.string(b.id) }))),
  };
  if (sch.entities.length) body.Entities = tag.list(T.Compound, sch.entities.map((e) => ({ ...e.data, Pos: tag.list(T.Double, e.pos.slice()), Id: tag.string(e.id) })));
  return gzip(nbt.write(tag.compound(body), 'Schematic'));
}

// ---------------- reading ----------------

/** Detect and read any supported schematic file. Returns a Schematic. */
export async function readAny(bytes, filename = '') {
  const raw = await maybeDecompress(bytes);
  const { tag: root } = nbt.parse(raw);
  const r = root.value;
  const lower = filename.toLowerCase();
  if (r.Schematic && r.Schematic.type === T.Compound) return readSponge(r.Schematic.value);
  if (get(r, 'Version') !== undefined && (get(r, 'Palette') || get(r, 'Blocks')?.Palette) ) return readSponge(r);
  if (get(r, 'Regions')) return readLitematic(r);
  if (get(r, 'Blocks') instanceof Int8Array && get(r, 'Width') !== undefined) return readMcedit(r);
  if (get(r, 'size') && get(r, 'blocks')) return readStructure(r);
  throw new Error(`Unrecognised schematic format${lower ? ` in ${filename}` : ''}`);
}

function readSponge(r) {
  const version = get(r, 'Version') ?? 1;
  const W = get(r, 'Width') & 0xffff, H = get(r, 'Height') & 0xffff, L = get(r, 'Length') & 0xffff;
  const sch = new Schematic(W, H, L);
  sch.dataVersion = get(r, 'DataVersion') ?? 1343;
  const meta = get(r, 'Metadata');
  sch.name = (meta && get(meta, 'Name')) || '';
  const container = (version >= 3 && get(r, 'Blocks')) || r;
  const pal = get(container, 'Palette');
  const palette = [];
  for (const [state, t] of Object.entries(pal)) palette[t.value] = state;
  palette.forEach((s, i) => { sch.palette[i] = s; sch.paletteMap.set(s, i); });
  const data = get(container, 'Data') || get(container, 'BlockData');
  sch.blocks = readVarints(data, W * H * L);
  const bes = get(container, 'BlockEntities') || get(container, 'TileEntities');
  for (const b of bes ? bes.items : []) {
    const pos = Array.from(get(b, 'Pos'));
    const id = get(b, 'Id') || get(b, 'id') || '';
    let d;
    if (b.Data && b.Data.type === T.Compound) d = { ...b.Data.value };
    else { d = { ...b }; delete d.Pos; delete d.Id; delete d.id; }
    sch.blockEntities.push({ pos, id, data: d });
  }
  const ents = get(r, 'Entities');
  for (const e of ents ? ents.items : []) {
    const pos = get(e, 'Pos').items.slice();
    const id = get(e, 'Id') || get(e, 'id') || '';
    let d;
    if (e.Data && e.Data.type === T.Compound) { d = { ...e.Data.value }; delete d.id; } else { d = { ...e }; delete d.Pos; delete d.Id; delete d.id; }
    sch.entities.push({ pos, id, data: d });
  }
  const off = get(r, 'Offset');
  if (off) sch.offset = Array.from(off);
  return sch;
}

function readMcedit(r) {
  const W = get(r, 'Width'), H = get(r, 'Height'), L = get(r, 'Length');
  const blocks = get(r, 'Blocks'), data = get(r, 'Data'), add = get(r, 'AddBlocks');
  const sch = new Schematic(W, H, L);
  const n = W * H * L;
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    let id = blocks[i] & 0xff;
    if (add) id |= ((i & 1) === 0 ? (add[i >> 1] & 0x0f) << 8 : (add[i >> 1] & 0xf0) << 4);
    const meta = data[i] & 0xf;
    const key = (id << 4) | meta;
    let p = cache.get(key);
    if (p === undefined) { p = sch.paletteIndex(legacyState(id, meta)); cache.set(key, p); }
    sch.blocks[i] = p; // MCEdit layout is (y * L + z) * W + x, same as Sponge
  }
  const tes = get(r, 'TileEntities');
  for (const t of tes ? tes.items : []) {
    const d = { ...t };
    const pos = [get(t, 'x'), get(t, 'y'), get(t, 'z')];
    const id = get(t, 'id') || '';
    delete d.x; delete d.y; delete d.z; delete d.id;
    sch.blockEntities.push({ pos, id, data: d, legacy: true });
  }
  const ents = get(r, 'Entities');
  for (const e of ents ? ents.items : []) {
    const p = get(e, 'Pos');
    if (!p) continue;
    const d = { ...e };
    const id = get(e, 'id') || '';
    for (const k of ['Pos', 'id', 'UUIDMost', 'UUIDLeast', 'UUID']) delete d[k];
    // MCEdit stores absolute world positions; WEOrigin gives the copy origin.
    const ox = get(r, 'WEOriginX') ?? 0, oy = get(r, 'WEOriginY') ?? 0, oz = get(r, 'WEOriginZ') ?? 0;
    sch.entities.push({ pos: [p.items[0] - ox, p.items[1] - oy, p.items[2] - oz], id, data: d });
  }
  fixLegacy(sch);
  sch.dataVersion = LEGACY_DATA_VERSION;
  sch.fromLegacy = true;
  return sch;
}

function readLitematic(r) {
  const regions = Object.entries(get(r, 'Regions'));
  const meta = get(r, 'Metadata');
  // Overall bounds across all regions
  const boxes = regions.map(([name, t]) => {
    const reg = t.value;
    const pos = get(reg, 'Position'), size = get(reg, 'Size');
    const p = [get(pos, 'x'), get(pos, 'y'), get(pos, 'z')], s = [get(size, 'x'), get(size, 'y'), get(size, 'z')];
    const min = p.map((v, i) => (s[i] < 0 ? v + s[i] + 1 : v));
    return { name, reg, min, size: s.map(Math.abs) };
  });
  const gmin = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
  const gmax = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.min[i] + b.size[i] - 1)));
  const sch = new Schematic(gmax[0] - gmin[0] + 1, gmax[1] - gmin[1] + 1, gmax[2] - gmin[2] + 1);
  sch.name = (meta && get(meta, 'Name')) || '';
  sch.dataVersion = get(r, 'MinecraftDataVersion') ?? 0;
  const air = sch.paletteIndex('minecraft:air');
  sch.blocks.fill(air);
  for (const b of boxes) {
    const pal = get(b.reg, 'BlockStatePalette').items.map(stateFromPaletteEntry);
    const map = pal.map((s) => sch.paletteIndex(s));
    const [sx, sy, sz] = b.size;
    const bits = Math.max(2, Math.ceil(Math.log2(pal.length)));
    const idx = unpack(get(b.reg, 'BlockStates'), bits, sx * sy * sz, true);
    const [ox, oy, oz] = [0, 1, 2].map((i) => b.min[i] - gmin[i]);
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const v = idx[(y * sz + z) * sx + x];
      if (pal[v] === 'minecraft:air') continue;
      sch.blocks[sch.index(ox + x, oy + y, oz + z)] = map[v];
    }
    const tes = get(b.reg, 'TileEntities');
    for (const t of tes ? tes.items : []) {
      const d = { ...t };
      const pos = [get(t, 'x') + ox, get(t, 'y') + oy, get(t, 'z') + oz];
      const id = get(t, 'id') || blockEntityIdFor(sch.get(...pos));
      delete d.x; delete d.y; delete d.z; delete d.id;
      sch.blockEntities.push({ pos, id, data: d });
    }
    const ents = get(b.reg, 'Entities');
    for (const e of ents ? ents.items : []) {
      const p = get(e, 'Pos');
      if (!p) continue;
      const d = { ...e }; const id = get(e, 'id') || '';
      for (const k of ['Pos', 'id', 'UUID', 'UUIDMost', 'UUIDLeast']) delete d[k];
      sch.entities.push({ pos: [p.items[0] + ox, p.items[1] + oy, p.items[2] + oz], id, data: d });
    }
  }
  sch.compact();
  return sch;
}

function readStructure(r) {
  const size = get(r, 'size').items;
  const sch = new Schematic(size[0], size[1], size[2]);
  sch.dataVersion = get(r, 'DataVersion') ?? 0;
  const palList = get(r, 'palette') || (get(r, 'palettes') && get(r, 'palettes').items[0] && { items: get(r, 'palettes').items[0].items || get(r, 'palettes').items[0] });
  const pal = (palList.items || []).map(stateFromPaletteEntry);
  const map = pal.map((s) => sch.paletteIndex(s));
  const air = sch.paletteIndex('minecraft:air');
  sch.blocks.fill(air);
  for (const b of get(r, 'blocks').items) {
    const pos = get(b, 'pos').items;
    const st = get(b, 'state');
    sch.blocks[sch.index(pos[0], pos[1], pos[2])] = map[st];
    const d = get(b, 'nbt');
    if (d) {
      const data = { ...d };
      const id = get(d, 'id') || blockEntityIdFor(pal[st]);
      delete data.id; delete data.x; delete data.y; delete data.z;
      sch.blockEntities.push({ pos: Array.from(pos), id, data });
    }
  }
  const ents = get(r, 'entities');
  for (const e of ents ? ents.items : []) {
    const p = get(e, 'pos'); const d = get(e, 'nbt');
    if (!p || !d) continue;
    const data = { ...d }; const id = get(d, 'id') || '';
    for (const k of ['Pos', 'id', 'UUID', 'UUIDMost', 'UUIDLeast']) delete data[k];
    sch.entities.push({ pos: p.items.slice(), id, data });
  }
  sch.compact();
  return sch;
}

function blockEntityIdFor(state) {
  const n = state.replace(/\[.*$/, '');
  if (/_sign$/.test(n)) return 'minecraft:sign';
  if (/_bed$/.test(n)) return 'minecraft:bed';
  if (/banner$/.test(n)) return 'minecraft:banner';
  if (/shulker_box$/.test(n)) return 'minecraft:shulker_box';
  if (/(skull|head)$/.test(n)) return 'minecraft:skull';
  return n;
}

// ---------------- writing .litematic and structure .nbt ----------------
import { parseState } from './legacy-fix.js';
import { pack } from './chunk.js';

function paletteTag(state) {
  const { name, props } = parseState(state);
  const c = { Name: tag.string(name) };
  const keys = Object.keys(props);
  if (keys.length) c.Properties = tag.compound(Object.fromEntries(keys.map((k) => [k, tag.string(props[k])])));
  return c;
}
const xyzTag = (x, y, z) => tag.compound({ x: tag.int(x), y: tag.int(y), z: tag.int(z) });

/** Litematica schematic (loads in the Litematica mod as a placement you can see and build from). */
export async function writeLitematic(sch, { name, author = 'MC Build Scraper' } = {}) {
  // Litematica wants air at palette index 0
  const order = sch.palette.map((_, i) => i);
  const airIdx = sch.paletteMap.get('minecraft:air');
  let palette = sch.palette.slice();
  let remap = null;
  if (airIdx !== 0) {
    palette = ['minecraft:air', ...sch.palette.filter((s) => s !== 'minecraft:air')];
    const m = new Map(palette.map((s, i) => [s, i]));
    remap = order.map((i) => m.get(sch.palette[i]));
  }
  const W = sch.width, H = sch.height, L = sch.length;
  const values = new Uint32Array(W * H * L);
  let total = 0;
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
    let v = sch.blocks[sch.index(x, y, z)];
    if (remap) v = remap[v];
    values[(y * L + z) * W + x] = v;
    if (v !== 0) total++;
  }
  const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
  const now = BigInt(Date.now());
  const regionName = name || sch.name || 'Build';
  const region = {
    Position: xyzTag(0, 0, 0), Size: xyzTag(W, H, L),
    BlockStatePalette: tag.list(T.Compound, palette.map(paletteTag)),
    BlockStates: { type: T.LongArray, value: pack(values, bits, true) },
    TileEntities: tag.list(T.Compound, sch.blockEntities.map((b) => ({ ...b.data, id: tag.string(b.id), x: tag.int(b.pos[0]), y: tag.int(b.pos[1]), z: tag.int(b.pos[2]) }))),
    Entities: tag.list(T.Compound, sch.entities.map((e) => ({ ...e.data, id: tag.string(e.id), Pos: tag.list(T.Double, e.pos.slice()) }))),
    PendingBlockTicks: tag.list(T.Compound, []), PendingFluidTicks: tag.list(T.Compound, []),
  };
  const root = tag.compound({
    Version: tag.int(6), SubVersion: tag.int(1), MinecraftDataVersion: tag.int(sch.dataVersion || 3953),
    Metadata: tag.compound({
      Name: tag.string(regionName), Author: tag.string(author), Description: tag.string('Made with Build Scraper'),
      RegionCount: tag.int(1), TotalVolume: tag.int(W * H * L), TotalBlocks: tag.int(total),
      TimeCreated: { type: T.Long, value: now }, TimeModified: { type: T.Long, value: now },
      EnclosingSize: xyzTag(W, H, L),
    }),
    Regions: tag.compound({ [regionName]: tag.compound(region) }),
  });
  return gzip(nbt.write(root, ''));
}

/** Vanilla structure file (structure block or /place template). */
export async function writeStructure(sch) {
  const blocks = [];
  const W = sch.width, H = sch.height, L = sch.length;
  const beAt = new Map(sch.blockEntities.map((b) => [b.pos.join(','), b]));
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
    const b = { pos: tag.list(T.Int, [x, y, z]), state: tag.int(sch.blocks[sch.index(x, y, z)]) };
    const be = beAt.get(`${x},${y},${z}`);
    if (be) b.nbt = tag.compound({ ...be.data, id: tag.string(be.id) });
    blocks.push(b);
  }
  const root = tag.compound({
    DataVersion: tag.int(sch.dataVersion || 3953),
    size: tag.list(T.Int, [W, H, L]),
    palette: tag.list(T.Compound, sch.palette.map(paletteTag)),
    blocks: tag.list(T.Compound, blocks),
    entities: tag.list(T.Compound, sch.entities.map((e) => ({
      pos: tag.list(T.Double, e.pos.slice()),
      blockPos: tag.list(T.Int, e.pos.map(Math.floor)),
      nbt: tag.compound({ ...e.data, id: tag.string(e.id) }),
    }))),
  });
  return gzip(nbt.write(root, ''));
}

export const FORMATS = {
  schem2: { ext: 'schem', label: 'Sponge .schem v2', write: (s, o) => writeSchem(s, { ...o, version: 2 }) },
  schem3: { ext: 'schem', label: 'Sponge .schem v3', write: (s, o) => writeSchem(s, { ...o, version: 3 }) },
  litematic: { ext: 'litematic', label: 'Litematica', write: (s, o) => writeLitematic(s, o) },
  structure: { ext: 'nbt', label: 'Structure block .nbt', write: (s) => writeStructure(s) },
};
