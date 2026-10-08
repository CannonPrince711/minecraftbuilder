import { Z_OUT, Z_FOUND, Z_INTERIOR, Z_ROOF, Z_STEP, Z_CORE } from '../zones.js';

export default {
  id: 'pyramid',
  label: 'Step pyramid',
  description: 'Stepped pyramid with an entrance passage into a hidden chamber.',
  variants: null,
  size: { w: [5, 11, 2] }, // height follows from the width
  square: true,
  derive: (t) => { t.h = (t.w + 1) / 2; },
  door: false,
  maxWindowRatio: 0,
  windowBand: () => false,

  zone(t, x, y, z) {
    const r = { x0: t.x0 + y, x1: t.x1 - y, z0: t.z0 + y, z1: t.z1 - y };
    if (r.x0 > r.x1 || r.z0 > r.z1 || x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return Z_OUT;
    if (r.x0 === r.x1 && r.z0 === r.z1) return Z_ROOF; // capstone
    const cz = (t.z0 + t.z1) / 2;
    if (x === t.cx && (y === 1 || y === 2) && z < cz) return Z_INTERIOR; // entrance passage
    const ring = x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;
    if (ring) return Z_STEP;
    return y === 0 ? Z_FOUND : Z_CORE;
  },
};
