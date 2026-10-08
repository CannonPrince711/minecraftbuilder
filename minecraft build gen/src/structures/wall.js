import { Z_OUT, Z_FOUND, Z_CORNER, Z_BODY, Z_MERLON, Z_CRENEL } from '../zones.js';

export default {
  id: 'wall',
  label: 'Castle wall',
  description: 'Wall section with pillar buttresses, a walkway and battlements on both sides.',
  variants: null,
  size: { w: [7, 11, 2], d: [2, 3], h: [3, 6] },
  door: false,
  maxWindowRatio: 0,
  windowBand: () => false,

  zone(t, x, y, z) {
    const inFp = x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1;
    if (!inFp) return Z_OUT;
    if (y === 0) return Z_FOUND;
    const buttress = x === t.x0 || x === t.x1 || x === t.cx;
    if (y <= t.h) return buttress && (z === t.z0 || z === t.z1) ? Z_CORNER : Z_BODY;
    if (y === t.h + 1 && (z === t.z0 || z === t.z1)) return (x - t.x0) % 2 === 0 ? Z_MERLON : Z_CRENEL;
    return Z_OUT;
  },
};
