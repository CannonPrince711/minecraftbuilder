// Categorised saving, the My builds tab and category search, against `node dist/mcbs.mjs serve`.
// Usage: node test/ui6.mjs http://127.0.0.1:PORT/   (server started with MCBS_LIBRARY=<empty dir>)
import { chromium } from 'playwright';
import fs from 'node:fs';
const lib = process.env.MCBS_LIBRARY;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('dialog', d => d.accept(process.env.NEWROOT || ''));
await page.goto(process.argv[2]);
// world tab: name drives the category until the user picks one
await page.click('#try-sample');
await page.waitForTimeout(4000);
await page.fill('#name', 'castle-keep');
console.log('guessed category:', await page.inputValue('#cat'));
const box = await page.locator('#map').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx - 60, cy - 60); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 30, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(300);
await page.click('#export');
await page.waitForTimeout(2500);
console.log('world save status:', await page.locator('#status').textContent());
// convert tab: per-file categories, Save all
await page.click('#tab-convert');
await page.setInputFiles('#files-input', ['test/fixtures/samples/cottage.litematic', 'test/fixtures/samples/big tower.schem', 'test/fixtures/samples/legacy-1.12-blocks.schematic']);
await page.waitForTimeout(1500);
console.log('convert categories:', await page.$$eval('#conv-list input.catin', (els) => els.map((e) => e.value)));
await page.locator('#conv-list input.catin').nth(2).fill('My Test Builds');
await page.locator('#conv-list input.catin').nth(2).dispatchEvent('change');
await page.click('#conv-all');
await page.waitForTimeout(1500);
console.log('convert status:', await page.locator('#conv-saved').textContent());
// library tab
await page.click('#tab-library');
await page.waitForTimeout(1200);
console.log('where:', await page.locator('#lib-where').innerText());
console.log('chips:', await page.locator('#lib-chips').innerText());
await page.fill('#lib-q', 'castle');
await page.waitForTimeout(300);
console.log('search castle ->', await page.$$eval('#lib-list .item .name', (els) => els.map((e) => e.textContent)));
await page.fill('#lib-q', '');
await page.selectOption('#lib-cat', 'Towers');
await page.waitForTimeout(300);
console.log('Towers ->', await page.$$eval('#lib-list .item .name', (els) => els.map((e) => e.textContent)));
// move the tower to Fantasy
const ci = page.locator('#lib-list input.catin').first();
await ci.fill('Fantasy'); await ci.dispatchEvent('change');
await page.waitForTimeout(800);
console.log('after move status:', await page.locator('#lib-status').textContent());
await page.selectOption('#lib-cat', '');
await page.click('.chip[data-c=""]');
await page.waitForTimeout(300);
await page.locator('#lib-list [data-act="view"]').first().click();
await page.waitForTimeout(3000);
console.log('viewer files:', (await page.frameLocator('#viewer-host iframe').locator('#fileList').innerText()).replace(/\n/g, ' | '));
await page.click('#tab-library');
await page.waitForTimeout(500);
await page.screenshot({ path: process.env.SHOT || 'lib.png', fullPage: true });
const walk = (d, p = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`, `${p}${e.name}/`) : [`${p}${e.name}`]);
console.log('on disk:', walk(lib));
// category search (needs network to GitHub)
await page.click('#tab-web');
await page.selectOption('#search-cat', 'Towers');
await page.click('#search-go');
await page.waitForFunction(() => !document.getElementById('search-go').disabled, null, { timeout: 90000 }).catch(() => {});
console.log('category search:', await page.locator('#search-status').textContent());
console.log('first results:', await page.$$eval('#search-list .item .name', (els) => els.slice(0, 4).map((e) => e.textContent)));
console.log('errors', errs);
await browser.close();
