import { attachViewer, topLayer } from './render.js';
import { getVersion, substitutions } from './lib/versions.js';
import { THEMES } from './lib/blocks.js';

const $ = (id) => document.getElementById(id);
const api = async (url, body) => {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

let opts = null;   // /api/options
const viewers = new Map(); // build name -> 3D viewer
let realism = {};  // slider values 0-100
let job = null;    // last generation result
const EXAMPLES = [
  '3 tall spruce watchtowers', 'a small cherry house with a gable roof', 'big egyptian pyramid',
  'a few oak archways', 'long castle wall', 'modern birch house', 'neat oak cottage with a hip roof',
];

// ---------- tabs ----------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${name}`; });
  if (name === 'train') { renderTrain(); loadLocal(); }
}

// ---------- settings ----------
const spec = () => opts.structures.find((s) => s.id === $('type').value);
const version = () => getVersion($('version').value);
const opt = (value, label = value) => el('option', { value, textContent: label });
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function fillRange(select, range, current) {
  select.replaceChildren(opt('', 'Any'));
  if (!range) return;
  const [lo, hi, step = 1] = range;
  for (let v = lo; v <= hi; v += step) select.append(opt(String(v)));
  if (current) select.value = String(snap(range, current));
}
function snap(range, v) {
  const [lo, hi, step = 1] = range;
  return lo + Math.round((Math.max(lo, Math.min(hi, v)) - lo) / step) * step;
}

function updateTypeFields(keep = {}) {
  const s = spec();
  $('variantField').hidden = !s.variants;
  $('variantField').firstChild.textContent = `${s.variantLabel} `;
  $('variant').replaceChildren(opt('', 'Any'), ...(s.variants ?? []).map((v) => opt(v, cap(v))));
  if (keep.variant && s.variants?.includes(keep.variant)) $('variant').value = keep.variant;
  $('theme').options[0].textContent = s.custom ? 'Your blocks' : 'Any';
  fillRange($('width'), s.size.w, keep.width);
  $('depthField').hidden = s.square || !s.size.d;
  fillRange($('depth'), s.size.d, keep.depth);
  $('heightField').hidden = !s.size.h;
  fillRange($('height'), s.size.h, keep.height);
  $('untrained').hidden = s.trained;
  $('untrainedText').textContent = s.training
    ? `${s.label} is training right now (${s.training.iter}/${s.training.total}). You can generate once it finishes.`
    : `The ${s.label.toLowerCase()} builder hasn't been trained yet. Training takes about 3 minutes.`;
  $('trainNowBtn').hidden = !!s.training;
}

function updateVersionNote() {
  const v = version();
  const theme = $('theme').value;
  let note = v.legacy
    ? `Minecraft ${v.label}: you get .schematic files (WorldEdit 6) and a functions folder, since 1.12 has no data packs.`
    : `Minecraft ${v.label}: you get .schem files (WorldEdit 7+) and a data pack (format ${v.format}).`;
  const themes = theme ? [theme] : Object.keys(THEMES);
  const subs = themes.map((t) => [t, substitutions(THEMES[t], v)]).filter(([, s]) => s.length);
  if (subs.length) {
    note += ' Not available in this version, so swapped: ' + subs.map(([t, s]) =>
      `${cap(t)} (${s.map(([a, b]) => `${a.replace(/_/g, ' ')} → ${b.replace(/_/g, ' ')}`).join(', ')})`).join('; ') + '.';
  }
  $('versionNote').textContent = note;
  $('tempLabel').textContent = tempWord();
  if (job) updateDownloads();
}
const tempWord = () => { const t = +$('temp').value; return t < 0.15 ? 'clean' : t < 0.45 ? 'balanced' : t < 0.75 ? 'varied' : 'wild'; };

async function init() {
  opts = await api('/api/options');
  // Versions grouped like 26.x / 1.21 / ... in one dropdown.
  const groups = new Map();
  for (const v of opts.versions) {
    if (!groups.has(v.group)) groups.set(v.group, el('optgroup', { label: v.group }));
    groups.get(v.group).append(opt(v.id, v.label));
  }
  $('version').replaceChildren(...groups.values());
  try { $('version').value = localStorage.getItem('mcVersion') || opts.latest; } catch { $('version').value = opts.latest; }
  if (!$('version').value) $('version').value = opts.latest;
  fillTypes();
  $('theme').replaceChildren(opt('', 'Any'), ...opts.themes.map((t) => opt(t.id, cap(t.id))));
  $('count').replaceChildren(...Array.from({ length: 24 }, (_, i) => opt(String(i + 1))));
  $('count').value = '6';
  $('examples').replaceChildren(...EXAMPLES.map((x) => el('button', {
    type: 'button', textContent: x,
    onclick: () => { $('prompt').value = x; applyPrompt().then(generate); },
  })));
  $('format').replaceChildren(...Object.entries(opts.formats).map(([k, f]) => opt(k, f.label)));
  try { $('format').value = localStorage.getItem('fileFormat') || 'auto'; } catch {}
  if (!$('format').value) $('format').value = 'auto';
  $('format').addEventListener('change', () => { try { localStorage.setItem('fileFormat', $('format').value); } catch {} if (job) updateDownloads(); });
  $('openScraper').hidden = !opts.companions.buildScraper;
  buildSliders();
  updateTypeFields();
  updateVersionNote();
  fillWorlds(opts.worlds);
}

function fillTypes() {
  const label = (s) => s.label + (s.trained ? '' : ' (not trained)');
  const own = opts.structures.filter((s) => s.custom);
  const builtIn = opts.structures.filter((s) => !s.custom);
  $('type').replaceChildren(
    el('optgroup', { label: 'Built-in' }, ...builtIn.map((s) => opt(s.id, label(s)))),
    ...(own.length ? [el('optgroup', { label: 'Your types' }, ...own.map((s) => opt(s.id, label(s))))] : []),
  );
}

// ---------- realism sliders ----------
const PRESET_NAMES = { clean: 'Clean (off)', 'lived-in': 'Lived-in', 'old village': 'Old village', overgrown: 'Overgrown', 'abandoned ruin': 'Abandoned ruin' };
const realismParam = () => opts.realism.map((r) => realism[r.key] ?? 0).join(',');

function buildSliders() {
  try { realism = JSON.parse(localStorage.getItem('realism')) || {}; } catch { realism = {}; }
  $('preset').replaceChildren(opt('custom', 'Custom'), ...Object.keys(opts.presets).map((k) => opt(k, PRESET_NAMES[k] ?? k)));
  $('sliders').replaceChildren(...opts.realism.map((r) => {
    const input = el('input', { type: 'range', min: 0, max: 100, step: 5, value: realism[r.key] ?? 0, id: `rs-${r.key}`, ariaLabel: r.label });
    const out = el('output', { textContent: realism[r.key] ?? 0 });
    input.addEventListener('input', () => { realism[r.key] = +input.value; out.textContent = input.value; syncPreset(); realismChanged(); });
    return el('label', { className: 'slider' }, el('span', { className: 'slider-head' }, r.label, out), input, el('small', { textContent: r.hint }));
  }));
  syncPreset();
  $('preset').addEventListener('change', () => {
    const p = opts.presets[$('preset').value];
    if (p) setRealism(p);
  });
}

function setRealism(values) {
  for (const r of opts.realism) {
    realism[r.key] = values[r.key] ?? 0;
    $(`rs-${r.key}`).value = realism[r.key];
    $(`rs-${r.key}`).parentElement.querySelector('output').textContent = realism[r.key];
  }
  syncPreset();
  realismChanged();
}

function syncPreset() {
  const match = Object.entries(opts.presets).find(([, p]) => opts.realism.every((r) => (p[r.key] ?? 0) === (realism[r.key] ?? 0)));
  $('preset').value = match ? match[0] : 'custom';
}

let realismTimer;
function realismChanged() {
  try { localStorage.setItem('realism', JSON.stringify(realism)); } catch {}
  if (!job) return;
  updateDownloads();
  clearTimeout(realismTimer);
  realismTimer = setTimeout(async () => {
    const forJob = job.job;
    try {
      const r = await api('/api/realism', { job: forJob, realism });
      if (!job || job.job !== forJob) return;
      for (const { name, deco, fell } of r.builds) {
        const b = job.builds.find((x) => x.name === name);
        if (b) { b.deco = deco; b.fell = fell; }
        viewers.get(name)?.refresh();
      }
    } catch (err) { toast(err.message); }
  }, 200);
}

// ---------- prompt ----------
let parseTimer;
$('prompt').addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(applyPrompt, 250); });
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('promptForm').requestSubmit(); } });

async function applyPrompt() {
  const text = $('prompt').value.trim();
  if (!text) { $('understood').replaceChildren(); return; }
  const { parsed: p } = await api('/api/parse', { prompt: text });
  $('type').value = p.type;
  updateTypeFields({ variant: p.variant, width: p.width, depth: p.depth, height: p.height });
  $('theme').value = p.theme ?? '';
  $('count').value = String(p.count ?? 6);
  if (p.temp !== undefined) $('temp').value = p.temp;
  if (p.realism) setRealism(p.realism);
  updateVersionNote();
  $('unknownHint').hidden = !p.unknown;
  if (p.unknown) $('unknownText').textContent = `I don't know how to build a "${p.unknown}" yet, so this will make a house. Upload a few ${p.unknown} schematics and it will learn.`;
  $('understood').replaceChildren(
    el('span', { className: 'lead', textContent: 'Understood:' }),
    ...p.understood.map((u) => el('span', { className: 'chip' }, el('b', { textContent: u.key }), u.value)),
  );
}

$('type').addEventListener('change', () => updateTypeFields());
$('version').addEventListener('change', () => { try { localStorage.setItem('mcVersion', $('version').value); } catch {} updateVersionNote(); });
$('theme').addEventListener('change', updateVersionNote);
$('temp').addEventListener('input', () => { $('tempLabel').textContent = tempWord(); });
$('promptForm').addEventListener('submit', async (e) => { e.preventDefault(); if ($('prompt').value.trim()) await applyPrompt(); generate(); });

// ---------- generate ----------
async function generate() {
  const s = spec();
  if (!s.trained) { $('untrained').hidden = false; $('untrained').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const btn = $('generateBtn');
  btn.disabled = true; btn.textContent = 'Building…';
  try {
    job = await api('/api/generate', {
      type: s.id, version: $('version').value, theme: $('theme').value, variant: $('variant').value,
      width: $('width').value, depth: $('depth').value, height: $('height').value,
      count: $('count').value, temp: $('temp').value, realism,
    });
    renderResults();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Generate';
  }
}

function updateDownloads() {
  const v = version(), fmt = $('format').value;
  const ext = fmt === 'litematic' ? 'litematic' : fmt === 'nbt' ? 'nbt' : v.legacy ? 'schematic' : 'schem';
  const rq = `&r=${realismParam()}&f=${fmt}`;
  $('dlSchems').href = `/api/download/${job.job}/schems.zip?v=${v.id}${rq}`;
  $('dlSchems').textContent = `Download all .${ext} (zip)`;
  $('dlPack').href = `/api/download/${job.job}/pack.zip?v=${v.id}${rq}`;
  $('dlPack').textContent = v.legacy ? 'Download functions (zip)' : 'Download data pack';
  $('resultsSub').textContent = `For Minecraft ${v.label}. Change the version above and the downloads follow.`;
  $('installHint').textContent = v.legacy
    ? 'Copies the functions into <world>/data/functions/rlbuild. Then /reload in game.'
    : 'Copies the data pack into <world>/datapacks. Then /reload in game.';
  document.querySelectorAll('[data-schem]').forEach((a) => {
    a.href = `/api/download/${job.job}/${a.dataset.schem}.${ext}?v=${v.id}${rq}`;
    a.textContent = `.${ext}`;
  });
}

function renderResults() {
  const s = opts.structures.find((x) => x.id === job.builds[0].type);
  $('empty').hidden = true;
  $('resultsHead').hidden = false;
  $('installCard').hidden = false;
  $('resultsTitle').textContent = `${job.builds.length} × ${s.label.toLowerCase()}`;
  viewers.clear();
  $('results').replaceChildren(...job.builds.map((b) => buildCard(b)));
  $('dojoStatus').hidden = true;
  updateDownloads();
  $('resultsHead').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildCard(b) {
  const m = b.metrics;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const chips = [
    m.doors !== null && `door${m.doors === 1 ? '' : 's'} ${m.doors}`,
    m.enclosure !== null && `enclosed ${pct(m.enclosure)}`,
    m.windowRatio !== null && `windows ${pct(m.windowRatio)}`,
    m.roofCoverage !== null && `roof ${pct(m.roofCoverage)}`,
    m.symmetry !== null && `symmetry ${pct(m.symmetry)}`,
    m.strayBlocks && `strays ${m.strayBlocks}`,
  ].filter(Boolean);
  const size = `${b.w}×${b.d}${b.h ? ` · height ${b.h}` : ''}`;
  const canvas = el('canvas', { ariaLabel: `3D preview of ${b.name}` });
  const top = topLayer(b, job.dims);
  const slider = el('input', { type: 'range', min: 0, max: top, value: top, ariaLabel: 'Visible layers' });
  const rotate = el('button', { type: 'button', textContent: '↻', title: 'Rotate' });
  const cmd = el('button', { type: 'button', className: 'copy-cmd', textContent: `/function rlbuild:${b.name}`, title: 'Copy command' });
  const fellChip = el('span', { className: 'fell', title: 'Blocks the Physics slider made fall (no support)' });
  const showFell = () => { fellChip.textContent = `physics: ${b.fell} fell`; fellChip.hidden = !b.fell; };
  showFell();
  const viewBtn = el('button', { type: 'button', textContent: 'Viewer', title: 'Open in Schematic Viewer', hidden: !opts.companions.viewer });
  viewBtn.onclick = () => api('/api/viewer', { job: job.job, name: b.name, version: $('version').value, realism, format: $('format').value })
    .then(() => toast('Opening Schematic Viewer…')).catch((err) => toast(err.message));
  const dl = el('a', { className: 'button primary', download: '' });
  dl.dataset.schem = b.name;
  const card = el('article', { className: 'card build', id: `card-${b.name}` },
    el('header', {},
      el('h3', { textContent: `${b.label} #${b.id}` }),
      el('span', { className: 'score', textContent: `${m.score}` }, el('span', { className: 'muted', textContent: '/100' }))),
    el('div', { className: 'muted', textContent: `${size}${b.variant ? ` · ${b.variant} ${b.variantLabel.toLowerCase()}` : ''} · ${b.theme.startsWith('custom_') ? 'your blocks' : b.theme}` }),
    canvas,
    el('div', { className: 'viewer-controls' }, rotate, el('span', { textContent: 'Layers' }), slider),
    el('div', { className: 'chips' }, ...chips.map((c) => el('span', { textContent: c })), fellChip),
    el('footer', {}, dl, viewBtn, cmd),
  );
  queueMicrotask(() => {
    const viewer = attachViewer(canvas, b, job.dims);
    rotate.onclick = () => viewer.rotate();
    slider.oninput = () => viewer.setSlice(+slider.value);
    viewers.set(b.name, {
      refresh() {
        showFell();
        const t = topLayer(b, job.dims), atTop = +slider.value >= +slider.max;
        slider.max = t;
        if (atTop) { slider.value = t; viewer.setSlice(t); } else viewer.draw();
      },
    });
  });
  cmd.onclick = () => { navigator.clipboard?.writeText(cmd.textContent); toast('Command copied'); };
  return card;
}

// ---------- WorldEdit ----------
$('weBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/worldedit', { job: job.job, version: $('version').value, realism });
    toast(`Copied ${r.files.length} schematics to WorldEdit. In game: ${r.command} then //paste`);
  } catch (err) { toast(err.message); }
});

// ---------- MineDojo ----------
$('dojoBtn').addEventListener('click', async () => {
  const status = $('dojoStatus');
  status.hidden = false;
  status.className = 'dojo-status';
  status.textContent = 'Starting MineDojo… the first start can take a few minutes.';
  $('dojoBtn').disabled = true;
  const forJob = job.job;
  try {
    await api('/api/minedojo', { job: forJob, prompt: $('prompt').value, realism });
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!job || job.job !== forJob) return;
      const s = await api(`/api/minedojo?job=${forJob}`);
      if (s.tail.length) status.textContent = `MineDojo: ${s.tail.at(-1)}`;
      if (!s.done) continue;
      if (s.error) throw new Error(s.error);
      showDojo(forJob, s.result);
      status.textContent = `MineCLIP ranked these against "${s.result.prompt}". Best match first.`;
      return;
    }
  } catch (err) {
    status.className = 'dojo-status err';
    status.replaceChildren(`MineDojo didn't run: ${err.message} `, el('a', { href: '#help-minedojo', textContent: 'Setup guide', onclick: () => showTab('help') }));
  } finally {
    $('dojoBtn').disabled = false;
  }
});

$('doctorBtn').addEventListener('click', async () => {
  const out = $('doctorOut');
  out.hidden = false;
  out.textContent = 'Checking… (starting WSL can take a moment)';
  const r = await api('/api/minedojo/doctor').catch((e) => ({ ok: false, lines: [], error: e.message }));
  out.textContent = [...r.lines, r.ok ? '' : (r.error ? `\n${r.error}` : '')].join('\n').trim() || 'No output';
});

function showDojo(jobId, result) {
  const ranked = Object.entries(result.builds).sort((a, b) => b[1].clip - a[1].clip);
  ranked.forEach(([name, r], i) => {
    const card = document.getElementById(`card-${name}`);
    if (!card) return;
    card.querySelector('.dojo')?.remove();
    const src = (f) => `/api/minedojo-img/${jobId}/${f}`;
    const main = el('img', { className: 'main', src: src(r.images[0]), alt: `MineDojo render of ${name}` });
    const thumbs = r.images.map((f, k) => {
      const t = el('img', { src: src(f), alt: `View ${k + 1}`, className: k ? '' : 'on' });
      t.onclick = () => { main.src = t.src; thumbs.forEach((x) => x.classList.toggle('on', x === t)); };
      return t;
    });
    const head = el('div', { className: 'chips' }, el('span', { textContent: `MineCLIP match ${r.clip.toFixed(3)}` }));
    if (i === 0) head.prepend(el('span', { className: 'best', textContent: 'Best prompt match' }));
    card.querySelector('canvas').before(el('div', { className: 'dojo' }, main, el('div', { className: 'thumbs' }, ...thumbs), head));
    $('results').append(card); // re-append in ranked order
  });
}

// ---------- install ----------
function fillWorlds(worlds) {
  $('world').replaceChildren(...(worlds.length
    ? worlds.map((w) => opt(w.path, w.name))
    : [opt('', 'No worlds found. Use the option below.')]));
}
$('savesBtn').addEventListener('click', async () => {
  try {
    const { worlds } = await api('/api/worlds', { savesDir: $('savesDir').value.trim() });
    fillWorlds(worlds);
    toast(worlds.length ? `Found ${worlds.length} world${worlds.length > 1 ? 's' : ''}` : 'No worlds in that folder');
  } catch (err) { toast(err.message); }
});
$('installBtn').addEventListener('click', async () => {
  const status = $('installStatus');
  status.className = 'status';
  status.textContent = 'Installing…';
  try {
    const r = await api('/api/install', { job: job.job, version: $('version').value, world: $('world').value, realism });
    status.className = 'status ok';
    status.textContent = `Installed to ${r.installed}. In game: /reload, then /function rlbuild:list`;
  } catch (err) {
    status.className = 'status err';
    status.textContent = err.message;
  }
});

// ---------- your own schematics ----------
$('teachBtn').addEventListener('click', () => {
  showTab('train');
  const word = $('unknownText').textContent.match(/"([^"]+)"/)?.[1] ?? '';
  $('customName').value = word ? word[0].toUpperCase() + word.slice(1) : '';
  $('customName').focus();
});
const dz = $('dropzone');
let chosen = [];
const setFiles = (list) => {
  chosen = [...list].filter((f) => /\.(schem|schematic|litematic|nbt|zip)$/i.test(f.name));
  $('dropText').textContent = chosen.length ? `${chosen.length} file${chosen.length > 1 ? 's' : ''}: ${chosen.map((f) => f.name).join(', ')}` : 'Drop schematic files here, or click to choose';
};
$('customFiles').addEventListener('change', (e) => setFiles(e.target.files));
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); setFiles(e.dataTransfer.files); });

const toBase64 = (file) => file.arrayBuffer().then((buf) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});

let lastUpload = null;
$('uploadBtn').addEventListener('click', async () => {
  const status = $('uploadStatus');
  status.className = 'status';
  if (!$('customName').value.trim()) { status.className = 'status err'; status.textContent = 'Give this kind of build a name first.'; return; }
  if (!chosen.length) { status.className = 'status err'; status.textContent = 'Choose some .schem, .schematic or .nbt files.'; return; }
  status.textContent = 'Reading schematics…';
  try {
    const files = await Promise.all(chosen.map(async (f) => ({ filename: f.name, data: await toBase64(f) })));
    const r = await api('/api/custom/upload', { name: $('customName').value.trim(), files });
    lastUpload = r;
    status.className = 'status ok';
    status.textContent = `Added ${r.added.length} example${r.added.length === 1 ? '' : 's'} to "${r.label}" (${r.total} in total).` +
      (r.errors.length ? ` Skipped: ${r.errors.map((e) => `${e.filename} (${e.error})`).join(', ')}` : '');
    showUpload(r);
    renderTrain();
  } catch (err) {
    status.className = 'status err';
    status.textContent = err.message;
  }
});

function showUpload(r) {
  $('uploadResult').hidden = false;
  const [GX, GY, GZ] = [11, 12, 11];
  $('uploadPreview').replaceChildren(...r.added.map((e) => {
    // Place the example at the lot origin so the shared renderer can draw it.
    const g = new Array(GX * GY * GZ).fill('0');
    for (let y = 0; y < e.h; y++) for (let z = 0; z < e.d; z++) for (let x = 0; x < e.w; x++) g[(y * GZ + z) * GX + x] = e.grid[(y * e.d + z) * e.w + x];
    const canvas = el('canvas', { ariaLabel: `Preview of ${e.filename}` });
    const card = el('div', { className: 'card example' }, canvas,
      el('b', { textContent: e.filename }),
      el('span', { className: 'muted', textContent: e.scaled ? `${e.original.join('×')} scaled to ${e.w}×${e.h}×${e.d}` : `${e.w}×${e.h}×${e.d}` }));
    queueMicrotask(() => attachViewer(canvas, { grid: g.join(''), colors: r.theme.colors }, [GX, GY, GZ]));
    return card;
  }));
  const t = r.theme;
  $('themeInfo').textContent = `Your materials: walls ${t.wall}, base ${t.foundation}, pillars ${t.pillar}, windows ${t.window}, roof ${t.roofStyle === 'full' ? t.roofFull : t.roofStairs}, door ${t.door}.`;
}
$('trainCustomBtn').addEventListener('click', () => lastUpload && startTrain(lastUpload.id, 200));

// Files Build Scraper saved (Downloads, or the folder set in the Control Center).
const fmtSize = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
async function loadLocal() {
  try {
    const r = await api('/api/importable');
    $('localDir').textContent = r.dir;
    $('localDir').title = r.dir;
    $('localUse').hidden = !r.files.length;
    $('localList').replaceChildren(...(r.files.length ? r.files.map((f) => el('label', {},
      el('input', { type: 'checkbox', value: f.name }),
      el('span', { textContent: f.name }),
      ...(f.fromBuildScraper ? [el('span', { className: 'from', textContent: 'Build Scraper' })] : []),
      el('span', { className: 'meta', textContent: `${f.inside ? `${f.inside} inside · ` : ''}${fmtSize(f.size)} · ${new Date(f.mtime).toLocaleDateString()}` }),
    )) : [el('p', { className: 'empty-note', textContent: 'No schematic files here yet. Save some from Build Scraper (or drop files above).' })]));
  } catch (err) { $('localList').replaceChildren(el('p', { className: 'empty-note', textContent: err.message })); }
}
$('localRefresh').addEventListener('click', loadLocal);
$('openScraper').addEventListener('click', () => api('/api/launch', { which: 'buildScraper' }).then(() => toast('Opening Build Scraper…')).catch((e) => toast(e.message)));
$('localUse').addEventListener('click', async () => {
  const status = $('uploadStatus');
  const files = [...$('localList').querySelectorAll('input:checked')].map((i) => i.value);
  status.className = 'status';
  if (!$('customName').value.trim()) { status.className = 'status err'; status.textContent = 'Give this kind of build a name first (above).'; $('customName').focus(); return; }
  if (!files.length) { status.className = 'status err'; status.textContent = 'Tick at least one file.'; return; }
  status.textContent = 'Reading schematics…';
  try {
    const r = await api('/api/custom/import-local', { name: $('customName').value.trim(), files });
    lastUpload = r;
    status.className = 'status ok';
    status.textContent = `Added ${r.added.length} example${r.added.length === 1 ? '' : 's'} to "${r.label}" (${r.total} in total).` +
      (r.errors.length ? ` Skipped: ${r.errors.map((e) => `${e.filename} (${e.error})`).join(', ')}` : '');
    showUpload(r);
    renderTrain();
  } catch (err) { status.className = 'status err'; status.textContent = err.message; }
});

// ---------- training ----------
$('trainNowBtn').addEventListener('click', () => startTrain(spec().id, 200));

async function startTrain(type, iters) {
  try {
    await api('/api/train', { type, iters });
    toast(`Training ${type}…`);
    await refreshOptions();
    showTab('train');
  } catch (err) { toast(err.message); }
}

let pollTimer = null;
async function refreshOptions() {
  const keep = $('type').value;
  opts = { ...opts, structures: (await api('/api/options')).structures };
  fillTypes();
  $('type').value = opts.structures.some((s) => s.id === keep) ? keep : opts.structures[0].id;
  updateTypeFields({ variant: $('variant').value, width: +$('width').value, depth: +$('depth').value, height: +$('height').value });
}

async function renderTrain() {
  const status = await api('/api/train');
  await refreshOptions();
  $('trainGrid').replaceChildren(...opts.structures.map((s) => trainCard(s, status[s.id])));
  const running = Object.values(status).some((t) => !t.done);
  clearTimeout(pollTimer);
  if (running && !$('tab-train').hidden) pollTimer = setTimeout(renderTrain, 1500);
}

function trainCard(s, t) {
  const running = t && !t.done;
  const badge = running ? el('span', { className: 'badge', textContent: `Training ${t.iter}/${t.total}` })
    : s.trained ? el('span', { className: 'badge ok', textContent: `Trained · score ${s.lastScore ?? '–'}` })
      : el('span', { className: 'badge', textContent: 'Not trained' });
  const iters = el('select', {}, ...[[100, 'Quick (100 iterations, ~1.5 min)'], [200, 'Standard (200, ~3 min)'], [400, 'Long (400, ~6 min)']].map(([v, l]) => opt(String(v), l)));
  iters.value = '200';
  const btn = el('button', { className: s.trained ? '' : 'primary', textContent: s.trained ? 'Retrain' : 'Train', disabled: running });
  btn.onclick = () => startTrain(s.id, +iters.value);
  const del = el('button', { className: 'danger', textContent: 'Delete', type: 'button', disabled: running });
  del.onclick = async () => {
    if (!confirm(`Delete "${s.label}" and its trained model?`)) return;
    try { await api('/api/custom/delete', { id: s.id }); toast(`Deleted ${s.label}`); renderTrain(); } catch (err) { toast(err.message); }
  };
  const title = el('h2', { textContent: s.label });
  if (s.custom) title.append(' ', el('span', { className: 'badge', textContent: 'yours' }));
  const kids = [
    el('header', {}, title, badge),
    el('p', { className: 'muted', textContent: s.description, style: 'margin:0' }),
    el('div', { className: 'train-row' }, iters, btn, ...(s.custom ? [del] : [])),
  ];
  if (t) {
    kids.push(el('div', { className: 'progress' }, el('div', { style: `width:${(100 * t.iter / t.total).toFixed(1)}%` })));
    if (t.scores.length > 1) kids.push(sparkline(t.scores));
    if (t.error) kids.push(el('p', { className: 'status err', textContent: t.error }));
    kids.push(el('pre', { className: 'log', textContent: t.tail.join('\n') }));
  }
  return el('article', { className: 'card train-card' }, ...kids);
}

function sparkline(scores) {
  const W = 300, H = 48;
  const pts = scores.map((v, i) => `${(i / (scores.length - 1)) * W},${H - 2 - (v / 100) * (H - 4)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Score during training, now ${scores.at(-1)}`);
  svg.innerHTML = `<polyline fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts}"><title>score ${scores.at(-1)}</title></polyline>`;
  return svg;
}

window.addEventListener('hashchange', () => { if (['#train', '#help', '#create'].includes(location.hash)) showTab(location.hash.slice(1)); });
init().then(() => {
  if (['#train', '#help'].includes(location.hash)) showTab(location.hash.slice(1));
  // Quick build from the Control Center: /?prompt=...
  const p = new URLSearchParams(location.search).get('prompt');
  if (p) {
    history.replaceState(null, '', '/');
    $('prompt').value = p;
    applyPrompt().then(generate);
  }
}).catch((err) => toast(`Could not start: ${err.message}`));
