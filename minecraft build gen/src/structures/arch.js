import { Z_OUT, Z_FOUND, Z_CORNER, Z_INTERIOR, Z_ROOF, Z_BODY } from '../zones.js';

export default {
  id: 'arch',
  label: 'Gate arch',
  description: 'Free-standing archway: two legs with pillar edges, a lintel and a slab cap.',
  variants: null,
  size: { w: [5, 9], d: [1, 3], h: [4, 7] },
  door: false,
  maxWindowRatio: 0,
  windowBand: () => false,

  zone(t, x, y, z) {
    const inFp = x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1;
    if (!inFp || y > t.h) return Z_OUT;
    if (y === t.h) return Z_ROOF;
    const lw = t.w >= 7 ? 2 : 1; // leg width
    const leg = x < t.x0 + lw || x > t.x1 - lw;
    if (leg) {
      const outer = (x === t.x0 || x === t.x1) && (z === t.z0 || z === t.z1);
      return y === 0 ? Z_FOUND : outer ? Z_CORNER : Z_BODY;
    }
    if (y >= t.h - 2) return Z_BODY; // lintel
    // Round off the opening's top corners when there is room.
    if (y === t.h - 3 && t.h >= 6 && (x === t.x0 + lw || x === t.x1 - lw)) return Z_BODY;
    return Z_INTERIOR;
  },

  roofShape: () => ({ kind: 'slab' }),
};
