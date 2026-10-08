// Parses every file given on the command line and prints a summary (Node test harness).
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const js = path.join(__dirname, '..', 'js');
require(path.join(js, 'nbt.js')); require(path.join(js, 'legacy.js'));
const F = require(path.join(js, 'formats.js'));
const Look = require(path.join(js, 'blocks.js'));
const M = require(path.join(js, 'mesher.js'));
let failed = 0;
for (const f of process.argv.slice(2)) {
  try {
    let u8 = fs.readFileSync(f);
    if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = zlib.gunzipSync(u8);
    const t0 = Date.now();
    const s = F.parseDecompressed(new Uint8Array(u8), path.basename(f));
    const looks = s.palette.map(p => Look.appearance(p.name, p.props));
    const ctx = M.makeContext(s, looks, new Uint8Array(looks.length).fill(1), 0, s.height - 1, true);
    let tris = 0;
    for (let y = 0; y < s.height; y += 32) for (let z = 0; z < s.length; z += 32) for (let x = 0; x < s.width; x += 32) {
      const r = M.buildChunk(ctx, x, y, z, 32); tris += (r.opaque.indices.length + r.translucent.indices.length) / 3;
    }
    const solid = s.palette.reduce((a, p, i) => a + (looks[i].invisible ? 0 : p.count), 0);
    const unknown = s.palette.filter((p, i) => looks[i].unknownColor && !looks[i].invisible).map(p => p.name);
    console.log(`OK  ${path.basename(f)}: ${s.formatLabel} | MC ${s.mcVersion} | ${s.width}x${s.height}x${s.length} | ${solid} blocks | ${s.palette.length} states | ${tris} tris | ${Date.now() - t0}ms`);
    console.log('    states:', s.palette.filter(p => p.count).slice(0, 12).map(p => p.state + ' x' + p.count).join('; '));
    if (unknown.length) console.log('    no colour match:', [...new Set(unknown)].join(', '));
  } catch (e) { failed++; console.log('ERR', f, e.stack); }
}
process.exit(failed ? 1 : 0);
