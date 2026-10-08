import { Z_OUT, Z_FOUND, Z_WALL, Z_CORNER, Z_INTERIOR, Z_ROOF, Z_ATTIC, Z_GABLE } from '../zones.js';

// Rectangle covered by roof layer k (k = 0 sits directly on the walls).
function roofRect(t, k) {
  const { x0, x1, z0, z1, variant } = t;
  if (variant === 'flat') return k === 0 ? { rx0: x0, rx1: x1, rz0: z0, rz1: z1 } : null;
  if (variant === 'gable') {
    const rz0 = z0 + k, rz1 = z1 - k;
    return rz0 <= rz1 ? { rx0: x0, rx1: x1, rz0, rz1 } : null;
  }
  const rx0 = x0 + k, rx1 = x1 - k, rz0 = z0 + k, rz1 = z1 - k;
  return rx0 <= rx1 && rz0 <= rz1 ? { rx0, rx1, rz0, rz1 } : null;
}
const inRect = (r, x, z) => r !== null && x >= r.rx0 && x <= r.rx1 && z >= r.rz0 && z <= r.rz1;

export default {
  id: 'house',
  label: 'House',
  description: 'Walled room with corner logs, windows, a centred door and a roof.',
  variantLabel: 'Roof',
  variants: ['flat', 'gable', 'hip'],
  size: { w: [5, 9], d: [5, 9], h: [3, 5] },
  door: true,
  maxWindowRatio: 0.3,
  windowBand: (t, y) => y >= 2 && y <= Math.max(2, t.h - 1),

  zone(t, x, y, z) {
    const inFp = x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1;
    if (inFp && y === 0) return Z_FOUND;
    if (inFp && y <= t.h) {
      const ex = x === t.x0 || x === t.x1, ez = z === t.z0 || z === t.z1;
      return ex && ez ? Z_CORNER : ex || ez ? Z_WALL : Z_INTERIOR;
    }
    if (y > t.h) {
      const k = y - t.h - 1;
      if (inRect(roofRect(t, k), x, z)) {
        if (!inRect(roofRect(t, k + 1), x, z)) return Z_ROOF;
        if (t.variant === 'gable' && (x === t.x0 || x === t.x1)) return Z_GABLE;
        return Z_ATTIC;
      }
    }
    return Z_OUT;
  },

  // Sloped roofs: stairs facing up-slope, slabs on ridges, full blocks on hip corners.
  roofShape(t, x, y, z) {
    if (t.variant === 'flat') return { kind: 'full' };
    const r = roofRect(t, y - t.h - 1);
    if (!r) return { kind: 'full' };
    const hip = t.variant === 'hip';
    const n = z === r.rz0, s = z === r.rz1, w = hip && x === r.rx0, e = hip && x === r.rx1;
    if ((n && s) || (w && e)) return { kind: 'slab' };
    if ((n || s) && (w || e)) return { kind: 'full' };
    if (n) return { kind: 'stairs', facing: 'south' };
    if (s) return { kind: 'stairs', facing: 'north' };
    if (w) return { kind: 'stairs', facing: 'east' };
    if (e) return { kind: 'stairs', facing: 'west' };
    return { kind: 'slab' };
  },
};
