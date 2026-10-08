// Generates small sample files in every supported format (used for testing and as demos).
// Usage: node tools/make-samples.js <outDir>
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// --- tiny NBT writer -------------------------------------------------------
const T = { byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12 };
const tag = (type, value, elemType) => ({ type, value, elemType });
class W {
  constructor() { this.chunks = []; }
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v & 255); this.chunks.push(b); }
  i8(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.chunks.push(b); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.chunks.push(b); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); this.chunks.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.chunks.push(b); }
  i64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64, BigInt(v))); this.chunks.push(b); }
  str(s) { const b = Buffer.from(s, 'utf8'); this.u16(b.length); this.chunks.push(b); }
  payload(t) {
    switch (t.type) {
      case 1: return this.i8(t.value);
      case 2: return this.i16(t.value);
      case 3: return this.i32(t.value);
      case 4: return this.i64(t.value);
      case 7: this.i32(t.value.length); this.chunks.push(Buffer.from(t.value)); return;
      case 8: return this.str(t.value);
      case 9: this.u8(t.elemType || 0); this.i32(t.value.length); t.value.forEach(v => this.payload({ type: t.elemType, value: v.value !== undefined && v.type ? v.value : v })); return;
      case 10: for (const [k, v] of Object.entries(t.value)) { this.u8(v.type); this.str(k); this.payload(v); } this.u8(0); return;
      case 11: this.i32(t.value.length); t.value.forEach(v => this.i32(v)); return;
      case 12: this.i32(t.value.length); t.value.forEach(v => this.i64(v)); return;
    }
  }
  root(name, compound) { this.u8(10); this.str(name); this.payload(compound); return Buffer.concat(this.chunks); }
}
const C = o => tag(10, o), I = v => tag(3, v), S = v => tag(2, v), B = v => tag(1, v), STR = v => tag(8, v);

// --- a small demo build: a cottage with a garden --------------------------
function buildHouse() {
  const Wd = 13, H = 10, Ln = 11;
  const g = new Map(); // "x,y,z" -> state
  const set = (x, y, z, s) => { if (x >= 0 && y >= 0 && z >= 0 && x < Wd && y < H && z < Ln) g.set(x + ',' + y + ',' + z, s); };
  for (let x = 0; x < Wd; x++) for (let z = 0; z < Ln; z++) set(x, 0, z, 'minecraft:grass_block[snowy=false]');
  for (let x = 2; x <= 10; x++) for (let z = 2; z <= 8; z++) {
    set(x, 1, z, 'minecraft:cobblestone');
    for (let y = 2; y <= 4; y++) {
      const edge = x === 2 || x === 10 || z === 2 || z === 8;
      const corner = (x === 2 || x === 10) && (z === 2 || z === 8);
      if (corner) set(x, y, z, 'minecraft:oak_log[axis=y]');
      else if (edge) set(x, y, z, (y === 3 && (x === 4 || x === 8 || z === 5)) ? 'minecraft:glass_pane[east=true,west=true]' : 'minecraft:oak_planks');
    }
  }
  // door
  set(6, 2, 2, 'minecraft:oak_door[facing=south,half=lower]'); set(6, 3, 2, 'minecraft:oak_door[facing=south,half=upper]');
  // roof
  for (let i = 0; i <= 4; i++) for (let x = 1 + i; x <= 11 - i; x++) {
    set(x, 5 + i, 1 + i, 'minecraft:spruce_stairs[facing=south,half=bottom]');
    set(x, 5 + i, 9 - i, 'minecraft:spruce_stairs[facing=north,half=bottom]');
    for (let z = 2 + i; z <= 8 - i; z++) if (x === 1 + i || x === 11 - i) set(x, 5 + i, z, 'minecraft:stone_bricks');
  }
  for (let x = 6; x <= 6; x++) for (let z = 1; z <= 9; z++) set(x, 9, 5, 'minecraft:spruce_slab[type=bottom]');
  // interior + garden
  set(4, 2, 6, 'minecraft:crafting_table'); set(8, 2, 6, 'minecraft:chest[facing=north]'); set(5, 2, 7, 'minecraft:red_bed[part=head,facing=north]');
  set(9, 4, 5, 'minecraft:lantern[hanging=false]');
  for (let x = 0; x < Wd; x++) { set(x, 1, 0, 'minecraft:oak_fence[east=true,west=true]'); }
  set(1, 1, 4, 'minecraft:poppy'); set(1, 1, 5, 'minecraft:dandelion'); set(11, 1, 4, 'minecraft:blue_orchid'); set(11, 1, 6, 'minecraft:oak_sapling');
  set(0, 1, 9, 'minecraft:water'); set(1, 1, 9, 'minecraft:water'); set(0, 1, 10, 'minecraft:water');
  set(12, 1, 10, 'minecraft:white_wool'); set(12, 2, 10, 'minecraft:light_blue_concrete'); set(12, 3, 10, 'minecraft:torch');
  set(3, 1, 1, 'minecraft:gravel'); set(6, 1, 1, 'minecraft:stone_brick_slab[type=bottom]');
  return { Wd, H, Ln, g };
}

function varint(n) { const out = []; while (n & ~0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; } out.push(n); return out; }

function sponge(house, version) {
  const { Wd, H, Ln, g } = house;
  const pal = new Map([['minecraft:air', 0]]);
  const data = [];
  for (let y = 0; y < H; y++) for (let z = 0; z < Ln; z++) for (let x = 0; x < Wd; x++) {
    const s = g.get(x + ',' + y + ',' + z) || 'minecraft:air';
    if (!pal.has(s)) pal.set(s, pal.size);
    data.push(...varint(pal.get(s)));
  }
  const palTag = C(Object.fromEntries([...pal].map(([k, v]) => [k, I(v)])));
  const bytes = tag(7, Buffer.from(data));
  if (version === 3) {
    return new W().root('', C({ Schematic: C({
      Version: I(3), DataVersion: I(3953), Width: S(Wd), Height: S(H), Length: S(Ln), Offset: tag(11, [0, 0, 0]),
      Metadata: C({ Name: STR('Demo cottage'), Author: STR('Schematic Viewer') }),
      Blocks: C({ Palette: palTag, Data: bytes, BlockEntities: tag(9, [], 10) })
    }) }));
  }
  return new W().root('Schematic', C({
    Version: I(version), ...(version === 2 ? { DataVersion: I(2586) } : {}), Width: S(Wd), Height: S(H), Length: S(Ln),
    PaletteMax: I(pal.size), Palette: palTag, BlockData: bytes, Metadata: C({ Name: STR('Demo cottage') })
  }));
}

function litematic(house) {
  const { Wd, H, Ln, g } = house;
  const pal = ['minecraft:air'], idx = new Map([['minecraft:air', 0]]);
  const vals = [];
  for (let y = 0; y < H; y++) for (let z = 0; z < Ln; z++) for (let x = 0; x < Wd; x++) {
    const s = g.get(x + ',' + y + ',' + z) || 'minecraft:air';
    if (!idx.has(s)) { idx.set(s, pal.length); pal.push(s); }
    vals.push(idx.get(s));
  }
  const bits = Math.max(2, Math.ceil(Math.log2(pal.length)));
  const nLongs = Math.ceil(vals.length * bits / 64);
  const longs = new Array(nLongs).fill(0n);
  vals.forEach((v, i) => {
    const bit = i * bits, li = Math.floor(bit / 64), off = bit % 64;
    longs[li] |= (BigInt(v) << BigInt(off)) & ((1n << 64n) - 1n);
    if (off + bits > 64) longs[li + 1] |= BigInt(v) >> BigInt(64 - off);
  });
  const palTag = tag(9, pal.map(s => {
    const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(s);
    const o = { Name: STR(m[1]) };
    if (m[2]) o.Properties = C(Object.fromEntries(m[2].split(',').map(kv => kv.split('=')).map(([k, v]) => [k, STR(v)])));
    return C(o);
  }), 10);
  // Second region with negative size to exercise that path: a small tower to the east.
  const r2pal = tag(9, [C({ Name: STR('minecraft:air') }), C({ Name: STR('minecraft:polished_andesite') })], 10);
  const r2vals = 2 * 4 * 2; // 2x4x2 all andesite
  const r2bits = 2, r2longs = new Array(Math.ceil(r2vals * r2bits / 64)).fill(0n);
  for (let i = 0; i < r2vals; i++) { const bit = i * r2bits; r2longs[Math.floor(bit / 64)] |= 1n << BigInt(bit % 64); }
  return new W().root('', C({
    Version: I(6), MinecraftDataVersion: I(3465),
    Metadata: C({ Name: STR('Demo cottage (litematic)'), Author: STR('Schematic Viewer'), EnclosingSize: C({ x: I(Wd + 3), y: I(H), z: I(Ln) }) }),
    Regions: C({
      main: C({ Position: C({ x: I(0), y: I(0), z: I(0) }), Size: C({ x: I(Wd), y: I(H), z: I(Ln) }), BlockStatePalette: palTag,
        BlockStates: tag(12, longs), TileEntities: tag(9, [], 10), Entities: tag(9, [], 10) }),
      tower: C({ Position: C({ x: I(Wd + 2), y: I(3), z: I(1) }), Size: C({ x: I(-2), y: I(-4), z: I(2) }), BlockStatePalette: r2pal,
        BlockStates: tag(12, r2longs) })
    })
  }));
}

function mcedit() {
  // A 1.12.2 style pixel-art wall + a few legacy blocks (ids and data values).
  const Wd = 16, H = 6, Ln = 3, n = Wd * H * Ln;
  const ids = Buffer.alloc(n), data = Buffer.alloc(n);
  const idx = (x, y, z) => (y * Ln + z) * Wd + x;
  for (let x = 0; x < 16; x++) { ids[idx(x, 0, 1)] = 35; data[idx(x, 0, 1)] = x; ids[idx(x, 1, 1)] = 251; data[idx(x, 1, 1)] = x; ids[idx(x, 2, 1)] = 159; data[idx(x, 2, 1)] = x; ids[idx(x, 3, 1)] = 95; data[idx(x, 3, 1)] = x; }
  for (let x = 0; x < 6; x++) { ids[idx(x, 4, 1)] = 5; data[idx(x, 4, 1)] = x; ids[idx(x, 5, 1)] = 53 + (x === 0 ? 0 : 0); data[idx(x, 5, 1)] = x & 3; }
  ids[idx(8, 4, 1)] = 1; data[idx(8, 4, 1)] = 1; ids[idx(9, 4, 1)] = 2; ids[idx(10, 4, 1)] = 17; data[idx(10, 4, 1)] = 2; ids[idx(11, 4, 1)] = 44; data[idx(11, 4, 1)] = 8 | 5;
  ids[idx(12, 4, 1)] = 89; ids[idx(13, 4, 1)] = 98; data[idx(13, 4, 1)] = 1; ids[idx(14, 4, 1)] = 155; ids[idx(15, 4, 1)] = 50; data[idx(15, 4, 1)] = 5;
  for (let x = 0; x < 16; x++) { ids[idx(x, 0, 0)] = 4; ids[idx(x, 0, 2)] = 2; }
  return new W().root('Schematic', C({
    Width: S(Wd), Height: S(H), Length: S(Ln), Materials: STR('Alpha'), Blocks: tag(7, ids), Data: tag(7, data),
    Entities: tag(9, [], 10), TileEntities: tag(9, [], 10)
  }));
}

function structure(house) {
  const { Wd, H, Ln, g } = house;
  const pal = [], idx = new Map(), blocks = [];
  for (const [k, s] of g) {
    if (!idx.has(s)) { idx.set(s, pal.length); pal.push(s); }
    const [x, y, z] = k.split(',').map(Number);
    blocks.push(C({ pos: tag(9, [x, y, z], 3), state: I(idx.get(s)) }));
  }
  const palTag = tag(9, pal.map(s => {
    const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(s); const o = { Name: STR(m[1]) };
    if (m[2]) o.Properties = C(Object.fromEntries(m[2].split(',').map(kv => kv.split('=')).map(([k, v]) => [k, STR(v)])));
    return C(o);
  }), 10);
  return new W().root('', C({ DataVersion: I(4189), size: tag(9, [Wd, H, Ln], 3), palette: palTag, blocks: tag(9, blocks, 10), entities: tag(9, [], 10) }));
}

const out = process.argv[2] || 'samples';
fs.mkdirSync(out, { recursive: true });
const house = buildHouse();
const files = {
  'cottage-sponge-v1.schem': sponge(house, 1),
  'cottage-sponge-v2.schem': sponge(house, 2),
  'cottage-sponge-v3.schem': sponge(house, 3),
  'cottage.litematic': litematic(house),
  'legacy-1.12-blocks.schematic': mcedit(),
  'cottage-structure.nbt': structure(house)
};
for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(out, name), zlib.gzipSync(buf));
console.log('wrote', Object.keys(files).join(', '));

// node tools/make-samples.js <outDir> big  -> also writes a large terrain stress-test file
if (process.argv[3] === 'big') {
  const Wd = 320, H = 160, Ln = 320, g = new Map();
  const mats = ['minecraft:stone', 'minecraft:dirt', 'minecraft:grass_block[snowy=false]', 'minecraft:oak_leaves[distance=1,persistent=true]', 'minecraft:water', 'minecraft:sand', 'minecraft:glass', 'minecraft:stone_bricks', 'minecraft:oak_planks'];
  const pal = new Map([['minecraft:air', 0]]); mats.forEach(m => pal.set(m, pal.size));
  const bytes = [];
  for (let y = 0; y < H; y++) for (let z = 0; z < Ln; z++) for (let x = 0; x < Wd; x++) {
    const h = 40 + 25 * Math.sin(x / 23) * Math.cos(z / 31) + 10 * Math.sin((x + z) / 9);
    let s = 0;
    if (y < h - 4) s = pal.get('minecraft:stone'); else if (y < h - 1) s = pal.get('minecraft:dirt'); else if (y < h) s = pal.get(h < 30 ? 'minecraft:sand' : 'minecraft:grass_block[snowy=false]');
    else if (y < 30) s = pal.get('minecraft:water');
    else if ((x % 40 > 10 && x % 40 < 30) && (z % 40 > 10 && z % 40 < 30) && y < h + 20 + (x % 7)) s = pal.get((x % 40 === 11 || x % 40 === 29 || z % 40 === 11 || z % 40 === 29) ? ((y % 4 === 2) ? 'minecraft:glass' : 'minecraft:stone_bricks') : (y % 6 === 0 ? 'minecraft:oak_planks' : 0) || 0);
    bytes.push(...varint(s));
  }
  const buf = new W().root('Schematic', C({ Version: I(2), DataVersion: I(3465), Width: S(Wd), Height: S(H), Length: S(Ln), PaletteMax: I(pal.size),
    Palette: C(Object.fromEntries([...pal].map(([k, v]) => [k, I(v)]))), BlockData: tag(7, Buffer.from(bytes)) }));
  fs.writeFileSync(path.join(out, '..', 'big-terrain.schem'), zlib.gzipSync(buf));
  console.log('wrote big-terrain.schem');
}
