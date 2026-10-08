// Isometric voxel renderer shared by the web app and the exported gallery.
// build: { grid: string of block digits, colors: [hex per block id] }

export const RENDER_SIZE = [284, 300];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(Math.min(255, v * f)));
  return `rgb(${c.join(',')})`;
}

function poly(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

// rot: 0-3 quarter turns; slice: highest layer to draw (cutaway view).
export function renderVoxels(canvas, build, dims, rot, slice) {
  const [GX, GY, GZ] = dims, [CW, CH] = RENDER_SIZE;
  const TW = 24, TH = 12, BH = 13;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CW * dpr; canvas.height = CH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, CW, CH);
  const S = GX; // square lot
  const rotXZ = (x, z) => [[x, z], [S - 1 - z, x], [S - 1 - x, S - 1 - z], [z, S - 1 - x]][rot];
  // Realism overrides: [cell, colour | null (removed), width, height] (src/realism.js decoFor).
  const deco = new Map((build.deco ?? []).map((d) => [d[0], d]));
  const cells = [];
  for (let y = 0; y < GY && y <= slice; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const i = (y * GZ + z) * GX + x;
    const [rx, rz] = rotXZ(x, z);
    const d = deco.get(i);
    if (d) {
      if (d[1]) cells.push({ x: rx, y, z: rz, col: d[1], w: d[2], h: d[3], glass: false, log: false });
      continue;
    }
    const v = +build.grid[i];
    if (v) cells.push({ x: rx, y, z: rz, col: build.colors[v], w: 1, h: 1, glass: v === 4, log: v === 3 });
  }
  if (!cells.length) return;
  const solid = new Set(cells.filter((c) => !c.glass && c.w === 1 && c.h === 1).map((c) => `${c.x},${c.y},${c.z}`));
  cells.sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z) || a.y - b.y);
  // Centre the build's actual extent.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { x, y, z } of cells) {
    const px = (x - z) * TW / 2, py = (x + z) * TH / 2 - y * BH;
    minX = Math.min(minX, px - TW / 2); maxX = Math.max(maxX, px + TW / 2);
    minY = Math.min(minY, py - TH / 2); maxY = Math.max(maxY, py + TH / 2 + BH);
  }
  const scale = Math.min(1.25, (CW - 24) / (maxX - minX), (CH - 24) / (maxY - minY));
  ctx.translate(CW / 2, CH / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
  for (const c of cells) {
    const { x, y, z, col } = c;
    // Smaller things (plants, lanterns, carpet) are scaled boxes standing on the cell floor.
    const tw = TW * c.w, th = TH * c.w, bh = BH * c.h;
    const sx = (x - z) * TW / 2, sy = (x + z) * TH / 2 - y * BH + (BH - bh);
    ctx.globalAlpha = c.glass ? 0.5 : 1;
    const full = c.w === 1 && c.h === 1;
    const top = !full || !solid.has(`${x},${y + 1},${z}`), right = !full || !solid.has(`${x + 1},${y},${z}`), left = !full || !solid.has(`${x},${y},${z + 1}`);
    if (top) poly(ctx, [[sx, sy - th / 2], [sx + tw / 2, sy], [sx, sy + th / 2], [sx - tw / 2, sy]], shade(col, 1.08));
    if (left) poly(ctx, [[sx - tw / 2, sy], [sx, sy + th / 2], [sx, sy + th / 2 + bh], [sx - tw / 2, sy + bh]], shade(col, 0.82));
    if (right) poly(ctx, [[sx + tw / 2, sy], [sx, sy + th / 2], [sx, sy + th / 2 + bh], [sx + tw / 2, sy + bh]], shade(col, 0.64));
    if (c.log && (left || right)) { // log bark lines
      ctx.strokeStyle = shade(col, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - TW / 4, sy + TH / 4 + 2); ctx.lineTo(sx - TW / 4, sy + TH / 4 + BH - 2);
      ctx.moveTo(sx + TW / 4, sy + TH / 4 + 2); ctx.lineTo(sx + TW / 4, sy + TH / 4 + BH - 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// Wire up a canvas with drag-to-rotate. Returns { draw, setSlice, rotate }.
export function attachViewer(canvas, build, dims) {
  let rot = 2, slice = dims[1] - 1, dragX = null; // rot 2 = front (door) toward the viewer
  const draw = () => renderVoxels(canvas, build, dims, rot, slice);
  canvas.addEventListener('pointerdown', (e) => { dragX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (dragX !== null && Math.abs(e.clientX - dragX) > 40) { rot = (rot + (e.clientX > dragX ? 1 : 3)) % 4; dragX = e.clientX; draw(); }
  });
  canvas.addEventListener('pointerup', () => { dragX = null; });
  draw();
  return {
    draw,
    rotate() { rot = (rot + 1) % 4; draw(); },
    setSlice(v) { slice = v; draw(); },
  };
}

export function topLayer(build, dims) {
  const [GX, , GZ] = dims;
  let top = 0;
  for (let i = 0; i < build.grid.length; i++) if (build.grid[i] !== '0') top = Math.floor(i / (GX * GZ));
  for (const d of build.deco ?? []) if (d[1]) top = Math.max(top, Math.floor(d[0] / (GX * GZ)));
  return top;
}
