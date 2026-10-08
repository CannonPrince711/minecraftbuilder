// Generate structures with a trained policy and export them (command-line version of the web app).
//   node src/generate.js --prompt "3 tall spruce watchtowers" --mc 1.20
//   node src/generate.js --type house --count 8 --roof gable --theme oak --mc 1.12.2 --world "My World"
// Options: --type house|tower|pyramid|arch|wall  --count N  --temp 0..1  --tries N  --seed N
//          --width N --depth N --height N --variant|--roof NAME --theme NAME
//          --mc VERSION (default: latest)  --out DIR  --world NAME  --saves DIR  --minedojo
//          --format auto|schem3|litematic|nbt   (file type for output/schematics)
//          --realism "lived-in" | "old village" | "overgrown" | "abandoned ruin" | "clean"
//                    or seven numbers 0-100: weathering,variety,details,interior,nature,ruin,physics

import fs from 'node:fs';
import path from 'node:path';
import { generateBuilds, findWorlds, listWorlds, loadLog } from './generator.js';
import { getStructure } from './structures/index.js';
import { getVersion, LATEST } from './versions.js';
import { parsePrompt } from './prompt.js';
import { parseArgs } from './cli.js';
import { functionPackage, writePackage, installPackage, schematicFile, writeGallery } from './export.js';
import { runMineDojo } from './minedojo.js';
import { parseRealism, withRealism, decoFor, KEYS } from './realism.js';

const args = parseArgs(process.argv.slice(2), {
  prompt: '', type: '', count: 0, temp: -1, seed: Date.now() % 100000, tries: 4, out: 'output',
  width: 0, depth: 0, height: 0, roof: '', variant: '', theme: '', mc: LATEST, world: '', saves: '', minedojo: false, realism: '', format: 'auto',
});

const p = args.prompt ? parsePrompt(args.prompt) : {};
if (args.prompt) console.log(`Prompt understood: ${p.understood.map((u) => `${u.key}: ${u.value}`).join(' | ')}`);
const type = args.type || p.type || 'house';
const spec = getStructure(type);
const version = getVersion(String(args.mc));
const brief = {
  width: args.width || p.width, depth: args.depth || p.depth, height: args.height || p.height,
  variant: args.variant || args.roof || p.variant, theme: args.theme || p.theme,
};

// Realism: --realism wins, else words in the prompt ("abandoned", "furnished"...).
const realism = parseRealism(args.realism || p.realism || '');
if (KEYS.some((k) => realism[k])) console.log(`Realism: ${KEYS.map((k) => `${k} ${realism[k]}`).join(', ')}`);

let builds;
try {
  builds = generateBuilds(type, {
    count: args.count || p.count || 8, temp: args.temp >= 0 ? args.temp : p.temp ?? 0.3, tries: args.tries, seed: args.seed, brief,
  });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

for (const b of builds) {
  const t = b.target, m = b.metrics;
  const extra = [
    m.doors !== null && `doors ${m.doors}`, m.windowRatio !== null && `windows ${(m.windowRatio * 100).toFixed(0)}%`,
    m.symmetry !== null && `sym ${(m.symmetry * 100).toFixed(0)}%`, `strays ${m.strayBlocks}`,
  ].filter(Boolean).join(' ');
  console.log(`${b.name.padEnd(10)} ${t.w}x${t.d}${t.h ? ` h${t.h}` : ''} ${(t.variant ?? '').padEnd(5)} ${t.theme.padEnd(6)} score ${m.score} | ${extra}`);
}

if (args.minedojo) {
  console.log('\nScoring in MineDojo (real Minecraft + MineCLIP)... this can take a few minutes.');
  try {
    const res = await runMineDojo(builds, args.prompt || `a minecraft ${spec.label.toLowerCase()}`, path.resolve(args.out, 'minedojo'), (line) => console.log(`  ${line}`));
    builds.sort((a, b) => (res.builds[b.name]?.clip ?? -1) - (res.builds[a.name]?.clip ?? -1));
    for (const b of builds) console.log(`  ${b.name}: MineCLIP match ${res.builds[b.name]?.clip?.toFixed(3) ?? 'n/a'}`);
  } catch (e) {
    console.error(`MineDojo step failed: ${e.message}`);
  }
}

fs.mkdirSync(args.out, { recursive: true });
for (const old of ['rlbuild_datapack', 'rlbuild_functions_1.12', 'schematics']) fs.rmSync(path.join(args.out, old), { recursive: true, force: true });
builds = builds.map((b) => withRealism(b, realism));
for (const b of builds) { b.deco = decoFor(b.realism); b.fell = b.realism.fell ?? 0; }
if (realism.physics) console.log(`Physics: ${builds.map((b) => `${b.name} ${b.fell} fell`).join(', ')}`);
const pkg = functionPackage(builds, version);
const pkgDir = writePackage(pkg, args.out);
const schemDir = path.join(args.out, 'schematics');
fs.mkdirSync(schemDir, { recursive: true });
for (const b of builds) {
  const f = schematicFile(b, version, args.format);
  fs.writeFileSync(path.join(schemDir, f.filename), f.content);
}
const galleryPath = path.join(args.out, 'gallery.html');
writeGallery(builds, loadLog(type), galleryPath);

console.log(`\nMinecraft ${version.label}`);
console.log(`Schematics: ${schemDir}  (WorldEdit: //schem load <name>, then //paste)`);
console.log(`${pkg.kind === 'datapack' ? 'Data pack' : 'Functions'}: ${pkgDir}`);
console.log(`Gallery:    ${galleryPath}`);

if (args.world) {
  const worlds = args.saves ? listWorlds(args.saves) : findWorlds().worlds;
  const w = worlds.find((x) => x.name === args.world);
  if (!w) {
    console.error(`World "${args.world}" not found. Worlds: ${worlds.map((x) => x.name).join(', ') || '(none - pass --saves <folder>)'}`);
    process.exit(1);
  }
  console.log(`Installed:  ${installPackage(pkg, w.path)}  -> in game: /reload then /function rlbuild:list`);
}
