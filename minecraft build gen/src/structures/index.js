// Registry of structure types: the five built-ins plus any custom types learned from
// uploaded schematics (custom/*.json). To hand-write a new type: copy one of these
// files, change zone() (and size/variants), import it here, then
// `node src/train.js --type <id>`.
import house from './house.js';
import tower from './tower.js';
import pyramid from './pyramid.js';
import arch from './arch.js';
import wall from './wall.js';
import { THEMES } from '../blocks.js';
import { loadDefs, makeCustomSpec, themeId } from '../custom.js';

export const BUILT_IN = { house, tower, pyramid, arch, wall };
export const STRUCTURES = { ...BUILT_IN };

// Re-read custom/*.json (after an upload or delete).
export function reloadCustom() {
  for (const [id, s] of Object.entries(STRUCTURES)) {
    if (s.custom) { delete STRUCTURES[id]; delete THEMES[themeId(id)]; }
  }
  for (const def of loadDefs()) {
    STRUCTURES[def.id] = makeCustomSpec(def);
    THEMES[themeId(def.id)] = def.theme;
  }
}
reloadCustom();

export function getStructure(id) {
  const s = STRUCTURES[id];
  if (!s) throw new Error(`Unknown structure "${id}". Pick one of: ${Object.keys(STRUCTURES).join(', ')}`);
  return s;
}
