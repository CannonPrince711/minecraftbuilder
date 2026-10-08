// Keyword search for schematic files.
//  - GitHub: public repositories matching the terms, then their .schem/.schematic/.litematic/.nbt files.
//  - A site you choose: a small, polite crawl of that one site, collecting schematic links that match.
import { fetchBytes, SCHEM_EXT } from './web.js';

const FILE_EXT = /\.(schem|schematic|litematic|nbt)$/i;
const td = new TextDecoder();

export function terms(q) {
  return q.toLowerCase().split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}
const norm = (s) => (s || '').toLowerCase().replace(/%20|[_\-./]+/g, ' ');
/** Every term must appear somewhere in the given text. */
export function matches(text, ts) {
  const t = norm(text);
  return ts.every((w) => t.includes(w));
}

async function getJson(url) {
  const r = await fetchBytes(url, { accept: 'application/vnd.github+json' });
  return JSON.parse(td.decode(r.bytes));
}

/**
 * Search public GitHub repositories. Unauthenticated GitHub allows about 10 searches a minute,
 * so this looks at a handful of repositories per search.
 */
export async function searchGitHub(q, { onProgress, maxRepos = 8, signal } = {}) {
  const ts = terms(q);
  if (!ts.length) return [];
  const query = encodeURIComponent(`${ts.join(' ')} minecraft schematic`);
  onProgress?.('Searching GitHub repositories…');
  let repos = (await getJson(`https://api.github.com/search/repositories?q=${query}&per_page=${maxRepos}&sort=stars`)).items || [];
  if (!repos.length) repos = (await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(ts.join(' ') + ' schematic')}&per_page=${maxRepos}`)).items || [];
  const out = [];
  for (const [i, repo] of repos.entries()) {
    if (signal?.aborted) break;
    onProgress?.(`Looking inside ${repo.full_name} (${i + 1} of ${repos.length})…`);
    let tree;
    try { tree = await getJson(`https://api.github.com/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`); }
    catch { continue; }
    const repoText = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`;
    const repoMatches = matches(repoText, ts);
    for (const f of tree.tree || []) {
      if (f.type !== 'blob' || !FILE_EXT.test(f.path)) continue;
      if (!repoMatches && !matches(f.path, ts)) continue;
      out.push({
        url: `https://raw.githubusercontent.com/${repo.full_name}/${encodeURIComponent(repo.default_branch)}/${f.path.split('/').map(encodeURIComponent).join('/')}`,
        label: f.path.split('/').pop(),
        where: `${repo.full_name}/${f.path}`,
        page: `${repo.html_url}/blob/${repo.default_branch}/${f.path}`,
        size: f.size,
        license: repo.license && repo.license.spdx_id,
      });
      if (out.length >= 200) return out;
    }
  }
  return out;
}

/**
 * Crawl one site looking for schematic links whose name, link text or page title match the terms.
 * startUrl may contain {q}, which is replaced by the search terms (for a site's own search page).
 */
export async function searchSite(startUrl, q, { maxPages = 25, onProgress, signal, delay = 700 } = {}) {
  const ts = terms(q);
  const first = new URL(startUrl.includes('{q}') ? startUrl.replace('{q}', encodeURIComponent(ts.join(' '))) : startUrl);
  const host = first.hostname;
  const queue = [{ url: first.href, score: 1e9 }];
  const seen = new Set([first.href]);
  const found = new Map();
  let pages = 0;
  while (queue.length && pages < maxPages) {
    if (signal?.aborted) break;
    queue.sort((a, b) => b.score - a.score);
    const { url } = queue.shift();
    pages++;
    onProgress?.(`Reading page ${pages} of up to ${maxPages}: ${url}`);
    let r;
    try { r = await fetchBytes(url); }
    catch (e) { if (pages === 1) throw e; continue; }
    if (!/html|xml|text/i.test(r.type) && r.bytes[0] !== 0x3c) continue;
    const doc = new DOMParser().parseFromString(td.decode(r.bytes), 'text/html');
    const title = (doc.querySelector('title')?.textContent || '') + ' ' + (doc.querySelector('h1')?.textContent || '');
    const pageMatches = matches(title, ts);
    for (const a of doc.querySelectorAll('a[href]')) {
      let u;
      try { u = new URL(a.getAttribute('href'), r.finalUrl); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = '';
      const text = `${a.textContent || ''} ${a.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
      const name = decodeURIComponent(u.pathname.split('/').pop() || '');
      if (SCHEM_EXT.test(u.pathname)) {
        if (pageMatches || matches(`${name} ${text}`, ts)) {
          if (!found.has(u.href)) found.set(u.href, { url: u.href, label: name || text, where: title.trim().slice(0, 100) || url, page: r.finalUrl });
        }
        continue;
      }
      if (u.hostname !== host || seen.has(u.href)) continue;
      if (/\.(png|jpe?g|gif|webp|svg|css|js|ico|pdf|mp4|webm|mp3|woff2?)$/i.test(u.pathname)) continue;
      if (/(login|logout|signin|signup|register|account|cart|wp-admin)/i.test(u.pathname)) continue;
      seen.add(u.href);
      // look at pages that mention the terms first
      const score = ts.filter((w) => norm(`${text} ${u.pathname}`).includes(w)).length * 10 - u.pathname.split('/').length;
      queue.push({ url: u.href, score });
    }
    if (delay) await new Promise((res) => setTimeout(res, delay));
  }
  return { results: [...found.values()], pages };
}
