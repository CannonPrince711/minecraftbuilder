// Program settings (settings.json in the project folder), edited from the Control Center.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'settings.json');

const DEFAULTS = {
  defaultVersion: '',     // '' = latest
  worldeditDir: '',       // '' = auto-detect
  minedojoPython: '',     // '' = MINEDOJO_PYTHON env var, or ~/minedojo in WSL on Windows
  openBuilderOnStart: false,
  companionsDir: '',      // '' = look for BuildScraper.exe / SchematicViewer.exe near this program
  importDir: '',          // '' = your Downloads folder (where Build Scraper saves files)
};

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}

export function saveSettings(patch) {
  const next = { ...loadSettings() };
  for (const k of Object.keys(DEFAULTS)) if (k in patch) next[k] = typeof DEFAULTS[k] === 'boolean' ? !!patch[k] : String(patch[k] ?? '').trim();
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

// Usual WorldEdit schematics folders (singleplayer Forge/Fabric install).
export function worldeditDir() {
  const s = loadSettings();
  if (s.worldeditDir) return s.worldeditDir;
  const mc = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'minecraft') : path.join(os.homedir(), '.minecraft');
  const dir = path.join(mc, 'config', 'worldedit', 'schematics');
  return fs.existsSync(path.dirname(dir)) ? dir : '';
}
