// The one launcher behind start.bat.
//   start.bat                       -> start the program and open its window (Control Center)
//   start.bat generate [options]    -> make builds from the command line (see src/generate.js)
//   start.bat train [options]       -> train one type (see src/train.js)
//   start.bat train-all [--iters N] -> train every type that has no model yet
//   start.bat help

import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, hasModel } from './generator.js';
import { STRUCTURES } from './structures/index.js';
import { openInBrowser } from './appwindow.js';

const [cmd, ...rest] = process.argv.slice(2);

function run(name, args) {
  return new Promise((resolve) => {
    spawn(process.execPath, [path.join(ROOT, 'src', name), ...args], { stdio: 'inherit', cwd: ROOT }).on('exit', (code) => resolve(code ?? 1));
  });
}

async function trainAll(iters) {
  for (const id of Object.keys(STRUCTURES)) {
    if (hasModel(id)) continue;
    console.log(`\n== Training ${STRUCTURES[id].label} (${iters} iterations) ==`);
    if (await run('train.js', ['--type', id, '--iters', String(iters)])) return 1;
  }
  console.log('\nAll structure types are trained.');
  return 0;
}

function help() {
  console.log(`
RL Build Generator

  start.bat                       start the program (opens its window)
  start.bat generate [options]    make builds without the window, e.g.
      start.bat generate --prompt "3 tall spruce watchtowers" --mc 1.20
      start.bat generate --type house --count 4 --realism "lived-in" --world "My World"
    options: --prompt TEXT  --type ${Object.keys(STRUCTURES).join('|')}  --mc VERSION
             --count N  --temp 0..1  --theme NAME  --variant NAME  --width/--depth/--height N
             --realism PRESET|"w,v,d,i,n,r,p"  --world NAME  --saves DIR  --out DIR  --minedojo
  start.bat train --type tower [--iters 200] [--resume]
  start.bat train-all [--iters 200]

Command-line output goes to the "output" folder. Full guide: HOW_TO_USE.txt
`);
  return 0;
}

const flag = (name, def) => { const i = rest.indexOf(name); return i >= 0 && rest[i + 1] ? rest[i + 1] : def; };
let code = 0;
switch ((cmd ?? '').toLowerCase()) {
  case '': case 'start': case 'website': case 'web':
    await import('./server.js'); // runs until Quit or the window is closed
    break;
  case 'generate': case 'gen':
    code = await run('generate.js', rest);
    if (!code && !rest.includes('--out')) openInBrowser(path.join(ROOT, 'output', 'gallery.html'));
    break;
  case 'train': code = await run('train.js', rest); break;
  case 'train-all': code = await trainAll(Number(flag('--iters', 200))); break;
  case 'help': case '-h': case '--help': case '/?': code = help(); break;
  default: console.log(`Unknown command "${cmd}".`); help(); code = 1;
}
if (code) process.exitCode = code;
