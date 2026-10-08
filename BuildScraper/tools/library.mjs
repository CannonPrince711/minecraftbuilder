// The build library on disk for the local server: one folder per category under a root folder
// (default: Documents/Minecraft Builds). Paths from the page are "Category/file.schem" and are
// cleaned and checked so nothing can be written outside the root.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const SCHEM = /\.(schem|schematic|litematic|nbt)$/i;
const settingsFile = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.config'), 'BuildScraper', 'settings.json');

function defaultRoot() {
  const docs = path.join(os.homedir(), 'Documents');
  return path.join(fs.existsSync(docs) ? docs : os.homedir(), 'Minecraft Builds');
}
let root = null;
export function libraryRoot() {
  if (root) return root;
  root = process.env.MCBS_LIBRARY || '';
  if (!root) { try { root = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).library || ''; } catch {} }
  if (!root) root = defaultRoot();
  return root;
}
export function setLibraryRoot(dir) {
  const d = path.resolve(String(dir || '').trim().replace(/^"|"$/g, ''));
  if (!dir || !path.isAbsolute(d)) throw new Error('Type the full path of a folder, for example C:\\Users\\you\\Documents\\Minecraft Builds.');
  fs.mkdirSync(d, { recursive: true });
  root = d;
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify({ library: d }, null, 2)); } catch {}
  return d;
}

const cleanPart = (s) => {
  let c = String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(c)) c = `_${c}`;
  return c.slice(0, 120);
};
/** "Category/file.schem" -> safe absolute path inside the root (or throws). */
function resolveRel(rel, { file = true } = {}) {
  const parts = String(rel || '').split(/[\\/]+/).map(cleanPart).filter(Boolean);
  if (!parts.length || parts.length > 2) throw new Error('Bad library path.');
  if (file && !SCHEM.test(parts[parts.length - 1])) throw new Error('Only .schem, .schematic, .litematic and .nbt files go in the library.');
  const r = libraryRoot();
  const abs = path.join(r, ...parts);
  const back = path.relative(r, abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) throw new Error('Bad library path.');
  return { abs, parts };
}
const relOf = (abs) => path.relative(libraryRoot(), abs).split(path.sep).join('/');
function unique(abs) {
  if (!fs.existsSync(abs)) return abs;
  const { dir, name, ext } = path.parse(abs);
  for (let i = 2; ; i++) { const p = path.join(dir, `${name}-${i}${ext}`); if (!fs.existsSync(p)) return p; }
}

export function listLibrary() {
  const r = libraryRoot();
  const items = [];
  const add = (abs) => { const st = fs.statSync(abs); items.push({ path: relOf(abs), size: st.size, mtime: st.mtimeMs }); };
  let top = [];
  try { top = fs.readdirSync(r, { withFileTypes: true }); } catch { return { root: r, items }; }
  for (const e of top) {
    const p = path.join(r, e.name);
    if (e.isFile() && SCHEM.test(e.name)) add(p);
    else if (e.isDirectory()) for (const f of fs.readdirSync(p, { withFileTypes: true })) if (f.isFile() && SCHEM.test(f.name)) add(path.join(p, f.name));
  }
  return { root: r, items };
}
export function saveToLibrary(rel, bytes) {
  const { abs } = resolveRel(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const out = unique(abs);
  fs.writeFileSync(out, bytes, { flag: 'wx' });
  return relOf(out);
}
export const readFromLibrary = (rel) => fs.readFileSync(resolveRel(rel).abs);
export function moveInLibrary(rel, category) {
  const { abs } = resolveRel(rel);
  const dest = resolveRel(`${category}/${path.basename(abs)}`).abs;
  if (dest === abs) return relOf(abs);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = unique(dest);
  fs.renameSync(abs, out);
  return relOf(out);
}
export function revealInLibrary(rel) {
  const r = libraryRoot();
  fs.mkdirSync(r, { recursive: true });
  const target = rel ? resolveRel(rel).abs : r;
  const [cmd, args] = process.platform === 'win32' ? ['explorer', rel ? [`/select,${target}`] : [target]]
    : process.platform === 'darwin' ? ['open', rel ? ['-R', target] : [target]] : ['xdg-open', [rel ? path.dirname(target) : target]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
}
