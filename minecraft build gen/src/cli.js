// Minimal --flag value parser; types follow the defaults.
export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (typeof defaults[key] === 'boolean' || next === undefined || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = typeof defaults[key] === 'number' ? Number(next) : next;
    i++;
  }
  return out;
}
