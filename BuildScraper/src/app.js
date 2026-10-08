import { World } from './world.js';
import { readAny, FORMATS } from './formats.js';
import { searchGitHub, searchSite } from './search.js';
import { errors, explain } from './errlog.js';
import { openZip, makeZip } from './zip.js';
import { gunzip } from './compress.js';
import { blockColor } from './colors.js';
import { fetchBytes, findLinks, looksLikeNbt, looksLikeZip, filenameFor, SCHEM_EXT, BLOCKED, hasHelper } from './web.js';
import { CATEGORIES, OTHER, categoryIds, findCategory, guessCategory, inCategory, cleanCategory } from './categories.js';
import { library, UNSORTED } from './library.js';

const $ = (id) => document.getElementById(id);
const fmtInt = (n) => Math.round(n).toLocaleString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- saving files ----------------
// In a normal browser tab we trigger a download. Inside a claude.ai artifact, pages cannot
// download directly, so we ask the viewer's "downloads" capability (which only accepts .zip).
let downloadsCap;
async function getDownloads() {
  if (downloadsCap !== undefined) return downloadsCap;
  downloadsCap = null;
  if (window.claude && typeof window.claude.use === 'function') {
    try { downloadsCap = await window.claude.use('downloads'); } catch { downloadsCap = null; }
  }
  return downloadsCap;
}
const inArtifact = () => !!(window.claude && typeof window.claude.use === 'function');

async function saveFiles(files, zipName) {
  const dl = await getDownloads();
  if (dl && files.length === 1 && /\.(txt|json|zip)$/i.test(files[0].name)) {
    await dl.save({ filename: files[0].name, data: files[0].data });
    return 'file';
  }
  if (dl) {
    const data = makeZip(files);
    await dl.save({ filename: zipName || files[0].name.replace(/\.\w+$/, '') + '.zip', data });
    return 'zip';
  }
  if (files.length === 1) blobDownload(files[0].name, files[0].data);
  else blobDownload(zipName || 'schematics.zip', makeZip(files));
  return 'file';
}
function blobDownload(name, data) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
// Save builds ({ name, data, category }) into the library's category folders. Without a library
// (plain browser tab or the claude.ai preview) they are downloaded instead; several builds come
// as one .zip with a folder per category.
async function saveBuilds(builds, zipName = 'schematics.zip') {
  // In Chrome or Edge the first save asks for a folder; cancelling that just downloads instead.
  if (library.kind !== 'none' && !inArtifact() && await library.connect()) {
    const paths = [];
    for (const b of builds) paths.push(await library.save(b.category, b.name, b.data));
    libraryDirty = true;
    return { how: 'library', paths };
  }
  if (builds.length === 1) {
    const how = await saveFiles([{ name: builds[0].name, data: builds[0].data }], builds[0].name.replace(/\.\w+$/, '.zip'));
    return { how, paths: [builds[0].name] };
  }
  const used = new Set();
  const files = builds.map((b) => {
    const dir = cleanCategory(b.category);
    let n = `${dir}/${b.name}`, i = 2;
    while (used.has(n)) n = `${dir}/${b.name.replace(/(\.\w+)$/, `-${i++}$1`)}`;
    used.add(n);
    return { name: n, data: b.data };
  });
  return { how: 'zip', paths: files.map((f) => f.name), zip: zipName, how2: await saveFiles(files, zipName) };
}
function savedMessage(r) {
  if (r.how === 'library') return r.paths.length === 1 ? `Saved to ${r.paths[0]} in your builds folder.` : `Saved ${r.paths.length} builds into their category folders.`;
  if (r.how === 'zip') return `Downloaded ${r.zip} with ${r.paths.length} builds in category folders.`;
  return `Downloaded ${r.paths[0]}.`;
}
// Category boxes share one suggestion list; any other name typed becomes a new folder.
function categoryInput(value, label = 'Category') {
  const i = document.createElement('input');
  i.type = 'text'; i.setAttribute('list', 'cat-list'); i.value = value; i.className = 'catin';
  i.setAttribute('aria-label', label); i.autocomplete = 'off';
  return i;
}
let libraryDirty = true;

const safeName = (s) => (s || 'build').replace(/\.(schem|schematic|litematic|nbt)$/i, '').replace(/[^\w\- .()]+/g, '_').trim() || 'build';

// ---------------- tabs ----------------
const tabs = ['world', 'convert', 'web', 'library', 'view', 'gen'];
function showTab(t) {
  for (const k of tabs) {
    $(`tab-${k}`).setAttribute('aria-selected', String(k === t));
    $(`pane-${k}`).hidden = k !== t;
  }
  try { localStorage.setItem('mcbs-tab', t); } catch {}
  if (t === 'world' && map) map.resize();
  if (t === 'view') getViewer().catch(() => {});
  if (t === 'library' && libraryDirty) refreshLibrary();
  if (t === 'gen') renderGenerated();
}
for (const k of tabs) $(`tab-${k}`).addEventListener('click', () => showTab(k));
try { const t = localStorage.getItem('mcbs-tab'); if (tabs.includes(t)) showTab(t); } catch {}
const hashTab = location.hash.replace('#', '');
if (tabs.includes(hashTab)) showTab(hashTab);

// ---------------- file providers ----------------
function filesProvider(fileList) {
  const files = new Map();
  const arr = [...fileList];
  const hasLevel = arr.some((f) => /(^|\/)level\.dat$/.test(f.webkitRelativePath || f.relPath || f.name));
  for (const f of arr) {
    let p = f.relPath || f.webkitRelativePath || f.name;
    // Loose region files without a world folder: treat them as the overworld.
    if (!hasLevel && /^r\.-?\d+\.-?\d+\.mca$/.test(f.name)) p = `region/${f.name}`;
    files.set(p, f);
  }
  return { paths: [...files.keys()], read: async (p) => new Uint8Array(await files.get(p).arrayBuffer()) };
}

async function entriesFromDrop(dt) {
  const items = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files];
  const out = [];
  async function walk(entry, path) {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      f.relPath = path + entry.name;
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path + entry.name + '/');
      }
    }
  }
  for (const e of items) await walk(e, '');
  return out;
}

function setupDrop(el, onFiles) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); el.classList.remove('over');
    onFiles(await entriesFromDrop(e.dataTransfer));
  });
}

// ---------------- world tab ----------------
let world = null;
let map = null;
let dimId = '';
const sel = { x0: null, y0: null, z0: null, x1: null, y1: null, z1: null };

$('pick-folder').addEventListener('click', () => $('folder-input').click());
$('pick-zip').addEventListener('click', () => $('zip-input').click());
$('folder-input').addEventListener('change', (e) => e.target.files.length && openWorldFiles([...e.target.files]));
$('zip-input').addEventListener('change', (e) => e.target.files[0] && openWorldFiles([e.target.files[0]]));
setupDrop($('world-drop'), openWorldFiles);
$('try-sample').addEventListener('click', openSample);

async function openSample() {
  const b64 = window.MCBS_SAMPLE;
  if (!b64) return;
  // Stored gzipped by tools/build.mjs (about 40% of the raw region file).
  const bin = await gunzip(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const provider = { paths: ['region/r.-1.-1.mca'], read: async () => bin };
  await openWorld(provider, 'Sample world (1.13.2 terrain)');
}

async function openWorldFiles(files) {
  setStatus('Reading world…');
  try {
    let provider;
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) provider = await openZip(files[0]);
    else provider = filesProvider(files);
    const first = files[0];
    const guess = /\.zip$/i.test(first.name) && files.length === 1 ? first.name.replace(/\.zip$/i, '') : (first.relPath || first.webkitRelativePath || '').split('/')[0] || 'World';
    await openWorld(provider, null, guess);
  } catch (e) {
    errors.add('Open world', files.length === 1 ? files[0].name : `${files.length} files`, e);
    showWorldError(e);
  }
}

function showWorldError(e) {
  $('world-ui').hidden = false;
  setStatus(explain(e), 'err');
}

async function openWorld(provider, nameOverride, fallbackName) {
  world = await World.open(provider);
  world.onError = (where, item, err) => errors.add(where, item, err);
  if (nameOverride) world.info.name = nameOverride;
  else if (world.info.name === 'Unknown world' && fallbackName) world.info.name = fallbackName;
  if (!world.dimensions.length) {
    world = null;
    throw new Error('No region files found. Pick the world folder itself (the one with level.dat and a region folder), or its .zip.');
  }
  $('world-ui').hidden = false;
  $('world-drop').classList.add('compact');
  $('world-drop').querySelector('h2').textContent = 'Switch world';
  const i = world.info;
  const pills = [];
  if (i.version) pills.push(`<span class="pill">${esc(i.version)}</span>`);
  if (i.dataVersion) pills.push(`<span class="pill">data ${i.dataVersion}</span>`);
  if (i.hasLevel && (!i.dataVersion || i.dataVersion < 1451)) pills.push('<span class="pill warn">pre-1.13 world: blocks will be converted</span>');
  if (!i.hasLevel) pills.push('<span class="pill">no level.dat: version is read from each chunk</span>');
  $('world-card').innerHTML = `<strong>${esc(i.name)}</strong>${pills.join('')}<span class="muted">${world.dimensions.reduce((n, d) => n + d.regions.length, 0)} region files</span>`;
  const dsel = $('dim');
  dsel.innerHTML = world.dimensions.map((d) => `<option value="${esc(d.id)}">${esc(d.label)} (${d.regions.length})</option>`).join('');
  dimId = world.dimensions[0].id;
  $('go-player').hidden = !i.player;
  $('go-spawn').hidden = !i.spawn;
  if (!map) map = new MapView($('map'));
  map.setWorld(world, dimId);
  const start = i.player ? i.player.pos : i.spawn;
  const dim = world.dimensions[0];
  if (start) map.centerOn(start[0], start[2]);
  else await centerOnRegion(dim);
  clearSelection();
  setStatus(`Opened ${i.name}. Find your build, then drag a box around it.`);
}

$('dim').addEventListener('change', (e) => {
  dimId = e.target.value;
  map.setWorld(world, dimId);
  centerOnRegion(world.dimensions.find((x) => x.id === dimId));
  clearSelection();
});
async function centerOnRegion(dim) {
  // the region closest to 0,0 is usually where people build
  const [rx, rz] = dim.regions.slice().sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
  const [x, z] = await world.regionCentroid(dim.id, rx, rz);
  map.centerOn(x, z, 1);
}
$('go').addEventListener('click', () => {
  const x = +$('go-x').value, z = +$('go-z').value;
  if (Number.isFinite(x) && Number.isFinite(z)) map.centerOn(x, z, 4);
});
$('go-player').addEventListener('click', () => world.info.player && map.centerOn(world.info.player.pos[0], world.info.player.pos[2], 4));
$('go-spawn').addEventListener('click', () => world.info.spawn && map.centerOn(world.info.spawn[0], world.info.spawn[2], 4));
$('zoom-in').addEventListener('click', () => map.zoomBy(2));
$('zoom-out').addEventListener('click', () => map.zoomBy(0.5));
function setMode(m) {
  map.mode = m;
  $('mode-pan').setAttribute('aria-pressed', String(m === 'pan'));
  $('mode-select').setAttribute('aria-pressed', String(m === 'select'));
  $('map').classList.toggle('selecting', m === 'select');
}
$('mode-pan').addEventListener('click', () => setMode('pan'));
$('mode-select').addEventListener('click', () => setMode('select'));

for (const k of ['x0', 'y0', 'z0', 'x1', 'y1', 'z1']) {
  $(k).addEventListener('input', () => {
    const v = $(k).value === '' ? null : Math.floor(+$(k).value);
    sel[k] = v;
    updateSelection(false);
  });
}

function clearSelection() {
  for (const k of Object.keys(sel)) sel[k] = null;
  updateSelection(true);
  $('result').hidden = true;
}
function hasSel() { return Object.values(sel).every((v) => v !== null && Number.isFinite(v)); }
function updateSelection(writeInputs) {
  if (writeInputs) for (const k of Object.keys(sel)) $(k).value = sel[k] ?? '';
  if (hasSel()) {
    const w = Math.abs(sel.x1 - sel.x0) + 1, h = Math.abs(sel.y1 - sel.y0) + 1, l = Math.abs(sel.z1 - sel.z0) + 1;
    $('sel-size').textContent = `${w} × ${h} × ${l} = ${fmtInt(w * h * l)} blocks`;
    $('export').disabled = false;
    $('preview').disabled = false;
  } else {
    $('sel-size').textContent = 'No area selected';
    $('export').disabled = true;
    $('preview').disabled = true;
  }
  if (map) map.draw();
}

function onMapSelect(x0, z0, x1, z1) {
  sel.x0 = Math.min(x0, x1); sel.x1 = Math.max(x0, x1);
  sel.z0 = Math.min(z0, z1); sel.z1 = Math.max(z0, z1);
  fitHeight();
}

function fitHeight() {
  if (sel.x0 === null || sel.z0 === null) return;
  const s = map.surfaceStats(sel.x0, sel.z0, sel.x1, sel.z1);
  const dim = world.dimensions.find((d) => d.id === dimId);
  if (s) { sel.y0 = s.ground; sel.y1 = s.top; }
  else if (sel.y0 === null) { sel.y0 = dim && dim.label === 'Overworld' ? 60 : 0; sel.y1 = sel.y0 + 40; }
  updateSelection(true);
}
$('fit-y').addEventListener('click', fitHeight);

$('export').addEventListener('click', () => exportSelection());
$('preview').addEventListener('click', () => exportSelection({ view: true }));
let warnBig = false;
async function exportSelection({ view = false } = {}) {
  if (!hasSel() || !world) return;
  const btn = $(view ? 'preview' : 'export');
  btn.disabled = true;
  const prog = $('prog'); prog.hidden = false; prog.firstElementChild.style.width = '0%';
  setStatus('Reading blocks…');
  $('result').hidden = true;
  try {
    let sch = await world.extract(dimId, [sel.x0, sel.y0, sel.z0], [sel.x1, sel.y1, sel.z1], {
      blockEntities: $('opt-be').checked,
      entities: $('opt-ent').checked,
      onProgress: (f) => { prog.firstElementChild.style.width = `${Math.round(f * 90)}%`; },
    });
    sch.normalizeAir();
    if ($('opt-trim').checked) {
      const t = sch.trimmed();
      if (t === sch && !sch.contentBounds()) throw new Error('That area is all air. Move the box or widen the height range.');
      sch = t;
    }
    const name = safeName($('name').value);
    sch.name = name;
    if (view) {
      prog.firstElementChild.style.width = '100%';
      setStatus(`Showing ${name} in the 3D viewer. Nothing has been saved yet.`, 'ok');
      await viewIn3D(name, sch);
      return;
    }
    setStatus('Writing the file…');
    const fmt = FORMATS[$('fmt').value] || FORMATS.schem2;
    if (fmt.ext === 'nbt' && (sch.width > 48 || sch.height > 48 || sch.length > 48)) warnBig = true; else warnBig = false;
    const bytes = await fmt.write(sch, { name });
    prog.firstElementChild.style.width = '100%';
    const file = `${name}.${fmt.ext}`;
    const r = await saveBuilds([{ name: file, data: bytes, category: $('cat').value || guessCategory(name) }], `${name}.zip`);
    setStatus(r.how === 'zip' || r.how === 'file' ? (inArtifact() ? `Saved ${name}.zip (it contains ${file}).` : `Downloaded ${file}.`) : savedMessage(r), 'ok');
    showResult(sch, bytes.length);
  } catch (e) {
    if (e && e.code === 'declined') setStatus('Save cancelled.');
    else {
      errors.add('Save build', `${$('name').value} (${sel.x0},${sel.y0},${sel.z0} to ${sel.x1},${sel.y1},${sel.z1})`, e);
      setStatus(explain(e), 'err');
    }
    console.error(e);
  } finally {
    btn.disabled = !hasSel();
    setTimeout(() => { prog.hidden = true; }, 600);
  }
}

function showResult(sch, size) {
  const mats = sch.materialCounts().filter(([n]) => n !== 'minecraft:air');
  const solid = mats.reduce((n, [, c]) => n + c, 0);
  const warn = [];
  if (sch.fromLegacy) warn.push('Pre-1.13 blocks were converted to modern names. Check doors, beds, heads and redstone after pasting.');
  if (sch.mixedVersions) warn.push('This area mixes chunks saved by different Minecraft versions. Paste it in the newest version you play.');
  if (warnBig) warn.push('This is bigger than 48 blocks on a side, so a structure block cannot load it. Use /place template (1.19+) instead.');
  if (sch.badChunks) warn.push(`${sch.badChunks} damaged chunk(s) could not be read and are saved as air. See Problems for details.`);
  if (sch.missingChunks) warn.push(`${sch.missingChunks} chunk(s) in the box were never generated and are saved as air.`);
  const unknown = mats.filter(([n]) => n.includes('unknown_legacy'));
  if (unknown.length) warn.push(`${unknown.length} modded or unknown block type(s) could not be converted.`);
  const r = $('result');
  r.innerHTML = `
    <h3>Saved</h3>
    <div class="size">${sch.width} × ${sch.height} × ${sch.length} · ${fmtInt(solid)} blocks · ${(size / 1024).toFixed(1)} KB</div>
    <div class="muted" style="font-size:13px">${sch.blockEntities.length} block entities · ${sch.entities.length} entities · data version ${sch.dataVersion}</div>
    ${warn.length ? `<ul class="warnings">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <h3>Top materials</h3>
    <div class="mats">${mats.slice(0, 10).map(([n, c]) => `<i style="background:${hex(blockColor(n))}"></i><span>${esc(pretty(n))}</span><b>${fmtInt(c)}</b>`).join('')}</div>`;
  r.hidden = false;
}

function setStatus(msg, kind) { const s = $('status'); s.textContent = msg; s.className = `status${kind ? ' ' + kind : ''}`; }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = (n) => n.replace('minecraft:', '').replace(/_/g, ' ');
const hex = (c) => (c < 0 ? 'transparent' : `#${c.toString(16).padStart(6, '0')}`);

// ---------------- map view ----------------
class MapView {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.cx = 0; this.cz = 0; this.scale = 1; // pixels per block
    this.mode = 'select';
    this.tiles = new Map();
    this.queue = [];
    this.busy = false;
    this.drag = null;
    this.hover = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.readout(); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  setWorld(w, dir) {
    this.world = w; this.dir = dir; this.tiles.clear(); this.queue = [];
    const d = w.dimensions.find((x) => x.id === dir);
    this.present = new Set(d.regions.map(([x, z]) => `${x},${z}`));
    this.draw();
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.dpr = dpr; this.w = r.width; this.h = r.height;
    this.draw();
  }
  centerOn(x, z, scale) { this.cx = x; this.cz = z; if (scale) this.scale = scale; this.draw(); }
  zoomBy(f, e) {
    const ns = Math.min(16, Math.max(0.125, this.scale * f));
    if (e) {
      const [bx, bz] = this.toBlock(e);
      const r = this.c.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      this.cx = bx - (px - this.w / 2) / ns; this.cz = bz - (py - this.h / 2) / ns;
    }
    this.scale = ns; this.draw();
  }
  toBlock(e) {
    const r = this.c.getBoundingClientRect();
    return [this.cx + (e.clientX - r.left - this.w / 2) / this.scale, this.cz + (e.clientY - r.top - this.h / 2) / this.scale];
  }
  down(e) {
    this.c.setPointerCapture(e.pointerId);
    const pan = this.mode === 'pan' || e.button === 1 || e.button === 2 || e.shiftKey;
    const [bx, bz] = this.toBlock(e);
    this.drag = pan ? { type: 'pan', x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz } : { type: 'sel', x0: Math.floor(bx), z0: Math.floor(bz), x1: Math.floor(bx), z1: Math.floor(bz) };
  }
  move(e) {
    const [bx, bz] = this.toBlock(e);
    this.hover = [Math.floor(bx), Math.floor(bz)];
    if (this.drag && this.drag.type === 'pan') {
      this.cx = this.drag.cx - (e.clientX - this.drag.x) / this.scale;
      this.cz = this.drag.cz - (e.clientY - this.drag.y) / this.scale;
      this.draw();
    } else if (this.drag && this.drag.type === 'sel') {
      this.drag.x1 = Math.floor(bx); this.drag.z1 = Math.floor(bz);
      this.draw();
    }
    this.readout();
  }
  up() {
    const d = this.drag; this.drag = null;
    if (d && d.type === 'sel') {
      if (d.x0 === d.x1 && d.z0 === d.z1) { this.draw(); return; }
      onMapSelect(d.x0, d.z0, d.x1, d.z1);
    }
  }
  heightAt(x, z) {
    const t = this.tiles.get(`${x >> 9},${z >> 9}`);
    if (!t || !t.heights) return null;
    const h = t.heights[(z & 511) * 512 + (x & 511)];
    return h === -32768 ? null : h;
  }
  readout() {
    const el = $('readout');
    if (!this.hover) { el.innerHTML = '<span>Drag on the map to draw a box around your build. Scroll to zoom. Shift-drag or right-drag moves the map.</span>'; return; }
    const [x, z] = this.hover; const y = this.heightAt(x, z);
    el.innerHTML = `<span>X ${x}</span><span>Z ${z}</span><span>${y === null ? 'no data' : `top Y ${y}`}</span><span>chunk ${x >> 4}, ${z >> 4}</span><span>r.${x >> 9}.${z >> 9}.mca</span>`;
  }
  surfaceStats(x0, z0, x1, z1) {
    let top = -Infinity, ground = Infinity, n = 0;
    const step = Math.max(1, Math.floor(Math.max(x1 - x0, z1 - z0) / 256));
    for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) {
      const h = this.heightAt(x, z);
      if (h === null) continue;
      n++;
      if (h > top) top = h;
      const edge = x === x0 || z === z0 || x + step > x1 || z + step > z1;
      if (edge && h < ground) ground = h;
    }
    if (!n) return null;
    if (ground === Infinity) ground = top;
    return { top, ground: Math.min(ground, top) };
  }
  ensureTile(rx, rz) {
    const k = `${rx},${rz}`;
    if (this.tiles.has(k)) return this.tiles.get(k);
    const t = { status: 'queued' };
    this.tiles.set(k, t);
    this.queue.push([rx, rz, t]);
    this.pump();
    return t;
  }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    const world = this.world, dir = this.dir;
    while (this.queue.length) {
      // render the queued tile nearest the view centre first
      const ccx = this.cx / 512, ccz = this.cz / 512;
      this.queue.sort((a, b) => Math.hypot(b[0] + 0.5 - ccx, b[1] + 0.5 - ccz) - Math.hypot(a[0] + 0.5 - ccx, a[1] + 0.5 - ccz));
      const [rx, rz, t] = this.queue.pop();
      t.status = 'loading';
      try {
        const res = await world.renderRegionMap(dir, rx, rz);
        if (world !== this.world || dir !== this.dir) break;
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
        cv.getContext('2d').putImageData(new ImageData(res.rgba, 512, 512), 0, 0);
        t.canvas = cv; t.heights = res.heights; t.status = 'done';
      } catch (e) { t.status = 'error'; t.error = e; console.warn(e); }
      this.draw();
    }
    this.busy = false;
  }
  draw() {
    if (!this.ctx || !this.w) return;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }
  paint() {
    const { ctx, dpr } = this;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim(), muted = css.getPropertyValue('--muted').trim(), selc = css.getPropertyValue('--sel').trim(), line = css.getPropertyValue('--line').trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.imageSmoothingEnabled = false;
    const s = this.scale;
    const left = this.cx - this.w / 2 / s, top = this.cz - this.h / 2 / s;
    const sx = (x) => (x - left) * s, sz = (z) => (z - top) * s;
    if (!this.world) return;
    const rx0 = Math.floor(left / 512), rx1 = Math.floor((left + this.w / s) / 512);
    const rz0 = Math.floor(top / 512), rz1 = Math.floor((top + this.h / s) / 512);
    for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) {
      if (!this.present.has(`${rx},${rz}`)) continue;
      const t = this.ensureTile(rx, rz);
      const X = sx(rx * 512), Z = sz(rz * 512);
      if (t.canvas) ctx.drawImage(t.canvas, X, Z, 512 * s, 512 * s);
      else {
        ctx.fillStyle = line; ctx.globalAlpha = 0.5; ctx.fillRect(X, Z, 512 * s, 512 * s); ctx.globalAlpha = 1;
        ctx.fillStyle = muted; ctx.font = '12px ui-monospace, monospace';
        ctx.fillText(t.status === 'error' ? `r.${rx}.${rz} could not be read` : 'Rendering…', X + 8, Z + 18);
      }
    }
    // grid
    ctx.lineWidth = 1;
    if (s >= 2) {
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.12; ctx.beginPath();
      for (let x = Math.ceil(left / 16) * 16; x < left + this.w / s; x += 16) { ctx.moveTo(Math.round(sx(x)) + 0.5, 0); ctx.lineTo(Math.round(sx(x)) + 0.5, this.h); }
      for (let z = Math.ceil(top / 16) * 16; z < top + this.h / s; z += 16) { ctx.moveTo(0, Math.round(sz(z)) + 0.5); ctx.lineTo(this.w, Math.round(sz(z)) + 0.5); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.3; ctx.beginPath();
    for (let rx = rx0; rx <= rx1 + 1; rx++) { const X = Math.round(sx(rx * 512)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, this.h); }
    for (let rz = rz0; rz <= rz1 + 1; rz++) { const Z = Math.round(sz(rz * 512)) + 0.5; ctx.moveTo(0, Z); ctx.lineTo(this.w, Z); }
    ctx.stroke(); ctx.globalAlpha = 1;
    // markers
    const mark = (p, label) => {
      if (!p) return;
      const X = sx(p[0] + 0.5), Z = sz(p[2] + 0.5);
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(X, Z, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = selc; ctx.beginPath(); ctx.arc(X, Z, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 12px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(label, X + 8, Z + 4); ctx.fillStyle = '#fff'; ctx.fillText(label, X + 8, Z + 4);
    };
    if (this.world.info.spawn && this.dirLabel() === 'Overworld') mark(this.world.info.spawn, 'Spawn');
    if (this.world.info.player) mark(this.world.info.player.pos, 'Player');
    // selection
    let b = null;
    if (this.drag && this.drag.type === 'sel') b = [Math.min(this.drag.x0, this.drag.x1), Math.min(this.drag.z0, this.drag.z1), Math.max(this.drag.x0, this.drag.x1), Math.max(this.drag.z0, this.drag.z1)];
    else if (sel.x0 !== null && sel.z0 !== null && sel.x1 !== null && sel.z1 !== null) b = [Math.min(sel.x0, sel.x1), Math.min(sel.z0, sel.z1), Math.max(sel.x0, sel.x1), Math.max(sel.z0, sel.z1)];
    if (b) {
      const X = sx(b[0]), Z = sz(b[1]), W = (b[2] - b[0] + 1) * s, H = (b[3] - b[1] + 1) * s;
      ctx.fillStyle = selc; ctx.globalAlpha = 0.18; ctx.fillRect(X, Z, W, H); ctx.globalAlpha = 1;
      ctx.lineWidth = 2; ctx.strokeStyle = selc; ctx.strokeRect(X, Z, W, H);
      ctx.font = '500 12px ui-monospace, monospace';
      const label = `${b[2] - b[0] + 1} × ${b[3] - b[1] + 1}`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = selc; ctx.fillRect(X, Z - 20, tw, 18); ctx.fillStyle = '#1f2423'; ctx.fillText(label, X + 5, Z - 7);
    }
  }
  dirLabel() { const d = this.world.dimensions.find((x) => x.id === this.dir); return d && d.label; }
}

// ---------------- convert tab ----------------
const convItems = [];
$('pick-files').addEventListener('click', () => $('files-input').click());
$('files-input').addEventListener('change', (e) => addConvertFiles([...e.target.files]));
setupDrop($('conv-drop'), addConvertFiles);

async function addConvertFiles(files) {
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      try {
        const z = await openZip(f);
        for (const p of z.paths.filter((p) => SCHEM_EXT.test(p) && !/\.zip$/i.test(p))) {
          await addConvertBytes(p.split('/').pop(), await z.read(p));
        }
      } catch (e) { addConvertError(f.name, e); }
    } else {
      await addConvertBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    }
  }
}

async function addConvertBytes(name, bytes, source, category) {
  $('conv-panel').hidden = false;
  try {
    const sch = await readAny(bytes, name);
    sch.normalizeAir();
    const guess = guessCategory(name, source && decodeURIComponent(source));
    const item = { name, sch, source, category: guess !== OTHER ? guess : category || OTHER };
    convItems.push(item);
    renderConvItem(item);
    return item;
  } catch (e) { addConvertError(name, e); return null; }
}

function addConvertError(name, e) {
  $('conv-panel').hidden = false;
  errors.add('Read file', name, e);
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<span class="pill warn">error</span><div class="name">${esc(name)}</div><div class="meta" style="color:var(--danger)">${esc(explain(e))}</div>`;
  $('conv-list').appendChild(el);
}

function renderConvItem(item) {
  const { sch } = item;
  const el = document.createElement('div');
  el.className = 'item';
  const fmt = item.name.split('.').pop().toLowerCase();
  const solid = sch.materialCounts().filter(([n]) => n !== 'minecraft:air').reduce((n, [, c]) => n + c, 0);
  el.innerHTML = `<span class="pill">.${esc(fmt)}</span><div class="name">${esc(item.name)}</div>
    <div class="meta">${sch.width} × ${sch.height} × ${sch.length} · ${fmtInt(solid)} blocks · ${sch.palette.length} block states${sch.fromLegacy ? ' · pre-1.13 IDs converted' : ''}${item.source ? ` · from ${esc(new URL(item.source).hostname)}` : ''}</div>
    <div class="acts"><button class="btn small" data-act="view">View in 3D</button><button class="btn small" data-act="save">Save</button></div>`;
  const cat = categoryInput(item.category, `Category for ${item.name}`);
  cat.addEventListener('change', () => { item.category = cat.value.trim() || OTHER; });
  el.querySelector('.meta').append(' · ', cat);
  el.querySelector('[data-act="view"]').addEventListener('click', () => viewIn3D(item.name.replace(/\.[^.]+$/, ''), item.sch));
  el.querySelector('[data-act="save"]').addEventListener('click', async () => {
    try {
      const out = await convertItem(item);
      const r = await saveBuilds([{ ...out, category: item.category }], out.name.replace(/\.\w+$/, '.zip'));
      const m = el.querySelector('.meta'); const done = document.createElement('div'); done.className = 'saved'; done.textContent = savedMessage(r); m.after(done);
    } catch (e) { if (!e || e.code !== 'declined') { errors.add('Convert', item.name, e); alertInline(el, e); } }
  });
  $('conv-list').appendChild(el);
}
function alertInline(el, e) { const m = el.querySelector('.meta'); m.textContent = explain(e); m.style.color = 'var(--danger)'; }

async function convertItem(item) {
  const fmt = FORMATS[$('cfmt').value] || FORMATS.schem2;
  const base = safeName(item.name.replace(/\.[^.]+$/, ''));
  return { name: `${base}.${fmt.ext}`, data: await fmt.write(item.sch, { name: base }) };
}
$('conv-all').addEventListener('click', async () => {
  if (!convItems.length) return;
  const files = [];
  for (const it of convItems) {
    try { files.push({ ...(await convertItem(it)), category: it.category }); } catch (e) { errors.add('Convert', it.name, e); }
  }
  if (!files.length) return;
  try { $('conv-saved').textContent = savedMessage(await saveBuilds(files, 'schematics.zip')); }
  catch (e) { if (!e || e.code !== 'declined') errors.add('Save files', 'schematics.zip', e); }
});

// ---------------- web tab ----------------
let webLinks = [];
if (inArtifact()) {
  $('search-hint').innerHTML = 'Search needs to reach other websites, which this preview cannot do. Download Build Scraper and run <b>BuildScraper.exe</b> (or open <code>index.html</code>) to search.';
  $('web-note').innerHTML = 'This preview runs inside a sandbox that cannot reach other websites. Download <b>Build Scraper</b> and open <code>index.html</code> on your computer to use web links, or run <code>node mcbs.mjs fetch URL</code> from the download. Please follow each site\'s rules and only download builds you\'re allowed to use.';
}
function webStatus(msg, kind) { const s = $('web-status'); s.textContent = msg; s.className = `status${kind ? ' ' + kind : ''}`; }

$('web-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('web-url').value.trim();
  if (!url) return;
  $('web-list').innerHTML = ''; $('web-actions').hidden = true; webLinks = [];
  webStatus('Fetching…');
  try {
    const target = githubRaw(url);
    const r = await fetchBytes(target);
    if (looksLikeNbt(r.bytes) || looksLikeZip(r.bytes)) {
      await handleDownloaded(filenameFor(r.finalUrl, r.disposition), r.bytes, target);
      webStatus('Added to the Convert tab.', 'ok');
      return;
    }
    const html = new TextDecoder().decode(r.bytes);
    webLinks = findLinks(html, r.finalUrl);
    if (!webLinks.length) { webStatus('No schematic links found on that page. Some sites hide downloads behind buttons or logins; open the page and download the file yourself, then use the Convert tab.'); return; }
    webStatus(`Found ${webLinks.length} schematic link${webLinks.length > 1 ? 's' : ''}.`);
    renderWebLinks();
  } catch (err) {
    errors.add('Open link', url, err);
    webStatus(err.message === BLOCKED ? err.message : explain(err), 'err');
  }
});

function githubRaw(u) {
  try {
    const x = new URL(u);
    if (x.hostname === 'github.com' && x.pathname.includes('/blob/')) { x.hostname = 'raw.githubusercontent.com'; x.pathname = x.pathname.replace('/blob/', '/'); }
    return x.href;
  } catch { return u; }
}

function renderWebLinks() {
  $('web-actions').hidden = false;
  const list = $('web-list');
  list.innerHTML = '';
  webLinks.forEach((l, i) => {
    const el = document.createElement('label');
    el.className = 'item';
    el.innerHTML = `<input type="checkbox" checked data-i="${i}" id="wl-${i}"><div class="name">${esc(l.label)}</div><div class="meta">${esc(l.url)}</div><div class="acts"><span class="pill" id="wls-${i}">ready</span></div>`;
    list.appendChild(el);
  });
}
$('web-all').addEventListener('change', (e) => { for (const cb of $('web-list').querySelectorAll('input[type=checkbox]')) cb.checked = e.target.checked; });
$('web-fetch').addEventListener('click', async () => {
  const picks = [...$('web-list').querySelectorAll('input[type=checkbox]:checked')].map((cb) => +cb.dataset.i);
  let ok = 0;
  for (const i of picks) {
    const l = webLinks[i]; const pill = $(`wls-${i}`);
    pill.textContent = 'downloading';
    try {
      const r = await fetchBytes(l.url);
      const n = await handleDownloaded(filenameFor(r.finalUrl, r.disposition), r.bytes, l.url, guessCategory(l.label, l.url));
      if (!n) errors.add('Download', r.url, new Error('The download was not a schematic file (the site may want a login or show a download page first).'));
      if (!n) errors.add('Download', l.url, new Error('The download was not a schematic file (the site may want a login or show a download page first).'));
      pill.textContent = n ? 'added' : 'not a schematic'; if (n) ok++;
    } catch (e) { errors.add('Download', l.url, e); pill.textContent = e.message === BLOCKED ? 'blocked by site' : 'failed'; pill.title = explain(e); pill.classList.add('warn'); }
    await sleep(800); // be gentle with the site
  }
  webStatus(`${ok} of ${picks.length} added to the Convert tab.`, ok ? 'ok' : 'err');
});

async function handleDownloaded(name, bytes, source, category) {
  if (looksLikeZip(bytes)) {
    const z = await openZip(new Blob([bytes]));
    let n = 0;
    for (const p of z.paths.filter((p) => SCHEM_EXT.test(p) && !/\.zip$/i.test(p))) if (await addConvertBytes(p.split('/').pop(), await z.read(p), source, category)) n++;
    return n;
  }
  if (!looksLikeNbt(bytes)) return 0;
  if (!/\.(schem|schematic|litematic|nbt)$/i.test(name)) name += '.schematic';
  return (await addConvertBytes(name, bytes, source, category)) ? 1 : 0;
}

// ---------------- search ----------------
let searchResults = [];
let searchAbort = null;
if (hasHelper()) {
  $('search-hint').textContent = 'Running from BuildScraper.exe, so any site can be searched. Pages are read one at a time with a pause, and pages a site\'s robots.txt rules out are skipped. Put {q} in the address to start from the site\'s own search page.';
  $('web-note').textContent = 'Running from BuildScraper.exe: links are downloaded by the app on your computer, so sites that block web pages still work. Please follow each site\'s rules and only download builds you\'re allowed to use.';
}
$('search-src').addEventListener('change', (e) => { $('site-row').hidden = e.target.value !== 'site'; });
function searchStatus(msg, kind) { const s = $('search-status'); s.textContent = msg; s.className = `status${kind ? ' ' + kind : ''}`; }

$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const typed = $('search-q').value.trim();
  const cat = findCategory($('search-cat').value);
  if (!typed && !cat) { $('search-list').innerHTML = ''; $('search-actions').hidden = true; searchResults = []; searchStatus('Type what you are looking for, or pick a category.', 'err'); return; }
  // With only a category, search for its main word; with words too, keep results in that category.
  const q = typed || cat.query || cat.id;
  searchAbort?.abort();
  searchAbort = new AbortController();
  const signal = searchAbort.signal;
  $('search-list').innerHTML = ''; $('search-actions').hidden = true; searchResults = [];
  $('search-go').disabled = true; $('search-stop').hidden = false;
  try {
    if ($('search-src').value === 'github') {
      searchResults = await searchGitHub(q, { onProgress: searchStatus, signal });
      searchResults = byCategory(searchResults, cat, typed);
      searchStatus(searchResults.length ? `Found ${searchResults.length} file${searchResults.length > 1 ? 's' : ''} on GitHub. Check each project's license before using a build.` : 'Nothing on GitHub matched. Try fewer or broader words.', searchResults.length ? 'ok' : '');
    } else {
      const site = $('search-site').value.trim();
      if (!site) { searchStatus('Enter the website to search.', 'err'); return; }
      const { results, pages } = await searchSite(site, q, { maxPages: Math.min(200, Math.max(1, +$('search-pages').value || 25)), onProgress: searchStatus, signal, delay: hasHelper() ? 0 : 700 });
      searchResults = byCategory(results, cat, typed);
      searchStatus(results.length ? `Found ${results.length} file${results.length > 1 ? 's' : ''} after reading ${pages} page${pages > 1 ? 's' : ''}.` : `No matching schematic files in ${pages} page${pages > 1 ? 's' : ''}. Try the site's own search page with {q}, or more pages.`, results.length ? 'ok' : '');
    }
    renderSearch();
  } catch (err) {
    errors.add('Search', `"${q}" on ${$('search-src').value === 'github' ? 'GitHub' : $('search-site').value}`, err);
    const msg = err.message === BLOCKED ? err.message : explain(err);
    searchStatus(/rate limit|403/i.test(msg) && $('search-src').value === 'github' ? 'GitHub limits searches without an account to a few per minute. Wait a minute and try again.' : msg, 'err');
  } finally {
    $('search-go').disabled = false; $('search-stop').hidden = true;
  }
});
$('search-stop').addEventListener('click', () => searchAbort?.abort());
// Tag each result with a category. With a category picked, keep only files in that category
// (unless that would leave nothing, in which case everything is shown, tagged).
function byCategory(results, cat, typed) {
  for (const r of results) {
    const g = guessCategory(r.where, r.label);
    r.category = g !== OTHER ? g : cat ? cat.id : guessCategory(typed) ;
  }
  if (!cat || cat.id === OTHER) return results;
  const keep = results.filter((r) => inCategory(cat.id, r.where, r.label, r.page));
  return keep.length ? keep.map((r) => Object.assign(r, { category: cat.id })) : results;
}

function renderSearch() {
  const list = $('search-list');
  list.innerHTML = '';
  $('search-actions').hidden = !searchResults.length;
  searchResults.forEach((r, i) => {
    const el = document.createElement('label');
    el.className = 'item';
    const extra = [r.where, r.size ? `${(r.size / 1024).toFixed(0)} KB` : '', r.license && r.license !== 'NOASSERTION' ? `license ${r.license}` : ''].filter(Boolean).join(' · ');
    el.innerHTML = `<input type="checkbox" checked data-i="${i}"><div class="name">${esc(r.label)} <span class="pill cat">${esc(r.category || OTHER)}</span></div><div class="meta">${esc(extra)} · <a href="${esc(r.page || r.url)}" target="_blank" rel="noopener">open page</a></div><div class="acts"><span class="pill" id="sr-${i}">ready</span></div>`;
    list.appendChild(el);
  });
}
$('search-all').addEventListener('change', (e) => { for (const cb of $('search-list').querySelectorAll('input[type=checkbox]')) cb.checked = e.target.checked; });
$('search-fetch').addEventListener('click', async () => {
  const picks = [...$('search-list').querySelectorAll('input[type=checkbox]:checked')].map((cb) => +cb.dataset.i);
  let ok = 0;
  for (const i of picks) {
    const r = searchResults[i]; const pill = $(`sr-${i}`);
    pill.textContent = 'downloading';
    try {
      const f = await fetchBytes(r.url);
      const n = await handleDownloaded(filenameFor(f.finalUrl, f.disposition), f.bytes, r.url, r.category);
      if (!n) errors.add('Download', r.url, new Error('The download was not a schematic file (the site may want a login or show a download page first).'));
      pill.textContent = n ? 'added' : 'not a schematic'; if (n) ok++;
    } catch (e) { errors.add('Download', r.url, e); pill.textContent = e.message === BLOCKED ? 'blocked by site' : 'failed'; pill.title = explain(e); pill.classList.add('warn'); }
    if (!hasHelper()) await sleep(800);
  }
  searchStatus(`${ok} of ${picks.length} added to the Convert tab.`, ok ? 'ok' : 'err');
});

// ---------------- problems panel ----------------
// ---------------- 3D viewer tab ----------------
// The schematic viewer is inlined at build time (window.MCBS_VIEWER) and loaded into an
// iframe srcdoc on first use. srcdoc frames share this page's origin, so we can call its API.
let viewerP = null;
function getViewer() {
  if (viewerP) return viewerP;
  viewerP = new Promise((resolve, reject) => {
    const host = $('viewer-host');
    if (!window.MCBS_VIEWER) {
      host.innerHTML = '<p class="note">The 3D viewer is not included in this copy. Rebuild with <code>node tools/build.mjs</code>.</p>';
      return reject(new Error('The 3D viewer is not included in this copy.'));
    }
    const f = document.createElement('iframe');
    f.title = 'Schematic viewer';
    f.addEventListener('load', () => {
      const w = f.contentWindow;
      if (!w || !w.SchemViewer) {
        const e = new Error('The 3D viewer did not start. Your browser may have WebGL turned off.');
        errors.add('3D viewer', '', e);
        return reject(e);
      }
      hookViewer(w);
      resolve(w.SchemViewer);
    }, { once: true });
    f.srcdoc = window.MCBS_VIEWER;
    host.appendChild(f);
  });
  viewerP.catch(() => { viewerP = null; });
  return viewerP;
}
function hookViewer(w) {
  // Viewer problems also show up in this page's Problems list (and the .exe's log file).
  const P = w.Problems;
  if (P) {
    const fwd = (p) => { if (p && p.level === 'error') errors.add('3D viewer', p.file || '', Object.assign(new Error(p.message + (p.hint ? ` ${p.hint}` : '')), { stack: p.detail ? `Error\n${p.detail}` : '' })); };
    const report = P.report, fromError = P.fromError;
    P.report = function (level, file, message, hint, detail) { const r = report.apply(this, arguments); fwd({ level, file, message, hint, detail }); return r; };
    P.fromError = function () { const p = fromError.apply(this, arguments); fwd(p); return p; };
  }
  // Pages inside claude.ai cannot download files, so hide the viewer's own download buttons there.
  if (inArtifact()) for (const id of ['btnShot', 'btnCsv']) { const b = w.document.getElementById(id); if (b) b.hidden = true; }
}
async function viewIn3D(name, sch) {
  showTab('view');
  try {
    const v = await getViewer();
    const bytes = await FORMATS.schem2.write(sch, { name });
    await v.openBuffers([{ name: `${safeName(name)}.schem`, bytes }]);
  } catch (e) {
    if (!/not included|did not start/.test(e.message)) errors.add('3D viewer', name, e);
  }
}

// ---------------- build generator tab ----------------
// window.MCBS_GEN holds the schematics in ../minecraft build gen/output/schematics, inlined at build time.
// (Can run from the saved-tab restore above, before later top-level lets exist, so the flag lives on the element.)
async function renderGenerated() {
  const list = $('gen-list');
  if (list.dataset.shown) return;
  list.dataset.shown = '1';
  const files = window.MCBS_GEN || [];
  const status = $('gen-status');
  if (!files.length) { status.textContent = 'No generated builds were found when this page was built.'; return; }
  for (const f of files) {
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const el = document.createElement('div');
    el.className = 'item';
    try {
      const sch = await readAny(bytes, f.name);
      sch.normalizeAir();
      const solid = sch.materialCounts().filter(([n]) => n !== 'minecraft:air').reduce((n, [, c]) => n + c, 0);
      el.innerHTML = `<span class="pill">.schem</span><div class="name">${esc(f.name)}</div>
        <div class="meta">${sch.width} × ${sch.height} × ${sch.length} · ${fmtInt(solid)} blocks · ${sch.palette.length} block states</div>
        <div class="acts"><button class="btn small" data-act="view">View in 3D</button><button class="btn small" data-act="convert">Convert or save</button></div>`;
      el.querySelector('[data-act="view"]').addEventListener('click', () => viewIn3D(f.name.replace(/\.[^.]+$/, ''), sch));
      el.querySelector('[data-act="convert"]').addEventListener('click', async () => {
        await addConvertBytes(f.name, bytes, undefined, 'Houses');
        showTab('convert');
      });
    } catch (e) {
      errors.add('Build generator', f.name, e);
      el.innerHTML = `<span class="pill warn">error</span><div class="name">${esc(f.name)}</div><div class="meta" style="color:var(--danger)">${esc(explain(e))}</div>`;
    }
    list.appendChild(el);
  }
  status.textContent = `${files.length} build${files.length === 1 ? '' : 's'}.`;
}

function renderErrors() {
  const n = errors.count;
  const btn = $('err-btn');
  btn.hidden = n === 0;
  btn.textContent = `${n} problem${n === 1 ? '' : 's'}`;
  if (!n) { $('err-panel').hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  $('err-list').innerHTML = errors.entries.map((e) => `<li><div class="what">${esc(e.where)}${e.item ? `: ${esc(e.item)}` : ''}</div><div class="why">${esc(e.message)}</div>${e.detail && e.detail !== e.message || e.stack ? `<details><summary>Technical detail</summary><pre>${esc([e.detail !== e.message ? e.detail : '', e.stack].filter(Boolean).join('\n'))}</pre></details>` : ''}<div class="muted" style="font-size:12px">${e.time.toLocaleTimeString()}</div></li>`).join('');
}
errors.onChange(renderErrors);
function toggleErrors(open) {
  const p = $('err-panel');
  p.hidden = open === undefined ? !p.hidden : !open;
  $('err-btn').setAttribute('aria-expanded', String(!p.hidden));
}
$('err-btn').addEventListener('click', () => toggleErrors());
$('err-close').addEventListener('click', () => toggleErrors(false));
$('err-clear').addEventListener('click', () => errors.clear());
$('err-save').addEventListener('click', async () => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  try { await saveFiles([{ name: `build-scraper-errors-${stamp}.txt`, data: new TextEncoder().encode(errors.toText()) }]); }
  catch (e) { if (!e || e.code !== 'declined') console.error(e); }
});
$('err-copy').addEventListener('click', async (ev) => {
  const text = errors.toText();
  try { await navigator.clipboard.writeText(text); ev.target.textContent = 'Copied'; setTimeout(() => { ev.target.textContent = 'Copy'; }, 1500); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
});
window.addEventListener('error', (e) => { if (e.error) errors.add('Unexpected error', '', e.error); });
window.addEventListener('unhandledrejection', (e) => errors.add('Unexpected error', '', e.reason));
// In BuildScraper.exe, copy each problem into BuildScraper-errors.txt beside the app as well.
if (hasHelper()) {
  errors.onChange((e) => {
    if (!e) return;
    const line = `[${e.time.toISOString()}] ${e.where}${e.item ? `: ${e.item}` : ''} | ${e.message}${e.detail && e.detail !== e.message ? ` | ${e.detail}` : ''}`;
    fetch(`/api/log?t=${encodeURIComponent(window.MCBS_API.token)}`, { method: 'POST', body: line }).catch(() => {});
  });
}

// ---------------- categories (world tab) ----------------
// The category follows the file name ("castle-keep" -> Castles & Medieval) until the user picks one.
{
  const dl = document.createElement('datalist');
  dl.id = 'cat-list';
  dl.innerHTML = categoryIds().map((c) => `<option value="${esc(c)}"></option>`).join('');
  document.body.appendChild(dl);
  let picked = false;
  const sync = () => { if (!picked) $('cat').value = guessCategory($('name').value); };
  $('name').addEventListener('input', sync);
  $('cat').addEventListener('input', () => { picked = !!$('cat').value.trim(); });
  sync();
  const opts = CATEGORIES.map((c) => `<option value="${esc(c.id)}">${esc(c.id)}</option>`).join('');
  $('search-cat').insertAdjacentHTML('beforeend', opts);
  $('lib-cat').insertAdjacentHTML('beforeend', opts);
}

// ---------------- library tab (saved builds by category) ----------------
let libItems = [];
let libFilter = '';
function libStatus(msg, kind) { const s = $('lib-status'); s.textContent = msg; s.className = `status${kind ? ' ' + kind : ''}`; }
const fmtSize = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function libSetup() {
  const app = library.kind === 'app', folder = library.kind === 'folder';
  $('lib-open').hidden = !app;
  $('lib-change').hidden = !(app || folder);
  if (inArtifact() || library.kind === 'none') {
    $('lib-where').innerHTML = inArtifact()
      ? 'This preview cannot save to a folder. Download Build Scraper and run <b>BuildScraper.exe</b> to keep your builds sorted into category folders. Here, saving several builds downloads one .zip with a folder per category.'
      : 'Saving into category folders needs the Build Scraper app, or Chrome or Edge. In this browser, saving several builds downloads one .zip with a folder per category.';
    $('lib-tools').hidden = true;
    return false;
  }
  return true;
}

async function refreshLibrary() {
  if (!libSetup()) return;
  libraryDirty = false;
  try {
    if (!(await library.ready())) {
      $('lib-where').textContent = 'Choose a folder for your builds. Each category gets its own folder inside it.';
      $('lib-change').textContent = 'Choose folder';
      libItems = []; renderLibrary();
      return;
    }
    $('lib-change').textContent = 'Change folder';
    libStatus('Reading your builds…');
    libItems = await library.list();
    $('lib-where').innerHTML = `Builds are saved in <code>${esc(library.label())}</code>, one folder per category.`;
    libStatus('');
    renderLibrary();
  } catch (e) {
    errors.add('Library', library.label(), e);
    libStatus(explain(e), 'err');
  }
}

function libMatches(it, words) {
  // Searching "castle" also finds builds filed under Castles & Medieval, and the reverse.
  const text = `${it.name} ${it.category}`;
  return words.every((w) => {
    if (text.toLowerCase().includes(w)) return true;
    const g = guessCategory(w);
    return g !== OTHER && g === it.category;
  });
}

function renderLibrary() {
  const words = $('lib-q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const textHits = libItems.filter((it) => libMatches(it, words));
  // category chips with counts for the current text search
  const counts = new Map();
  for (const it of textHits) counts.set(it.category, (counts.get(it.category) || 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => a === UNSORTED ? 1 : b === UNSORTED ? -1 : a.localeCompare(b));
  if (libFilter && !counts.has(libFilter)) cats.unshift(libFilter);
  $('lib-chips').innerHTML = [`<button class="chip" data-c="" aria-pressed="${!libFilter}">All <b>${textHits.length}</b></button>`]
    .concat(cats.map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${libFilter === c}">${esc(c)} <b>${counts.get(c) || 0}</b></button>`)).join('');
  $('lib-cat').value = findCategory(libFilter) ? findCategory(libFilter).id : '';
  const shown = textHits.filter((it) => !libFilter || it.category === libFilter).sort((a, b) => b.mtime - a.mtime);
  const list = $('lib-list');
  list.innerHTML = '';
  if (!libItems.length) { list.innerHTML = '<p class="muted" style="margin:0">No saved builds yet. Use Save on the other tabs and they will show up here, sorted by category.</p>'; return; }
  if (!shown.length) { list.innerHTML = '<p class="muted" style="margin:0">Nothing matches. Try other words or another category.</p>'; return; }
  for (const it of shown.slice(0, 400)) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<span class="pill">.${esc(it.name.split('.').pop())}</span><div class="name">${esc(it.name)}</div>
      <div class="meta">${fmtSize(it.size)} · ${new Date(it.mtime).toLocaleDateString()} · </div>
      <div class="acts"><button class="btn small" data-act="view">View in 3D</button>${library.kind === 'app' ? '<button class="btn small" data-act="show">Show file</button>' : ''}</div>`;
    const cat = categoryInput(it.category === UNSORTED ? '' : it.category, `Move ${it.name} to category`);
    cat.placeholder = UNSORTED;
    cat.title = 'Type or pick a category to move this build there';
    cat.addEventListener('change', async () => {
      const to = cat.value.trim();
      if (!to || cleanCategory(to) === it.category) return;
      try { it.path = await library.move(it.path, to); it.category = it.path.split('/')[0]; it.name = it.path.split('/').pop(); libStatus(`Moved ${it.name} to ${it.category}.`, 'ok'); renderLibrary(); }
      catch (e) { errors.add('Move build', it.path, e); libStatus(explain(e), 'err'); }
    });
    el.querySelector('.meta').append(cat);
    el.querySelector('[data-act="view"]').addEventListener('click', async () => {
      try {
        const bytes = await library.read(it.path);
        showTab('view');
        const v = await getViewer();
        await v.openBuffers([{ name: it.name, bytes }]);
      } catch (e) { if (!/not included|did not start/.test(e.message)) { errors.add('Open build', it.path, e); libStatus(explain(e), 'err'); } }
    });
    el.querySelector('[data-act="show"]')?.addEventListener('click', () => library.reveal(it.path).catch((e) => errors.add('Show file', it.path, e)));
    list.appendChild(el);
  }
  if (shown.length > 400) list.insertAdjacentHTML('beforeend', `<p class="muted" style="margin:0">Showing the newest 400 of ${shown.length}. Search to narrow it down.</p>`);
}

$('lib-q').addEventListener('input', renderLibrary);
$('lib-cat').addEventListener('change', (e) => { libFilter = e.target.value; renderLibrary(); });
$('lib-chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { libFilter = b.dataset.c; renderLibrary(); } });
$('lib-refresh').addEventListener('click', refreshLibrary);
$('lib-open').addEventListener('click', () => library.reveal().catch((e) => { errors.add('Open folder', library.label(), e); libStatus(explain(e), 'err'); }));
$('lib-change').addEventListener('click', async () => {
  try {
    if (library.kind === 'app') {
      const dir = window.prompt('Folder to keep your builds in (it is created if it does not exist):', library.label());
      if (!dir || dir === library.label()) return;
      await library.choose(dir);
    } else if (!(await library.choose())) return;
    await refreshLibrary();
  } catch (e) { errors.add('Choose folder', '', e); libStatus(explain(e), 'err'); }
});
libSetup();
