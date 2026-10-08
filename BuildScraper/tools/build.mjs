import * as esbuild from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
const r = await esbuild.build({ entryPoints: ['src/app.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2022', legalComments: 'none', external: ['node:zlib'] });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Gzipped: the region file is mostly zero padding. The page gunzips it on "Try a sample world".
const sample = zlib.gzipSync(fs.readFileSync('test/fixtures/1.13.2/r.-1.-1.mca'), { level: 9 }).toString('base64');
const minCss = async (css) => (await esbuild.transform(css, { loader: 'css', minify: true })).code.trim();
// Minified separately per <script>: with no format set, esbuild keeps top-level names, which the files share as globals.
const minJs = async (src) => (await esbuild.transform(src, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' })).code.trim();
const replaceAsync = async (s, re, fn) => { const parts = []; s.replace(re, (...m) => { parts.push(fn(...m)); return ''; }); const out = await Promise.all(parts); let i = 0; return s.replace(re, () => out[i++]); };
const html = await replaceAsync(fs.readFileSync('src/index.html', 'utf8'), /<style>([\s\S]*?)<\/style>/g, async (_, css) => `<style>${await minCss(css)}</style>`);
// The schematic viewer (viewer/, a copy of the viewer project) is inlined into one HTML string and
// shown in the "View in 3D" tab through an iframe srcdoc, so it shares this page's origin everywhere.
const noClose = (t) => t.replace(/<\/script/gi, '<\\/script');
let viewer = fs.readFileSync('viewer/index.html', 'utf8');
viewer = await replaceAsync(viewer, /<link rel="stylesheet" href="([^"]+)">/g, async (_, f) => `<style>${await minCss(fs.readFileSync('viewer/' + f, 'utf8'))}</style>`);
viewer = await replaceAsync(viewer, /<script src="([^"]+)"><\/script>/g, async (_, f) => {
  const src = fs.readFileSync('viewer/' + f, 'utf8');
  return `<script>${noClose(/\.min\.js$/.test(f) ? src : await minJs(src))}</script>`;
});
if (/<script src=|<link rel="stylesheet" href=/.test(viewer)) throw new Error('viewer/index.html still references an external file');
const viewerJs = `window.MCBS_VIEWER=${JSON.stringify(viewer).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--')};`;
// Builds made by the RL Build Generator (../minecraft build gen), listed in the "Build generator" tab.
const genDir = '../minecraft build gen/output/schematics';
const gen = fs.existsSync(genDir)
  ? fs.readdirSync(genDir).filter((f) => /\.(schem|schematic)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, data: fs.readFileSync(`${genDir}/${name}`).toString('base64') }))
  : [];
fs.mkdirSync('dist', { recursive: true });
const page = `${html}\n<script>window.MCBS_SAMPLE=${JSON.stringify(sample)};</script>\n<script>window.MCBS_GEN=${JSON.stringify(gen)};</script>\n<script>${viewerJs}</script>\n<script>${js}</script>\n`;
// The artifact host adds its own skeleton; the standalone file needs one.
fs.writeFileSync('dist/artifact.html', page);
fs.writeFileSync('dist/index.html', `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`);
// CLI
await esbuild.build({ entryPoints: ['tools/cli.mjs'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist/mcbs.mjs', target: 'node18', loader: { '.html': 'text' }, banner: { js: '#!/usr/bin/env node' } });
if (process.argv.includes('--exe')) {
  // The Windows app (app/, Go + WebView2): the page above in its own window, plus web fetching
  // and the category library. Needs Go 1.24+. Builds from any OS.
  const { execFileSync } = await import('node:child_process');
  fs.mkdirSync('app/site', { recursive: true });
  fs.copyFileSync('dist/index.html', 'app/site/index.html');
  execFileSync(process.env.GO || 'go', ['build', '-trimpath', '-ldflags', '-s -w -H windowsgui', '-o', '../dist/BuildScraper.exe', '.'],
    { cwd: 'app', stdio: 'inherit', env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } });
}
if (process.argv.includes('--bun-exe')) {
  // Older single-file build of the command-line tool; double-clicking it runs the page in your browser.
  const { execFileSync } = await import('node:child_process');
  const bun = process.env.BUN || 'bun';
  // Baseline build runs on every 64-bit CPU; the default one needs AVX2 and closes instantly without it.
  // tools/exe.mjs wraps the CLI so startup errors stay on screen.
  const target = process.env.EXE_TARGET || 'bun-windows-x64-baseline';
  const out = target.includes('windows') ? 'dist/BuildScraper-console.exe' : 'dist/BuildScraper-console';
  execFileSync(bun, ['build', '--compile', '--minify', `--target=${target}`, 'tools/exe.mjs', '--outfile', out], { stdio: 'inherit' });
}
console.log('built', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + 'KB');
