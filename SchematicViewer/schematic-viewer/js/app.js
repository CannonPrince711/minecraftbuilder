/* Schematic Viewer: UI, file loading and rendering. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CHUNK = 32;

  // ---------- theme ----------
  var THEME_KEY = 'schemviewer.theme';
  function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (e) {}
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  $('btnTheme').onclick = function () {
    var next = isDark() ? 'light' : 'dark'; applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    updateSceneColors(); requestRender();
  };

  // ---------- three.js setup ----------
  var canvas = $('canvas'), stage = $('stage');
  if (!window.THREE || !window.SchemFormats || !window.Mesher || !window.BlockLook || !window.OrbitCam) {
    fatal('The viewer could not start because some of its files are missing.',
      'Keep all the viewer files together in one folder (index.html with the css, js and vendor folders), then reload the page.',
      'Loaded: three=' + !!window.THREE + ' formats=' + !!window.SchemFormats + ' mesher=' + !!window.Mesher + ' blocks=' + !!window.BlockLook + ' controls=' + !!window.OrbitCam);
    return;
  }
  var renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: false }); }
  catch (e) {
    fatal('3D graphics could not start on this computer.',
      'Turn on "Use hardware acceleration" in your browser settings, update your graphics driver, or try another browser (Chrome, Edge or Firefox).',
      (e && e.message) || String(e));
    return;
  }
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    Problems.report('error', null, 'The 3D view stopped because the graphics card was reset or ran out of memory.', 'Reload the page. For very large builds, close other tabs or programs first.');
    showToast('The 3D view stopped. Reload the page to continue.', true);
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  var root3d = new THREE.Group(); scene.add(root3d);
  var chunkGroup = new THREE.Group(); root3d.add(chunkGroup);
  var matOpaque = new THREE.MeshBasicMaterial({ vertexColors: true });
  var matTrans = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  var grid = null, bounds = null;
  var hoverBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)), new THREE.LineBasicMaterial({ color: 0xffffff }));
  hoverBox.visible = false; root3d.add(hoverBox);
  var hoverBoxInner = new THREE.LineSegments(hoverBox.geometry, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
  hoverBoxInner.scale.setScalar(0.995); hoverBox.add(hoverBoxInner);

  var needsRender = true;
  function requestRender() { needsRender = true; }
  var controls = new OrbitCam(camera, canvas, requestRender);
  controls.update();

  function resize() {
    var w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); requestRender();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  resize();

  function loop(now) {
    if (controls.tick(now)) needsRender = true;
    if (needsRender) { needsRender = false; renderer.render(scene, camera); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function updateSceneColors() {
    var dark = isDark();
    hoverBox.material.color.set(dark ? 0xffffff : 0x111111);
    hoverBoxInner.material.color.set(dark ? 0x000000 : 0xffffff);
    if (grid) { grid.material.color.set(dark ? 0x3a4656 : 0x8aa0b4); }
    if (bounds) bounds.material.color.set(dark ? 0x9fb3c8 : 0x3b4b5c);
  }

  // A problem that stops the whole viewer: shown full-size in the 3D area.
  function fatal(message, hint, detail) {
    if (window.Problems) Problems.report('error', null, message, hint, detail);
    showErrorCard({ title: 'The viewer could not start', message: message, hint: hint, detail: detail });
    $('empty').hidden = true;
    ['btnErrOpen'].forEach(function (id) { var b = $(id); if (b) b.hidden = true; });
  }
  function showErrorCard(o) {
    $('errTitle').textContent = o.title || 'This file could not be opened';
    $('errFile').textContent = o.file || ''; $('errFile').hidden = !o.file;
    $('errMsg').textContent = o.message || '';
    $('errHint').textContent = o.hint || ''; $('errHint').hidden = !o.hint;
    $('errDetail').textContent = o.detail || ''; $('errDetailBox').hidden = !o.detail;
    $('errorCard').hidden = false; $('empty').hidden = true;
    $('btnErrCopy').onclick = function () {
      Problems.copyText((o.file ? o.file + ': ' : '') + (o.message || '') + (o.hint ? '\nWhat to try: ' + o.hint : '') + (o.detail ? '\nDetails: ' + o.detail : ''), this);
    };
  }
  function hideErrorCard() { $('errorCard').hidden = true; }
  $('btnErrOpen').onclick = function () { $('fileInput').click(); };
  function showFileError(f) {
    var e = f.error || {};
    showErrorCard({ file: f.name, message: e.message, hint: e.hint, detail: e.detail });
    if (current) { $('toolbar').hidden = true; $('hud').hidden = true; chunkGroup.visible = false; if (grid) grid.visible = false; if (bounds) bounds.visible = false; requestRender(); }
    ['panelInfo', 'panelView', 'panelBlocks'].forEach(function (id) { $(id).hidden = true; });
    errorShownFor = f; renderFileList();
  }
  var errorShownFor = null;

  // ---------- state ----------
  var files = [];       // { name, schem | error }
  var current = null;   // { schem, looks, groups, nameToGroup, visible, yMin, yMax, chunks:Map, ctx }
  var buildToken = 0;

  // ---------- file loading ----------
  $('btnOpen').onclick = $('btnOpen2').onclick = function () { $('fileInput').click(); };
  $('fileInput').onchange = function (e) { openFiles(Array.from(e.target.files)); e.target.value = ''; };
  $('btnDemo').onclick = function () {
    var bin = atob(DEMO_SCHEM.base64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    openBuffers([{ name: DEMO_SCHEM.name, bytes: u8 }]);
  };

  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) { if (hasFiles(e)) { dragDepth++; $('dropHint').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropHint').hidden = true; });
  window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); dragDepth = 0; $('dropHint').hidden = true;
    var list = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (list.length) openFiles(list);
  });
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }

  async function openFiles(list) {
    var bufs = [];
    for (var i = 0; i < list.length; i++) {
      try { bufs.push({ name: list[i].name, bytes: new Uint8Array(await list[i].arrayBuffer()) }); }
      catch (e) {
        var err = { message: 'The file could not be read from your computer.', hint: 'Check that the file still exists and is not open in another program, then try again.', detail: (e && e.message) || String(e) };
        files.push({ name: list[i].name, error: err });
        Problems.report('error', list[i].name, err.message, err.hint, err.detail);
      }
    }
    openBuffers(bufs);
  }

  async function openBuffers(bufs) {
    if (!bufs.length) { renderFileList(); return; }
    var firstNew = null;
    showOverlay('Reading ' + (bufs.length === 1 ? bufs[0].name : bufs.length + ' files') + '…', 0);
    for (var i = 0; i < bufs.length; i++) {
      var b = bufs[i], entry = { name: b.name };
      setOverlay('Reading ' + b.name + '…', i / bufs.length);
      await nextFrame();
      try {
        entry.schem = await SchemFormats.parseSchematicBytes(b.bytes, b.name);
        (entry.schem.warnings || []).forEach(function (w) { Problems.report('warning', b.name, w); });
      } catch (e) {
        var p = Problems.fromError(e, b.name);
        entry.error = { message: p.message, hint: p.hint, detail: p.detail };
      }
      files.push(entry);
      if (!firstNew && entry.schem) firstNew = entry;
    }
    hideOverlay();
    renderFileList();
    var added = files.slice(-bufs.length), errs = added.filter(function (f) { return f.error; });
    if (errs.length) showToast(errs.length === 1 ? errs[0].name + ' could not be opened: ' + errs[0].error.message : errs.length + ' files could not be opened. See Problems for the reasons.', true);
    if (firstNew) selectFile(firstNew);
    else if (errs.length) showFileError(errs[0]);
  }

  function renderFileList() {
    $('panelFiles').hidden = files.length === 0;
    var ul = $('fileList'); ul.innerHTML = '';
    files.forEach(function (f, i) {
      var li = document.createElement('li');
      var active = errorShownFor ? errorShownFor === f : (current && current.file === f);
      li.className = (active ? 'active ' : '') + (f.error ? 'failed' : '');
      var n = document.createElement('span'); n.className = 'name'; n.textContent = f.name; n.title = f.error ? 'Could not be opened: ' + f.error.message : f.name;
      if (f.error) { var w = document.createElement('span'); w.className = 'err'; w.textContent = '!'; w.title = f.error.message; li.appendChild(w); }
      li.appendChild(n);
      var x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Close'; x.setAttribute('aria-label', 'Close ' + f.name);
      x.onclick = function (ev) { ev.stopPropagation(); closeFile(i); };
      li.appendChild(x);
      li.onclick = function () { if (f.schem) selectFile(f); else showFileError(f); };
      ul.appendChild(li);
    });
  }

  function closeFile(i) {
    var f = files[i]; files.splice(i, 1);
    if (errorShownFor === f) {
      errorShownFor = null; hideErrorCard();
      if (current) selectFile(current.file); else { var nx = files.filter(function (x) { return x.schem; })[0]; if (nx) selectFile(nx); else clearScene(); }
    } else if (current && current.file === f) {
      var next = files.filter(function (x) { return x.schem; })[0];
      if (next) selectFile(next); else clearScene();
    }
    renderFileList();
  }

  function clearScene() {
    buildToken++;
    disposeChunks();
    current = null; errorShownFor = null; hideErrorCard();
    $('empty').hidden = false; $('toolbar').hidden = true; $('hud').hidden = true;
    ['panelInfo', 'panelView', 'panelBlocks'].forEach(function (id) { $(id).hidden = true; });
    $('panelHint').hidden = false;
    if (grid) { root3d.remove(grid); grid = null; }
    if (bounds) { root3d.remove(bounds); bounds = null; }
    hoverBox.visible = false; $('tooltip').hidden = true;
    requestRender();
  }

  // ---------- selecting a file ----------
  function selectFile(f) {
    var s = f.schem;
    errorShownFor = null; hideErrorCard(); chunkGroup.visible = true;
    if (current && current.file === f) {
      $('toolbar').hidden = false; $('hud').hidden = false;
      ['panelInfo', 'panelView', 'panelBlocks'].forEach(function (id) { $(id).hidden = false; });
      if (grid) grid.visible = $('optGrid').checked; if (bounds) bounds.visible = $('optBounds').checked;
      renderFileList(); requestRender(); return;
    }
    var looks = s.palette.map(function (p) { return BlockLook.appearance(p.name, p.props); });
    // Group palette states by block name for the materials list
    var groups = [], byName = new Map();
    s.palette.forEach(function (p, i) {
      if (looks[i].invisible || !p.count) return;
      var g = byName.get(p.name);
      if (!g) { g = { name: p.name, label: prettyName(p.name), count: 0, indices: [], color: looks[i].top || looks[i].color, hidden: false }; byName.set(p.name, g); groups.push(g); }
      g.count += p.count; g.indices.push(i);
    });
    groups.sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    var unknown = groups.filter(function (g) { return looks[g.indices[0]].unknownColor; }).map(function (g) { return g.name; });
    if (unknown.length) Problems.report('warning', f.name, unknown.length + ' block type' + (unknown.length > 1 ? 's are' : ' is') + ' not known to the viewer and shown with a made-up colour.',
      'This is normal for modded blocks. Everything else in the build is shown as usual.', unknown.slice(0, 40).join(', ') + (unknown.length > 40 ? ', …' : ''));
    current = { file: f, schem: s, looks: looks, groups: groups, byName: byName, visible: new Uint8Array(looks.length).fill(1), yMin: 0, yMax: s.height - 1, chunks: new Map() };
    $('empty').hidden = true; $('toolbar').hidden = false; $('hud').hidden = false; $('panelHint').hidden = true;
    ['panelInfo', 'panelView', 'panelBlocks'].forEach(function (id) { $(id).hidden = false; });
    renderFileList(); renderInfo(); renderBlockList(); setupLayerControls();
    setupHelpers();
    rebuildAll(true);
    fitView('iso', true);
    closeSidebarMobile();
  }

  function prettyName(name) {
    var ns = name.indexOf(':') >= 0 ? name.slice(0, name.indexOf(':')) : 'minecraft';
    var id = name.slice(name.indexOf(':') + 1).replace(/_/g, ' ');
    var label = id.charAt(0).toUpperCase() + id.slice(1);
    return ns === 'minecraft' ? label : label + ' (' + ns + ')';
  }
  function fmt(n) { return n.toLocaleString(); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function renderInfo() {
    var s = current.schem, total = current.groups.reduce(function (a, g) { return a + g.count; }, 0);
    var rows = [];
    if (s.meta.Name) rows.push(['Name', s.meta.Name]);
    if (s.meta.Author) rows.push(['Author', s.meta.Author]);
    rows.push(['File', s.fileName]);
    rows.push(['Format', s.formatLabel]);
    rows.push(['Minecraft', s.mcVersion || 'unknown']);
    rows.push(['Size', s.width + ' × ' + s.height + ' × ' + s.length + ' (W × H × L)']);
    rows.push(['Blocks', fmt(total) + ' placed, ' + current.groups.length + ' types']);
    if (s.blockEntityCount) rows.push(['Containers etc.', fmt(s.blockEntityCount)]);
    if (s.entityCount) rows.push(['Entities', fmt(s.entityCount)]);
    if (s.meta.Date) rows.push(['Created', s.meta.Date]);
    $('info').innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
    $('blockTotal').textContent = '(' + current.groups.length + ')';
  }

  function rgbCss(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function renderBlockList() {
    var q = $('blockSearch').value.trim().toLowerCase();
    var ul = $('blockList'); ul.innerHTML = '';
    var frag = document.createDocumentFragment();
    current.groups.forEach(function (g) {
      if (q && g.label.toLowerCase().indexOf(q) < 0 && g.name.indexOf(q) < 0) return;
      var li = document.createElement('li'); li.dataset.name = g.name;
      if (g.hidden) li.className = 'off';
      var lab = document.createElement('label');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !g.hidden;
      cb.onchange = function () { g.hidden = !cb.checked; li.className = g.hidden ? 'off' : ''; applyVisibility(); };
      var sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = rgbCss(g.color);
      var nm = document.createElement('span'); nm.className = 'bname'; nm.textContent = g.label; nm.title = g.name;
      lab.appendChild(cb); lab.appendChild(sw); lab.appendChild(nm);
      var ct = document.createElement('span'); ct.className = 'count'; ct.textContent = fmt(g.count);
      ct.title = stacksText(g.count);
      li.appendChild(lab); li.appendChild(ct);
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }
  function stacksText(n) {
    var st = Math.floor(n / 64), r = n % 64, sb = Math.floor(n / 1728);
    return fmt(n) + ' blocks = ' + (sb ? sb + ' shulker box' + (sb > 1 ? 'es' : '') + ', ' : '') + st + ' stack' + (st === 1 ? '' : 's') + (r ? ' + ' + r : '');
  }
  $('blockSearch').oninput = function () { if (current) renderBlockList(); };
  $('showAll').onclick = function () { current.groups.forEach(function (g) { g.hidden = false; }); renderBlockList(); applyVisibility(); };
  $('hideAll').onclick = function () { current.groups.forEach(function (g) { g.hidden = true; }); renderBlockList(); applyVisibility(); };

  var visTimer = null;
  function applyVisibility() {
    current.visible.fill(1);
    current.groups.forEach(function (g) { if (g.hidden) g.indices.forEach(function (i) { current.visible[i] = 0; }); });
    clearTimeout(visTimer);
    visTimer = setTimeout(function () { rebuildAll(false); }, 60);
  }

  $('btnCsv').onclick = function () {
    if (!current) return;
    var lines = ['Block,ID,Count,Stacks of 64,Remainder,Shulker boxes'];
    current.groups.forEach(function (g) {
      lines.push('"' + g.label.replace(/"/g, '""') + '",' + g.name + ',' + g.count + ',' + Math.floor(g.count / 64) + ',' + (g.count % 64) + ',' + (g.count / 1728).toFixed(2));
    });
    download(new Blob([lines.join('\r\n')], { type: 'text/csv' }), baseName(current.schem.fileName) + '-materials.csv');
  };
  function baseName(n) { return (n || 'schematic').replace(/\.[^.]+$/, ''); }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- layers ----------
  function setupLayerControls() {
    var H = current.schem.height;
    ['yMin', 'yMax'].forEach(function (id) { $(id).min = 0; $(id).max = H - 1; });
    $('yMin').value = 0; $('yMax').value = H - 1; $('singleLayer').checked = false;
    updateLayerLabels();
  }
  function updateLayerLabels() {
    $('yMinOut').textContent = current.yMin; $('yMaxOut').textContent = current.yMax + ' / ' + (current.schem.height - 1);
    $('yMin').value = current.yMin; $('yMax').value = current.yMax;
  }
  function setLayers(yMin, yMax) {
    var H = current.schem.height;
    yMin = Math.max(0, Math.min(H - 1, yMin)); yMax = Math.max(0, Math.min(H - 1, yMax));
    if ($('singleLayer').checked) yMin = yMax;
    if (yMin > yMax) yMin = yMax;
    var old = [current.yMin, current.yMax];
    if (old[0] === yMin && old[1] === yMax) return;
    current.yMin = yMin; current.yMax = yMax;
    updateLayerLabels();
    scheduleLayerRebuild(old);
  }
  var layerTimer = null, pendingOld = null;
  function scheduleLayerRebuild(old) {
    if (!pendingOld) pendingOld = old;
    clearTimeout(layerTimer);
    layerTimer = setTimeout(function () {
      var o = pendingOld; pendingOld = null;
      // Only chunks near the changed layer boundaries need rebuilding
      var set = [];
      [[o[0], current.yMin], [o[1], current.yMax]].forEach(function (p) {
        if (p[0] !== p[1]) set.push([Math.min(p[0], p[1]) - 1, Math.max(p[0], p[1]) + 1]);
      });
      rebuildRanges(set);
    }, 30);
  }
  $('yMax').oninput = function () {
    var v = +this.value;
    setLayers($('singleLayer').checked ? v : Math.min(current.yMin, v), v);
  };
  $('yMin').oninput = function () {
    var v = +this.value;
    if ($('singleLayer').checked) setLayers(v, v); else setLayers(v, Math.max(v, current.yMax));
  };
  $('singleLayer').onchange = function () {
    if (this.checked) setLayers(current.yMax, current.yMax);
    else setLayers(0, current.yMax);
  };
  function stepLayer(d) {
    if (!current) return;
    if ($('singleLayer').checked) setLayers(current.yMax + d, current.yMax + d);
    else setLayers(current.yMin, current.yMax + d);
  }
  $('layerUp').onclick = function () { stepLayer(1); };
  $('layerDown').onclick = function () { stepLayer(-1); };
  $('layerAll').onclick = function () { $('singleLayer').checked = false; setLayers(0, current.schem.height - 1); };

  $('optAO').onchange = function () { rebuildAll(false); };
  $('optGrid').onchange = function () { if (grid) grid.visible = this.checked; requestRender(); };
  $('optBounds').onchange = function () { if (bounds) bounds.visible = this.checked; requestRender(); };

  // ---------- meshing ----------
  function disposeChunks() {
    if (!current) { while (chunkGroup.children.length) disposeObj(chunkGroup.children[0]); return; }
    current.chunks.forEach(function (c) { c.meshes.forEach(disposeObj); });
    current.chunks.clear();
    while (chunkGroup.children.length) disposeObj(chunkGroup.children[0]);
  }
  function disposeObj(m) { chunkGroup.remove(m); if (m.geometry) m.geometry.dispose(); }

  function makeCtx() {
    var c = current;
    c.ctx = Mesher.makeContext(c.schem, c.looks, c.visible, c.yMin, c.yMax, $('optAO').checked);
    return c.ctx;
  }

  function geometryFrom(part) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(part.colors, 4, true));
    g.setIndex(new THREE.BufferAttribute(part.indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  function buildChunkMeshes(ctx, cx, cy, cz) {
    var key = cx + ',' + cy + ',' + cz;
    var old = current.chunks.get(key);
    if (old) old.meshes.forEach(disposeObj);
    var r = Mesher.buildChunk(ctx, cx * CHUNK, cy * CHUNK, cz * CHUNK, CHUNK);
    var meshes = [];
    if (r.opaque.indices.length) { var m1 = new THREE.Mesh(geometryFrom(r.opaque), matOpaque); m1.matrixAutoUpdate = false; chunkGroup.add(m1); meshes.push(m1); }
    if (r.translucent.indices.length) { var m2 = new THREE.Mesh(geometryFrom(r.translucent), matTrans); m2.matrixAutoUpdate = false; m2.renderOrder = 1; chunkGroup.add(m2); meshes.push(m2); }
    current.chunks.set(key, { meshes: meshes });
    return (r.opaque.indices.length + r.translucent.indices.length) / 3;
  }

  async function runChunks(list, showProgress) {
    var token = ++buildToken, ctx = makeCtx();
    var t0 = performance.now(), lastYield = t0, overlayShown = false;
    for (var i = 0; i < list.length; i++) {
      if (token !== buildToken) return false;
      try { buildChunkMeshes(ctx, list[i][0], list[i][1], list[i][2]); }
      catch (e) {
        if (overlayShown) hideOverlay();
        Problems.report('error', current && current.schem.fileName, 'Part of the 3D view could not be built' + (e instanceof RangeError ? ' because the computer ran out of memory.' : '.'),
          'Close other tabs or programs and open the file again, or hide some block types to make the build lighter.', (e && e.stack) || String(e));
        showToast('Part of the build could not be shown. See Problems.', true);
        return false;
      }
      var now = performance.now();
      if (now - lastYield > 40) {
        if (showProgress && !overlayShown && now - t0 > 250) { showOverlay('Building 3D view…', i / list.length); overlayShown = true; }
        if (overlayShown) setOverlay('Building 3D view…', i / list.length);
        requestRender();
        await nextFrame();
        lastYield = performance.now();
      }
    }
    if (overlayShown) hideOverlay();
    requestRender();
    return true;
  }

  function allChunks() {
    var s = current.schem, out = [];
    var nx = Math.ceil(s.width / CHUNK), ny = Math.ceil(s.height / CHUNK), nz = Math.ceil(s.length / CHUNK);
    for (var cy = 0; cy < ny; cy++) for (var cz = 0; cz < nz; cz++) for (var cx = 0; cx < nx; cx++) out.push([cx, cy, cz]);
    return out;
  }
  function rebuildAll(first) {
    if (!current) return;
    if (first) disposeChunks();
    var c = current; c.dirtyAll = true;
    return runChunks(allChunks(), true).then(function (done) { if (done && c === current) c.dirtyAll = false; });
  }
  function rebuildRanges(ranges) {
    if (current.dirtyAll) return rebuildAll(false); // a full rebuild was interrupted
    var list = allChunks().filter(function (c) {
      var y0 = c[1] * CHUNK, y1 = y0 + CHUNK - 1;
      return ranges.some(function (r) { return r[1] >= y0 && r[0] <= y1; });
    });
    return runChunks(list, true);
  }

  function setupHelpers() {
    var s = current.schem;
    if (grid) { root3d.remove(grid); grid.geometry.dispose(); }
    if (bounds) { root3d.remove(bounds); bounds.geometry.dispose(); }
    var size = Math.max(s.width, s.length) + 8;
    size += size % 2;
    grid = new THREE.GridHelper(size, size, 0x888888, 0x888888);
    grid.material.transparent = true; grid.material.opacity = 0.5;
    grid.position.set(Math.round(s.width / 2), -0.01, Math.round(s.length / 2)); // lines on block edges
    grid.visible = $('optGrid').checked;
    root3d.add(grid);
    var bg = new THREE.EdgesGeometry(new THREE.BoxGeometry(s.width, s.height, s.length));
    bounds = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x888888 }));
    bounds.position.set(s.width / 2, s.height / 2, s.length / 2);
    bounds.visible = $('optBounds').checked;
    root3d.add(bounds);
    updateSceneColors();
  }

  // ---------- camera views ----------
  function fitView(view, instant) {
    if (!current) return;
    var s = current.schem;
    var center = new THREE.Vector3(s.width / 2, s.height / 2, s.length / 2);
    var r = Math.sqrt(s.width * s.width + s.height * s.height + s.length * s.length) / 2;
    var dist = r / Math.sin(camera.fov * Math.PI / 360) * (camera.aspect < 1 ? 1.5 / Math.max(0.5, camera.aspect) : 1.05);
    controls.maxRadius = Math.max(200, dist * 8);
    var th = Math.PI / 4, ph = Math.PI / 3.2;
    if (view === 'top') { th = 0; ph = 0.0001; }
    if (view === 'front') { th = 0; ph = Math.PI / 2; }
    if (view === 'side') { th = Math.PI / 2; ph = Math.PI / 2; }
    if (instant) { controls.target.copy(center); controls.radius = dist; controls.theta = th; controls.phi = ph; controls.update(); }
    else controls.animateTo(center, dist, th, ph);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) { b.onclick = function () { fitView(b.dataset.view); }; });

  $('btnShot').onclick = screenshot;
  function screenshot() {
    if (!current) return;
    hoverBox.visible = false;
    renderer.render(scene, camera);
    canvas.toBlob(function (blob) { if (blob) download(blob, baseName(current.schem.fileName) + '.png'); });
    requestRender();
  }
  $('btnFull').onclick = toggleFull;
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
  }

  // ---------- hover / pick ----------
  var raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2(), lastPick = null, hoverPending = null;
  canvas.addEventListener('pointermove', function (e) {
    if (e.buttons) { hideHover(); return; }
    var had = hoverPending; hoverPending = e;
    if (!had) requestAnimationFrame(doHover);
  });
  canvas.addEventListener('pointerleave', hideHover);
  function pickAt(clientX, clientY) {
    if (!current || !current.ctx) return null;
    var rect = canvas.getBoundingClientRect();
    mouse.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    var o = raycaster.ray.origin, d = raycaster.ray.direction;
    return Mesher.raycast(current.ctx, o.x, o.y, o.z, d.x, d.y, d.z, camera.far);
  }
  function doHover() {
    var e = hoverPending; if (!e) return; hoverPending = null;
    var hit = pickAt(e.clientX, e.clientY);
    if (!hit) { hideHover(); return; }
    var p = current.schem.palette[hit.index];
    hoverBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5); hoverBox.visible = true; requestRender();
    var tip = $('tooltip');
    var props = Object.keys(p.props).map(function (k) { return k + '=' + p.props[k]; }).join(', ');
    tip.innerHTML = '<b>' + esc(prettyName(p.name)) + '</b><div class="muted">' + esc(p.name) + (p.legacy ? ' (old ID ' + esc(p.legacy) + ')' : '') + '</div>' +
      (props ? '<div class="props">' + esc(props) + '</div>' : '') + '<div class="muted">x ' + hit.x + ', y ' + hit.y + ', z ' + hit.z + '</div>';
    tip.hidden = false;
    var rect = stage.getBoundingClientRect(), tx = e.clientX - rect.left + 16, ty = e.clientY - rect.top + 16;
    if (tx + tip.offsetWidth > rect.width - 8) tx = e.clientX - rect.left - tip.offsetWidth - 12;
    if (ty + tip.offsetHeight > rect.height - 8) ty = e.clientY - rect.top - tip.offsetHeight - 12;
    tip.style.left = Math.max(4, tx) + 'px'; tip.style.top = Math.max(4, ty) + 'px';
    lastPick = { hit: hit, name: p.name };
  }
  function hideHover() { if (hoverBox.visible) { hoverBox.visible = false; requestRender(); } $('tooltip').hidden = true; lastPick = null; }
  canvas.addEventListener('click', function (e) {
    if (controls.dragDistance() > 4) return;
    var hit = pickAt(e.clientX, e.clientY);
    if (!hit) return;
    var name = current.schem.palette[hit.index].name;
    if ($('blockSearch').value) { $('blockSearch').value = ''; renderBlockList(); }
    var li = $('blockList').querySelector('li[data-name="' + CSS.escape(name) + '"]');
    if (li) { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); }
  });

  // ---------- keyboard ----------
  window.addEventListener('keydown', function (e) {
    if (!current || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target; if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range') || (t && t.tagName === 'TEXTAREA')) return;
    var k = e.key;
    if (k === '[') stepLayer(-1);
    else if (k === ']') stepLayer(1);
    else if (k === '1') fitView('iso'); else if (k === '2') fitView('top'); else if (k === '3') fitView('front'); else if (k === '4') fitView('side');
    else if (k === 'r' || k === 'R') fitView('iso');
    else if (k === 'p' || k === 'P') screenshot();
    else if (k === 'f' || k === 'F') toggleFull();
    else return;
    e.preventDefault();
  });

  // ---------- misc UI ----------
  $('btnHelp').onclick = function () { $('helpDialog').showModal(); };
  $('btnSidebar').onclick = function () { $('sidebar').classList.toggle('open'); };
  function closeSidebarMobile() { $('sidebar').classList.remove('open'); }
  stage.addEventListener('pointerdown', closeSidebarMobile);

  function showOverlay(text, p) { $('overlay').hidden = false; setOverlay(text, p); }
  function setOverlay(text, p) { $('overlayText').textContent = text; $('progressBar').style.width = Math.round((p || 0) * 100) + '%'; }
  function hideOverlay() { $('overlay').hidden = true; }
  var toastTimer = null;
  function showToast(msg, isErr) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 7000 : 3500);
  }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }

  // ?url=... loads a schematic from a web address (the server must allow it)
  try {
    var params = new URLSearchParams(location.search), urls = params.getAll('url');
    if (urls.length) {
      showOverlay('Downloading…', 0);
      Promise.all(urls.map(function (url) {
        return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then(function (buf) { return { name: decodeURIComponent(url.split('/').pop().split('?')[0]) || 'schematic', bytes: new Uint8Array(buf) }; })
          .catch(function (e) {
            var nm = decodeURIComponent(url.split('/').pop().split('?')[0]) || url;
            var local = url.indexOf('/open/') === 0; // a file given to the Windows app
            var msg = local ? 'This file could not be found or opened on your computer.' : /HTTP 404/.test(e.message) ? 'The file was not found at this address.' : /HTTP/.test(e.message) ? 'The server refused to send the file (' + e.message + ').' : 'The file could not be downloaded.';
            var hint = local ? 'It may have been moved, renamed or deleted, or another program may be using it.' : /HTTP/.test(e.message) ? 'Check that the link is correct and the file still exists.' : 'Check your internet connection. Files from other websites only load if that site allows it; otherwise download the file and open it here.';
            Problems.report('error', nm, msg, hint, url + '\n' + e.message);
            files.push({ name: nm, error: { message: msg, hint: hint, detail: url + '\n' + e.message } });
            return null;
          });
      })).then(function (list) {
        hideOverlay(); list = list.filter(Boolean);
        if (list.length) openBuffers(list);
        else { renderFileList(); var bad = files.filter(function (f) { return f.error; })[0]; if (bad) showFileError(bad); }
      });
    } else if (params.get('demo') !== null) { $('btnDemo').click(); }
  } catch (e) {}

  updateSceneColors();
  window.SchemViewer = { openBuffers: openBuffers, get current() { return current; }, fitView: fitView, setLayers: function (a, b) { setLayers(a, b); } };
})();
