"""Stitch numbered PNG frames (from render-chat-turn.ts) into an animated GIF.

    python scripts/frames-to-gif.py <frames-dir> <out.gif> [fps]

Needs Pillow.
"""

import sys
from pathlib import Path

from PIL import Image

frames_dir = Path(sys.argv[1])
out = Path(sys.argv[2])
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 20.0

paths = sorted(frames_dir.glob("frame-*.png"))
if not paths:
    sys.exit(f"no frames in {frames_dir}")
frames = [Image.open(p).convert("RGB").quantize(colors=64, dither=Image.Dither.NONE) for p in paths]
frames[0].save(
    out,
    save_all=True,
    append_images=frames[1:],
    duration=round(1000 / fps),
    loop=0,
    optimize=True,
)
print(f"wrote {out} ({len(frames)} frames)")
