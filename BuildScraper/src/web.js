// Finding and downloading schematic files from a web link.
// Browsers only let a page read another site's files when that site allows it (CORS),
// so this works for direct file links on hosts like GitHub, and for pages that permit it.

export const SCHEM_EXT = /\.(schem|schematic|litematic|nbt|zip)(?:$|[?#])/i;

// When opened through BuildScraper.exe, a local helper fetches pages for us (no CORS limits,
// robots.txt checked, one request per second per site).
const API = typeof window !== 'undefined' ? window.MCBS_API : null;
export const hasHelper = () => !!API;

export async function fetchBytes(url, { accept } = {}) {
  if (API) {
    const q = new URLSearchParams({ url, t: API.token });
    if (accept) q.set('accept', accept);
    const res = await fetch(`/api/fetch?${q}`);
    if (res.headers.get('content-type')?.includes('json')) throw new Error((await res.json()).error || 'Download failed');
    const status = +(res.headers.get('x-status') || res.status);
    if (status >= 400) throw new Error(`The site answered ${status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('x-content-type') || '', finalUrl: res.headers.get('x-final-url') || url, disposition: res.headers.get('x-disposition') || '' };
  }
  let res;
  try { res = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow', headers: accept ? { accept } : {} }); }
  catch { throw new Error(BLOCKED); }
  if (!res.ok) throw new Error(`The site answered ${res.status} ${res.statusText || ''}`.trim());
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') || '', finalUrl: res.url || url, disposition: res.headers.get('content-disposition') || '' };
}

export const BLOCKED = 'This site does not let other web pages read its files. Download the file in your browser and drop it on the Convert tab, or run the command-line helper that comes with Build Scraper (node mcbs.mjs fetch URL).';

/** Is this a schematic/NBT payload (gzip or raw NBT compound)? */
export function looksLikeNbt(u8) {
  return u8.length > 3 && ((u8[0] === 0x1f && u8[1] === 0x8b) || (u8[0] === 0x0a && u8[1] === 0x00));
}
export const looksLikeZip = (u8) => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b;

/** Pull candidate download links out of an HTML page. */
export function findLinks(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Map();
  const add = (href, label) => {
    let u; try { u = new URL(href, baseUrl); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    // GitHub "blob" pages -> raw file
    if (u.hostname === 'github.com' && /\/blob\//.test(u.pathname)) { u.hostname = 'raw.githubusercontent.com'; u.pathname = u.pathname.replace('/blob/', '/'); }
    const key = u.href;
    if (!seen.has(key)) seen.set(key, { url: key, label: (label || '').trim().slice(0, 120) || decodeURIComponent(u.pathname.split('/').pop() || u.hostname) });
  };
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    const text = a.textContent || a.getAttribute('title') || '';
    if (SCHEM_EXT.test(href) || (a.hasAttribute('download') && SCHEM_EXT.test(a.getAttribute('download') || href))) add(href, text);
  }
  return [...seen.values()];
}

export function filenameFor(url, disposition) {
  const m = disposition && disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) return decodeURIComponent(m[1]);
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'download'; } catch { return 'download'; }
}
