import { Z_OUT, Z_FOUND, Z_WALL, Z_CORNER, Z_INTERIOR, Z_BODY, Z_FLOOR, Z_MERLON, Z_CRENEL } from '../zones.js';

export default {
  id: 'tower',
  label: 'Watchtower',
  description: 'Tall square tower: door, arrow-slit windows, a mid floor, a top deck and battlements.',
  variants: null,
  size: { w: [5, 7, 2], h: [6, 9] }, // odd widths so battlements end on a tooth
  square: true,
  door: true,
  maxWindowRatio: 0.12,
  windowBand: (t, y) => y >= 3 && y <= t.h - 1,

  zone(t, x, y, z) {
    const inFp = x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1;
    if (!inFp) return Z_OUT;
    const ex = x === t.x0 || x === t.x1, ez = z === t.z0 || z === t.z1, edge = ex || ez;
    const floorY = Math.max(3, Math.floor(t.h / 2) + 1);
    if (y === 0) return Z_FOUND;
    if (y <= t.h) {
      if (ex && ez) return Z_CORNER;
      if (edge) return Z_WALL;
      return y === floorY ? Z_FLOOR : Z_INTERIOR;
    }
    if (y === t.h + 1) return edge ? Z_BODY : Z_FLOOR; // parapet + deck
    if (y === t.h + 2 && edge) return (x - t.x0 + z - t.z0) % 2 === 0 ? Z_MERLON : Z_CRENEL;
    return Z_OUT;
  },
};
