// Local web app: type a prompt, preview builds in 3D, download .schem files or a
// data pack for any Minecraft version, install into a world, and train models.
//   node src/server.js [--port 4321] [--no-open]
// Listens on 127.0.0.1 only.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { STRUCTURES, getStructure, reloadCustom } from './structures/index.js';
import { importSchematics, deleteDef } from './custom.js';
import { THEMES, THEME_NAMES } from './blocks.js';
import { VERSIONS, LATEST, getVersion, substitutions } from './versions.js';
import { parsePrompt } from './prompt.js';
import { ROOT, hasModel, loadLog, generateBuilds, findWorlds, listWorlds } from './generator.js';
import { functionPackage, zipPackage, installPackage, schematicFile, galleryData } from './export.js';
import { zip } from './zip.js';
import { parseArgs } from './cli.js';
import { runMineDojo, mineDojoDoctor } from './minedojo.js';
import { REALISM, PRESETS, parseRealism, realismMap, withRealism, decoFor } from './realism.js';
import { loadSettings, saveSettings, worldeditDir } from './settings.js';
import { companions, launch, listImportable, readImportable, importDir } from './companions.js';
import { FILE_FORMATS } from './export.js';
import { openAppWindow, reveal } from './appwindow.js';

const args = parseArgs(process.argv.slice(2), { port: 4321, 'no-open': false });
const WEB = path.join(ROOT, 'web');
const jobs = new Map(); // job id -> builds (last 30 kept)
const started = Date.now();
let buildsMade = 0;

// Activity log shown in the Control Center.
const activity = [];
function log(msg, kind = 'info') {
  activity.push({ t: Date.now(), msg, kind });
  if (activity.length > 300) activity.shift();
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}
const training = {}; // type -> { proc, lines, iter, total, done, error }
const dojo = new Map(); // job id -> { lines, done, error, result }
const dojoDir = (job) => path.join(ROOT, 'minedojo', 'runs', job);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const fail = (res, status, message) => send(res, status, { error: message });

async function readJson(req, limit = 1e5) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error('Request too large');
  }
  return data ? JSON.parse(data) : {};
}

function structureInfo() {
  return Object.values(STRUCTURES).map((s) => {
    const log = loadLog(s.id), t = training[s.id];
    return {
      id: s.id, label: s.label, description: s.description, custom: !!s.custom, defaultTheme: s.defaultTheme ?? null, variants: s.variants, variantLabel: s.variantLabel ?? 'Style',
      size: s.size, square: !!s.square, trained: hasModel(s.id), lastScore: log.at(-1)?.score ?? null, iterations: log.length,
      training: t && !t.done ? { iter: t.iter, total: t.total } : null,
    };
  });
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : undefined;
}

function makeJob(body) {
  const type = body.type || 'house';
  const spec = getStructure(type);
  const version = getVersion(body.version || LATEST);
  const brief = {
    width: clampInt(body.width, 1, 11), depth: clampInt(body.depth, 1, 11), height: clampInt(body.height, 1, 11),
    variant: spec.variants?.includes(body.variant) ? body.variant : undefined,
    theme: THEME_NAMES.includes(body.theme) ? body.theme : undefined,
  };
  const builds = generateBuilds(type, {
    count: clampInt(body.count, 1, 24) ?? 6,
    temp: Math.max(0, Math.min(1, Number(body.temp ?? 0.3))),
    tries: 4,
    brief,
  });
  const id = Math.random().toString(36).slice(2, 10);
  jobs.set(id, builds);
  buildsMade += builds.length;
  log(`Generated ${builds.length} × ${spec.label.toLowerCase()} for Minecraft ${version.label}`, 'ok');
  if (jobs.size > 30) jobs.delete(jobs.keys().next().value);
  const realism = parseRealism(body.realism);
  for (const b of builds) { const m = realismMap(b, realism); b.deco = decoFor(m); b.fell = m.fell ?? 0; }
  const data = galleryData(builds, loadLog(type));
  for (const b of data.builds) b.substitutions = THEMES[b.theme] ? substitutions(THEMES[b.theme], version) : [];
  return { job: id, version, ...data };
}

function startTraining(type, iters) {
  getStructure(type);
  if (training[type] && !training[type].done) throw new Error(`${type} is already training`);
  const total = clampInt(iters, 10, 2000) ?? 200;
  const proc = spawn(process.execPath, [path.join(ROOT, 'src', 'train.js'), '--type', type, '--iters', String(total)], { cwd: ROOT });
  const t = { proc, lines: [], iter: 0, total, done: false, error: null, scores: [] };
  training[type] = t;
  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      t.lines.push(line);
      if (t.lines.length > 200) t.lines.shift();
      const m = line.match(/^iter\s+(\d+).*score\s+([\d.]+)/);
      if (m) { t.iter = +m[1]; t.scores.push(+m[2]); }
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  log(`Training ${type} started (${total} iterations)`);
  proc.on('exit', (code) => {
    t.done = true;
    if (code) { t.error = `Training exited with code ${code}`; log(`Training ${type} failed: ${t.error}`, 'error'); }
    else log(`Training ${type} finished, score ${t.scores.at(-1) ?? '?'}`, 'ok');
  });
}

const FOLDERS = () => ({
  program: ROOT,
  output: path.join(ROOT, 'output'),
  schematics: path.join(ROOT, 'output', 'schematics'),
  models: path.join(ROOT, 'models'),
  custom: path.join(ROOT, 'custom'),
  saves: findWorlds().savesDirs[0],
  worldedit: worldeditDir(),
});

function dirSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
  } catch { /* missing folder */ }
  return total;
}

const routes = {
  // Everything the Control Center shows.
  'GET /api/status': () => {
    const folders = FOLDERS();
    return {
      version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
      node: process.version, port: args.port, uptime: Date.now() - started, buildsMade,
      structures: structureInfo(),
      training: Object.fromEntries(Object.entries(training).map(([k, t]) => [k, { iter: t.iter, total: t.total, done: t.done, error: t.error }])),
      folders: Object.fromEntries(Object.entries(folders).map(([k, p]) => [k, { path: p || '', exists: !!p && fs.existsSync(p) }])),
      sizes: { models: dirSize(folders.models), output: dirSize(folders.output), custom: dirSize(folders.custom) },
      worlds: findWorlds().worlds,
      companions: companions(),
      importDir: importDir(),
      settings: loadSettings(),
      versions: VERSIONS.map((v) => ({ id: v.id, label: v.label })),
      activity: activity.slice(-80),
    };
  },
  'POST /api/open': async (req) => {
    const { what, path: p } = await readJson(req);
    const folders = FOLDERS();
    let target = folders[what];
    if (what === 'world') target = findWorlds().worlds.find((w) => w.path === p)?.path;
    if (what === 'guide') target = path.join(ROOT, 'HOW_TO_USE.txt');
    if (!target) throw new Error(what === 'worldedit' ? 'No WorldEdit folder found. Set it in Settings.' : 'Folder not found.');
    if (!fs.existsSync(target)) {
      // Only the program's own folders (and the WorldEdit one) are created on demand.
      if (!['output', 'schematics', 'models', 'custom', 'worldedit'].includes(what)) throw new Error(`Not found: ${target}`);
      fs.mkdirSync(target, { recursive: true });
    }
    reveal(target);
    return { opened: target };
  },
  'GET /api/settings': () => loadSettings(),
  'POST /api/settings': async (req) => {
    const next = saveSettings(await readJson(req));
    companions(true); // folders may have changed
    log('Settings saved');
    return next;
  },
  // Copy the current schematics straight into the WorldEdit schematics folder.
  'POST /api/worldedit': async (req) => {
    const { job, version, realism } = await readJson(req);
    const builds = jobs.get(job)?.map((b) => withRealism(b, parseRealism(realism)));
    if (!builds) throw Object.assign(new Error('These builds expired. Generate again.'), { status: 404 });
    const dir = worldeditDir();
    if (!dir) throw new Error('No WorldEdit folder found. Set it in the Control Center under Settings.');
    fs.mkdirSync(dir, { recursive: true });
    const v = getVersion(version || LATEST);
    const names = builds.map((b) => { const f = schematicFile(b, v); fs.writeFileSync(path.join(dir, f.filename), f.content); return f.filename; });
    log(`Sent ${names.length} schematics to WorldEdit (${dir})`, 'ok');
    return { dir, files: names, command: `${v.legacy ? '//schematic' : '//schem'} load ${builds[0].name}` };
  },
  // Build Scraper / Schematic Viewer
  'POST /api/launch': async (req) => {
    const { which } = await readJson(req);
    const exe = launch(which === 'viewer' ? 'viewer' : 'buildScraper');
    log(`Opened ${path.basename(exe)}`);
    return { opened: exe };
  },
  'POST /api/viewer': async (req) => {
    const { job, name, version, realism, format } = await readJson(req);
    const b = jobs.get(job)?.find((x) => x.name === name);
    if (!b) throw Object.assign(new Error('These builds expired. Generate again.'), { status: 404 });
    const f = schematicFile(withRealism(b, parseRealism(realism)), getVersion(version || LATEST), format);
    const dir = path.join(ROOT, 'output', 'viewer');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, f.filename);
    fs.writeFileSync(file, f.content);
    launch('viewer', [file]);
    log(`Opened ${f.filename} in Schematic Viewer`);
    return { file };
  },
  'GET /api/importable': () => listImportable(),
  'POST /api/custom/import-local': async (req) => {
    const { name, files } = await readJson(req);
    if (!Array.isArray(files) || !files.length) throw new Error('Tick at least one file.');
    const { def, added, errors } = importSchematics(name, readImportable(files));
    reloadCustom();
    log(`Imported ${added.length} build(s) from ${importDir()} into your type "${def.label}"`, errors.length ? 'warn' : 'ok');
    return {
      id: def.id, label: def.label, theme: def.theme, total: def.examples.length, errors,
      added: added.map((e) => ({ filename: e.filename, w: e.w, h: e.h, d: e.d, grid: e.grid, scaled: e.scaled, original: e.original })),
    };
  },
  'POST /api/quit': () => {
    log('Quitting');
    setTimeout(() => process.exit(0), 300);
    return { bye: true };
  },
  'GET /api/options': () => ({
    structures: structureInfo(),
    themes: THEME_NAMES.map((n) => ({ id: n, colors: THEMES[n].colors })),
    versions: VERSIONS, latest: loadSettings().defaultVersion || LATEST, realism: REALISM, presets: PRESETS,
    worldedit: !!worldeditDir(),
    companions: { buildScraper: !!companions().buildScraper, viewer: !!companions().viewer },
    formats: FILE_FORMATS,
    ...findWorlds(),
  }),
  // Re-apply the realism sliders to existing builds (fast, no regeneration).
  'POST /api/realism': async (req) => {
    const { job, realism } = await readJson(req);
    const builds = jobs.get(job);
    if (!builds) throw Object.assign(new Error('These builds expired. Generate again.'), { status: 404 });
    const r = parseRealism(realism);
    return { builds: builds.map((b) => { const m = realismMap(b, r); return { name: b.name, deco: decoFor(m), fell: m.fell ?? 0 }; }) };
  },
  'POST /api/parse': async (req) => ({ parsed: parsePrompt((await readJson(req)).prompt) }),
  'POST /api/generate': async (req) => makeJob(await readJson(req)),
  'POST /api/worlds': async (req) => {
    const { savesDir } = await readJson(req);
    return { worlds: savesDir ? listWorlds(savesDir) : findWorlds().worlds };
  },
  'POST /api/install': async (req) => {
    const { job, version, world, realism } = await readJson(req);
    const builds = jobs.get(job)?.map((b) => withRealism(b, parseRealism(realism)));
    if (!builds) throw Object.assign(new Error('These builds expired. Generate again.'), { status: 404 });
    if (!world || !fs.existsSync(path.join(world, 'level.dat'))) throw new Error('Pick a Minecraft world folder (one that contains level.dat).');
    const v = getVersion(version || LATEST);
    const dest = installPackage(functionPackage(builds, v), world);
    log(`Installed ${builds.length} builds into ${path.basename(world)} (${v.label})`, 'ok');
    return { installed: dest, kind: v.legacy ? 'functions' : 'datapack' };
  },
  // Upload schematics (base64 in JSON) to create or extend a custom structure type.
  'POST /api/custom/upload': async (req) => {
    const { name, files } = await readJson(req, 40e6);
    if (!Array.isArray(files) || !files.length) throw new Error('Choose at least one schematic file.');
    const { def, added, errors } = importSchematics(name, files.map((f) => ({ filename: String(f.filename), buffer: Buffer.from(String(f.data), 'base64') })));
    reloadCustom();
    log(`Imported ${added.length} schematic(s) into your type "${def.label}"${errors.length ? `, skipped ${errors.length}` : ''}`, errors.length ? 'warn' : 'ok');
    return {
      id: def.id, label: def.label, theme: def.theme, total: def.examples.length, errors,
      added: added.map((e) => ({ filename: e.filename, w: e.w, h: e.h, d: e.d, grid: e.grid, scaled: e.scaled, original: e.original })),
    };
  },
  'POST /api/custom/delete': async (req) => {
    const { id } = await readJson(req);
    if (!STRUCTURES[id]?.custom) throw new Error('Only your own types can be deleted.');
    deleteDef(id);
    for (const f of [`${id}.json`, `${id}_log.json`]) fs.rmSync(path.join(ROOT, 'models', f), { force: true });
    reloadCustom();
    return { deleted: id };
  },
  'GET /api/minedojo/doctor': async () => {
    const lines = [];
    try { await mineDojoDoctor((l) => lines.push(l)); return { ok: true, lines }; } catch (e) {
      return { ok: false, lines: /^(WSL|MineDojo Python)/.test(e.message) ? [] : lines, error: e.message };
    }
  },
  'POST /api/minedojo': async (req) => {
    const { job, prompt, realism } = await readJson(req);
    const builds = jobs.get(job)?.map((b) => withRealism(b, parseRealism(realism)));
    if (!builds) throw Object.assign(new Error('These builds expired. Generate again.'), { status: 404 });
    if (dojo.get(job) && !dojo.get(job).done) return { started: job };
    const run = { lines: [], done: false, error: null, result: null };
    dojo.set(job, run);
    const text = String(prompt || '').trim() || `a minecraft ${builds[0].target.spec.label.toLowerCase()}`;
    runMineDojo(builds, text, dojoDir(job), (l) => { run.lines.push(l); if (run.lines.length > 50) run.lines.shift(); })
      .then((r) => { run.result = r; log('MineDojo scored the builds', 'ok'); })
      .catch((e) => { run.error = e.message; log(`MineDojo: ${e.message}`, 'error'); })
      .finally(() => { run.done = true; });
    return { started: job };
  },
  'GET /api/train': () => Object.fromEntries(Object.entries(training).map(([k, t]) =>
    [k, { iter: t.iter, total: t.total, done: t.done, error: t.error, scores: t.scores, tail: t.lines.slice(-6) }])),
  'POST /api/train': async (req) => {
    const { type, iters } = await readJson(req);
    startTraining(type, iters);
    return { started: type };
  },
};

// GET /api/download/<job>/<what>?v=<version>  what = schems.zip | pack.zip | <name>.schem(atic)
function download(res, url) {
  const [, , , job, what] = url.pathname.split('/');
  const r = parseRealism(url.searchParams.get('r') || '');
  const builds = jobs.get(job)?.map((b) => withRealism(b, r));
  if (!builds) return fail(res, 404, 'These builds expired. Generate again.');
  const version = getVersion(url.searchParams.get('v') || LATEST);
  const attach = (name, body, type = 'application/octet-stream') =>
    send(res, 200, body, type, { 'Content-Disposition': `attachment; filename="${name}"` });
  const tag = version.id.replace(/\./g, '_');
  const format = FILE_FORMATS[url.searchParams.get('f')] ? url.searchParams.get('f') : 'auto';
  if (what === 'schems.zip') {
    const files = builds.map((b) => schematicFile(b, version, format)).map((f) => ({ path: f.filename, content: f.content }));
    return attach(`rlbuild_${builds[0].target.type}_${tag}_schematics.zip`, zip(files), 'application/zip');
  }
  if (what === 'pack.zip') {
    const pkg = functionPackage(builds, version);
    return attach(`${pkg.root}_${tag}.zip`, zipPackage(pkg), 'application/zip');
  }
  const b = builds.find((x) => what.replace(/\.[a-z]+$/, '') === x.name);
  if (!b) return fail(res, 404, 'Unknown file');
  const f = schematicFile(b, version, format);
  return attach(f.filename, f.content);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return send(res, 200, await route(req));
    if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) return download(res, url);
    if (req.method === 'GET' && url.pathname === '/api/minedojo') {
      const run = dojo.get(url.searchParams.get('job'));
      return run ? send(res, 200, { done: run.done, error: run.error, result: run.result, tail: run.lines.slice(-5) }) : fail(res, 404, 'No MineDojo run for these builds');
    }
    // GET /api/minedojo-img/<job>/<file>.png
    if (req.method === 'GET' && url.pathname.startsWith('/api/minedojo-img/')) {
      const [, , , job, file] = url.pathname.split('/');
      if (!/^[a-z0-9]+$/.test(job) || !/^[\w-]+\.png$/.test(file ?? '')) return fail(res, 404, 'Not found');
      const p = path.join(dojoDir(job), file);
      return fs.existsSync(p) ? send(res, 200, fs.readFileSync(p), 'image/png') : fail(res, 404, 'Not found');
    }
    // The browser shares these two modules with the server.
    if (req.method === 'GET' && ['/lib/versions.js', '/lib/blocks.js'].includes(url.pathname)) {
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'src', path.basename(url.pathname))), MIME['.js']);
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.resolve(WEB, rel);
      if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file)) return fail(res, 404, 'Not found');
      return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
    }
    fail(res, 404, 'Not found');
  } catch (e) {
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/status') log(`${url.pathname}: ${e.message}`, 'error');
    fail(res, e.status ?? 400, e.message);
  }
});

const link = `http://localhost:${args.port}`;
const startPage = () => (loadSettings().openBuilderOnStart ? link + '/' : link + '/control.html');
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Already running (e.g. start.bat double-clicked twice): just show the window again.
    console.log(`Already running at ${link} - opening the window.`);
    if (!args['no-open']) openAppWindow(startPage());
    setTimeout(() => process.exit(0), 500);
  } else throw e;
});
server.listen(args.port, '127.0.0.1', () => {
  log(`RL Build Generator running at ${link}`);
  console.log('Keep this window open while you use the program. Close it (or press Quit) to stop.');
  if (!args['no-open']) openAppWindow(startPage());
});
