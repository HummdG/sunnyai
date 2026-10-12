"""Trace the reference artwork (sunny.png) into layered vector parts.

    python -I scripts/trace-reference.py

Writes packages/character/src/traced-art.ts. The character is drawn from these
traced shapes rather than from idealised geometry, so the hand-inked line
weight, the detached rays, the notched pupils, the brows and the cheek creases
are the reference's own.

Every part is emitted in the rig's body-local frame (origin at the body centre,
+y down) using the same scale as geometry.ts: 1 source px = 0.125417 units,
body centre at source (625, 618).
"""

from __future__ import annotations

import json
import math
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import measure

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "sunny.png"
OUT = ROOT / "packages" / "character" / "src" / "traced-art.ts"

SCALE = 0.125417
CX, CY = 625.0, 618.0
RAY_ANGLES = [0, 49, 91.5, 131.5, 180, 228.5, 268.5, 311]

img = np.asarray(Image.open(SRC).convert("RGBA")).astype(np.int32)
r, g, b, a = img[..., 0], img[..., 1], img[..., 2], img[..., 3]
solid = a > 127
orange = solid & (r > 180) & (g > 60) & (g < 175) & (b < 90)
cream = solid & (r > 200) & (g > 190) & (b > 140)
ink = solid & ~orange & ~cream


def local(x: float, y: float) -> tuple[float, float]:
    return ((x - CX) * SCALE, (y - CY) * SCALE)


def path_for(mask: np.ndarray, tolerance: float = 1.3, min_len: int = 12) -> str:
    """Smooth closed paths around every boundary of `mask` (holes included)."""
    padded = np.pad(mask.astype(float), 1)
    padded = ndi.gaussian_filter(padded, 0.7)
    parts: list[str] = []
    for contour in measure.find_contours(padded, 0.5):
        if len(contour) < min_len:
            continue
        simple = measure.approximate_polygon(contour, tolerance)
        pts = [local(c[1] - 1, c[0] - 1) for c in simple[:-1]]
        if len(pts) < 3:
            continue
        parts.append(catmull_rom(pts))
    return "".join(parts)


def catmull_rom(pts: list[tuple[float, float]]) -> str:
    """Closed Catmull-Rom spline through `pts`, as cubic Beziers."""
    n = len(pts)
    f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".").replace("-0", "-0") if v != 0 else "0"
    out = [f"M{f(pts[0][0])} {f(pts[0][1])}"]
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append(
            f"C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}"
        )
    out.append("Z")
    return "".join(out)


def centroid(mask: np.ndarray) -> tuple[float, float]:
    ys, xs = np.nonzero(mask)
    return local(xs.mean(), ys.mean())


# ── silhouette components: the body and eight detached rays ──────────────────
labels, count = ndi.label(solid)
sizes = ndi.sum(solid, labels, range(1, count + 1))
order = np.argsort(sizes)[::-1] + 1
body_label = order[0]
ray_labels = [lab for lab in order[1:] if sizes[lab - 1] > 2000][:8]
assert len(ray_labels) == 8, f"expected 8 rays, found {len(ray_labels)}"

rays = []
for lab in ray_labels:
    comp = labels == lab
    cx, cy = centroid(comp)
    angle = (math.degrees(math.atan2(cx, -cy)) + 360) % 360
    index = min(range(8), key=lambda i: abs(((RAY_ANGLES[i] - angle + 180) % 360) - 180))
    fill = ndi.binary_fill_holes(comp & orange)
    rays.append(
        {
            "index": index,
            "ink": path_for(ndi.binary_fill_holes(comp)),
            "fill": path_for(fill),
        }
    )
rays.sort(key=lambda ray: ray["index"])
assert [ray["index"] for ray in rays] == list(range(8)), "ray matching failed"

# ── body ─────────────────────────────────────────────────────────────────────
body = ndi.binary_fill_holes(labels == body_label)
body_orange = ndi.binary_fill_holes(body & orange)
# Keep only the largest orange region (the disc), then fill the face's holes.
lab_o, n_o = ndi.label(body_orange)
body_orange = lab_o == (np.argmax(ndi.sum(body_orange, lab_o, range(1, n_o + 1))) + 1)
body_orange = ndi.binary_fill_holes(body_orange)

# ── face: every non-orange feature inside the orange disc ────────────────────
face = body_orange & ~orange
face_labels, face_count = ndi.label(face, structure=np.ones((3, 3)))
features = []
for lab in range(1, face_count + 1):
    comp = face_labels == lab
    area = int(comp.sum())
    if area < 150:
        continue
    ys, xs = np.nonzero(comp)
    features.append(
        {
            "mask": comp,
            "area": area,
            "has_cream": bool((comp & cream).sum() > 500),
            "cy": ys.mean(),
            "cx": xs.mean(),
            "bbox": (xs.min(), ys.min(), xs.max(), ys.max()),
        }
    )

eyes = sorted([f for f in features if f["has_cream"]], key=lambda f: f["cx"])
assert len(eyes) == 2, f"expected 2 eyes, found {len(eyes)}"
rest = [f for f in features if not f["has_cream"]]
eye_top = min(e["bbox"][1] for e in eyes)
brows = sorted([f for f in rest if f["cy"] < eye_top + 10], key=lambda f: f["cx"])
assert len(brows) == 2, f"expected 2 brows, found {len(brows)}"
mouth_parts = [f for f in rest if all(f is not b for b in brows)]


def eye_part(feature: dict) -> dict:
    outer = ndi.binary_fill_holes(feature["mask"])
    # The ring is the dark outline; measure its thickness from the reference's
    # 11 px eye stroke and erode by that much to get the opening.
    inner = ndi.binary_erosion(outer, iterations=11)
    pupil = inner & ink
    lab_p, n_p = ndi.label(pupil)
    if n_p > 1:
        pupil = lab_p == (np.argmax(ndi.sum(pupil, lab_p, range(1, n_p + 1))) + 1)
    ys, xs = np.nonzero(outer)
    return {
        "outer": path_for(outer),
        "inner": path_for(inner),
        "pupil": path_for(pupil, tolerance=0.9),
        "centre": local(xs.mean(), ys.mean()),
    }


def ink_part(masks: list[np.ndarray]) -> dict:
    merged = np.zeros_like(masks[0])
    for m in masks:
        merged |= m
    ys, xs = np.nonzero(merged)
    return {"ink": path_for(merged, tolerance=0.9, min_len=6), "centre": local(xs.mean(), ys.mean())}


art = {
    "body": {"ink": path_for(body), "fill": path_for(body_orange)},
    "rays": [{"ink": ray["ink"], "fill": ray["fill"]} for ray in rays],
    "eyes": {"left": eye_part(eyes[0]), "right": eye_part(eyes[1])},
    "brows": {"left": ink_part([brows[0]["mask"]]), "right": ink_part([brows[1]["mask"]])},
    "mouth": ink_part([f["mask"] for f in mouth_parts]),
}

header = '''// GENERATED by scripts/trace-reference.py from sunny.png -- do not edit by hand.
//
// The reference artwork, traced into layered parts in the rig's body-local
// frame (origin at the body centre, +y down, 1 source px = 0.125417 units).
// Re-run the script after changing the reference.

'''
OUT.write_text(
    header
    + "export const TRACED_ART = "
    + json.dumps(art, separators=(",", ":"))
    + " as const;\n",
    encoding="utf-8",
)
print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB, mouth parts {len(mouth_parts)}")
