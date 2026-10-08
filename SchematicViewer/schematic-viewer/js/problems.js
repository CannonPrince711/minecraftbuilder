/* Problems list: every error and warning the viewer runs into, shown in the side panel with
   a plain explanation, what to try, and technical details that can be copied.
   In the Windows app, problems are also written to a log file. Loaded before everything else. */
(function () {
  'use strict';
  var list = [];
  var $ = function (id) { return document.getElementById(id); };
  var inApp = location.protocol === 'http:' && location.hostname === '127.0.0.1';
  var appLog = false; // true once the Windows app answered

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function timeStr(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  // level: 'error' | 'warning'
  function report(level, file, message, hint, detail) {
    var key = level + '|' + file + '|' + message + '|' + (detail || '');
    for (var i = 0; i < list.length; i++) if (list[i].key === key) { list[i].count++; list[i].time = new Date(); render(); return list[i]; }
    var p = { key: key, level: level, file: file || '', message: message, hint: hint || '', detail: detail || '', time: new Date(), count: 1 };
    list.push(p);
    if (list.length > 200) list.shift();
    (level === 'error' ? console.error : console.warn)('[Schematic Viewer] ' + (file ? file + ': ' : '') + message + (detail ? '\n' + detail : ''));
    sendToApp(p);
    render();
    return p;
  }
  function fromError(e, file) {
    if (!e) e = new Error('Unknown error');
    var isFriendly = e.name === 'SchemError';
    return report('error', file,
      isFriendly ? e.message : 'Something went wrong while opening this file.',
      isFriendly ? e.hint : 'Try opening the file again. If it keeps happening, use "Copy details" and send them along with the file.',
      isFriendly ? (e.detail || '') : ((e.name || 'Error') + ': ' + (e.message || e) + (e.stack ? '\n' + e.stack : '')));
  }

  function asText(p) {
    return '[' + timeStr(p.time) + '] ' + p.level.toUpperCase() + (p.file ? ' in ' + p.file : '') + ': ' + p.message +
      (p.hint ? '\n  What to try: ' + p.hint : '') + (p.detail ? '\n  Details: ' + p.detail.replace(/\n/g, '\n    ') : '') + (p.count > 1 ? '\n  (happened ' + p.count + ' times)' : '');
  }
  function allText() {
    return 'Schematic Viewer problem report\n' + new Date().toString() + '\n' + navigator.userAgent + '\n\n' + list.map(asText).join('\n\n');
  }

  function sendToApp(p) {
    if (!inApp) return;
    try { fetch('/__log', { method: 'POST', body: asText(p) }).catch(function () {}); } catch (e) {}
  }

  function copyText(text, btn) {
    function done(ok) { if (btn) { var t = btn.textContent; btn.textContent = ok ? 'Copied' : 'Select and copy'; setTimeout(function () { btn.textContent = t; }, 1600); } }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove(); done(ok);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render() {
    var panel = $('panelProblems'), ul = $('problemList'), badge = $('btnProblems');
    if (!panel || !ul) return;
    var errors = list.filter(function (p) { return p.level === 'error'; }).length, warns = list.length - errors;
    panel.hidden = list.length === 0;
    $('problemCount').textContent = list.length ? '(' + list.length + ')' : '';
    if (badge) {
      badge.hidden = list.length === 0;
      badge.className = 'btn small problems-badge ' + (errors ? 'has-errors' : 'has-warnings');
      badge.textContent = (errors ? errors + ' error' + (errors > 1 ? 's' : '') : '') + (errors && warns ? ', ' : '') + (warns ? warns + ' warning' + (warns > 1 ? 's' : '') : '');
    }
    ul.innerHTML = '';
    list.slice().reverse().forEach(function (p) {
      var li = el('li', 'problem ' + p.level);
      var head = el('div', 'phead');
      head.appendChild(el('span', 'picon', p.level === 'error' ? '✕' : '!'));
      var body = el('div', 'pbody');
      if (p.file) body.appendChild(el('div', 'pfile', p.file));
      body.appendChild(el('div', 'pmsg', p.message + (p.count > 1 ? ' (×' + p.count + ')' : '')));
      if (p.hint) body.appendChild(el('div', 'phint', p.hint));
      if (p.detail) {
        var d = el('details', 'pdetail'); d.appendChild(el('summary', null, 'Technical details'));
        d.appendChild(el('pre', null, p.detail)); body.appendChild(d);
      }
      body.appendChild(el('div', 'ptime', timeStr(p.time)));
      head.appendChild(body); li.appendChild(head); ul.appendChild(li);
    });
    if ($('btnOpenLog')) $('btnOpenLog').hidden = !appLog;
  }

  function wire() {
    if ($('btnCopyProblems')) $('btnCopyProblems').onclick = function () { copyText(allText(), this); };
    if ($('btnClearProblems')) $('btnClearProblems').onclick = function () { list = []; render(); };
    if ($('btnOpenLog')) $('btnOpenLog').onclick = function () { fetch('/__openlog', { method: 'POST' }).catch(function () {}); };
    if ($('btnProblems')) $('btnProblems').onclick = function () {
      var sb = $('sidebar'); if (sb) sb.classList.add('open');
      var panel = $('panelProblems'); if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (inApp) fetch('/__ping').then(function (r) { if (r.ok) { appLog = true; render(); } }).catch(function () {});
    render();
  }

  // Catch failures anywhere: scripts that did not load, and unexpected errors.
  window.addEventListener('error', function (ev) {
    var t = ev.target;
    if (t && t !== window && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
      report('error', null, 'Part of the viewer did not load (' + (t.src || t.href || '').split('/').slice(-2).join('/') + ').',
        'Keep all the viewer files together in one folder (index.html with the css, js and vendor folders), then reload the page.');
      return;
    }
    report('error', null, 'Something went wrong inside the viewer.', 'Reload the page and try again. If it keeps happening, use "Copy details" and send them along.',
      ev.error && ev.error.stack ? ev.error.stack : (ev.message + (ev.filename ? ' at ' + ev.filename + ':' + ev.lineno : '')));
  }, true);
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    report('error', null, 'Something went wrong inside the viewer.', 'Reload the page and try again. If it keeps happening, use "Copy details" and send them along.',
      r && r.stack ? r.stack : String(r));
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  window.Problems = { report: report, fromError: fromError, list: function () { return list.slice(); }, copyText: copyText, asText: asText };
})();
