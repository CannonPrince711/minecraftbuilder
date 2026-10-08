import fs from 'node:fs';
import { World } from '../src/world.js';
import { writeSchem, readAny } from '../src/formats.js';
import { RegionFile } from '../src/region.js';
import { dirProvider } from './fsprovider.js';
const vers = fs.readdirSync('test/fixtures').filter(v => /^\d/.test(v));
for (const v of vers) {
  const f = fs.readdirSync('test/fixtures/' + v)[0];
  const [, rx, rz] = f.match(/r\.(-?\d+)\.(-?\d+)/).map(Number);
  // fake world: put region in region/
  const prov = { paths: ['region/' + f], read: async () => new Uint8Array(fs.readFileSync(`test/fixtures/${v}/${f}`)) };
  const w = await World.open(prov);
  const t0 = Date.now();
  const tile = await w.renderRegionMap('', rx, rz);
  let filled = 0; for (let i = 3; i < tile.rgba.length; i += 4) if (tile.rgba[i]) filled++;
  // find a chunk present
  const reg = await w.region('', rx, rz);
  let cx, cz; outer: for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if (reg.hasChunk(x, z)) { cx = rx*32+x; cz = rz*32+z; break outer; }
  const c = await w.chunk('', cx, cz);
  const ys = [...c.sections.keys()];
  const sch = await w.extract('', [cx*16, Math.min(...ys)*16 < 0 ? -64 : 0, cz*16], [cx*16+31, 120, cz*16+31], {});
  const mats = sch.materialCounts().slice(0, 6).map(([n, c]) => n.replace('minecraft:', '') + ':' + c).join(' ');
  const bytes = await writeSchem(sch, { version: 2 });
  const back = await readAny(bytes);
  const same = back.blocks.every((b, i) => back.palette[b] === sch.palette[sch.blocks[i]]);
  const b3 = await readAny(await writeSchem(sch, { version: 3 }));
  const same3 = b3.blocks.every((b, i) => b3.palette[b] === sch.palette[sch.blocks[i]]);
  console.log(v.padEnd(7), 'dv', sch.dataVersion, 'legacy', !!sch.fromLegacy, 'map px', filled, `${Date.now()-t0}ms`, 'size', sch.width, sch.height, sch.length, 'pal', sch.palette.length, 'BE', sch.blockEntities.length, 'ent', sch.entities.length, 'rt', same, same3, '|', mats);
}
