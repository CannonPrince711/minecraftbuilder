// Shared by the CLI and the web server: load a structure's model and generate builds.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActorCritic } from './nn.js';
import { makeTarget, rollout, evaluate, N_FEATURES } from './env.js';
import { getStructure } from './structures/index.js';
import { mulberry32 } from './rng.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const modelPath = (type) => path.join(ROOT, 'models', `${type}.json`);
export const logPath = (type) => path.join(ROOT, 'models', `${type}_log.json`);

export function hasModel(type) {
  return fs.existsSync(modelPath(type));
}

export function loadModel(type) {
  getStructure(type);
  const file = modelPath(type);
  if (!fs.existsSync(file)) throw new Error(`No trained model for "${type}" yet. Train it first: node src/train.js --type ${type}`);
  const model = ActorCritic.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (model.nIn !== N_FEATURES) throw new Error(`The "${type}" model is from an older version. Retrain it: node src/train.js --type ${type}`);
  return model;
}

export function loadLog(type) {
  try { return JSON.parse(fs.readFileSync(logPath(type), 'utf8')); } catch { return []; }
}

// brief: { width, depth, height, variant, theme } (any may be omitted = random).
export function generateBuilds(type, { count = 8, temp = 0.3, tries = 4, seed = Date.now() % 1e9, brief = {} } = {}) {
  const model = loadModel(type);
  const rng = mulberry32(seed);
  const builds = [];
  for (let id = 1; id <= count; id++) {
    const target = makeTarget(type, rng, brief);
    // Sample a few candidates for this brief and keep the best-scoring one.
    let best = null;
    for (let k = 0; k < tries; k++) {
      const { grid } = rollout(model, target, rng, { temperature: temp });
      const metrics = evaluate(target, grid);
      if (!best || metrics.score > best.metrics.score) best = { id, name: `${type}_${id}`, target, grid, metrics };
    }
    builds.push(best);
  }
  return builds;
}

// Minecraft saves folders found on this machine (default launcher locations).
export function findWorlds() {
  const home = os.homedir();
  const dirs = process.platform === 'win32'
    ? [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), '.minecraft', 'saves')]
    : process.platform === 'darwin'
      ? [path.join(home, 'Library', 'Application Support', 'minecraft', 'saves')]
      : [path.join(home, '.minecraft', 'saves')];
  return { savesDirs: dirs, worlds: dirs.flatMap(listWorlds) };
}

export function listWorlds(savesDir) {
  try {
    return fs.readdirSync(savesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(savesDir, d.name, 'level.dat')))
      .map((d) => ({ name: d.name, path: path.join(savesDir, d.name) }));
  } catch { return []; }
}
