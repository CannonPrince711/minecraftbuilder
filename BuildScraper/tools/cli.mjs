// Command-line version of Build Scraper. Bundled to dist/mcbs.mjs (needs Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import { World } from '../src/world.js';
import { writeSchem, readAny } from '../src/formats.js';
import { openZip } from '../src/zip.js';
import { minedojoCommands } from '../src/minedojo.js';
import { serve } from './serve.mjs';
import { ErrorLog, explain } from '../src/errlog.js';
import { fatal, waitForKey } from './fatal.mjs';

const log = new ErrorLog();
let logDir = '.';
const fail = (where, item, e) => { log.add(where, item, e); console.log(`  ✗ ${item}: ${explain(e)}`); };

const HELP = `Build Scraper (command line)

  node mcbs.mjs serve [--port 8765]
      Open the Build Scraper website through a local server, which can also
      search and download from sites that block in-browser downloads.
      (Double-clicking BuildScraper.exe does this.)

  node mcbs.mjs info <world folder or .zip>
      Show the world's name, version and dimensions.

  node mcbs.mjs scrape <world folder or .zip> --from X,Y,Z --to X,Y,Z [options]
      Save a box from the world as a .schem.
      --dim overworld|nether|end|<folder>   dimension (default overworld)
      -o, --out file.schem                  output file (default build.schem)
      --v3                                  write Sponge v3 instead of v2
      --no-entities  --no-block-entities  --no-trim

  node mcbs.mjs convert <files...> [-o folder] [--v3]
      Convert .schematic / .litematic / .nbt / old .schem files to .schem.

  node mcbs.mjs minedojo <schematic file> [-o build.json] [--at X,Y,Z]
      Write the setblock/fill commands MineDojo (Minecraft 1.11.2) needs to
      rebuild a schematic. minedojo_view.py uses this to show builds in MineDojo.

  node mcbs.mjs fetch <page or file URL> [-o folder] [--v3] [--delay ms]
      Find schematic links on a web page, download them and convert to .schem.
      Respects robots.txt and waits between downloads. Only download builds
      you are allowed to use, and follow the site's terms.
`;

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') opt.out = argv[++i];
    else if (a.startsWith('--')) {
      const k = a.slice(2);
      if (['from', 'to', 'dim', 'out', 'delay', 'at', 'q', 'site', 'pages', 'port'].includes(k)) opt[k] = argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

function dirProvider(root) {
  const paths = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else paths.push(r);
    }
  })(root, '');
  return { paths, read: async (p) => new Uint8Array(fs.readFileSync(path.join(root, p))) };
}

async function openWorld(p) {
  if (!p || !fs.existsSync(p)) throw new Error(`World not found: ${p}`);
  const provider = fs.statSync(p).isDirectory() ? dirProvider(p) : await openZip(fs.openAsBlob ? await fs.openAsBlob(p) : new Blob([fs.readFileSync(p)]));
  return World.open(provider);
}

const xyz = (s, name) => {
  const v = String(s || '').split(/[ ,]+/).map(Number);
  if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) throw new Error(`--${name} needs X,Y,Z`);
  return v.map(Math.floor);
};

function pickDim(world, dim = 'overworld') {
  const d = dim.toLowerCase();
  const want = { overworld: 'Overworld', nether: 'Nether', end: 'The End', the_end: 'The End' }[d];
  const found = world.dimensions.find((x) => (want ? x.label === want : x.id.replace(/\/$/, '') === dim || x.label === dim));
  if (!found) throw new Error(`Dimension "${dim}" not found. Available: ${world.dimensions.map((x) => x.label).join(', ')}`);
  return found;
}

async function cmdInfo(p) {
  const w = await openWorld(p);
  console.log(`${w.info.name}  ${w.info.version || ''}  data version ${w.info.dataVersion ?? 'unknown'}`);
  if (w.info.spawn) console.log(`spawn  ${w.info.spawn.join(' ')}`);
  if (w.info.player) console.log(`player ${w.info.player.pos.join(' ')}`);
  for (const d of w.dimensions) console.log(`  ${d.label.padEnd(12)} ${d.regions.length} region files  (${d.id || 'region/'})`);
}

async function cmdScrape(p, opt) {
  const w = await openWorld(p);
  w.onError = (where, item, e) => fail(where, item, e);
  logDir = path.dirname(path.resolve(opt.out || 'build.schem'));
  const dim = pickDim(w, opt.dim);
  let sch = await w.extract(dim.id, xyz(opt.from, 'from'), xyz(opt.to, 'to'), {
    blockEntities: !opt['no-block-entities'], entities: !opt['no-entities'],
  });
  sch.normalizeAir();
  if (!opt['no-trim']) sch = sch.trimmed();
  const out = opt.out || 'build.schem';
  const name = path.basename(out).replace(/\.schem$/, '');
  fs.writeFileSync(out, await writeSchem(sch, { version: opt.v3 ? 3 : 2, name }));
  console.log(`Saved ${out}: ${sch.width} x ${sch.height} x ${sch.length}, ${sch.palette.length} block states, ${sch.blockEntities.length} block entities, ${sch.entities.length} entities`);
  if (sch.fromLegacy) console.log('Note: pre-1.13 blocks were converted to modern names.');
  if (sch.missingChunks) console.log(`Note: ${sch.missingChunks} chunk(s) were never generated and are air.`);
  if (sch.badChunks) console.log(`Warning: ${sch.badChunks} damaged chunk(s) could not be read and are air.`);
}

async function convertBytes(name, bytes, outDir, v3) {
  const sch = await readAny(bytes, name);
  sch.normalizeAir();
  const base = path.basename(name).replace(/\.[^.]+$/, '').replace(/[^\w\- .()]+/g, '_') || 'build';
  let out = path.join(outDir, `${base}.schem`), i = 2;
  while (fs.existsSync(out)) out = path.join(outDir, `${base}-${i++}.schem`);
  fs.writeFileSync(out, await writeSchem(sch, { version: v3 ? 3 : 2, name: base }));
  console.log(`  ${name} -> ${out} (${sch.width} x ${sch.height} x ${sch.length})`);
}

async function convertAny(name, bytes, outDir, v3) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const z = await openZip(new Blob([bytes]));
    for (const p of z.paths.filter((x) => /\.(schem|schematic|litematic|nbt)$/i.test(x))) {
      try { await convertBytes(p, await z.read(p), outDir, v3); } catch (e) { fail('Convert', `${name} > ${p}`, e); }
    }
  } else await convertBytes(name, bytes, outDir, v3);
}

async function cmdConvert(files, opt) {
  const outDir = opt.out || '.';
  fs.mkdirSync(outDir, { recursive: true });
  logDir = outDir;
  if (!files.length) throw new Error('Give at least one file to convert.');
  for (const f of files) {
    try { await convertAny(f, new Uint8Array(fs.readFileSync(f)), outDir, opt.v3); } catch (e) { fail('Convert', f, e); }
  }
}

// ---- fetch ----
const UA = 'BuildScraper/1.0 (+schematic converter; one request at a time)';

async function robotsAllows(url) {
  const u = new URL(url);
  try {
    const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA } });
    if (!r.ok) return true;
    const lines = (await r.text()).split(/\r?\n/);
    let applies = false; const rules = [];
    for (const raw of lines) {
      const line = raw.replace(/#.*/, '').trim();
      const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'user-agent') applies = v === '*' || /buildscraper/i.test(v);
      else if (applies && v) rules.push({ allow: k === 'allow', path: v });
    }
    const best = rules.filter((r) => u.pathname.startsWith(r.path.replace(/\*.*$/, ''))).sort((a, b) => b.path.length - a.path.length)[0];
    return !best || best.allow;
  } catch { return true; }
}

function findLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    if (!/\.(schem|schematic|litematic|nbt|zip)(\?|$)/i.test(m[1])) continue;
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), base);
      if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) { u.hostname = 'raw.githubusercontent.com'; u.pathname = u.pathname.replace('/blob/', '/'); }
      out.add(u.href);
    } catch {}
  }
  return [...out];
}

async function cmdFetch(url, opt) {
  const outDir = opt.out || 'schems';
  const delay = Math.max(500, +(opt.delay || 1500));
  fs.mkdirSync(outDir, { recursive: true });
  logDir = outDir;
  const get = async (u) => {
    if (!(await robotsAllows(u))) throw new Error('robots.txt asks tools not to download this');
    const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cd = r.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const name = m ? decodeURIComponent(m[1]) : decodeURIComponent(new URL(r.url).pathname.split('/').pop() || 'download');
    return { bytes: new Uint8Array(await r.arrayBuffer()), name, finalUrl: r.url, type: r.headers.get('content-type') || '' };
  };
  const first = await get(url);
  const isFile = (b) => (b[0] === 0x1f && b[1] === 0x8b) || (b[0] === 0x0a && b[1] === 0x00) || (b[0] === 0x50 && b[1] === 0x4b);
  if (isFile(first.bytes)) { await convertAny(first.name, first.bytes, outDir, opt.v3); return; }
  const links = findLinks(new TextDecoder().decode(first.bytes), first.finalUrl);
  if (!links.length) { console.log('No schematic links found on that page. The site may hide downloads behind buttons or a login; download the file yourself and use "convert".'); return; }
  console.log(`Found ${links.length} link(s).`);
  for (const l of links) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const f = await get(l);
      if (!isFile(f.bytes)) { fail('Download', l, new Error('The download was not a schematic file (the site may want a login or show a download page first).')); continue; }
      await convertAny(f.name, f.bytes, outDir, opt.v3);
    } catch (e) { fail('Download', l, e); }
  }
}

async function cmdMinedojo(file, opt) {
  logDir = path.dirname(path.resolve(opt.out || file));
  const sch = await readAny(new Uint8Array(fs.readFileSync(file)), file);
  sch.normalizeAir();
  const at = opt.at ? xyz(opt.at, 'at') : [0, 4, 0];
  const { commands, unmapped } = minedojoCommands(sch, at);
  const out = opt.out || file.replace(/\.[^.\\/]+$/, '') + '.minedojo.json';
  fs.writeFileSync(out, JSON.stringify({ name: path.basename(file), size: [sch.width, sch.height, sch.length], origin: at, commands, unmapped }));
  console.log(`Wrote ${out}: ${commands.length} commands for a ${sch.width} x ${sch.height} x ${sch.length} build.`);
  const miss = Object.entries(unmapped).filter(([, n]) => n);
  if (miss.length) console.log(`Left out ${miss.length} block type(s) with no 1.11 equivalent, e.g. ${miss.slice(0, 3).map(([s]) => s).join(', ')}`);
}

const [cmd, ...rest] = process.argv.slice(2).filter((a) => a !== '--smol'); // bun may inject runtime flags
const { pos, opt } = parseArgs(rest);
try {
  if (cmd === 'serve' || (!cmd && process.versions.bun)) {
    try { await serve({ port: +(opt.port || 8765) }); } catch (e) { fatal(e); }
  }
  else if (cmd === 'info') await cmdInfo(pos[0]);
  else if (cmd === 'scrape') await cmdScrape(pos[0], opt);
  else if (cmd === 'convert') await cmdConvert(pos, opt);
  else if (cmd === 'fetch') await cmdFetch(pos[0], opt);
  else if (cmd === 'minedojo') await cmdMinedojo(pos[0], opt);
  else {
    console.log(HELP);
    if (process.versions.bun) waitForKey(); // e.g. a file dropped onto the .exe; keep the help readable
  }
} catch (e) {
  log.add(cmd || 'Build Scraper', pos[0] || '', e);
  console.error(`Error: ${explain(e)}`);
  process.exitCode = 1;
}
if (log.count) {
  const file = path.join(logDir, 'errors.txt');
  try {
    fs.writeFileSync(file, log.toText(`Build Scraper error log (${process.argv.slice(2).join(' ')})`));
    console.error(`\n${log.count} problem(s). Details written to ${file}`);
  } catch (e) { console.error(`\n${log.count} problem(s). Could not write ${file}: ${e.message}`); }
  process.exitCode = 1;
}
