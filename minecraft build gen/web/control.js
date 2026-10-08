// Control Center: program status, models, folders, worlds, settings and activity.

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const api = async (url, body) => {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
let toastTimer;
function toast(msg) {
  $('toast').textContent = msg; $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtUptime = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? 'just started' : m < 60 ? `up ${m} min` : `up ${Math.floor(m / 60)} h ${m % 60} min`; };

const ICON = {
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  cube: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z M12 12 20 7.5 M12 12 4 7.5 M12 12v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10v1a3 3 0 0 0 1 5.5V17a3 3 0 0 0 4 2.8M15 4a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 2.5v1a3 3 0 0 1-1 5.5V17a3 3 0 0 1-4 2.8M12 5v14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  globe: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  pickaxe: '<path d="M4 9c4-5 12-5 16 0M12 7l-6 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  user: '<circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

const FOLDERS = [
  ['output', 'Output', 'cube', 'Latest command-line builds'],
  ['schematics', 'Schematics', 'cube', '.schem files from the command line'],
  ['worldedit', 'WorldEdit', 'pickaxe', 'Where "Send to WorldEdit" copies to'],
  ['saves', 'Minecraft saves', 'globe', 'Your worlds'],
  ['models', 'Models', 'brain', 'Trained agents'],
  ['custom', 'Your types', 'user', 'Learned from your schematics'],
];

let settingsLoaded = false;

async function refresh() {
  let s;
  try {
    s = await api('/api/status');
  } catch {
    $('statusPill').className = 'pill down';
    $('statusText').textContent = 'Program not running. Start it with start.bat';
    return;
  }
  $('statusPill').className = 'pill ok';
  $('statusText').textContent = `Running · ${fmtUptime(s.uptime)}`;

  const trained = s.structures.filter((x) => x.trained).length;
  $('statTrained').textContent = `${trained} / ${s.structures.length}`;
  $('statTrainedSub').textContent = s.structures.some((x) => x.custom) ? `${s.structures.filter((x) => x.custom).length} of them yours` : 'built-in types';
  $('statBuilds').textContent = s.buildsMade;
  $('statWorlds').textContent = s.worlds.length;
  $('statWorldsSub').textContent = s.worlds.length ? 'in the default saves folder' : 'none in the default location';
  $('statDisk').textContent = fmtBytes(s.sizes.models + s.sizes.output + s.sizes.custom);

  renderModels(s);
  renderFolders(s);
  renderCompanions(s);
  renderWorlds(s);
  renderActivity(s);
  renderSystem(s);
  if (!settingsLoaded) { fillSettings(s); settingsLoaded = true; }
}

function renderModels(s) {
  $('modelList').replaceChildren(...s.structures.map((m) => {
    const t = s.training[m.id];
    const running = t && !t.done;
    const badge = running ? el('span', { className: 'badge', textContent: `Training ${t.iter}/${t.total}` })
      : m.trained ? el('span', { className: 'badge ok', textContent: `Score ${m.lastScore ?? '–'}` })
        : el('span', { className: 'badge', textContent: 'Not trained' });
    const btn = el('button', { textContent: m.trained ? 'Retrain' : 'Train', disabled: !!running, className: m.trained ? '' : 'primary' });
    btn.onclick = () => train(m.id);
    const info = el('div', {},
      el('div', { className: 'name', textContent: m.label + (m.custom ? ' · yours' : '') }),
      el('div', { className: 'desc', textContent: m.description }));
    if (running) info.append(el('div', { className: 'progress' }, el('div', { style: `width:${(100 * t.iter / t.total).toFixed(1)}%` })));
    if (t?.error) info.append(el('div', { className: 'desc danger', textContent: t.error }));
    return el('div', { className: 'model' }, info, badge, btn);
  }));
  $('trainMissingBtn').disabled = s.structures.every((m) => m.trained || (s.training[m.id] && !s.training[m.id].done));
}

async function train(id) {
  try { await api('/api/train', { type: id, iters: 200 }); toast(`Training started (about 3 minutes)`); refresh(); } catch (e) { toast(e.message); }
}
$('trainMissingBtn').addEventListener('click', async () => {
  const s = await api('/api/status');
  const missing = s.structures.filter((m) => !m.trained && !(s.training[m.id] && !s.training[m.id].done));
  for (const m of missing) await api('/api/train', { type: m.id, iters: 200 }).catch((e) => toast(e.message));
  toast(missing.length ? `Training ${missing.length} type${missing.length > 1 ? 's' : ''}` : 'Everything is trained');
  refresh();
});

function renderFolders(s) {
  $('folderGrid').replaceChildren(...FOLDERS.map(([key, label, icon, hint]) => {
    const f = s.folders[key];
    const b = el('button', { className: 'folder', type: 'button', title: f.path || hint, disabled: !f.path });
    b.innerHTML = `${svg(icon)}<span><b></b><small></small></span>`;
    b.querySelector('b').textContent = label;
    b.querySelector('small').textContent = f.path ? (f.exists ? f.path : `${hint} (created when used)`) : 'Not found. Set it in Settings';
    b.onclick = () => api('/api/open', { what: key }).catch((e) => toast(e.message));
    return b;
  }));
}

function renderCompanions(s) {
  const items = [
    ['buildScraper', 'Build Scraper', 'pickaxe', 'Pull builds out of worlds, find them online, convert files'],
    ['viewer', 'Schematic Viewer', 'cube', 'Look at any schematic in 3D'],
  ];
  $('companionList').replaceChildren(...items.map(([key, label, icon, what]) => {
    const exe = s.companions[key];
    const row = el('div', { className: `companion${exe ? '' : ' missing'}` });
    row.innerHTML = svg(icon);
    row.append(el('div', {}, el('b', { textContent: label }), el('small', { textContent: exe || `Not found. Set its folder in Settings. (${what})`, title: exe || what })));
    const b = el('button', { textContent: 'Open', type: 'button', disabled: !exe, className: exe ? 'primary' : '' });
    b.onclick = () => api('/api/launch', { which: key }).then(() => toast(`Opening ${label}…`)).catch((e) => toast(e.message));
    row.append(b);
    return row;
  }));
  $('importInfo').textContent = `Looks for saved schematics in ${s.importDir}`;
}

function renderWorlds(s) {
  if (!s.worlds.length) {
    $('worldList').replaceChildren(el('p', { className: 'muted', textContent: 'No worlds in the default Minecraft folder. Other launchers keep worlds elsewhere; the Builder\'s install box can search any saves folder.' }));
    return;
  }
  $('worldList').replaceChildren(...s.worlds.map((w) => {
    const b = el('button', { textContent: 'Open folder', type: 'button' });
    b.onclick = () => api('/api/open', { what: 'world', path: w.path }).catch((e) => toast(e.message));
    return el('div', { className: 'world' }, el('span', { textContent: w.name }), b);
  }));
}

let lastActivity = '';
function renderActivity(s) {
  const key = s.activity.map((a) => a.t).join();
  if (key === lastActivity) return;
  lastActivity = key;
  const list = $('activity');
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 20;
  list.replaceChildren(...(s.activity.length ? s.activity.map((a) => el('li', { className: a.kind },
    el('time', { textContent: new Date(a.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }),
    el('span', { className: 'k' }),
    el('span', { textContent: a.msg }))) : [el('li', { className: 'empty-line', textContent: 'Nothing yet. Make some builds!' })]));
  $('activityCount').textContent = s.activity.length ? `${s.activity.length} event${s.activity.length === 1 ? '' : 's'}` : '';
  if (atBottom) list.scrollTop = list.scrollHeight;
}

function renderSystem(s) {
  const rows = [
    ['Program', `v${s.version}`],
    ['Node.js', s.node],
    ['Address', `http://localhost:${s.port}`],
    ['Models', fmtBytes(s.sizes.models)],
    ['Output', fmtBytes(s.sizes.output)],
  ];
  $('sysinfo').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
}

function fillSettings(s) {
  $('setVersion').replaceChildren(el('option', { value: '', textContent: 'Latest' }), ...s.versions.map((v) => el('option', { value: v.id, textContent: v.label })));
  $('setVersion').value = s.settings.defaultVersion;
  $('setWorldedit').value = s.settings.worldeditDir;
  $('worldeditHint').textContent = s.folders.worldedit.path && !s.settings.worldeditDir ? `Found: ${s.folders.worldedit.path}` : 'Singleplayer: .minecraft\\config\\worldedit\\schematics';
  $('setPython').value = s.settings.minedojoPython;
  $('setBuilderFirst').checked = s.settings.openBuilderOnStart;
  $('setCompanions').value = s.settings.companionsDir;
  $('setImport').value = s.settings.importDir;
}

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/settings', {
      defaultVersion: $('setVersion').value, worldeditDir: $('setWorldedit').value,
      minedojoPython: $('setPython').value, openBuilderOnStart: $('setBuilderFirst').checked,
      companionsDir: $('setCompanions').value, importDir: $('setImport').value,
    });
    $('settingsStatus').className = 'status ok';
    $('settingsStatus').textContent = 'Saved';
    setTimeout(() => { $('settingsStatus').textContent = ''; }, 2500);
    settingsLoaded = false;
    refresh();
  } catch (err) {
    $('settingsStatus').className = 'status err';
    $('settingsStatus').textContent = err.message;
  }
});

$('guideBtn').addEventListener('click', () => api('/api/open', { what: 'guide' }).catch((e) => toast(e.message)));
$('dojoCheckBtn').addEventListener('click', async () => {
  const out = $('dojoOut');
  out.hidden = false;
  out.textContent = 'Checking… (starting WSL can take a moment)';
  const r = await api('/api/minedojo/doctor').catch((e) => ({ ok: false, lines: [], error: e.message }));
  out.textContent = [...r.lines, r.ok ? '' : (r.error ? `\n${r.error}` : '')].join('\n').trim() || 'No output';
});

$('quickForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = $('quickPrompt').value.trim();
  location.href = p ? `/?prompt=${encodeURIComponent(p)}` : '/';
});

$('quitBtn').addEventListener('click', async () => {
  if (!confirm('Stop the RL Build Generator? Any training in progress will stop too.')) return;
  await api('/api/quit', {}).catch(() => {});
  document.body.innerHTML = '<main class="cc"><div class="card" style="margin-top:40px;text-align:center"><h1>Stopped</h1><p class="muted">You can close this window. Start again with start.bat.</p></div></main>';
  setTimeout(() => window.close(), 800);
});

refresh();
setInterval(refresh, 2000);
