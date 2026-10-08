"""MineDojo bridge for the RL Build Generator.

Places generated builds inside MineDojo's Minecraft (1.11.2), films a 16-frame
orbit around each one, and scores how well the video matches the text prompt
with MineCLIP. Called by src/minedojo.js; can also be run by hand:

    python bridge.py doctor
    python bridge.py run --job job.json --out some/folder

job.json: {"prompt": str, "lot": [11, 12, 11],
           "builds": [{"name": str, "height": int, "blocks": [[x, y, z, "minecraft:id", meta], ...]}]}
Writes some/folder/result.json:
           {"prompt": str, "builds": {name: {"clip": float, "images": [png file names]}}}

Setup (Linux, macOS, or WSL2 on Windows):
    conda create -n minedojo python=3.9 && conda activate minedojo
    # JDK 8 is required by MineDojo, e.g.: sudo apt install openjdk-8-jdk
    pip install minedojo
    pip install git+https://github.com/MineDojo/MineCLIP
    # download the MineCLIP "attn" checkpoint (link in the MineCLIP README) to minedojo/attn.pth
    # headless Linux/WSL: export MINEDOJO_HEADLESS=1
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CKPT = os.environ.get("MINECLIP_CKPT", os.path.join(HERE, "attn.pth"))
GROUND_Y = 3          # superflat grass level; the build's foundation layer replaces it
ORIGIN = (0, 0)       # x, z of the lot corner
FRAMES = 16           # MineCLIP works on 16-frame videos
RENDER_SIZE = (320, 512)
CLIP_SIZE = (160, 256)


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- setup check

def doctor():
    ok = True
    log("Python %s" % sys.version.split()[0])
    if sys.version_info[:2] != (3, 9):
        log("  warning: MineDojo is tested on Python 3.9")
    for mod in ("numpy", "torch", "minedojo", "mineclip", "PIL"):
        try:
            __import__(mod)
            log("  ok      %s" % mod)
        except Exception as e:  # noqa: BLE001
            ok = False
            log("  missing %s (%s)" % (mod, e))
    if os.path.exists(CKPT):
        log("  ok      MineCLIP weights at %s" % CKPT)
    else:
        ok = False
        log("  missing MineCLIP weights: put attn.pth at %s (or set MINECLIP_CKPT)" % CKPT)
    log("Ready." if ok else "Not ready yet - see the setup notes at the top of bridge.py.")
    return 0 if ok else 1


# ---------------------------------------------------------------- simulator

def make_env():
    import minedojo

    kwargs = dict(task_id="creative:255", image_size=RENDER_SIZE, start_position=dict(x=-6, y=4, z=-6, yaw=0, pitch=0))
    try:
        env = minedojo.make(generate_world_type="flat", **kwargs)
    except Exception as e:  # noqa: BLE001  older/newer MineDojo builds differ in options
        log("flat world option not accepted (%s); using the default world with a platform" % e)
        env = minedojo.make(**kwargs)
    env.reset()
    for cmd in ("/time set 6000", "/gamerule doDaylightCycle false", "/weather clear 1000000",
                "/gamerule doMobSpawning false", "/kill @e[type=!player]", "/gamemode creative @p"):
        env.execute_cmd(cmd)
    return env


def noop(env, n=1):
    obs = None
    for _ in range(n):
        obs, _, _, _ = env.step(env.action_space.no_op())
    return obs


def place(env, build, lot):
    gx, gy, gz = lot
    ox, oz = ORIGIN
    # Clear the lot, lay a grass floor around it, then place the build.
    env.execute_cmd("/fill %d %d %d %d %d %d minecraft:air" % (ox - 8, GROUND_Y, oz - 8, ox + gx + 8, GROUND_Y + gy + 4, oz + gz + 8))
    env.execute_cmd("/fill %d %d %d %d %d %d minecraft:grass" % (ox - 8, GROUND_Y, oz - 8, ox + gx + 8, GROUND_Y, oz + gz + 8))
    # Bottom-up so doors and panes have support when they land.
    for x, y, z, block, meta in sorted(build["blocks"], key=lambda b: b[1]):
        env.execute_cmd("/setblock %d %d %d %s %d" % (ox + x, GROUND_Y + y, oz + z, block, meta))


def orbit_frames(env, build, lot):
    """Teleport around the build (starting in front of its door) and grab one frame per stop."""
    import numpy as np

    gx, gy, gz = lot
    blocks = build["blocks"]
    xs = [b[0] for b in blocks] or [gx / 2]
    zs = [b[2] for b in blocks] or [gz / 2]
    top = max([b[1] for b in blocks] or [4])
    cx = ORIGIN[0] + (min(xs) + max(xs) + 1) / 2.0
    cz = ORIGIN[1] + (min(zs) + max(zs) + 1) / 2.0
    target_y = GROUND_Y + top * 0.45
    radius = max(9.0, 1.6 * max(max(xs) - min(xs), max(zs) - min(zs), top))
    cam_y = target_y + radius * 0.35
    frames = []
    for k in range(FRAMES):
        a = 2 * math.pi * k / FRAMES
        px, pz = cx - radius * math.sin(a), cz - radius * math.cos(a)  # k=0: north side, facing the door
        yaw = math.degrees(math.atan2(-(cx - px), cz - pz))
        pitch = math.degrees(math.atan2(cam_y - target_y, radius))
        env.execute_cmd("/tp @p %.2f %.2f %.2f %.1f %.1f" % (px, cam_y, pz, yaw, pitch))
        obs = noop(env, 2)
        frames.append(np.asarray(obs["rgb"]))  # (3, H, W) uint8
    return np.stack(frames)  # (16, 3, H, W)


# ---------------------------------------------------------------- MineCLIP

def load_mineclip(device):
    import torch
    from mineclip import MineCLIP

    model = MineCLIP(arch="vit_base_p16_fz.v2.t2", hidden_dim=512, image_feature_dim=512,
                     mlp_adapter_spec="v0-2.t0", pool_type="attn.d2.nh8.glusw", resolution=CLIP_SIZE)
    model.load_ckpt(CKPT, strict=True)
    return model.to(device).eval()


def clip_score(model, frames, prompt, device):
    import torch
    import torch.nn.functional as F

    with torch.no_grad():
        video = torch.as_tensor(frames, dtype=torch.float32, device=device)
        video = F.interpolate(video, size=CLIP_SIZE, mode="bilinear", align_corners=False).unsqueeze(0)
        v = model.encode_video(video)
        t = model.encode_text([prompt])
        return float(F.cosine_similarity(v, t).item())


def save_images(frames, out_dir, name):
    from PIL import Image

    files = []
    for k in (0, 4, 8, 12):  # front, side, back, side
        fn = "%s_%d.png" % (name, k // 4)
        Image.fromarray(frames[k].transpose(1, 2, 0)).save(os.path.join(out_dir, fn))
        files.append(fn)
    return files


# ---------------------------------------------------------------- main

def run(job_path, out_dir):
    import torch

    with open(job_path) as f:
        job = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    log("Loading MineCLIP on %s" % device)
    model = load_mineclip(device)
    log("Starting MineDojo (the first start can take a few minutes)")
    env = make_env()
    results = {}
    try:
        for i, build in enumerate(job["builds"]):
            log("[%d/%d] placing %s (%d blocks)" % (i + 1, len(job["builds"]), build["name"], len(build["blocks"])))
            place(env, build, job["lot"])
            noop(env, 5)
            frames = orbit_frames(env, build, job["lot"])
            score = clip_score(model, frames, job["prompt"], device)
            results[build["name"]] = {"clip": score, "images": save_images(frames, out_dir, build["name"])}
            log("[%d/%d] %s MineCLIP match %.3f" % (i + 1, len(job["builds"]), build["name"], score))
    finally:
        env.close()
    with open(os.path.join(out_dir, "result.json"), "w") as f:
        json.dump({"prompt": job["prompt"], "builds": results}, f)
    log("Done")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor", help="check that MineDojo, MineCLIP and its weights are installed")
    r = sub.add_parser("run", help="render and score a job file")
    r.add_argument("--job", required=True)
    r.add_argument("--out", required=True)
    a = ap.parse_args()
    sys.exit(doctor() if a.cmd == "doctor" else run(a.job, a.out))


if __name__ == "__main__":
    main()
