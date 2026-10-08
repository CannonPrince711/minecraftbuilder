// Turn a plain-English prompt ("3 tall spruce watchtowers") into generator settings.
// Keyword based and fully local: it picks out structure, theme, roof, size and count,
// and reports what it understood so the UI can show it.

import { STRUCTURES } from './structures/index.js';

const TYPE_WORDS = [
  ['wall', /\b(castle wall|city wall|walls?|ramparts?|fortifications?|battlements?|palisades?)\b/],
  ['arch', /\b(arch(way)?s?|gates?|gateways?|portals?|torii|entrances?)\b/],
  ['pyramid', /\b(pyramids?|ziggurats?|temples?|mastabas?)\b/],
  ['tower', /\b(towers?|watchtowers?|turrets?|lookouts?|keeps?|spires?|castles?|forts?)\b/],
  ['house', /\b(houses?|homes?|cottages?|cabins?|huts?|villas?|shacks?|sheds?|buildings?|bungalows?|lodges?)\b/],
];
const THEME_WORDS = [
  ['cherry', /\b(cherry|pink|japanese|sakura|blossoms?)\b/],
  ['desert', /\b(desert|sand|sandstone|egypt(ian)?|arabian|dunes?)\b/],
  ['spruce', /\b(spruce|dark|nordic|viking|taiga|winter|snowy|rustic)\b/],
  ['birch', /\b(birch|white|light|bright|scandinavian|pale)\b/],
  ['oak', /\b(oak|wood(en)?|classic|medieval|village)\b/],
];
const ROOF_WORDS = [
  ['hip', /\b(hip(ped)?|pyramid roof|four.sided)\b/],
  ['gable', /\b(gabled?|pitched|a.frame|pointy|pointed|slanted|sloped)\b/],
  ['flat', /\b(flat|modern|minimalist?)\b/],
];
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, couple: 2, few: 3, several: 4 };

export function parsePrompt(text) {
  let s = ` ${String(text || '').toLowerCase()} `;
  const out = { understood: [] };
  const say = (k, v) => out.understood.push({ key: k, value: String(v) });

  // Roof first, so "pyramid roof" doesn't become a pyramid.
  for (const [roof, re] of ROOF_WORDS) if (re.test(s)) { out.variant = roof; s = s.replace(re, ' '); break; }

  // Your own uploaded types win when their name appears ("windmill" -> your Windmill type).
  for (const sp of Object.values(STRUCTURES)) {
    if (sp.custom && sp.keywords.some((k) => new RegExp(`\\b${k}(e?s)?\\b`).test(s))) {
      out.type = sp.id;
      // Words of the type's own name ("Cherry Cottage") are not theme or size words.
      for (const k of sp.keywords) s = s.replace(new RegExp(`\\b${k}(e?s)?\\b`, 'g'), ` ${sp.id}s `);
      break;
    }
  }
  if (!out.type) for (const [type, re] of TYPE_WORDS) if (re.test(s)) { out.type = type; break; }
  if (!out.type) {
    out.type = 'house';
    // Name the thing we don't know yet so the UI can suggest teaching it.
    const known = /\b(a|an|the|with|and|of|in|on|some|small|big|large|tall|short|wide|narrow|tiny|huge|roof|style|built|made|build|me|please|make|create)\b/g;
    const leftover = s.replace(known, ' ').replace(/[^a-z ]/g, ' ').trim().split(/\s+/).filter((w) => w.length > 3 && !THEME_WORDS.some(([, re]) => re.test(` ${w} `)));
    if (leftover.length) out.unknown = leftover.at(-1);
  }
  const spec = STRUCTURES[out.type];
  say('Structure', spec.label + (out.unknown ? ` (no "${out.unknown}" type yet)` : ''));
  if (out.variant && !spec.variants) delete out.variant;
  if (out.variant) say(spec.variantLabel ?? 'Style', out.variant);

  for (const [theme, re] of THEME_WORDS) if (re.test(s)) { out.theme = theme; break; }
  if (!out.theme && out.type === 'pyramid') out.theme = 'desert';
  if (out.theme) say('Theme', out.theme);

  // How many: a number shortly before a plural structure word ("3 tall towers", "a few huts").
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < words.length && !out.count; i++) {
    const n = /^\d+$/.test(words[i]) ? +words[i] : NUMBER_WORDS[words[i]];
    if (!(n > 1)) continue;
    for (let j = i + 1; j <= i + 4 && j < words.length; j++) {
      const plural = words[j].endsWith('s') && (TYPE_WORDS.some(([, re]) => re.test(` ${words[j]} `)) ||
        Object.values(STRUCTURES).some((sp) => sp.custom && sp.keywords.some((k) => words[j].startsWith(k))));
      if (plural) {
        out.count = Math.min(24, n);
        s = s.replace(new RegExp(`\\b${words[i]}\\b`), ' ');
        say('How many', out.count);
        break;
      }
    }
  }

  // Explicit sizes: "7x9", "7 by 9", "6 tall", "9 wide".
  const range = (k) => spec.size[k] ?? null;
  const dims = s.match(/\b(\d{1,2})\s*(?:x|×|by)\s*(\d{1,2})\b/);
  if (dims) { out.width = +dims[1]; if (!spec.square) out.depth = +dims[2]; s = s.replace(dims[0], ' '); }
  const tall = s.match(/\b(\d{1,2})\s*(?:blocks?\s*)?(?:tall|high)\b/);
  if (tall && range('h')) { out.height = +tall[1]; s = s.replace(tall[0], ' '); }
  const wide = s.match(/\b(\d{1,2})\s*(?:blocks?\s*)?wide\b/);
  if (wide) { out.width = +wide[1]; s = s.replace(wide[0], ' '); }

  // Size words map to the ends of the structure's allowed ranges.
  const lo = (k) => range(k)?.[0], hi = (k) => range(k)?.[1];
  if (/\b(tiny|small|little|mini|compact)\b/.test(s)) { out.width ??= lo('w'); out.depth ??= lo('d'); out.height ??= lo('h'); say('Size', 'small'); }
  if (/\b(big|large|huge|giant|grand|massive|enormous)\b/.test(s)) { out.width ??= hi('w'); out.depth ??= hi('d'); out.height ??= hi('h'); say('Size', 'large'); }
  if (/\b(tall|high|towering)\b/.test(s)) { out.height ??= hi('h'); say('Height', 'tall'); }
  if (/\b(short|low|squat|stubby)\b/.test(s)) { out.height ??= lo('h'); say('Height', 'short'); }
  if (/\b(wide|long|broad)\b/.test(s)) { out.width ??= hi('w'); say('Width', 'wide'); }
  if (/\b(narrow|thin|slim|skinny)\b/.test(s)) { out.width ??= lo('w'); say('Width', 'narrow'); }
  if (/\bdeep\b/.test(s)) { out.depth ??= hi('d'); }
  for (const k of ['width', 'depth', 'height']) if (out[k] == null) delete out[k];
  if (spec.square) delete out.depth;
  if (dims || tall || wide) say('Size', [out.width && `${out.width} wide`, out.depth && `${out.depth} deep`, out.height && `${out.height} tall`].filter(Boolean).join(', '));

  // Realism words set the realism sliders (0-100); unmentioned sliders go to 0.
  const REALISM_WORDS = [
    ['realistic', /\b(realistic|real|lifelike|believable)\b/, { weathering: 25, variety: 50, details: 65, interior: 60, nature: 35, physics: 50 }],
    ['detailed', /\b(detailed|decorated|fancy|ornate)\b/, { details: 85, variety: 45 }],
    ['furnished', /\b(furnished|cozy|cosy|lived.in|homely|inhabited)\b/, { interior: 85, details: 65 }],
    ['weathered', /\b(old|ancient|weathered|mossy|aged|worn)\b/, { weathering: 70, variety: 45 }],
    ['overgrown', /\b(overgrown|lush|vines?|garden|flowery)\b/, { nature: 85 }],
    ['ruined', /\b(ruin(ed|s)?|abandoned|destroyed|broken|crumbling|haunted|derelict)\b/, { ruin: 55, weathering: 75, nature: 60, details: 10, interior: 10, physics: 60 }],
    ['collapsed', /\b(collapsed|collapsing|caved|caving|sagging|unstable)\b/, { ruin: 45, physics: 95, weathering: 50 }],
    ['sturdy', /\b(sturdy|solid|stable|physics|physical)\b/, { physics: 70 }],
    ['textured', /\b(textured|gradient|mixed)\b/, { variety: 75 }],
  ];
  for (const [name, re, vals] of REALISM_WORDS) {
    if (!re.test(s)) continue;
    out.realism ??= {};
    for (const [k, v] of Object.entries(vals)) out.realism[k] = Math.max(out.realism[k] ?? 0, v);
    say('Realism', name);
  }

  if (/\b(random|varied|creative|wild|chaotic|unique|different)\b/.test(s)) { out.temp = 0.6; say('Variety', 'high'); }
  if (/\b(clean|neat|perfect|tidy|simple|plain)\b/.test(s)) { out.temp = 0.05; say('Variety', 'low'); }
  return out;
}
