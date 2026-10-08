# Build Scraper

Pull builds out of Minecraft Java worlds and save them as `.schem` files for WorldEdit, FAWE, Litematica or Amulet.

## Start it

- **Windows:** right-click `BuildScraper-windows.zip` → **Extract All**, then double-click `BuildScraper.exe` in the extracted folder. Build Scraper opens in its own window with everything in it: worlds, converting, web search, your saved builds and the 3D viewer. Windows may warn that the app is from an unknown publisher; choose **More info → Run anyway**.
- **Any computer:** open `index.html` in Chrome, Edge, Firefox or Safari. Everything works except searching sites that block web pages.

Nothing is uploaded: worlds are read on your computer.

1. **From a world**: choose your world folder (or a world `.zip`). Saves live in
   - Windows: `%appdata%\.minecraft\saves`
   - macOS: `~/Library/Application Support/minecraft/saves`
   - Linux: `~/.minecraft/saves`
2. A top-down map appears. Drag a box around your build. Shift-drag or right-drag moves the map, scrolling zooms, or type X/Z and press Go.
3. The height range fills in automatically from the ground to the tallest block. Adjust it if your build has a basement.
4. Pick a format and a category, then press **Save build**: `.schem` (WorldEdit/FAWE), `.litematic` (Litematica) or structure `.nbt` (vanilla).

**Categories.** Every build has a category (Houses, Castles & Medieval, Towers, Modern & City, Fantasy, Ships & Vehicles, Farms, Redstone, Statues & Pixel Art, Nature & Trees, Bridges & Roads, Interiors & Decor, Other). It is guessed from the name and where the file came from, and you can pick another or type your own. Saving puts each build in a folder named after its category:
- In the Windows app: `Documents\Minecraft Builds\<Category>\` (change it on the **My builds** tab).
- In Chrome or Edge: the first save asks which folder to use; after that builds go straight into its category folders.
- In other browsers: one build downloads as a file; several download as one `.zip` with a folder per category.

**My builds** lists everything you saved, with a chip per category showing how many builds it holds. Search by name or by category word ("castle" also finds builds filed under Castles & Medieval), filter by category, move a build to another category, or open it in 3D. Existing files are never overwritten: a second `castle.schem` becomes `castle-2.schem`.

**Convert files** turns MCEdit `.schematic` (pre-1.13), Litematica `.litematic`, structure block `.nbt` and older `.schem` files into `.schem`, `.litematic` or `.nbt`. Drop a `.zip` of them to convert many at once.

**Search the web** finds builds by keyword, by category, or both. Pick a category with no words to find that kind of build (Towers searches for towers and keeps only tower files); add words to narrow it. Every result shows its category, and it carries over when you download it.
- *Public GitHub projects* searches GitHub repositories for your words and lists the schematic files inside them. Check each project's license before using a build.
- *A website I choose* reads pages on that one site (25 by default, one at a time, skipping anything its robots.txt rules out) and lists schematic files whose name, link text or page title match. Put `{q}` in the address to start from the site's own search page, for example `https://example.com/?s={q}`.

It also takes a direct link to a schematic or a `.zip`, or a page that links to schematic files. Many sites block other pages from reading their files. For those, download the file yourself and use Convert, or use the command-line helper below. Follow each site's terms and only download builds you're allowed to use.

**View in 3D** is the schematic viewer, built in. Press **View in 3D** next to Download on the world tab to look at your selection before saving, or next to any file on the Convert tab (that includes files found with Search the web). You can also open `.schem`, `.schematic`, `.litematic` and `.nbt` files there directly. Drag to rotate, scroll to zoom, and use the layer sliders to look inside.

## Load it in Minecraft

| File | Tool | How |
|---|---|---|
| `.schem` | WorldEdit / FAWE | Put it in `.minecraft/config/worldedit/schematics` (or `plugins/WorldEdit/schematics` on a server). Run `//schem load <name>`, stand where the corner should go, then `//paste` (`//paste -a` skips air). |
| `.litematic` | Litematica mod | Put it in `.minecraft/schematics`. Press `M` → Load Schematics → pick it → Load. A see-through hologram appears that you can build from, or paste in creative. |
| `.nbt` | Structure block | Put it in `saves/<World>/generated/minecraft/structures`. Run `/place template minecraft:<name>` (1.19+) or load it with a structure block (max 48×48×48). |
| any | MineDojo | `python minedojo_view.py <file>` builds it in a MineDojo world, saves screenshots and `orbit.gif`, then deletes that world (keep it with `--keep-world`). Needs `pip install minedojo pillow` and Java 8. MineDojo runs Minecraft 1.11.2, so newer blocks are swapped for the closest 1.11 block. |

## Versions

Reads worlds saved by Minecraft Java 1.12.2 up to the current 26.x releases (older Anvil worlds back to 1.2 also work):

| Saved by | Storage | Notes |
|---|---|---|
| 1.12.2 and older | numeric block IDs | Converted to modern names, including doors, bed colours, banners, heads, flower pots, note blocks, stair shapes, fence/pane/wall connections, double chests, redstone wire and item IDs inside containers |
| 1.13 to 1.15 | palette packed across longs | |
| 1.16 to 1.17 | palette in aligned longs; entities in `entities/` from 1.17 | |
| 1.18 to 26.x | `block_states` sections, negative Y, LZ4 chunks (1.20.5+) | |

Builds from pre-1.13 worlds are saved with data version 1631 (1.13.2), so WorldEdit applies any later renames when you paste. Modern worlds keep the data version they were saved with.

Output is Sponge Schematic v2 by default (WorldEdit 7+, FAWE, Litematica, Amulet), or v3 (WorldEdit 7.3+).

## Command line (optional)

Needs Node.js 20 or newer.

```
node mcbs.mjs info  "path/to/world"
node mcbs.mjs scrape "path/to/world" --from 100,60,-40 --to 160,110,20 -o castle.schem
node mcbs.mjs scrape world.zip --dim nether --from ... --to ... --v3
node mcbs.mjs convert old/*.schematic -o converted
node mcbs.mjs fetch https://example.com/page-with-schematics -o downloads
node mcbs.mjs minedojo castle.schem          # commands for minedojo_view.py
node mcbs.mjs serve                          # the app in your browser, with web search and My builds
```

`fetch` reads robots.txt, downloads one file at a time with a pause between files, and converts everything it finds.

## When something goes wrong

Every failure names the file, chunk or link and says why in plain words. Nothing stops a whole batch: a bad file or damaged chunk is skipped and the rest carry on.

- **Website:** a red "N problems" button appears at the top. It opens a list with the reason and technical detail for each problem, plus **Download error log (.txt)** and **Copy**.
- **BuildScraper.exe:** problems are also added to `%LOCALAPPDATA%\BuildScraper\BuildScraper-errors.txt`.
- **Command line:** failures are printed as they happen and written to `errors.txt` in the output folder (for `scrape`, next to the output file). The command exits with code 1 when anything failed. Each run replaces the previous `errors.txt`.

### BuildScraper.exe does not open

1. Make sure you extracted the zip first. Running the .exe from inside the zip can fail.
2. If a message box appears, it says what went wrong; details are in `%LOCALAPPDATA%\BuildScraper\BuildScraper-errors.txt`.
3. If the .exe disappears, your antivirus removed it. Restore it from quarantine or allow it, then try again.
4. Nothing works: open `index.html` instead. Everything except searching sites that block web pages works there.

Damaged chunks in a world are saved as air and counted in the result, so the rest of the build still exports.

## Known limits

- Modded blocks from pre-1.13 worlds have no modern name and are saved as `unknown_legacy_<id>_<meta>`.
- Paintings and item frames keep their original tile coordinates; WorldEdit repositions them on paste.
- The map uses approximate block colours. It is for finding builds, not an exact render.

## Source

`source/src/` holds the readers and writers (NBT, region files, chunk formats, legacy conversion, schematic formats). `source/viewer/` is a copy of the schematic viewer; the build inlines it into the View in 3D tab. The viewer uses three.js (MIT licence, `source/viewer/vendor/three-LICENSE.txt`). `source/app/` is the Windows app (Go + WebView2): it shows the page in its own window, downloads web pages for it and reads and writes the category folders. Run `npm install` then `node tools/build.mjs` inside `source/` to rebuild `dist/index.html` and `dist/mcbs.mjs`; add `--exe` (needs Go 1.24+) to also build `dist/BuildScraper.exe`. Tests: `node test/ui6.mjs URL` (saving and My builds) and `node test/ui7.mjs URL` (category search) against a running app or `node dist/mcbs.mjs serve`.
