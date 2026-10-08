// PPO training loop.
//   node src/train.js [--type house] [--iters 200] [--batch 8] [--hidden 64] [--lr 0.001] [--seed 1] [--resume]

import fs from 'node:fs';
import path from 'node:path';
import { ActorCritic } from './nn.js';
import { N, N_FEATURES, makeTarget, rollout, evaluate } from './env.js';
import { EASY } from './zones.js';
import { getStructure } from './structures/index.js';
import { N_BLOCKS } from './blocks.js';
import { mulberry32 } from './rng.js';
import { parseArgs } from './cli.js';

const args = parseArgs(process.argv.slice(2), {
  iters: 200, batch: 8, hidden: 64, lr: 0.001, seed: 1, epochs: 3, minibatch: 1024,
  gamma: 0.5, lambda: 0.8, clip: 0.2, ent: 0.05, keepEasy: 0.2, explore: 0.15, vcoef: 0.5, type: 'house', out: '', resume: false,
});

const spec = getStructure(args.type);
if (!args.out) args.out = `models/${args.type}.json`;
const rng = mulberry32(args.seed);
let model = new ActorCritic(N_FEATURES, args.hidden, N_BLOCKS, args.seed);
let log = [];
const logPath = args.out.replace(/.json$/, '') + '_log.json';
if (args.resume && fs.existsSync(args.out)) {
  model = ActorCritic.fromJSON(JSON.parse(fs.readFileSync(args.out, 'utf8')));
  if (fs.existsSync(logPath)) log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  console.log(`Resumed from ${args.out} (${log.length} iterations logged)`);
}
fs.mkdirSync(path.dirname(args.out), { recursive: true });

const S = args.batch * N;
const feats = new Float32Array(S * N_FEATURES);
const explored = new Uint8Array(S);
const actions = new Int8Array(S), oldLogp = new Float32Array(S), adv = new Float32Array(S), ret = new Float32Array(S);
const x = new Float64Array(N_FEATURES);
const order = new Uint32Array(S);

console.log(`PPO | ${spec.label} | ${N} cells/episode, ${N_FEATURES} features, ${args.hidden} hidden, batch ${args.batch} episodes`);
const t0 = Date.now();
const startIter = log.length;

for (let it = startIter; it < startIter + args.iters; it++) {
  // 1. Collect experience.
  let sumReturn = 0, sumScore = 0, doorsOk = 0, nTrain = 0;
  for (let e = 0; e < args.batch; e++) {
    const target = makeTarget(args.type, rng);
    const { grid, total, rec } = rollout(model, target, rng, { record: true, explore: args.explore * Math.max(0.2, 1 - (it - startIter) / args.iters) });
    const off = e * N;
    feats.set(rec.feats, off * N_FEATURES);
    actions.set(rec.actions, off);
    explored.set(rec.explored, off);
    oldLogp.set(rec.logp, off);
    // GAE(lambda) advantages over the scan-order trajectory.
    let gae = 0;
    for (let i = N - 1; i >= 0; i--) {
      const nextV = i === N - 1 ? 0 : rec.values[i + 1];
      const delta = rec.rewards[i] + args.gamma * nextV - rec.values[i];
      gae = delta + args.gamma * args.lambda * gae;
      adv[off + i] = gae;
      ret[off + i] = gae + rec.values[i];
    }
    // Rebalance: most cells are trivial "air outside the house" decisions that would
    // otherwise drown out the rare, interesting ones (doors, windows, roof edges).
    for (let i = 0; i < N; i++) if (rec.actions[i] >= 0 && (!EASY[rec.zones[i]] || rng() < args.keepEasy)) order[nTrain++] = off + i;
    const m = evaluate(target, grid);
    sumReturn += total; sumScore += m.score; doorsOk += m.doors === 1 || m.doors === null ? 1 : 0;
  }
  let mean = 0, sq = 0;
  for (let i = 0; i < S; i++) mean += adv[i];
  mean /= S;
  for (let i = 0; i < S; i++) sq += (adv[i] - mean) ** 2;
  const std = Math.sqrt(sq / S) + 1e-8;
  for (let i = 0; i < S; i++) adv[i] = (adv[i] - mean) / std;

  // 2. PPO update.
  const entCoef = args.ent * Math.max(0.2, 1 - (it - startIter) / args.iters);
  let entropy = 0, vloss = 0, clipFrac = 0, count = 0;
  for (let ep = 0; ep < args.epochs; ep++) {
    for (let i = nTrain - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let s = 0; s < nTrain; s += args.minibatch) {
      const end = Math.min(nTrain, s + args.minibatch);
      for (let b = s; b < end; b++) {
        const i = order[b];
        for (let k = 0; k < N_FEATURES; k++) x[k] = feats[i * N_FEATURES + k];
        const r = model.accumulate(x, actions[i], oldLogp[i], adv[i], ret[i], { clip: args.clip, entCoef, vCoef: args.vcoef }, explored[i] === 1);
        entropy += r.entropy; vloss += r.vloss; clipFrac += r.clipped ? 1 : 0; count++;
      }
      model.step(args.lr, end - s);
    }
  }

  const row = {
    iter: it + 1,
    return: +(sumReturn / args.batch).toFixed(1),
    score: +(sumScore / args.batch).toFixed(1),
    doorRate: +(doorsOk / args.batch).toFixed(2),
    entropy: +(entropy / count).toFixed(3),
  };
  log.push(row);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(
    `iter ${String(row.iter).padStart(4)} | return ${String(row.return).padStart(7)} | score ${String(row.score).padStart(5)}/100` +
    ` | door ok ${(row.doorRate * 100).toFixed(0).padStart(3)}% | entropy ${row.entropy} | vloss ${(vloss / count).toFixed(3)}` +
    ` | clip ${(clipFrac / count).toFixed(2)} | ${secs}s`,
  );
  if ((it + 1) % 10 === 0 || it === startIter + args.iters - 1) {
    fs.writeFileSync(args.out, JSON.stringify(model.toJSON()));
    fs.writeFileSync(logPath, JSON.stringify(log));
  }
}
console.log(`Saved ${args.out}`);
