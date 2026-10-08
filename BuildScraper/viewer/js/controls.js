/* Small orbit camera controller: rotate, pan, zoom with mouse, touch and keyboard. */
(function (root) {
  'use strict';
  function OrbitCam(camera, el, onChange) {
    this.camera = camera; this.el = el; this.onChange = onChange || function () {};
    this.target = new THREE.Vector3(); this.radius = 30; this.theta = Math.PI / 4; this.phi = Math.PI / 3;
    this.minRadius = 1; this.maxRadius = 5000;
    this._goal = null;
    var self = this, pointers = new Map(), mode = null, last = null, pinch = null, moved = 0;
    this.dragDistance = function () { return moved; };

    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('pointerdown', function (e) {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; self._goal = null;
      if (pointers.size === 1) { mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'rotate'; last = { x: e.clientX, y: e.clientY }; }
      else if (pointers.size === 2) { mode = 'pinch'; pinch = pinchState(); }
    });
    el.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'pinch' && pointers.size >= 2) {
        var p = pinchState();
        if (pinch && p.dist > 0) {
          self.radius = clamp(self.radius * pinch.dist / p.dist, self.minRadius, self.maxRadius);
          self.pan(p.cx - pinch.cx, p.cy - pinch.cy);
        }
        pinch = p; moved += 5; self.update(); return;
      }
      if (!last) return;
      var dx = e.clientX - last.x, dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      last = { x: e.clientX, y: e.clientY };
      if (mode === 'rotate') { self.theta -= dx * 0.008; self.phi = clamp(self.phi - dy * 0.008, 0.02, Math.PI - 0.02); }
      else if (mode === 'pan') self.pan(dx, dy);
      self.update();
    });
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 1) { var p = pointers.values().next().value; last = { x: p.x, y: p.y }; mode = 'rotate'; pinch = null; }
      if (pointers.size === 0) { mode = null; last = null; pinch = null; }
    }
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) {
      e.preventDefault(); self._goal = null;
      var f = Math.exp((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0012);
      self.radius = clamp(self.radius * f, self.minRadius, self.maxRadius); self.update();
    }, { passive: false });
    function pinchState() {
      var pts = Array.from(pointers.values()); var a = pts[0], b = pts[1];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  OrbitCam.prototype.pan = function (dx, dy) {
    var h = this.el.clientHeight || 1;
    var scale = 2 * this.radius * Math.tan(this.camera.fov * Math.PI / 360) / h;
    var right = new THREE.Vector3(), up = new THREE.Vector3();
    this.camera.matrix.extractBasis(right, up, new THREE.Vector3());
    this.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
  };
  OrbitCam.prototype.update = function () {
    var s = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * s * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * s * Math.cos(this.theta));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    var far = Math.max(1000, this.radius * 6); this.camera.near = Math.max(0.05, this.radius / 2000); this.camera.far = far;
    this.camera.updateProjectionMatrix();
    this.onChange();
  };
  // Smoothly move to a view
  OrbitCam.prototype.animateTo = function (target, radius, theta, phi) {
    // Take the short way round
    var t = this.theta; while (theta - t > Math.PI) theta -= 2 * Math.PI; while (t - theta > Math.PI) theta += 2 * Math.PI;
    this._goal = { from: { tx: this.target.x, ty: this.target.y, tz: this.target.z, r: this.radius, th: this.theta, ph: this.phi },
      to: { tx: target.x, ty: target.y, tz: target.z, r: radius, th: theta, ph: phi }, t0: performance.now() };
  };
  OrbitCam.prototype.tick = function (now) {
    if (!this._goal) return false;
    var g = this._goal, k = Math.min(1, (now - g.t0) / 450), e = 1 - Math.pow(1 - k, 3);
    function L(a, b) { return a + (b - a) * e; }
    this.target.set(L(g.from.tx, g.to.tx), L(g.from.ty, g.to.ty), L(g.from.tz, g.to.tz));
    this.radius = L(g.from.r, g.to.r); this.theta = L(g.from.th, g.to.th); this.phi = L(g.from.ph, g.to.ph);
    if (k >= 1) this._goal = null;
    this.update();
    return true;
  };
  root.OrbitCam = OrbitCam;
})(typeof globalThis !== 'undefined' ? globalThis : this);
