// Category search with GitHub answers faked (no network needed).
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
const asked = [];
await page.route('**/api/fetch?**', (route) => {
  const u = new URL(new URL(route.request().url()).searchParams.get('url'));
  asked.push(u.pathname + u.search);
  let body;
  if (u.pathname === '/search/repositories') body = { items: [{ full_name: 'me/builds', name: 'builds', description: 'minecraft schematics: towers and castles', default_branch: 'main', html_url: 'https://github.com/me/builds', topics: [], license: { spdx_id: 'MIT' } }] };
  else body = { tree: ['towers/wizard tower.schem', 'castles/castle tower.schem', 'castles/keep.schem', 'misc/lighthouse.litematic', 'houses/cottage.schem'].map((path) => ({ path, type: 'blob', size: 2048 })) };
  route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-status': '200' }, body: JSON.stringify(body) });
});
await page.goto(process.argv[2]);
await page.click('#tab-web');
const run = async (q, cat) => {
  await page.fill('#search-q', q); await page.selectOption('#search-cat', cat);
  await page.click('#search-go');
  await page.waitForFunction(() => !document.getElementById('search-go').disabled);
  console.log(`q="${q}" cat="${cat}" ->`, await page.$$eval('#search-list .item .name', (els) => els.map((e) => e.textContent.trim())), '|', await page.locator('#search-status').textContent());
};
await run('', 'Towers');
await run('wizard', 'Towers');
await run('tower', '');
await run('', '');
console.log('github queries:', asked.filter((a) => a.startsWith('/search')));
await page.screenshot({ path: process.env.SHOT });
console.log('errors', errs);
await browser.close();
