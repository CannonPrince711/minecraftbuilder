import fs from 'node:fs'; import path from 'node:path';
export function dirProvider(root) {
  const paths = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else paths.push(r); } })(root, '');
  return { paths, read: async (p) => new Uint8Array(fs.readFileSync(path.join(root, p))) };
}
