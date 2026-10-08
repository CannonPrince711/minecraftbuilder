// Build a synthetic 1.12.2 chunk with blocks whose 1.13 state depends on neighbours or block entities.
import * as nbt from '../src/nbt.js'; import { tag, T } from '../src/nbt.js';
import { World } from '../src/world.js';
const zlib = await import('node:zlib');
const blocks = new Int8Array(4096), data = new Int8Array(2048);
const set = (x, y, z, id, meta = 0) => { const i = y * 256 + z * 16 + x; blocks[i] = id << 24 >> 24; data[i >> 1] |= (i & 1) ? meta << 4 : meta; };
set(1,1,1,26,0); set(1,1,2,26,8);            // bed foot/head facing south
set(3,1,1,54,2); set(4,1,1,54,2);            // two chests facing north
set(6,1,1,64,1); set(6,2,1,64,8);            // door lower facing south? + upper hinge left
set(8,1,1,85); set(9,1,1,85); set(8,1,2,1);  // fences + stone
set(11,1,1,53,0); set(11,1,2,53,2);          // stairs east, stairs south -> corner
set(13,1,1,140);                              // flower pot
set(14,1,1,144,1);                            // skull floor
set(1,1,5,176,0);                             // standing banner
set(3,1,5,25);                                // note block
set(5,1,5,175,0); set(5,2,5,175,8);           // sunflower lower/upper -> but lower meta0 sunflower
set(7,1,5,2); set(7,2,5,78);                  // grass under snow layer
const te = (x, y, z, id, extra) => ({ x: tag.int(x), y: tag.int(y), z: tag.int(z), id: tag.string(id), ...extra });
const tes = [
  te(1,1,1,'minecraft:bed',{ color: tag.int(11) }), te(1,1,2,'minecraft:bed',{ color: tag.int(11) }),
  te(3,1,1,'minecraft:chest',{ Items: tag.list(T.Compound, [{ Slot: tag.byte(0), id: tag.string('minecraft:wool'), Count: tag.byte(5), Damage: tag.short(14) }, { Slot: tag.byte(1), id: tag.string('minecraft:diamond_sword'), Count: tag.byte(1), Damage: tag.short(30) }]) }),
  te(4,1,1,'minecraft:chest',{ Items: tag.list(T.Compound, []) }),
  te(13,1,1,'minecraft:flower_pot',{ Item: tag.string('minecraft:red_flower'), Data: tag.int(2) }),
  te(14,1,1,'minecraft:skull',{ SkullType: tag.byte(4), Rot: tag.byte(6) }),
  te(1,1,5,'minecraft:banner',{ Base: tag.int(1), Patterns: tag.list(T.Compound, [{ Pattern: tag.string('cr'), Color: tag.int(15) }]) }),
  te(3,1,5,'minecraft:noteblock',{ note: tag.byte(7), powered: tag.byte(0) }),
];
const root = tag.compound({ DataVersion: tag.int(1343), Level: tag.compound({ xPos: tag.int(0), zPos: tag.int(0),
  Sections: tag.list(T.Compound, [{ Y: tag.byte(0), Blocks: tag.byteArray(blocks), Data: tag.byteArray(data) }]),
  TileEntities: tag.list(T.Compound, tes), Entities: tag.list(T.Compound, []) }) });
const comp = zlib.deflateSync(nbt.write(root, ''));
const region = new Uint8Array(8192 + Math.ceil((comp.length + 5) / 4096) * 4096);
const dv = new DataView(region.buffer); dv.setUint32(0, (2 << 8) | Math.ceil((comp.length + 5) / 4096));
dv.setUint32(8192, comp.length + 1); region[8196] = 2; region.set(comp, 8197);
const w = await World.open({ paths: ['region/r.0.0.mca'], read: async () => region });
const s = await w.extract('', [0, 0, 0], [15, 3, 15], {});
for (const [p, label] of [[[1,1,1],'bed foot'],[[1,1,2],'bed head'],[[3,1,1],'chest a'],[[4,1,1],'chest b'],[[6,1,1],'door lo'],[[6,2,1],'door up'],[[8,1,1],'fence'],[[11,1,1],'stairs'],[[13,1,1],'pot'],[[14,1,1],'skull'],[[1,1,5],'banner'],[[3,1,5],'note'],[[5,2,5],'sunflower top'],[[7,1,5],'grass']]) {
  console.log(label.padEnd(14), s.get(p[0], p[1], p[2] - 0));
}
console.log('BEs', s.blockEntities.map(b => b.id).join(','));
const chest = s.blockEntities.find(b => b.id === 'minecraft:chest' && b.data.Items.value.items.length);
console.log('items', JSON.stringify(chest.data.Items.value.items.map(i => nbt.simplify({ type: 10, value: i }))));
const ban = s.blockEntities.find(b => b.id === 'minecraft:banner'); console.log('banner', JSON.stringify(nbt.simplify({ type: 10, value: ban.data })));
