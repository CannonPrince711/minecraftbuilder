// Working together with Build Scraper (pulls builds out of worlds / the web) and
// Schematic Viewer: find their .exe files, launch them, and list the schematic files
// Build Scraper saved to Downloads so they can be trained on.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSettings } from './settings.js';
import { decode } from './nbt.js';
import { SCHEMATIC_FILE } from './schematic-import.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Look for an exe in the configured folder, then next to this program (e.g. on the Desktop).
function findExe(exe, configured) {
  const roots = [configured, path.dirname(ROOT), path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Downloads')].filter(Boolean);
  const seen = new Set();
  const walk = (dir, depth) => {
    if (!dir || seen.has(dir) || depth < 0) return '';
    seen.add(dir);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
    const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === exe.toLowerCase());
    if (hit) return path.join(dir, hit.name);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const found = walk(path.join(dir, e.name), depth - 1);
      if (found) return found;
    }
    return '';
  };
  for (const r of roots) { const f = walk(r, 3); if (f) return f; }
  return '';
}

let cache = null;
export function companions(refresh = false) {
  if (cache && !refresh) return cache;
  const s = loadSettings();
  cache = {
    buildScraper: findExe('BuildScraper.exe', s.companionsDir),
    viewer: findExe('SchematicViewer.exe', s.companionsDir),
  };
  return cache;
}

export function launch(which, args = []) {
  const exe = companions()[which];
  if (!exe) throw new Error(`${which === 'viewer' ? 'SchematicViewer.exe' : 'BuildScraper.exe'} not found. Set its folder in Control Center -> Settings.`);
  spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return exe;
}

export function importDir() {
  return loadSettings().importDir || path.join(os.homedir(), 'Downloads');
}

// Who made a schematic file (Build Scraper writes "MC Build Scraper" as the author).
function authorOf(file) {
  try {
    if (fs.statSync(file).size > 8e6 || !/\.(schem|litematic)$/i.test(file)) return '';
    let buf = fs.readFileSync(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    const { value } = decode(buf);
    const root = value.Schematic ?? value;
    return root.Metadata?.Author ?? '';
  } catch { return ''; }
}

// How many schematic files a zip holds, reading only its central directory (no unpacking).
function schematicsInZip(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let end = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) return 0;
    const cdSize = tail.readUInt32LE(end + 12), cdOffset = tail.readUInt32LE(end + 16), count = tail.readUInt16LE(end + 10);
    if (cdSize > 16e6) return 0;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    let p = 0, n = 0;
    for (let k = 0; k < count && p + 46 <= cd.length; k++) {
      const nameLen = cd.readUInt16LE(p + 28), extra = cd.readUInt16LE(p + 30), comment = cd.readUInt16LE(p + 32);
      if (SCHEMATIC_FILE.test(cd.toString('utf8', p + 46, p + 46 + nameLen))) n++;
      p += 46 + nameLen + extra + comment;
    }
    return n;
  } catch { return 0; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Recent schematic files (and zips of them) in the import folder, newest first.
export function listImportable(limit = 40) {
  const dir = importDir();
  let names;
  try { names = fs.readdirSync(dir); } catch { return { dir, files: [] }; }
  const files = names
    .filter((n) => SCHEMATIC_FILE.test(n) || /\.zip$/i.test(n))
    .map((n) => { try { const st = fs.statSync(path.join(dir, n)); return st.isFile() ? { name: n, size: st.size, mtime: st.mtimeMs } : null; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .filter((f) => !/\.zip$/i.test(f.name) || (f.inside = schematicsInZip(path.join(dir, f.name))) > 0)
    .slice(0, limit);
  for (const f of files) {
    const author = authorOf(path.join(dir, f.name));
    f.fromBuildScraper = /build scraper/i.test(author);
    f.author = author;
  }
  return { dir, files };
}

// Read chosen files from the import folder (names only, no paths, so nothing outside it).
export function readImportable(names) {
  const dir = importDir();
  return names.map((n) => {
    const base = path.basename(String(n));
    return { filename: base, buffer: fs.readFileSync(path.join(dir, base)) };
  });
}
