# Minecraft RL Build Generator

A reinforcement-learning agent that builds Minecraft structures block by block. You can describe what you want, preview it in 3D, and download it for **any Java version from 1.12.2 to 26.3** as a WorldEdit `.schem` file or a data pack. You can also teach it **new kinds of builds from your own schematics**. Written in pure Node.js (18+) with **no dependencies**: the neural nets, backprop, Adam, PPO, NBT, ZIP and the web server are all in `src/`.

```bash
start.bat                 # double-click: opens the program window (Control Center + Builder)
start.bat help            # command-line use: generate / train / train-all
```

See **[HOW_TO_USE.txt](HOW_TO_USE.txt)** for the step-by-step guide.

## Features

- **Prompts.** For example `3 tall spruce watchtowers` or `two 7x9 birch cottages`. A local keyword reader fills in the structure, materials, roof, size and count. It names words it doesn't know and offers to learn them.
- **Built-in types, already trained.** House (flat, gable or hip roof), watchtower, step pyramid, gate arch and castle wall, in 5 material themes.
- **Every version.** A version dropdown covers 1.12.2 through 26.3:
  - correct pack formats, `function` vs `functions` folders, and data versions
  - pre-1.13 block ids for 1.12.2
  - automatic stand-ins for blocks a version doesn't have
- **Exports:**
  - `.schem` (Sponge v2, WorldEdit 7)
  - `.schematic` (MCEdit, for 1.12.2 / WorldEdit 6)
  - a data pack or a 1.12 functions folder, with `/function rlbuild:<name>`
  - one-click install into a world
- **Realism sliders** ([src/realism.js](src/realism.js)). These are rule-based finishing touches applied after the agent builds: weathering, block variety, exterior details, interior, nature, ruin and physics, plus presets and prompt words. Physics spreads support up from the ground; sideways steps cost support (wood reaches further than stone), and unsupported blocks fall and land as rubble. They are seeded per build, so the preview always matches the files.
- **Build Scraper & Schematic Viewer compatible.** Reads and writes the same formats: `.schem` v1–v3, `.schematic`, `.litematic` and structure `.nbt` ([src/bits.js](src/bits.js) packs Litematica's bit arrays). Both directions were checked against Build Scraper's own readers and writers. The program also finds and launches both apps ([src/companions.js](src/companions.js)), and lists the schematics Build Scraper saved to Downloads for training.
- **Custom types from your schematics.** Upload `.schem`, `.schematic` or `.nbt` files and it trains a new type in about 2 minutes, using your materials.
- **MineDojo (optional).** Places builds in MineDojo's real Minecraft, films a 16-frame orbit, and ranks them by MineCLIP prompt match. Needs Linux, macOS or WSL2.

## How it works

**Environment** ([src/env.js](src/env.js)). Each episode is one structure on an 11×12×11 lot. The agent visits every cell bottom-up and picks one of 7 abstract blocks: air, foundation, wall, pillar, window, door or roof. A structure type ([src/structures/](src/structures/)) paints *zones* onto the lot from a random design brief: walls, corners, roof surface, interior, battlements and so on. The agent observes the zone, its neighbours, the mirror cell and a few counters.

**Rewards.**
- **Built-in types** use rule rewards per zone ([src/zones.js](src/zones.js)), plus a few rules: one door centred on the front, windows only in the window band, and left-right symmetry.
- **Custom types** ([src/custom.js](src/custom.js)) use an imitation reward. Each episode takes one uploaded example, stretches or squashes it 9-slice style, sometimes mirrors or rotates it, and rewards rebuilding it from shape-only zones. The agent learns the style, not the coordinates.

**Learning** ([src/nn.js](src/nn.js), [src/train.js](src/train.js)). PPO with separate actor and critic MLPs, GAE and an entropy bonus, plus three fixes that turned out to matter:
- **Rebalanced updates.** Trivial "empty space" cells are down-sampled in the update.
- **Doors as one action.** Placing the lower half fills in the upper half automatically.
- **ε-exploration with self-imitation.** Random actions only push the policy when they beat the critic (`max(A,0)`). This stops PPO's ratio clip from freezing a saturated policy.

A shared trunk for actor and critic made the critic ignore rare cells, which is why they are separate. Typical scores after 200 iterations (about 3 minutes on a laptop CPU) are 98–100, and 90–95 for custom types.

**Export** ([src/export.js](src/export.js), [src/versions.js](src/versions.js)). Maps abstract blocks to themed blocks: roof edges become stairs facing up-slope, ridges become slabs. It then writes them per version.

## Layout

```
start.bat                the one launcher -> src/launcher.js (window, or generate/train commands)
web/control.*            Control Center (program window); src/appwindow.js opens it in app mode
src/server.js            local web server (127.0.0.1:4321)
web/                     website (index.html, app.js, style.css, render.js)
src/structures/          built-in structure types
src/custom.js            custom types learned from uploads (stored in custom/)
src/schematic-import.js  .schem / .schematic / .nbt reader + block -> role mapping
src/minedojo.js          MineDojo bridge (Node side); minedojo/bridge.py (Python side)
models/                  trained policies (<type>.json) + training logs
```

## Limits

- The lot is 11×12×11, so bigger uploads are scaled down.
- Doors, glass panes and stairs come out in fixed orientations. Interiors (furniture, lights) are not generated.
- The prompt reader is keyword-based and local. It doesn't understand free-form sentences.
- The MineDojo integration couldn't be tested on the development machine, which had no WSL or Python. `bridge.py doctor` checks a setup.
