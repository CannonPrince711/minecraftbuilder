// The build library: a folder on the user's computer with one sub-folder per category,
// e.g. "Minecraft Builds/Castles & Medieval/big-keep.schem".
//  - In the Build Scraper app (BuildScraper.exe or `mcbs serve`) the app reads and writes the
//    folder for us through /api/library (default: Documents/Minecraft Builds).
//  - In Chrome or Edge opened from a file, the user picks the folder once (File System Access).
//  - Elsewhere there is no library: saving downloads a .zip with the category folders inside.
import { cleanCategory } from './categories.js';

export const SCHEM_FILE = /\.(schem|schematic|litematic|nbt)$/i;
export const UNSORTED = 'Unsorted';
const API = typeof window !== 'undefined' ? window.MCBS_API : null;

function apiUrl(path, params = {}) {
  return `/api/library${path}?${new URLSearchParams({ ...params, t: API.token })}`;
}
async function apiJson(path, params, init) {
  const r = await fetch(apiUrl(path, params), init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `The app answered ${r.status}`);
  return body;
}

// ---- folder handle (Chrome/Edge) kept in IndexedDB so it survives reloads ----
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('mcbs', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const loadHandle = () => idb('readonly', (s) => s.get('library')).catch(() => null);
const storeHandle = (h) => idb('readwrite', (s) => s.put(h, 'library')).catch(() => {});

async function permitted(h, ask) {
  const opts = { mode: 'readwrite' };
  if ((await h.queryPermission(opts)) === 'granted') return true;
  return ask ? (await h.requestPermission(opts)) === 'granted' : false;
}

const splitName = (n) => { const m = n.match(/^(.*?)(\.[^.]+)?$/); return [m[1], m[2] || '']; };
const cleanFile = (n) => n.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120) || 'build.schem';

async function fsExists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}
async function fsUnique(dir, name) {
  const [base, ext] = splitName(name);
  let n = name, i = 2;
  while (await fsExists(dir, n)) n = `${base}-${i++}${ext}`;
  return n;
}

export const library = {
  kind: API ? 'app' : (typeof window !== 'undefined' && 'showDirectoryPicker' in window && window.top === window.self ? 'folder' : 'none'),
  handle: null,
  root: '',

  /** Is there a folder to save into right now (without asking anything)? */
  async ready() {
    if (this.kind === 'app') {
      if (!this.root) { try { this.root = (await apiJson('', { only: 'root' })).root; } catch { return false; } }
      return true;
    }
    if (this.kind === 'folder') {
      if (!this.handle) this.handle = await loadHandle();
      return !!this.handle && permitted(this.handle, false);
    }
    return false;
  },

  /** Where builds are saved, for display. */
  label() {
    if (this.kind === 'app') return this.root;
    if (this.kind === 'folder') return this.handle ? this.handle.name : '';
    return '';
  },

  /** Make sure a folder is chosen and allowed. Call from a click so the browser may ask. */
  async connect({ choose = false } = {}) {
    if (this.kind === 'app') return this.ready();
    if (this.kind !== 'folder') return false;
    if (!this.handle) this.handle = await loadHandle();
    if (choose || !this.handle) {
      try { this.handle = await window.showDirectoryPicker({ id: 'mcbs-library', mode: 'readwrite', startIn: 'documents' }); }
      catch (e) { if (e && e.name !== 'AbortError') console.warn('Folder picker failed', e); return false; }
      await storeHandle(this.handle);
    }
    return permitted(this.handle, true);
  },

  /** Change the library folder. In the app, `dir` is a folder path typed by the user. */
  async choose(dir) {
    if (this.kind === 'app') {
      this.root = (await apiJson('/root', { dir }, { method: 'POST' })).root;
      return true;
    }
    return this.connect({ choose: true });
  },

  /** Save one build. Returns its path inside the library, e.g. "Towers/spire.schem". */
  async save(category, name, bytes) {
    const cat = cleanCategory(category);
    const file = cleanFile(name);
    if (this.kind === 'app') return (await apiJson('/save', { path: `${cat}/${file}` }, { method: 'POST', body: bytes })).path;
    if (!(await this.connect())) throw Object.assign(new Error('No library folder was chosen.'), { code: 'declined' });
    const dir = await this.handle.getDirectoryHandle(cat, { create: true });
    const n = await fsUnique(dir, file);
    const w = await (await dir.getFileHandle(n, { create: true })).createWritable();
    await w.write(bytes); await w.close();
    return `${cat}/${n}`;
  },

  /** Everything in the library: [{ path, category, name, size, mtime }]. */
  async list() {
    if (this.kind === 'app') {
      const r = await apiJson('');
      this.root = r.root;
      return r.items.map(withCategory);
    }
    if (!(await this.connect())) return [];
    const out = [];
    for await (const [name, h] of this.handle.entries()) {
      if (h.kind === 'file' && SCHEM_FILE.test(name)) out.push(await fileInfo(h, name));
      else if (h.kind === 'directory') {
        for await (const [n2, h2] of h.entries()) if (h2.kind === 'file' && SCHEM_FILE.test(n2)) out.push(await fileInfo(h2, `${name}/${n2}`));
      }
    }
    return out.map(withCategory);
  },

  async read(path) {
    if (this.kind === 'app') {
      const r = await fetch(apiUrl('/file', { path }));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Could not read ${path}`);
      return new Uint8Array(await r.arrayBuffer());
    }
    const f = await (await this.fsFile(path)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  },

  /** Move a build to another category folder. Returns its new path. */
  async move(path, category) {
    const cat = cleanCategory(category);
    if (this.kind === 'app') return (await apiJson('/move', { path, to: cat }, { method: 'POST' })).path;
    const parts = path.split('/');
    const from = parts.length > 1 ? await this.handle.getDirectoryHandle(parts[0]) : this.handle;
    const name = parts[parts.length - 1];
    const bytes = await this.read(path);
    const dir = await this.handle.getDirectoryHandle(cat, { create: true });
    const n = await fsUnique(dir, name);
    const w = await (await dir.getFileHandle(n, { create: true })).createWritable();
    await w.write(bytes); await w.close();
    await from.removeEntry(name);
    return `${cat}/${n}`;
  },

  /** Show the library folder (or one file in it) in Explorer. App only. */
  async reveal(path = '') {
    if (this.kind === 'app') await apiJson('/open', { path }, { method: 'POST' });
  },

  async fsFile(path) {
    const parts = path.split('/');
    let dir = this.handle;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    return dir.getFileHandle(parts[parts.length - 1]);
  },
};

async function fileInfo(h, path) {
  const f = await h.getFile();
  return { path, size: f.size, mtime: f.lastModified };
}
function withCategory(it) {
  const parts = it.path.split('/');
  return { ...it, name: parts[parts.length - 1], category: parts.length > 1 ? parts[0] : UNSORTED };
}
