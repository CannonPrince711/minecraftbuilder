// Keeps the BuildScraper.exe window open when something goes wrong, so the message can be
// read instead of the window flashing shut. Uses only built-in modules so it still works
// when the rest of the app failed to load.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// Double-clicked .exe: write the log beside it. Otherwise use the current folder.
// If that folder is read-only, fall back to the system temp folder.
export let LOG_FILE = path.join(process.versions.bun ? path.dirname(process.execPath) : process.cwd(), 'BuildScraper-errors.txt');

export function appendLog(what, detail) {
  const line = `[${new Date().toISOString()}] ${what}: ${detail}\n`;
  try { fs.appendFileSync(LOG_FILE, line); return true; } catch {}
  try { LOG_FILE = path.join(os.tmpdir(), 'BuildScraper-errors.txt'); fs.appendFileSync(LOG_FILE, line); return true; } catch { return false; }
}

/** Explorer runs an .exe opened inside a zip from a temp copy (…\Temp\Temp1_name.zip\…). */
export function runningFromZip() {
  const p = process.execPath;
  return /\.zip[\\/]/i.test(p) || /[\\/]Temp[\\/](Temp\d+_|7z[A-Z0-9]|Rar\$|wz)/i.test(p);
}

/** True when running as the double-clicked .exe (no command given). */
export const isWindowApp = () => !!process.versions.bun && !process.argv.slice(2).some((a) => a !== '--smol');

/** Block until the user presses a key/Enter. Synchronous, so it also works inside an 'exit' handler. */
export function waitForKey(prompt = 'Press any key to close this window.') {
  try {
    if (process.platform === 'win32') {
      console.log(`\n  ${prompt}`);
      spawnSync('cmd', ['/c', 'pause >nul'], { stdio: 'inherit' });
    } else if (process.stdin.isTTY) {
      console.log(`\n  ${prompt.replace('any key', 'Enter')}`);
      const buf = Buffer.alloc(1);
      try { fs.readSync(0, buf, 0, 1, null); } catch {}
    }
  } catch {}
}

/** Print a startup/fatal error in plain words, log it, and keep the window open. */
export function fatal(e, what = 'Build Scraper could not start') {
  if (globalThis.MCBS_FATAL_SHOWN) return; // the wrapper and the bundled app each carry a copy
  globalThis.MCBS_FATAL_SHOWN = true;
  const detail = (e && (e.stack || e.message)) || String(e);
  const saved = appendLog(what, detail);
  console.error(`\n  ${what}.\n\n  ${(e && e.message) || e}\n`);
  console.error(saved ? `  These details were saved to ${LOG_FILE}` : `  Could not write ${LOG_FILE}. Copy the text above instead.`);
  console.error('  Send that file (or a screenshot of this window) if you need help.\n');
  console.error(String(detail).split('\n').slice(0, 8).map((s) => '    ' + s.trim()).join('\n'));
  if (isWindowApp()) waitForKey();
  process.exitCode = 1;
}
