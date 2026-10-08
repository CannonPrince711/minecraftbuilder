import fs from 'node:fs';
import { readAny, writeSchem } from '../src/formats.js';
const s = await readAny(new Uint8Array(fs.readFileSync('test/fixtures/viking-house1.schematic')), 'x.schematic');
console.log(s.width, s.height, s.length, s.dataVersion, 'BE', s.blockEntities.length, s.blockEntities.map(b=>b.id));
console.log(s.palette.filter(p => /stairs|fence|door|pane|chest|wall|bed|torch|unknown/.test(p)).join('\n'));
const m = await readAny(new Uint8Array(fs.readFileSync('test/fixtures/smallhouse1.schem')), 'x.schem');
console.log('schem', m.width, m.height, m.length, m.dataVersion, m.palette.length, m.blockEntities.length);
