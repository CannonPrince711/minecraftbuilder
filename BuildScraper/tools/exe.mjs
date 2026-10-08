// Entry point for BuildScraper.exe. Loads the app inside a try/catch so that even an error
// while loading is shown in the window (and saved to BuildScraper-errors.txt) instead of
// the window closing straight away.
import { fatal, isWindowApp, appendLog, waitForKey, runningFromZip } from './fatal.mjs';

if (isWindowApp()) {
  console.log('\n  Starting Build Scraper...');
  if (runningFromZip()) {
    console.log(`
  Heads up: this was opened from inside the zip file, so Windows is running a temporary copy.
  It may close or lose its files. To fix it: close this window, right-click
  BuildScraper-windows.zip, choose Extract All, and open BuildScraper.exe from the new folder.
`);
    appendLog('Warning', `Opened from inside a zip (${process.execPath})`);
  }
  // Once the server is up, serve.mjs logs errors itself and keeps running.
  process.on('uncaughtException', (e) => { if (!globalThis.MCBS_RUNNING) fatal(e); });
  process.on('unhandledRejection', (e) => { if (!globalThis.MCBS_RUNNING) fatal(e); });
  // The window should only close when the user closes it. Anything else is a failure worth showing.
  process.on('exit', (code) => {
    if (globalThis.MCBS_FATAL_SHOWN) return;
    appendLog('Build Scraper stopped unexpectedly', `exit code ${code}`);
    console.error(`\n  Build Scraper stopped unexpectedly (exit code ${code}).`);
    waitForKey();
  });
}
try {
  await import('../dist/mcbs.mjs');
} catch (e) {
  fatal(e);
}
