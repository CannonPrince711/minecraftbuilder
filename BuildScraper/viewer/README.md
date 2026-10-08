# Schematic Viewer

View Minecraft builds in 3D, right in your web browser. Nothing to install, and your files never leave your computer.

## How to start

1. Unzip the folder anywhere.
2. Double-click **index.html**. It opens in your browser (Chrome, Edge, Firefox or Safari).
3. Click **Open files** or drag one or more schematic files onto the page.
   Click **Try a demo build** if you just want to look around.

Keep all the files together: the page needs the `js`, `css` and `vendor` folders next to it.

## Supported files

| File | Made by | Minecraft versions |
|---|---|---|
| `.schem` (Sponge v1, v2, v3) | WorldEdit, FastAsyncWorldEdit, Amulet, the build scraper | 1.13 to latest |
| `.schematic` | MCEdit, Schematica, old WorldEdit | 1.12.2 and older (old numeric block IDs are converted automatically) |
| `.litematic` | Litematica (multi-region files work) | 1.12 to latest |
| `.nbt` | Vanilla structure blocks | 1.13 to latest |

## Controls

- **Rotate**: drag with the left mouse button (one finger on touch screens)
- **Move**: drag with the right mouse button, or hold Shift (two fingers on touch)
- **Zoom**: mouse wheel or pinch
- **Inspect**: point at a block to see its name, properties and position. Click it to find it in the block list.
- **Layers**: the sliders, or the `[` and `]` keys, build the schematic up layer by layer. Tick *One layer at a time* to follow a build step by step.
- **Hide blocks**: untick a block type in the list (for example to remove the ground or see through walls).
- **Materials list**: *Export list* saves block counts, stacks of 64 and shulker boxes as a CSV spreadsheet.
- **Shortcuts**: `1`-`4` camera views, `R` reset view, `P` screenshot, `F` full screen.

You can also open a file from a web address: `index.html?url=https://example.com/build.schem` (the site must allow it).

## Put it on the web

The viewer is a plain static website: every path is relative and there is no server code, so any static host works.

- **Netlify**: drag the unzipped `schematic-viewer` folder onto https://app.netlify.com/drop.
- **GitHub Pages**: push the folder to a repository and turn on Pages for it (the `.nojekyll` file is already included).
- **Any web server**: copy the folder into the site, for example as `/viewer/`.

To combine it with the build scraper as one site, put the scraper at the site root and this folder at `/viewer/`. The scraper can then open any scraped file in the viewer with a link like `/viewer/?url=/downloads/my-build.schem`. Files on the same site always load; files on other sites load only if that site allows it (CORS).

## When something goes wrong

Every problem appears in the **Problems** panel (and as a red or yellow badge at the top): which file, what went wrong in plain words, what to try, and technical details. **Copy details** copies the whole list as text. Files that could not be opened are marked in red in the Files list; click one to see why. The viewer recognises common mix-ups such as zip archives, preview images, saved web pages, Bedrock `.mcstructure` files, world files, cut-off downloads and damaged files. Problems in files that still open (missing data, unknown modded blocks) show as warnings.

The Windows app also writes these to `%LOCALAPPDATA%\SchematicViewer\viewer-log.txt`.

## Good to know

- Blocks are drawn with solid colours that approximate their in-game look, so the viewer works offline and needs no Minecraft textures. Common shapes (slabs, stairs, fences, walls, panes, doors, trapdoors, carpets, plants, torches and more) are shown; complex models are simplified.
- Modded blocks still show up, with a colour picked from their name.
- Large builds work: a 320 × 160 × 320 schematic (16 million block spaces) opens in a few seconds.

## For developers

- `js/nbt.js` NBT reader, `js/formats.js` format readers, `js/legacy.js` 1.12 ID table, `js/blocks.js` colours and shapes, `js/mesher.js` mesh builder, `js/app.js` the UI.
- `node tools/make-samples.js samples` regenerates the sample files; `node tools/test-parse.js file...` parses files from the command line.
- 3D rendering uses three.js r149 (MIT licence, in `vendor/`).
