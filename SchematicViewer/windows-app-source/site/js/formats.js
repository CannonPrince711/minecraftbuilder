/* Schematic format readers. Each returns a common "Schematic" object:
   { width, height, length, blocks: Uint16Array (x + z*W + y*W*L), palette: [{state, name, props}],
     format, formatLabel, dataVersion, mcVersion, blockEntityCount, entityCount, meta } */
(function (root) {
  'use strict';
  var NBT = root.NBT || (typeof require !== 'undefined' ? require('./nbt.js') : null);
  var Legacy = root.LegacyBlocks || (typeof require !== 'undefined' ? require('./legacy.js') : null);

  // DataVersion -> Minecraft release (first DataVersion of each release).
  var DATA_VERSIONS = [
    [100, '1.9'], [510, '1.10'], [819, '1.11'], [1139, '1.12'], [1241, '1.12.1'], [1343, '1.12.2'],
    [1519, '1.13'], [1628, '1.13.1'], [1631, '1.13.2'], [1952, '1.14'], [1957, '1.14.1'], [1963, '1.14.2'], [1968, '1.14.3'], [1976, '1.14.4'],
    [2225, '1.15'], [2227, '1.15.1'], [2230, '1.15.2'], [2566, '1.16'], [2567, '1.16.1'], [2578, '1.16.2'], [2580, '1.16.3'], [2584, '1.16.4'], [2586, '1.16.5'],
    [2724, '1.17'], [2730, '1.17.1'], [2860, '1.18'], [2865, '1.18.1'], [2975, '1.18.2'], [3105, '1.19'], [3117, '1.19.1'], [3120, '1.19.2'],
    [3218, '1.19.3'], [3337, '1.19.4'], [3463, '1.20'], [3465, '1.20.1'], [3578, '1.20.2'], [3698, '1.20.3'], [3700, '1.20.4'],
    [3837, '1.20.5'], [3839, '1.20.6'], [3953, '1.21'], [3955, '1.21.1'], [4080, '1.21.2'], [4082, '1.21.3'], [4189, '1.21.4'],
    [4325, '1.21.5'], [4435, '1.21.6'], [4438, '1.21.7'], [4440, '1.21.8'], [4554, '1.21.9'], [4556, '1.21.10'], [4671, '1.21.11']
  ];
  function mcVersionFor(dv) {
    if (!dv) return null;
    var best = null;
    for (var i = 0; i < DATA_VERSIONS.length; i++) if (DATA_VERSIONS[i][0] <= dv) best = DATA_VERSIONS[i][1];
    if (best && dv > DATA_VERSIONS[DATA_VERSIONS.length - 1][0] + 20) best += '+';
    return best || ('data version ' + dv);
  }

  // A problem with a file, phrased for people. code: short id, hint: what to try, detail: technical text.
  function SchemError(code, message, hint, detail) {
    var e = new Error(message); e.name = 'SchemError'; e.code = code; e.hint = hint || ''; e.detail = detail || ''; return e;
  }
  var warnings = null;
  function warn(msg) { if (warnings && warnings.indexOf(msg) < 0) warnings.push(msg); }
  var MAX_VOLUME = 150000000; // block spaces; beyond this a browser runs out of memory
  function checkSize(W, H, L) {
    if (!(W > 0 && H > 0 && L > 0)) throw SchemError('empty', 'This schematic is empty (size ' + W + ' × ' + H + ' × ' + L + ').', 'Export the build again and make sure the selection contains blocks.');
    if (W * H * L > MAX_VOLUME) throw SchemError('too_big', 'This schematic is too large to show (' + W + ' × ' + H + ' × ' + L + ' = ' + (W * H * L).toLocaleString() + ' block spaces).',
      'The viewer can show up to about ' + MAX_VOLUME.toLocaleString() + ' block spaces. Split the build into smaller schematics.');
  }

  function parseState(s) {
    var name = s, props = {};
    var b = s.indexOf('[');
    if (b >= 0) {
      name = s.slice(0, b);
      s.slice(b + 1, s.lastIndexOf(']')).split(',').forEach(function (kv) {
        var e = kv.indexOf('=');
        if (e > 0) props[kv.slice(0, e).trim()] = kv.slice(e + 1).trim();
      });
    }
    if (name.indexOf(':') < 0) name = 'minecraft:' + name;
    return { name: name, props: props };
  }
  function stateString(name, props) {
    var keys = Object.keys(props || {});
    if (!keys.length) return name;
    return name + '[' + keys.map(function (k) { return k + '=' + props[k]; }).join(',') + ']';
  }

  // Names that changed meaning across versions.
  function normalizeName(name, dataVersion) {
    if (name === 'minecraft:grass') {
      if (dataVersion && dataVersion < 1451) return 'minecraft:grass_block';
      return 'minecraft:short_grass';
    }
    return name;
  }

  function makePaletteEntry(name, props, dataVersion) {
    name = normalizeName(name, dataVersion);
    return { name: name, props: props || {}, state: stateString(name, props) };
  }

  // Varint-packed block data used by Sponge schematics.
  function readVarints(bytes, count) {
    var out = new Uint16Array(count);
    var i = 0, p = 0, n = bytes.length;
    while (i < count && p < n) {
      var value = 0, shift = 0, b;
      do { b = bytes[p++] & 0xff; value |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && p < n);
      out[i++] = value;
    }
    if (i < count) warn('The block data ends early: ' + (count - i).toLocaleString() + ' of ' + count.toLocaleString() + ' block spaces are missing and are shown as empty. The file may be damaged or cut off.');
    return out;
  }

  function n(v) { return typeof v === 'number' ? v : 0; }
  function metaFrom(m) {
    if (!m || typeof m !== 'object') return {};
    var out = {};
    ['Name', 'Author', 'Date', 'Description', 'RequiredMods'].forEach(function (k) { if (m[k] !== undefined) out[k] = m[k]; });
    if (typeof out.Date === 'number') { try { out.Date = new Date(out.Date).toISOString().slice(0, 10); } catch (e) {} }
    return out;
  }

  function readSponge(rootTag) {
    var s = rootTag.Schematic && typeof rootTag.Schematic === 'object' && !Array.isArray(rootTag.Schematic) ? rootTag.Schematic : rootTag;
    var version = n(s.Version) || 1;
    var W = n(s.Width) & 0xffff, H = n(s.Height) & 0xffff, L = n(s.Length) & 0xffff;
    var dataVersion = n(s.DataVersion) || null;
    var paletteTag, dataTag, blockEntities, biomesNote;
    if (version >= 3) {
      var blk = s.Blocks || {};
      paletteTag = blk.Palette || {}; dataTag = blk.Data; blockEntities = blk.BlockEntities;
    } else {
      paletteTag = s.Palette || {}; dataTag = s.BlockData; blockEntities = s.BlockEntities || s.TileEntities;
    }
    var maxIdx = 0;
    Object.keys(paletteTag).forEach(function (k) { if (paletteTag[k] > maxIdx) maxIdx = paletteTag[k]; });
    var palette = new Array(maxIdx + 1);
    Object.keys(paletteTag).forEach(function (k) {
      var ps = parseState(k);
      palette[paletteTag[k]] = makePaletteEntry(ps.name, ps.props, dataVersion);
    });
    for (var i = 0; i < palette.length; i++) if (!palette[i]) palette[i] = makePaletteEntry('minecraft:air', {}, dataVersion);
    checkSize(W, H, L);
    if (!Object.keys(paletteTag).length) warn('This file has no block palette, so every block is shown as empty.');
    if (!dataTag) warn('This file has no block data, so it is shown empty.');
    var blocks = dataTag ? readVarints(new Uint8Array(dataTag.buffer, dataTag.byteOffset, dataTag.length), W * H * L) : new Uint16Array(W * H * L);
    var bad = 0;
    for (var bi = 0; bi < blocks.length; bi++) if (blocks[bi] >= palette.length) { blocks[bi] = 0; bad++; }
    if (bad) { warn(bad.toLocaleString() + ' blocks point to palette entries that do not exist and are shown as empty. The file may be damaged.'); }
    var meta = metaFrom(s.Metadata);
    return {
      width: W, height: H, length: L, blocks: blocks, palette: palette,
      format: 'sponge', formatLabel: 'Sponge .schem v' + version,
      dataVersion: dataVersion, mcVersion: mcVersionFor(dataVersion) || (version === 1 ? '1.13+ (no data version)' : null),
      blockEntityCount: Array.isArray(blockEntities) ? blockEntities.length : 0,
      entityCount: Array.isArray(s.Entities) ? s.Entities.length : 0,
      meta: meta
    };
  }

  function readMCEdit(t) {
    var W = n(t.Width) & 0xffff, H = n(t.Height) & 0xffff, L = n(t.Length) & 0xffff;
    checkSize(W, H, L);
    var total = W * H * L;
    if (t.Blocks.length < total) throw SchemError('truncated', 'The block list in this .schematic file is shorter than its size says (' + t.Blocks.length.toLocaleString() + ' of ' + total.toLocaleString() + ').', 'The file is probably damaged. Try exporting it again.');
    var ids = t.Blocks, data = t.Data, add = t.AddBlocks || null;
    // Schematica: its own name->id mapping (handles mods and changed IDs).
    var mapping = null;
    if (t.SchematicaMapping && typeof t.SchematicaMapping === 'object') {
      mapping = {};
      Object.keys(t.SchematicaMapping).forEach(function (name) { mapping[t.SchematicaMapping[name]] = name; });
    }
    var keyToIndex = new Map();
    var palette = [];
    var blocks = new Uint16Array(total);
    // MCEdit index order is (y * L + z) * W + x, which matches ours.
    for (var i = 0; i < total; i++) {
      var id = ids[i] & 0xff;
      if (add) id |= (i & 1 ? (add[i >> 1] & 0x0f) : ((add[i >> 1] >> 4) & 0x0f)) << 8;
      var meta = data ? data[i] & 0x0f : 0;
      var key = id * 16 + meta;
      var idx = keyToIndex.get(key);
      if (idx === undefined) {
        var st;
        var mappedName = mapping ? mapping[id] : null;
        if (mappedName && Legacy.LEGACY_NAMES[mappedName] === undefined && mappedName.indexOf('minecraft:') !== 0) {
          st = { name: mappedName, props: meta ? { meta: String(meta) } : {} };
        } else {
          var vid = mappedName && Legacy.LEGACY_NAMES[mappedName] !== undefined ? Legacy.LEGACY_NAMES[mappedName] : id;
          st = Legacy.legacyToState(vid, meta);
        }
        if (/unknown_legacy_/.test(st.name)) warn('Block ID ' + id + ' is not a vanilla 1.12 block (probably from a mod). It is shown with a placeholder colour.');
        var e = makePaletteEntry(st.name, st.props, 1343);
        e.legacy = id + ':' + meta;
        idx = palette.length; palette.push(e); keyToIndex.set(key, idx);
      }
      blocks[i] = idx;
    }
    return {
      width: W, height: H, length: L, blocks: blocks, palette: palette,
      format: 'mcedit', formatLabel: 'MCEdit/Schematica .schematic (' + (t.Materials || 'Alpha') + ')',
      dataVersion: null, mcVersion: '1.12.2 or older (legacy IDs)',
      blockEntityCount: Array.isArray(t.TileEntities) ? t.TileEntities.length : 0,
      entityCount: Array.isArray(t.Entities) ? t.Entities.length : 0,
      meta: {}
    };
  }

  function readLitematic(t) {
    var regions = t.Regions || {};
    var names = Object.keys(regions);
    if (!names.length) throw new Error('This .litematic file has no regions.');
    var dataVersion = n(t.MinecraftDataVersion) || null;
    var boxes = names.map(function (nm) {
      var r = regions[nm], pos = r.Position || {}, size = r.Size || {};
      function axis(p, s) { return s >= 0 ? [p, p + s - 1] : [p + s + 1, p]; }
      var ax = axis(n(pos.x), n(size.x)), ay = axis(n(pos.y), n(size.y)), az = axis(n(pos.z), n(size.z));
      return { r: r, name: nm, min: [ax[0], ay[0], az[0]], max: [ax[1], ay[1], az[1]], sx: Math.abs(n(size.x)), sy: Math.abs(n(size.y)), sz: Math.abs(n(size.z)) };
    });
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    boxes.forEach(function (b) { for (var k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.min[k]); mx[k] = Math.max(mx[k], b.max[k]); } });
    var W = mx[0] - mn[0] + 1, H = mx[1] - mn[1] + 1, L = mx[2] - mn[2] + 1;
    checkSize(W, H, L);
    var blocks = new Uint16Array(W * H * L);
    var palette = [makePaletteEntry('minecraft:air', {}, dataVersion)];
    var stateToIndex = new Map([['minecraft:air', 0]]);
    var beCount = 0, entCount = 0;
    boxes.forEach(function (b) {
      var r = b.r;
      var pal = (r.BlockStatePalette || []).map(function (p) {
        var props = {};
        if (p.Properties) Object.keys(p.Properties).forEach(function (k) { props[k] = String(p.Properties[k]); });
        var e = makePaletteEntry(p.Name.indexOf(':') < 0 ? 'minecraft:' + p.Name : p.Name, props, dataVersion);
        var idx = stateToIndex.get(e.state);
        if (idx === undefined) { idx = palette.length; palette.push(e); stateToIndex.set(e.state, idx); }
        return idx;
      });
      beCount += Array.isArray(r.TileEntities) ? r.TileEntities.length : 0;
      entCount += Array.isArray(r.Entities) ? r.Entities.length : 0;
      var arr = r.BlockStates;
      if (!arr || !arr.words) { warn('Region "' + b.name + '" has no block data and is shown empty.'); return; }
      var needLongs = Math.ceil(b.sx * b.sy * b.sz * Math.max(2, Math.ceil(Math.log2(Math.max(1, pal.length)))) / 64);
      if (arr.length < needLongs) warn('Region "' + b.name + '" has less block data than its size needs. Part of it may look wrong; the file may be damaged.');
      var words = arr.words;
      var bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, pal.length))));
      var mask = (1 << bits) - 1;
      var ox = b.min[0] - mn[0], oy = b.min[1] - mn[1], oz = b.min[2] - mn[2];
      var i = 0;
      for (var y = 0; y < b.sy; y++) for (var z = 0; z < b.sz; z++) for (var x = 0; x < b.sx; x++, i++) {
        var bit = i * bits, w = bit >>> 5, off = bit & 31;
        var v = words[w] >>> off;
        if (off + bits > 32) v |= words[w + 1] << (32 - off);
        v &= mask;
        var gi = v < pal.length ? pal[v] : 0;
        if (gi) blocks[(x + ox) + (z + oz) * W + (y + oy) * W * L] = gi;
      }
    });
    var md = t.Metadata || {};
    return {
      width: W, height: H, length: L, blocks: blocks, palette: palette,
      format: 'litematic', formatLabel: 'Litematica .litematic v' + (n(t.Version) || '?') + ' (' + names.length + ' region' + (names.length > 1 ? 's' : '') + ')',
      dataVersion: dataVersion, mcVersion: mcVersionFor(dataVersion),
      blockEntityCount: beCount, entityCount: entCount,
      meta: metaFrom({ Name: md.Name, Author: md.Author, Description: md.Description, Date: md.TimeCreated })
    };
  }

  function readStructure(t) {
    var size = t.size || [0, 0, 0];
    var W = size[0], H = size[1], L = size[2];
    checkSize(W, H, L);
    var dataVersion = n(t.DataVersion) || null;
    var palTag = t.palette || (t.palettes && t.palettes[0]) || [];
    var palette = [makePaletteEntry('minecraft:air', {}, dataVersion)];
    var map = palTag.map(function (p) {
      var props = {};
      if (p.Properties) Object.keys(p.Properties).forEach(function (k) { props[k] = String(p.Properties[k]); });
      palette.push(makePaletteEntry(p.Name.indexOf(':') < 0 ? 'minecraft:' + p.Name : p.Name, props, dataVersion));
      return palette.length - 1;
    });
    var blocks = new Uint16Array(W * H * L);
    (t.blocks || []).forEach(function (b) {
      var pos = b.pos; if (!pos) return;
      if (pos[0] < 0 || pos[1] < 0 || pos[2] < 0 || pos[0] >= W || pos[1] >= H || pos[2] >= L) { warn('Some blocks lie outside the structure size and were left out.'); return; }
      blocks[pos[0] + pos[2] * W + pos[1] * W * L] = map[b.state] || 0;
    });
    return {
      width: W, height: H, length: L, blocks: blocks, palette: palette,
      format: 'structure', formatLabel: 'Vanilla structure .nbt',
      dataVersion: dataVersion, mcVersion: mcVersionFor(dataVersion),
      blockEntityCount: (t.blocks || []).filter(function (b) { return b.nbt; }).length,
      entityCount: Array.isArray(t.entities) ? t.entities.length : 0,
      meta: metaFrom({ Author: t.author })
    };
  }

  function detectAndRead(nbt) {
    var t = nbt.value;
    if (t.Regions && (t.MinecraftDataVersion !== undefined || t.Metadata)) return readLitematic(t);
    if (t.Schematic && typeof t.Schematic === 'object' && !Array.isArray(t.Schematic) && !(t.Schematic instanceof Int8Array)) return readSponge(t);
    if (t.Blocks instanceof Int8Array && t.Width !== undefined) return readMCEdit(t);
    if (t.Palette || t.BlockData || (t.Version !== undefined && t.Width !== undefined)) return readSponge(t);
    if (t.size && t.blocks) return readStructure(t);
    if (t.Regions) return readLitematic(t);
    var keys = Object.keys(t).slice(0, 12).join(', ');
    if (t.Level || t.Data && t.Data.LevelName !== undefined) throw SchemError('world', 'This is a Minecraft world or level file, not a schematic.', 'Open the world in Minecraft and export the build with WorldEdit (//copy then //schem save) or Litematica.', 'Top-level tags: ' + keys);
    if (t.sections || t.Sections || t.xPos !== undefined) throw SchemError('chunk', 'This is a world chunk file, not a schematic.', 'Export the build with WorldEdit or Litematica instead.', 'Top-level tags: ' + keys);
    throw SchemError('unknown_nbt', 'This is a Minecraft data file, but not a schematic format the viewer knows.', 'Supported: Sponge .schem (WorldEdit/FAWE), MCEdit/Schematica .schematic, Litematica .litematic and structure-block .nbt.', 'Top-level tags: ' + (keys || '(none)'));
  }

  function finalize(s) {
    // Block counts per palette entry and overall bounds.
    var counts = new Uint32Array(s.palette.length);
    var b = s.blocks;
    for (var i = 0; i < b.length; i++) counts[b[i]]++;
    s.palette.forEach(function (p, i) { p.count = counts[i]; });
    return s;
  }

  // Recognise common wrong file types before trying to read NBT.
  function sniff(u8, filename) {
    var ext = (/\.([a-z0-9]+)$/i.exec(filename || '') || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    if (!u8.length) return SchemError('empty_file', 'The file is empty (0 bytes).', 'The download or copy probably failed. Get the file again.');
    var b = u8, head = String.fromCharCode.apply(null, Array.prototype.slice.call(b, 0, 16));
    if (ext === 'mcstructure') return SchemError('bedrock', 'Bedrock Edition .mcstructure files are not supported.', 'This viewer reads Java Edition schematics. Convert the structure with a tool such as Amulet first.');
    if (ext === 'bp') return SchemError('axiom', 'Axiom blueprint (.bp) files are not supported.', 'Export the build from Axiom as a .schem file instead.');
    if (b[0] === 0x50 && b[1] === 0x4b) return SchemError('zip', 'This is a .zip archive, not a schematic.', 'Unzip it first, then open the .schem, .schematic, .litematic or .nbt file inside.');
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return SchemError('rar', 'This is a .rar archive, not a schematic.', 'Extract it first, then open the schematic file inside.');
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc) return SchemError('7z', 'This is a .7z archive, not a schematic.', 'Extract it first, then open the schematic file inside.');
    if (b[0] === 0x89 && head.slice(1, 4) === 'PNG' || b[0] === 0xff && b[1] === 0xd8 || head.slice(0, 4) === 'GIF8' || head.slice(8, 12) === 'WEBP') return SchemError('image', 'This is a picture, not a schematic.', 'Download the actual schematic file from the build page rather than its preview image.');
    if (head.slice(0, 4) === '%PDF') return SchemError('pdf', 'This is a PDF document, not a schematic.');
    if (head.slice(0, 2) === 'MZ') return SchemError('exe', 'This is a program file, not a schematic.');
    var txt = 0, sample = Math.min(b.length, 512);
    for (var i = 0; i < sample; i++) { var c = b[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) txt++; }
    if (sample > 8 && txt / sample > 0.95) {
      var t = head.trim().toLowerCase();
      if (t.indexOf('<') === 0) return SchemError('html', 'This is a web page, not a schematic.', 'The site probably showed a download page or a login page instead of the file. Open the link in a browser and download the file from there.');
      if (t.indexOf('{') === 0 || t.indexOf('[') === 0) return SchemError('json', 'This is a text (JSON) file, not a schematic.');
      return SchemError('text', 'This is a text file, not a schematic.');
    }
    return null;
  }

  function wrapReadError(e, u8) {
    if (e && e.name === 'SchemError') return e;
    var msg = (e && e.message) || String(e);
    if (e instanceof RangeError || /out of bounds|outside the bounds|Offset/i.test(msg))
      return SchemError('truncated', 'The file ends before all of its data was read.', 'It may be cut off (an incomplete download) or damaged. Get the file again.', msg);
    if (/Not an NBT|Unknown NBT tag/.test(msg))
      return SchemError('not_nbt', 'This file is not a Minecraft schematic, or it is damaged.', 'Check that it is a .schem, .schematic, .litematic or structure .nbt file. If it is, try downloading it again.', msg);
    return SchemError('read_failed', 'The file could not be read.', 'It may be damaged. Try downloading or exporting it again.', msg);
  }

  // bytes: raw file contents (possibly gzipped). Node callers can pass decompressed bytes.
  async function parseSchematicBytes(bytes, filename) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var pre = sniff(u8, filename);
    if (pre) throw pre;
    var compressed = NBT.isGzip(u8) || NBT.isZlib(u8);
    try { u8 = await NBT.decompress(u8); }
    catch (e) {
      if (e && /DecompressionStream missing/.test(e.message)) throw SchemError('old_browser', 'This browser cannot open compressed files.', 'Update your browser, or use a current version of Chrome, Edge, Firefox or Safari.', e.message);
      throw SchemError('bad_compression', 'The file is compressed, but the compressed data is damaged or cut off.', 'Get the file again; the download may not have finished.', 'gzip/zlib decompression failed' + (e && e.message ? ' (' + e.message + ')' : ''));
    }
    if (compressed) { var pre2 = sniff(u8, ''); if (pre2 && pre2.code !== 'empty_file') throw pre2; }
    return parseDecompressed(u8, filename);
  }
  function parseDecompressed(u8, filename) {
    warnings = [];
    try {
      var nbt;
      try { nbt = NBT.readNBT(u8); } catch (e) { throw wrapReadError(e, u8); }
      var s;
      try { s = detectAndRead(nbt); } catch (e) { throw wrapReadError(e, u8); }
      s.fileName = filename || '';
      checkSize(s.width, s.height, s.length);
      finalize(s);
      s.warnings = warnings;
      return s;
    } finally { warnings = null; }
  }

  var api = { SchemError: SchemError, sniff: sniff, parseSchematicBytes: parseSchematicBytes, parseDecompressed: parseDecompressed, parseState: parseState, stateString: stateString, mcVersionFor: mcVersionFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SchemFormats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
