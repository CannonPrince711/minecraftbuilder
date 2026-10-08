// Local server used by BuildScraper.exe (and `node mcbs.mjs serve`): serves the website and
// fetches web pages on its behalf, so searching sites isn't blocked by browser CORS rules.
// It only listens on 127.0.0.1 and every API call needs a per-run token.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { LOG_FILE, appendLog } from './fatal.mjs';
import { libraryRoot, setLibraryRoot, listLibrary, saveToLibrary, readFromLibrary, moveInLibrary, revealInLibrary } from './library.mjs';

function logFailure(what, detail) {
  console.log(`  ! [${new Date().toISOString()}] ${what}: ${detail}`);
  appendLog(what, detail);
}
import PAGE from '../dist/index.html';

const UA = 'BuildScraper/1.1 (+local schematic converter; one request at a time)';
const MIN_GAP_MS = 1100; // per host
const MAX_BYTES = 300 * 1024 * 1024;

const robotsCache = new Map();
async function robotsAllows(u) {
  if (u.hostname === 'api.github.com' || u.hostname === 'raw.githubusercontent.com') return true; // APIs meant for programs
  let rules = robotsCache.get(u.origin);
  if (!rules) {
    rules = [];
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        let applies = false;
        for (const raw of (await r.text()).split(/\r?\n/)) {
          const line = raw.replace(/#.*/, '').trim();
          const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
          if (!m) continue;
          const k = m[1].toLowerCase(), v = m[2].trim();
          if (k === 'user-agent') applies = v === '*' || /buildscraper/i.test(v);
          else if (applies && v) rules.push({ allow: k === 'allow', path: v });
        }
      }
    } catch {}
    robotsCache.set(u.origin, rules);
  }
  const path = u.pathname + u.search;
  const toRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  const best = rules.filter((r) => toRe(r.path).test(path)).sort((a, b) => b.path.length - a.path.length)[0];
  return !best || best.allow;
}

const lastHit = new Map();
async function politeWait(host) {
  const now = Date.now();
  const next = Math.max(now, (lastHit.get(host) || 0) + MIN_GAP_MS);
  lastHit.set(host, next);
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}

function isPrivateHost(h) {
  if (process.env.MCBS_ALLOW_LOCAL === '1') return false; // tests only
  return h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]';
}

async function handleFetch(req, res, params) {
  let u;
  try { u = new URL(params.get('url')); } catch { return json(res, 400, { error: 'That is not a valid web address.' }); }
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) return json(res, 400, { error: 'Only public http(s) addresses can be fetched.' });
  if (!(await robotsAllows(u))) return json(res, 403, { error: `${u.hostname} asks tools not to download this page (robots.txt).` });
  await politeWait(u.hostname);
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, accept: params.get('accept') || '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
    const len = +(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return json(res, 413, { error: 'That file is too large.' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) logFailure(`Download ${u.href}`, `site answered ${r.status}`);
    res.writeHead(r.ok ? 200 : 502, {
      'content-type': 'application/octet-stream',
      'x-status': String(r.status), 'x-final-url': r.url || u.href,
      'x-content-type': r.headers.get('content-type') || '', 'x-disposition': r.headers.get('content-disposition') || '',
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch (e) {
    json(res, 502, { error: `Could not reach ${u.hostname}: ${e.message}` });
  }
}

async function handleLibrary(req, res, url) {
  const q = url.searchParams, post = req.method === 'POST';
  try {
    switch (url.pathname) {
      case '/api/library':
        return json(res, 200, q.get('only') === 'root' ? { root: libraryRoot() } : listLibrary());
      case '/api/library/file': {
        const buf = readFromLibrary(q.get('path'));
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(buf);
      }
      case '/api/library/save': {
        if (!post) break;
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > 300 * 1024 * 1024) return json(res, 413, { error: 'That file is too large.' }); chunks.push(c); }
        return json(res, 200, { path: saveToLibrary(q.get('path'), Buffer.concat(chunks)) });
      }
      case '/api/library/move':
        if (!post) break;
        return json(res, 200, { path: moveInLibrary(q.get('path'), q.get('to')) });
      case '/api/library/root':
        if (!post) break;
        return json(res, 200, { root: setLibraryRoot(q.get('dir')) });
      case '/api/library/open':
        if (!post) break;
        revealInLibrary(q.get('path'));
        return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Unknown library request.' });
  } catch (e) {
    return json(res, e.code === 'ENOENT' ? 404 : 400, { error: e.code === 'ENOENT' ? 'That build is no longer in the folder. Press Refresh.' : e.message });
  }
}

function json(res, code, obj) {
  if (code >= 400 && obj.error) {
    let what = 'Request';
    try { const q = new URL(res.req.url, 'http://x').searchParams.get('url'); if (q) what = `Download ${q}`; } catch {}
    logFailure(what, obj.error);
  }
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export async function serve({ port = 8765, open = true } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const page = PAGE.replace('<script>window.MCBS_SAMPLE', `<script>window.MCBS_API=${JSON.stringify({ token })};</script>\n<script>window.MCBS_SAMPLE`);
  process.on('uncaughtException', (e) => logFailure('Unexpected error', e.stack || e.message));
  process.on('unhandledRejection', (e) => logFailure('Unexpected error', (e && e.stack) || String(e)));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(page);
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.searchParams.get('t') !== token) return json(res, 403, { error: 'Bad token. Reload the page from the Build Scraper window.' });
      if (url.pathname === '/api/fetch') return handleFetch(req, res, url.searchParams);
      if (url.pathname === '/api/ping') return json(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/library')) return handleLibrary(req, res, url);
      if (url.pathname === '/api/log' && req.method === 'POST') {
        let body = ''; for await (const c of req) body += c;
        try { fs.appendFileSync(LOG_FILE, body.slice(0, 100000) + '\n'); } catch {}
        return json(res, 200, { ok: true, file: LOG_FILE });
      }
    }
    res.writeHead(404); res.end('Not found');
  });
  const listen = (p) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, '127.0.0.1', () => resolve(server.address().port)); });
  let actual;
  try { actual = await listen(port); } catch (e) {
    if (e && e.code !== 'EADDRINUSE') logFailure(`Could not use port ${port}`, e.message);
    actual = await listen(0);
  }
  server.on('error', (e) => logFailure('Local server error', e.stack || e.message));
  setInterval(() => {}, 1 << 30); // stay open until the window is closed, whatever the runtime does with idle sockets
  globalThis.MCBS_RUNNING = true;
  const addr = `http://127.0.0.1:${actual}/`;
  console.log(`\n  Build Scraper is running at ${addr}\n  Your browser should open by itself. Keep this window open while you use it; close it to quit.\n  Problems are listed here and saved to ${LOG_FILE}\n`);
  if (open) openBrowser(addr);
  return server;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {}
}
