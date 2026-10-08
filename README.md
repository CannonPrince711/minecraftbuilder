# Minecraft builder

Three Minecraft Java tools that share the same schematic formats (`.schem`, `.schematic`, `.litematic`, structure `.nbt`).

- **[BuildScraper](BuildScraper/)**: pulls a build out of any Java world (1.12.2 to 26.x) and saves it as a schematic, converts and searches for schematics, and shows them in 3D. Open `BuildScraper/dist/index.html`, or rebuild with `npm install` then `node tools/build.mjs` inside `BuildScraper/`. Its "Build generator" tab lists the builds made by the generator below.
- **[minecraft build gen](minecraft%20build%20gen/)**: the RL Build Generator, a reinforcement-learning agent that builds structures from a short prompt and exports them for 1.12.2 to 26.3. Double-click `start.bat` (Node.js 18+). See its `README.md` and `HOW_TO_USE.txt`.
- **[SchematicViewer](SchematicViewer/)**: the standalone 3D schematic viewer and its Windows app source.

`BuildScraper.exe` is not stored here; build it with `node tools/build.mjs --exe` (needs Go 1.24+).
