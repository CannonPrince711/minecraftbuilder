// Tiny actor-critic with hand-written backprop + Adam. No dependencies.
// Actor and critic are separate 2-hidden-layer tanh MLPs: sharing a trunk lets the
// policy gradient drown out the value loss on rare cell types (corners, door spots).

import { mulberry32 } from './rng.js';

class MLP {
  constructor(nIn, nHid, nOut, rng, outScale) {
    this.nIn = nIn; this.nHid = nHid; this.nOut = nOut;
    const init = (n, fanIn, scale = 1) => {
      const a = new Float64Array(n), s = scale * Math.sqrt(3 / fanIn);
      for (let i = 0; i < n; i++) a[i] = (rng() * 2 - 1) * s;
      return a;
    };
    this.p = {
      W1: init(nHid * nIn, nIn), b1: new Float64Array(nHid),
      W2: init(nHid * nHid, nHid), b2: new Float64Array(nHid),
      W3: init(nOut * nHid, nHid, outScale), b3: new Float64Array(nOut),
    };
    this.alloc();
  }

  alloc() {
    const { nHid, nOut } = this;
    this.g = {}; this.m = {}; this.v = {};
    for (const k in this.p) {
      const n = this.p[k].length;
      this.g[k] = new Float64Array(n); this.m[k] = new Float64Array(n); this.v[k] = new Float64Array(n);
    }
    this.h1 = new Float64Array(nHid); this.h2 = new Float64Array(nHid); this.out = new Float64Array(nOut);
    this.dh1 = new Float64Array(nHid); this.dh2 = new Float64Array(nHid);
  }

  forward(x) {
    const { nIn, nHid, nOut, p, h1, h2, out } = this;
    for (let j = 0; j < nHid; j++) {
      let s = p.b1[j];
      const row = j * nIn;
      for (let k = 0; k < nIn; k++) if (x[k] !== 0) s += p.W1[row + k] * x[k];
      h1[j] = Math.tanh(s);
    }
    for (let j = 0; j < nHid; j++) {
      let s = p.b2[j];
      const row = j * nHid;
      for (let k = 0; k < nHid; k++) s += p.W2[row + k] * h1[k];
      h2[j] = Math.tanh(s);
    }
    for (let a = 0; a < nOut; a++) {
      let s = p.b3[a];
      const row = a * nHid;
      for (let k = 0; k < nHid; k++) s += p.W3[row + k] * h2[k];
      out[a] = s;
    }
    return out;
  }

  // Backprop dOut (gradient w.r.t. outputs of the last forward) and accumulate.
  backward(x, dOut) {
    const { nIn, nHid, nOut, p, g, h1, h2, dh1, dh2 } = this;
    dh2.fill(0);
    for (let a = 0; a < nOut; a++) {
      const d = dOut[a], row = a * nHid;
      if (d === 0) continue;
      g.b3[a] += d;
      for (let k = 0; k < nHid; k++) { g.W3[row + k] += d * h2[k]; dh2[k] += d * p.W3[row + k]; }
    }
    dh1.fill(0);
    for (let j = 0; j < nHid; j++) {
      const d = dh2[j] * (1 - h2[j] * h2[j]), row = j * nHid;
      g.b2[j] += d;
      for (let k = 0; k < nHid; k++) { g.W2[row + k] += d * h1[k]; dh1[k] += d * p.W2[row + k]; }
    }
    for (let j = 0; j < nHid; j++) {
      const d = dh1[j] * (1 - h1[j] * h1[j]), row = j * nIn;
      g.b1[j] += d;
      for (let k = 0; k < nIn; k++) if (x[k] !== 0) g.W1[row + k] += d * x[k];
    }
  }

  // Adam on averaged gradients with global-norm clipping, then clear them.
  step(lr, batchSize, t, maxNorm) {
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    let norm = 0;
    for (const k in this.g) for (const gv of this.g[k]) norm += (gv / batchSize) ** 2;
    norm = Math.sqrt(norm);
    const scale = (norm > maxNorm ? maxNorm / norm : 1) / batchSize;
    const c1 = 1 - b1 ** t, c2 = 1 - b2 ** t;
    for (const k in this.p) {
      const P = this.p[k], G = this.g[k], M = this.m[k], V = this.v[k];
      for (let i = 0; i < P.length; i++) {
        const gi = G[i] * scale;
        M[i] = b1 * M[i] + (1 - b1) * gi;
        V[i] = b2 * V[i] + (1 - b2) * gi * gi;
        P[i] -= (lr * M[i] / c1) / (Math.sqrt(V[i] / c2) + eps);
        G[i] = 0;
      }
    }
  }

  toJSON() {
    const p = {};
    for (const k in this.p) p[k] = Array.from(this.p[k], (v) => +v.toFixed(6));
    return p;
  }

  load(p) {
    for (const k in this.p) this.p[k] = Float64Array.from(p[k]);
    this.alloc();
  }
}

export class ActorCritic {
  constructor(nIn, nHid, nAct, seed = 1) {
    this.nIn = nIn; this.nHid = nHid; this.nAct = nAct;
    const rng = mulberry32(seed);
    this.actor = new MLP(nIn, nHid, nAct, rng, 0.05);
    this.critic = new MLP(nIn, nHid, 1, rng, 0.1);
    this.probs = new Float64Array(nAct);
    this.dz = new Float64Array(nAct);
    this.dv = new Float64Array(1);
    this.t = 0;
  }

  // Fills this.probs, returns the value estimate.
  forward(x) {
    const z = this.actor.forward(x), probs = this.probs;
    let max = -Infinity;
    for (let a = 0; a < this.nAct; a++) if (z[a] > max) max = z[a];
    let sum = 0;
    for (let a = 0; a < this.nAct; a++) sum += probs[a] = Math.exp(z[a] - max);
    for (let a = 0; a < this.nAct; a++) probs[a] /= sum;
    return this.critic.forward(x)[0];
  }

  // Accumulate gradients of the PPO loss for one sample. Exploration samples (random
  // actions, not drawn from the policy) use self-imitation instead: an unclipped push
  // toward the action only when it beat expectations (adv > 0). PPO's ratio clip would
  // otherwise stop a near-zero-probability action from ever taking over.
  accumulate(x, action, oldLogp, adv, ret, { clip, entCoef, vCoef }, explored = false) {
    const { nAct, probs, dz, dv } = this;
    const V = this.forward(x);
    const logp = Math.log(probs[action] + 1e-12);
    const ratio = Math.exp(logp - oldLogp);
    const clipped = (adv > 0 && ratio > 1 + clip) || (adv < 0 && ratio < 1 - clip);
    const gLogp = explored ? -Math.max(0, adv) : clipped ? 0 : -ratio * adv;
    let H = 0;
    for (let a = 0; a < nAct; a++) H -= probs[a] * Math.log(probs[a] + 1e-12);
    for (let a = 0; a < nAct; a++) {
      const pa = probs[a];
      dz[a] = gLogp * ((a === action ? 1 : 0) - pa) + entCoef * pa * (Math.log(pa + 1e-12) + H);
    }
    dv[0] = vCoef * (V - ret);
    this.actor.backward(x, dz);
    this.critic.backward(x, dv);
    return { ratio, entropy: H, vloss: 0.5 * (V - ret) ** 2, clipped };
  }

  step(lr, batchSize) {
    this.t++;
    this.actor.step(lr, batchSize, this.t, 0.5);
    this.critic.step(lr, batchSize, this.t, 0.5);
  }

  toJSON() {
    return { nIn: this.nIn, nHid: this.nHid, nAct: this.nAct, actor: this.actor.toJSON(), critic: this.critic.toJSON() };
  }

  static fromJSON(j) {
    const m = new ActorCritic(j.nIn, j.nHid, j.nAct);
    m.actor.load(j.actor);
    m.critic.load(j.critic);
    return m;
  }
}
