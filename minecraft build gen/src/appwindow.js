// Open a URL as a standalone app window (Edge/Chrome "app mode": no tabs or address
// bar), falling back to the default browser.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';

function browsers() {
  if (process.platform === 'win32') {
    const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    return pf.flatMap((d) => [
      path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(d, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]);
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
}

export function openAppWindow(url) {
  const exe = browsers().find((p) => fs.existsSync(p));
  if (exe) {
    spawn(exe, [`--app=${url}`, '--window-size=1280,860', '--new-window'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  openInBrowser(url);
  return false;
}

export function openInBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

// Show a folder or file in Explorer / Finder.
export function reveal(target) {
  const cmd = process.platform === 'win32' ? `explorer "${target}"` : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
  exec(cmd);
}
