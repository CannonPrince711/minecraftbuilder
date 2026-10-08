#!/usr/bin/env python3
"""View a schematic inside MineDojo.

Builds the schematic in a flat MineDojo world (Minecraft 1.11.2), flies a camera around it,
saves screenshots plus an orbit GIF, then closes Minecraft and deletes the world it made.

    pip install minedojo pillow      # MineDojo also needs Java 8 (JDK 1.8)
    python minedojo_view.py castle.schem
    python minedojo_view.py castle.minedojo.json --frames 16 --size 720x1280 --keep-world

Schematic files (.schem / .schematic / .litematic / .nbt) are turned into commands with
`node mcbs.mjs minedojo` or `BuildScraper.exe minedojo` from the same folder.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_commands(path: Path, origin):
    if path.suffix.lower() == ".json":
        return json.loads(path.read_text())
    out = Path(tempfile.gettempdir()) / (path.stem + ".minedojo.json")
    exe = HERE / "BuildScraper.exe"
    cli = HERE / "mcbs.mjs"
    args = ["minedojo", str(path), "-o", str(out), "--at", ",".join(map(str, origin))]
    if exe.exists() and os.name == "nt":
        cmd = [str(exe)] + args
    elif cli.exists() and shutil.which("node"):
        cmd = ["node", str(cli)] + args
    else:
        sys.exit("Put this script next to BuildScraper.exe or mcbs.mjs (with Node.js installed), "
                 "or pass a .minedojo.json made with `mcbs.mjs minedojo`.")
    subprocess.run(cmd, check=True)
    return json.loads(out.read_text())


def saves_dir():
    """Where MineDojo's bundled Minecraft keeps worlds."""
    import minedojo
    base = Path(minedojo.__file__).resolve().parent / "sim" / "Malmo" / "Minecraft" / "run" / "saves"
    return base


def snapshot(d: Path):
    return {p.name for p in d.iterdir()} if d.exists() else set()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help=".schem/.schematic/.litematic/.nbt or a .minedojo.json")
    ap.add_argument("--frames", type=int, default=12, help="screenshots around the build (default 12)")
    ap.add_argument("--size", default="480x768", help="image size HEIGHTxWIDTH (default 480x768)")
    ap.add_argument("--out", type=Path, default=None, help="folder for screenshots (default <name>_minedojo)")
    ap.add_argument("--keep-world", action="store_true", help="don't delete the MineDojo world afterwards")
    a = ap.parse_args()

    try:
        import minedojo
        import numpy as np
        from PIL import Image
    except ImportError as e:
        sys.exit(f"Missing package: {e.name}. Install with: pip install minedojo pillow")

    origin = (0, 4, 0)  # flat world grass is at y=3
    plan = load_commands(a.file, origin)
    w, h, l = plan["size"]
    ox, oy, oz = plan.get("origin", origin)
    commands = plan["commands"]
    missing = {k: v for k, v in plan.get("unmapped", {}).items() if v}
    if missing:
        print(f"Note: {len(missing)} block type(s) have no Minecraft 1.11 version and are left out.")

    hh, ww = (int(v) for v in a.size.lower().split("x"))
    out_dir = a.out or a.file.with_name(a.file.stem + "_minedojo")
    out_dir.mkdir(parents=True, exist_ok=True)

    sdir = saves_dir()
    before = snapshot(sdir)
    cx, cz = ox + w / 2, oz + l / 2
    env = minedojo.make(
        task_id="creative:0",
        image_size=(hh, ww),
        generate_world_type="flat",
        start_position=dict(x=cx, y=oy + h + 5, z=oz - 10, yaw=0, pitch=30),
        start_time=6000,
        allow_time_passage=False,
        allow_mob_spawn=False,
        world_seed=1,
    )
    frames = []
    try:
        env.reset()
        noop = env.action_space.no_op()
        env.execute_cmd("/gamemode 3")       # spectator: no gravity, no collisions, no hand
        env.execute_cmd("/gamerule doDaylightCycle false")
        env.execute_cmd("/weather clear 100000")
        t0 = time.time()
        for i, cmd in enumerate(commands, 1):
            env.execute_cmd(cmd)
            if i % 200 == 0 or i == len(commands):
                print(f"  placed {i}/{len(commands)} commands ({time.time() - t0:.0f}s)")
        radius = max(w, l) * 0.9 + 8
        cam_y = oy + h * 0.8 + 4
        for k in range(a.frames):
            ang = 2 * math.pi * k / a.frames
            x, z = cx + radius * math.sin(ang), cz - radius * math.cos(ang)
            # Minecraft yaw: 0 faces +Z, 90 faces -X
            yaw = math.degrees(math.atan2(-(cx - x), cz - z))
            pitch = math.degrees(math.atan2(cam_y - (oy + h / 2), radius))
            env.teleport_agent(x, cam_y, z, yaw, pitch)
            obs = None
            for _ in range(3):  # let chunks render
                obs, _, _, _ = env.step(noop)
            img = Image.fromarray(np.transpose(obs["rgb"], (1, 2, 0)).astype("uint8"))
            p = out_dir / f"view_{k:02d}.png"
            img.save(p)
            frames.append(img)
            print(f"  saved {p}")
        if frames:
            gif = out_dir / "orbit.gif"
            frames[0].save(gif, save_all=True, append_images=frames[1:], duration=350, loop=0)
            print(f"Saved {gif}")
    finally:
        env.close()
        if not a.keep_world:
            time.sleep(1)
            if not sdir.exists():
                print(f"Could not find MineDojo's saves folder ({sdir}); nothing deleted.")
            for name in snapshot(sdir) - before:   # only worlds created by this run
                shutil.rmtree(sdir / name, ignore_errors=True)
                print(f"Deleted MineDojo world {name}")


if __name__ == "__main__":
    main()
