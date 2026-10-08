/* Turns a parsed schematic into triangle buffers: hidden faces between solid blocks are
   culled, faces get Minecraft-style directional shading plus ambient occlusion. */
(function (root) {
  'use strict';

  var SHADE = [0.8, 0.8, 1.0, 0.55, 0.9, 0.9]; // +x, -x, +y, -y, +z, -z
  var AO_LEVEL = [0.5, 0.68, 0.84, 1.0];
  var DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  // For each direction: the 4 unit-cube corners of that face, wound counter-clockwise from outside.
  var FACES = DIRS.map(function (n) {
    var a = n[0] ? 0 : (n[1] ? 1 : 2);
    var u = (a + 1) % 3, v = (a + 2) % 3;
    var side = n[a] > 0 ? 1 : 0;
    var raw = [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (uv) { var c = [0, 0, 0]; c[a] = side; c[u] = uv[0]; c[v] = uv[1]; return c; });
    var e1 = sub(raw[1], raw[0]), e2 = sub(raw[2], raw[0]);
    var cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) raw.reverse();
    return { n: n, axis: a, u: u, v: v, corners: raw };
  });
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  function Buf() { this.pos = new Float32Array(3 * 4096); this.col = new Uint8Array(4 * 4096); this.idx = new Uint32Array(6 * 1024); this.nv = 0; this.ni = 0; }
  Buf.prototype.ensure = function (vAdd, iAdd) {
    if ((this.nv + vAdd) * 3 > this.pos.length) {
      var np = new Float32Array(Math.max(this.pos.length * 2, (this.nv + vAdd) * 3)); np.set(this.pos); this.pos = np;
      var nc = new Uint8Array(np.length / 3 * 4); nc.set(this.col); this.col = nc;
    }
    if (this.ni + iAdd > this.idx.length) { var ni = new Uint32Array(Math.max(this.idx.length * 2, this.ni + iAdd)); ni.set(this.idx); this.idx = ni; }
  };
  Buf.prototype.result = function () {
    return { positions: this.pos.slice(0, this.nv * 3), colors: this.col.slice(0, this.nv * 4), indices: this.idx.slice(0, this.ni), vertexCount: this.nv };
  };

  function hash3(x, y, z) { var h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  /* ctx: { schem, looks: [appearance per palette index], visible: Uint8Array per palette index (1 = draw),
            yMin, yMax, ao: bool } */
  function makeContext(schem, looks, visible, yMin, yMax, ao) {
    var W = schem.width, H = schem.height, L = schem.length, blocks = schem.blocks, WL = W * L;
    // Per-palette flags: 1 = drawn, 2 = occludes neighbours
    // Index looks.length is a sentinel for "outside the schematic / outside the shown layers" (never drawn).
    var OUT = looks.length, flags = new Uint8Array(looks.length + 1);
    for (var i = 0; i < looks.length; i++) {
      var lk = looks[i];
      if (!lk.invisible && visible[i]) flags[i] = 1 | (lk.occludes ? 2 : 0);
    }
    function at(x, y, z) {
      if (x < 0 || z < 0 || y < yMin || x >= W || y > yMax || z >= L) return OUT;
      return blocks[x + z * W + y * WL];
    }
    return { W: W, H: H, L: L, WL: WL, blocks: blocks, looks: looks, flags: flags, at: at, yMin: yMin, yMax: yMax, ao: ao !== false };
  }

  function faceColor(lk, d) {
    if (lk.axisEnds) {
      var ax = lk.axis === 'x' ? 0 : (lk.axis === 'z' ? 2 : 1);
      if (FACES[d].axis === ax) return lk.axisEnds;
      return lk.color;
    }
    if (d === 2 && lk.top) return lk.top;
    if (d === 3 && (lk.bottom || lk.top)) return lk.bottom || lk.color;
    return lk.color;
  }

  function buildChunk(ctx, x0, y0, z0, size) {
    var opaque = new Buf(), trans = new Buf();
    var W = ctx.W, L = ctx.L, WL = ctx.WL, blocks = ctx.blocks, looks = ctx.looks, flags = ctx.flags, at = ctx.at;
    var x1 = Math.min(x0 + size, W), y1 = Math.min(y0 + size, ctx.yMax + 1), z1 = Math.min(z0 + size, L);
    var yStart = Math.max(y0, ctx.yMin);
    var doAO = ctx.ao;
    for (var y = yStart; y < y1; y++) for (var z = z0; z < z1; z++) {
      var rowBase = z * W + y * WL;
      for (var x = x0; x < x1; x++) {
        var b = blocks[rowBase + x];
        if (!(flags[b] & 1)) continue;
        var lk = looks[b];
        var jitter = 0.95 + hash3(x, y, z) * 0.08;
        if (lk.shape === 'cube') {
          var out = lk.translucent ? trans : opaque;
          for (var d = 0; d < 6; d++) {
            var n = DIRS[d];
            var nb = at(x + n[0], y + n[1], z + n[2]);
            var nf = flags[nb];
            if (nf & 2) continue;                          // neighbour is solid
            if (lk.translucent && nb === b) continue;      // glass next to same glass
            if (lk.translucent && (nf & 1) && looks[nb].translucent && looks[nb].id === lk.id) continue;
            emitFace(out, ctx, x, y, z, d, faceColor(lk, d), jitter, lk.translucent ? lk.alpha : 1, doAO && !lk.translucent && !lk.emissive, null);
          }
        } else {
          var bx = lk.boxes, o = lk.translucent ? trans : opaque;
          for (var k = 0; k < bx.length; k++) {
            var box = bx[k];
            for (var dd = 0; dd < 6; dd++) {
              // Skip a box face lying on the block boundary when the neighbour is solid
              var nn = DIRS[dd], onEdge = false;
              if (dd === 0) onEdge = box[3] >= 1; else if (dd === 1) onEdge = box[0] <= 0;
              else if (dd === 2) onEdge = box[4] >= 1; else if (dd === 3) onEdge = box[1] <= 0;
              else if (dd === 4) onEdge = box[5] >= 1; else onEdge = box[2] <= 0;
              if (onEdge && (flags[at(x + nn[0], y + nn[1], z + nn[2])] & 2)) continue;
              emitFace(o, ctx, x, y, z, dd, faceColor(lk, dd), jitter, lk.translucent ? lk.alpha : 1, false, box);
            }
          }
        }
      }
    }
    return { opaque: opaque.result(), translucent: trans.result() };
  }

  function emitFace(buf, ctx, x, y, z, d, rgb, jitter, alpha, doAO, box) {
    var f = FACES[d], c = f.corners, s = SHADE[d] * jitter;
    buf.ensure(4, 6);
    var vi = buf.nv, p = buf.pos, col = buf.col, pi = vi * 3, ci = vi * 4;
    var ao0 = 3, ao1 = 3, ao2 = 3, ao3 = 3;
    if (doAO) {
      var n = f.n, flags = ctx.flags, at = ctx.at;
      var nx = x + n[0], ny = y + n[1], nz = z + n[2];
      var aos = [3, 3, 3, 3];
      for (var k = 0; k < 4; k++) {
        var cc = c[k];
        var du = [0, 0, 0], dv = [0, 0, 0];
        du[f.u] = cc[f.u] ? 1 : -1; dv[f.v] = cc[f.v] ? 1 : -1;
        var s1 = (flags[at(nx + du[0], ny + du[1], nz + du[2])] & 2) ? 1 : 0;
        var s2 = (flags[at(nx + dv[0], ny + dv[1], nz + dv[2])] & 2) ? 1 : 0;
        var cn = (flags[at(nx + du[0] + dv[0], ny + du[1] + dv[1], nz + du[2] + dv[2])] & 2) ? 1 : 0;
        aos[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cn);
      }
      ao0 = aos[0]; ao1 = aos[1]; ao2 = aos[2]; ao3 = aos[3];
    }
    var aoArr = [ao0, ao1, ao2, ao3];
    for (var i = 0; i < 4; i++) {
      var cr = c[i];
      if (box) {
        p[pi++] = x + (cr[0] ? box[3] : box[0]);
        p[pi++] = y + (cr[1] ? box[4] : box[1]);
        p[pi++] = z + (cr[2] ? box[5] : box[2]);
      } else {
        p[pi++] = x + cr[0]; p[pi++] = y + cr[1]; p[pi++] = z + cr[2];
      }
      var m = s * AO_LEVEL[aoArr[i]];
      col[ci++] = Math.min(255, rgb[0] * m); col[ci++] = Math.min(255, rgb[1] * m); col[ci++] = Math.min(255, rgb[2] * m);
      col[ci++] = Math.round(alpha * 255);
    }
    var ix = buf.idx, ii = buf.ni;
    // Flip the quad diagonal so AO interpolates evenly
    if (ao0 + ao2 < ao1 + ao3) {
      ix[ii++] = vi + 1; ix[ii++] = vi + 2; ix[ii++] = vi + 3; ix[ii++] = vi + 1; ix[ii++] = vi + 3; ix[ii++] = vi;
    } else {
      ix[ii++] = vi; ix[ii++] = vi + 1; ix[ii++] = vi + 2; ix[ii++] = vi; ix[ii++] = vi + 2; ix[ii++] = vi + 3;
    }
    buf.ni = ii; buf.nv = vi + 4;
  }

  // Voxel ray cast (Amanatides & Woo). Returns {x,y,z,face} of the first drawn block or null.
  function raycast(ctx, ox, oy, oz, dx, dy, dz, maxDist) {
    var W = ctx.W, H = ctx.H, L = ctx.L;
    // Move the origin onto the bounding box if it starts outside
    var tmin = 0, tmax = maxDist || 1e9;
    var o = [ox, oy, oz], d = [dx, dy, dz], lo = [0, ctx.yMin, 0], hi = [W, ctx.yMax + 1, L];
    for (var a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < lo[a] || o[a] > hi[a]) return null; continue; }
      var t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
      if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    var px = ox + dx * (tmin + 1e-6), py = oy + dy * (tmin + 1e-6), pz = oz + dz * (tmin + 1e-6);
    var x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
    var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    var tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
    var tx = dx !== 0 ? ((dx > 0 ? x + 1 - px : px - x) * tdx) : Infinity;
    var ty = dy !== 0 ? ((dy > 0 ? y + 1 - py : py - y) * tdy) : Infinity;
    var tz = dz !== 0 ? ((dz > 0 ? z + 1 - pz : pz - z) * tdz) : Infinity;
    var face = -1, steps = W + H + L + 10;
    for (var i = 0; i < steps * 3; i++) {
      if (x >= 0 && y >= ctx.yMin && z >= 0 && x < W && y <= ctx.yMax && z < L) {
        var b = ctx.blocks[x + z * W + y * ctx.WL];
        if (ctx.flags[b] & 1) return { x: x, y: y, z: z, face: face, index: b };
      } else if (i > 2) return null;
      if (tx < ty && tx < tz) { x += sx; tx += tdx; face = sx > 0 ? 1 : 0; }
      else if (ty < tz) { y += sy; ty += tdy; face = sy > 0 ? 3 : 2; }
      else { z += sz; tz += tdz; face = sz > 0 ? 5 : 4; }
    }
    return null;
  }

  var api = { makeContext: makeContext, buildChunk: buildChunk, raycast: raycast };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Mesher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
