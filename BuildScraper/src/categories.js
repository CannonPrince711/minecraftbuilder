// Build categories: used to sort saved builds into folders and to search by category.
// A build's category is guessed from its file name, where it came from and what was searched
// for; the user can always change it (or type a new one).

export const OTHER = 'Other';

// `query` is what a category search looks for when no words are typed; `words` are matched
// against names and paths (a word also matches its plural, e.g. "house" matches "houses").
export const CATEGORIES = [
  { id: 'Houses', query: 'house', words: ['house', 'home', 'cottage', 'cabin', 'hut', 'villa', 'mansion', 'starter', 'farmhouse', 'barn', 'bungalow', 'treehouse', 'manor', 'residence'] },
  { id: 'Castles & Medieval', query: 'castle', words: ['castle', 'medieval', 'keep', 'fort', 'fortress', 'citadel', 'palace', 'kingdom', 'tavern', 'inn', 'blacksmith', 'village', 'viking', 'gatehouse'] },
  { id: 'Towers', query: 'tower', words: ['tower', 'lighthouse', 'spire', 'windmill', 'watchtower', 'belltower', 'minaret'] },
  { id: 'Modern & City', query: 'modern', words: ['modern', 'city', 'skyscraper', 'apartment', 'office', 'shop', 'store', 'mall', 'hospital', 'school', 'station', 'hotel', 'building', 'suburban', 'contemporary'] },
  { id: 'Fantasy', query: 'fantasy', words: ['fantasy', 'elven', 'elf', 'dwarf', 'dwarven', 'wizard', 'mage', 'magic', 'dragon', 'floating', 'temple', 'shrine', 'ruin', 'portal', 'steampunk'] },
  { id: 'Ships & Vehicles', query: 'ship', words: ['ship', 'boat', 'pirate', 'galleon', 'airship', 'submarine', 'car', 'train', 'plane', 'airplane', 'vehicle', 'tank', 'spaceship', 'rocket', 'yacht', 'helicopter'] },
  { id: 'Farms', query: 'farm', words: ['farm', 'crop', 'wheat', 'grinder', 'sugarcane', 'pumpkin', 'melon', 'breeder', 'xp', 'spawner', 'trap', 'harvester'] },
  { id: 'Redstone', query: 'redstone', words: ['redstone', 'piston', 'contraption', 'machine', 'circuit', 'sorter', 'elevator', 'tnt', 'cannon', 'calculator', 'computer', 'flying machine', 'hidden door'] },
  { id: 'Statues & Pixel Art', query: 'statue', words: ['statue', 'pixel', 'pixelart', 'sculpture', 'monument', 'bust', 'figure', 'logo', 'mural'] },
  { id: 'Nature & Trees', query: 'tree', words: ['tree', 'oak', 'birch', 'spruce', 'jungle', 'willow', 'sakura', 'cherry', 'bush', 'rock', 'mountain', 'terrain', 'island', 'garden', 'park', 'volcano', 'waterfall', 'forest'] },
  { id: 'Bridges & Roads', query: 'bridge', words: ['bridge', 'road', 'path', 'tunnel', 'railway', 'rail', 'highway', 'aqueduct'] },
  { id: 'Interiors & Decor', query: 'interior', words: ['interior', 'decor', 'decoration', 'furniture', 'kitchen', 'bedroom', 'room', 'fountain', 'well', 'lamp', 'stall', 'market', 'gazebo', 'statue base'] },
  { id: OTHER, query: '', words: [] },
];

export const categoryIds = () => CATEGORIES.map((c) => c.id);
export const findCategory = (id) => CATEGORIES.find((c) => c.id.toLowerCase() === String(id || '').toLowerCase());

const norm = (s) => ' ' + String(s || '').toLowerCase()
  .replace(/%20|[_\-./\\()[\]{}+,]+/g, ' ')
  .replace(/([a-z])([0-9])/g, '$1 $2')
  .replace(/\s+/g, ' ') + ' ';

// A word matches at the start of a word, optionally followed by a plural ending.
const reCache = new Map();
function wordRe(w) {
  let re = reCache.get(w);
  if (!re) { re = new RegExp(` ${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)? `); reCache.set(w, re); }
  return re;
}

/** How strongly the text points at each category: [[id, score], ...] best first, only matches. */
export function scoreCategories(...texts) {
  const t = norm(texts.filter(Boolean).join(' '));
  const out = [];
  for (const c of CATEGORIES) {
    let s = 0;
    for (const w of c.words) if (wordRe(w).test(t)) s += w.includes(' ') ? 2 : 1;
    if (s) out.push([c.id, s]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

/** Best category for a build from its name, path or source; "Other" when nothing matches. */
export function guessCategory(...texts) {
  const best = scoreCategories(...texts)[0];
  return best ? best[0] : OTHER;
}

/** Does this text belong to the category? (Used to filter search results.) */
export function inCategory(id, ...texts) {
  const c = findCategory(id);
  if (!c || c.id === OTHER) return true;
  return scoreCategories(...texts).some(([k]) => k === c.id);
}

/** A category name made safe to use as a folder name on Windows, macOS and Linux. */
export function cleanCategory(s) {
  let c = String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  if (!c) c = OTHER;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(c)) c = `_${c}`;
  return c.slice(0, 60);
}
