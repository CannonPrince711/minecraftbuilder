// Shared error log: every failure (file, chunk, download, conversion) is recorded with
// what was being done, which item, a plain-language reason and the technical detail.

/** Turn low-level errors into something a player can act on. */
export function explain(err) {
  const m = String((err && err.message) || err || 'Unknown error');
  if (/Not an NBT file|Bad NBT tag type|Offset is outside the bounds|out of bounds/i.test(m)) return 'The file is damaged or is not a Minecraft NBT file.';
  if (/incorrect header check|invalid (block type|distance|stored)|unexpected end|Decompression|zlib|gzip|compressed data/i.test(m)) return 'The data is damaged or incomplete, so it could not be unpacked. If this came from a download, try downloading it again.';
  if (/Unrecognised schematic format/i.test(m)) return 'This is an NBT file, but not a schematic format Build Scraper knows (.schem, .schematic, .litematic or structure .nbt).';
  if (/not a valid \.zip|Unsupported zip compression/i.test(m)) return 'The .zip file is damaged or uses an unsupported compression method.';
  if (/Unsupported chunk compression/i.test(m)) return 'A chunk uses a compression type this version cannot read. Open and save the world in a current Minecraft version, then try again.';
  if (/external \.mcc|Missing external chunk/i.test(m)) return 'A very large chunk is stored in a separate .mcc file that was not included. Choose the whole world folder rather than single files.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'The download could not start. The site may block other pages, or you may be offline.';
  if (/answered 4\d\d|HTTP 4\d\d/i.test(m)) return `The site refused the request (${m.match(/\d{3}/)[0]}). The file may need a login or no longer exist.`;
  if (/answered 5\d\d|HTTP 5\d\d/i.test(m)) return `The site had a problem (${m.match(/\d{3}/)[0]}). Try again later.`;
  if (/ENOENT/.test(m)) return `File or folder not found: ${(m.match(/'([^']+)'/) || [, ''])[1]}`;
  if (/EACCES|EPERM/.test(m)) return 'Permission denied. Close Minecraft (it locks open worlds) or pick a folder you can write to.';
  if (/EBUSY/.test(m)) return 'The file is in use. Close Minecraft and try again.';
  if (/allocation|Invalid array length|out of memory/i.test(m)) return 'Ran out of memory. Select a smaller area.';
  return m;
}

export class ErrorLog {
  constructor() { this.entries = []; this.listeners = new Set(); }
  /** where: what was happening ("Convert", "Download"); item: file name, URL or coordinates. */
  add(where, item, err) {
    const e = {
      time: new Date(),
      where,
      item: item == null ? '' : String(item),
      message: explain(err),
      detail: String((err && err.message) || err || ''),
      stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : '',
    };
    this.entries.push(e);
    for (const fn of this.listeners) fn(e, this);
    return e;
  }
  onChange(fn) { this.listeners.add(fn); }
  clear() { this.entries = []; for (const fn of this.listeners) fn(null, this); }
  get count() { return this.entries.length; }
  /** Plain-text report suitable for errors.txt */
  toText(title = 'Build Scraper error log') {
    const lines = [title, `Written ${new Date().toISOString()}`, `${this.entries.length} problem(s)`, ''];
    this.entries.forEach((e, i) => {
      lines.push(`${i + 1}. [${e.time.toISOString()}] ${e.where}${e.item ? `: ${e.item}` : ''}`);
      lines.push(`   ${e.message}`);
      if (e.detail && e.detail !== e.message) lines.push(`   Detail: ${e.detail}`);
      if (e.stack) lines.push(...e.stack.split('\n').slice(1).map((s) => `     ${s.trim()}`));
      lines.push('');
    });
    return lines.join('\n');
  }
}

export const errors = new ErrorLog();
