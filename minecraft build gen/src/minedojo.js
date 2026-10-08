// Optional MineDojo integration (https://minedojo.org).
//
// Builds are sent to minedojo/bridge.py, which places them block by block inside
// MineDojo's real Minecraft simulator, films a 16-frame orbit around each one, and
// asks MineCLIP (MineDojo's video-language model) how well that video matches the
// prompt. We get back real in-game renders plus a prompt-match score per build.
//
// MineDojo needs Python 3.9 + JDK 8 on Linux/macOS (on Windows: inside WSL2).
// Set MINEDOJO_PYTHON to the interpreter command, e.g. "wsl python3" (the Windows
// default) or "/home/me/miniconda3/envs/minedojo/bin/python".

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GX, GY, GZ } from './env.js';
import { getVersion } from './versions.js';
import { legacyPlacements } from './export.js';
import { ROOT } from './generator.js';
import { loadSettings } from './settings.js';

export const BRIDGE = path.join(ROOT, 'minedojo', 'bridge.py');

// Default on Windows: the venv at ~/minedojo inside WSL, run headless.
const WSL_DEFAULT = ['wsl', '-e', 'bash', '-lc', 'MINEDOJO_HEADLESS=1 exec "${MINEDOJO_VENV:-$HOME/minedojo}/bin/python" "$0" "$@"'];

export function pythonCommand() {
  const raw = loadSettings().minedojoPython || process.env.MINEDOJO_PYTHON;
  if (!raw) return process.platform === 'win32' ? WSL_DEFAULT : ['python3'];
  return fs.existsSync(raw) ? [raw] : raw.split(/\s+/).filter(Boolean);
}

// Windows paths have to be translated when Python runs inside WSL.
function forPython(cmd, p) {
  if (cmd[0].toLowerCase() !== 'wsl' && !/(^|[\\/])wsl(\.exe)?$/i.test(cmd[0])) return p;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p));
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p;
}

export function jobFile(builds, prompt) {
  const legacy = getVersion('1.12.2');
  return {
    prompt,
    lot: [GX, GY, GZ],
    builds: builds.map((b) => ({ name: b.name, height: b.target.h, blocks: legacyPlacements(b, legacy) })),
  };
}

function run(args, onLine) {
  const cmd = pythonCommand();
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(cmd[0], [...cmd.slice(1), forPython(cmd, BRIDGE), ...args.map((a) => (fs.existsSync(a) || a.includes(path.sep) ? forPython(cmd, a) : a))]);
    } catch (e) {
      return reject(new Error(`Could not start "${cmd.join(' ')}": ${e.message}`));
    }
    const tail = [];
    const onData = (chunk) => {
      // wsl.exe prints its own messages as UTF-16; drop the NULs.
      for (const line of String(chunk).replace(/\u0000/g, '').split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)) {
        tail.push(line);
        if (tail.length > 200) tail.shift();
        onLine?.(line);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => reject(new Error(`Could not start "${cmd.join(' ')}" (${e.message}). Install MineDojo and set MINEDOJO_PYTHON.`)));
    proc.on('exit', (code) => {
      if (code === 0) return resolve(tail);
      const text = tail.join('\n');
      if (/Usage: wsl|no installed distributions|WSL.*not.*installed/i.test(text)) {
        return reject(new Error('WSL (Linux on Windows) is not set up yet. Follow the MineDojo setup guide in "How to use".'));
      }
      if (/No such file or directory|not found/i.test(text) && /minedojo\/bin\/python|python/i.test(text)) {
        return reject(new Error('MineDojo Python not found (expected ~/minedojo inside WSL, or set MINEDOJO_PYTHON). See the setup guide.'));
      }
      reject(new Error(tail.slice(-4).join(' | ') || `exit code ${code}`));
    });
  });
}

// Check that Python, MineDojo, MineCLIP and its weights are all in place.
export const mineDojoDoctor = (onLine) => run(['doctor'], onLine);

// Render + score builds. Resolves to { prompt, builds: { name: { clip, images: [file] } } }; images are in workDir.
export async function runMineDojo(builds, prompt, workDir, onLine) {
  fs.mkdirSync(workDir, { recursive: true });
  const job = path.join(workDir, 'job.json');
  fs.writeFileSync(job, JSON.stringify(jobFile(builds, prompt)));
  const result = path.join(workDir, 'result.json');
  fs.rmSync(result, { force: true });
  await run(['run', '--job', job, '--out', workDir], onLine);
  return JSON.parse(fs.readFileSync(result, 'utf8'));
}
