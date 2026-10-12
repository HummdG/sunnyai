"""Trace Sunny's hands and shoes from reference_poses.png.

    python -I scripts/trace-hands.py

Writes packages/character/src/traced-hands.ts. Each shape is cut out of the
pose sheet at its wrist (or ankle), its ink silhouette and its orange regions
are traced -- so the finger separations and fist creases are the sheet's own
ink lines, as with the traced face -- and it is normalised:

- hands: wrist centre at the origin, the hand pointing up (-y), length 24 units;
- shoes: ankle centre at the origin, the toe pointing along +x, length 26 units.
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
SRC = ROOT / "reference_poses.png"
OUT = ROOT / "packages" / "character" / "src" / "traced-hands.ts"
UP = 4  # upscale factor before tracing

# box: sheet-pixel crop; seed: a point inside the shape; cut: two points of the
# wrist/ankle line (the side holding the seed is kept); flip: mirror so every
# hand has its thumb on the same side; kind: hand or shoe.
SHAPES = {
    "open": dict(box=(60, 70, 137, 158), seed=(95, 115), cut=((101, 151), (129, 133)), flip=False, kind="hand"),
    "fist": dict(box=(82, 312, 140, 372), seed=(100, 340), cut=((82, 362), (140, 362)), flip=False, kind="hand"),
    "thumb": dict(box=(950, 90, 1004, 175), seed=(975, 140), cut=((957, 128), (957, 172)), flip=False, kind="hand"),
    "point": dict(box=(1050, 128, 1103, 200), seed=(1085, 170), cut=((1100, 140), (1100, 198)), flip=False, kind="hand"),
    "peace": dict(box=(84, 828, 140, 905), seed=(108, 880), cut=((100, 903), (136, 884)), flip=False, kind="hand"),
    "shoe": dict(box=(125, 484, 196, 530), seed=(150, 510), cut=((166, 486), (194, 512)), flip=False, kind="shoe"),
}


def side(p, a, b) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def trace_shape(img: np.ndarray, spec: dict) -> dict:
    x0, y0, x1, y1 = spec["box"]
    crop = Image.fromarray(img[y0:y1, x0:x1]).resize(((x1 - x0) * UP, (y1 - y0) * UP), Image.BICUBIC)
    a = np.asarray(crop).astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    background = (r > 225) & (g > 225) & (b > 225)
    orange = (r > 190) & (g > 70) & (g < 190) & (b < 110)
    solid = ~background

    # Keep the seed's side of the wrist line.
    h, w = solid.shape
    ys, xs = np.mgrid[0:h, 0:w]
    sx = xs / UP + x0
    sy = ys / UP + y0
    (ax, ay), (bx, by) = spec["cut"]
    keep_sign = np.sign(side(spec["seed"], (ax, ay), (bx, by)))
    half = np.sign((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) == keep_sign
    solid &= half

    # The component under the seed, separated from touching neighbours by a
    # light erosion first.
    eroded = ndi.binary_erosion(solid, iterations=2)
    labels, _ = ndi.label(eroded, structure=np.ones((3, 3)))
    seed = ((spec["seed"][1] - y0) * UP, (spec["seed"][0] - x0) * UP)
    lab = labels[int(seed[0]), int(seed[1])]
    assert lab != 0, f"seed not inside shape for {spec}"
    shape = ndi.binary_dilation(labels == lab, iterations=2) & solid
    shape = ndi.binary_fill_holes(shape)
    fill = shape & orange
    fill = ndi.binary_opening(fill, iterations=1)
    # The sheet's ink is drawn for a 1448px poster; at Sunny's scale it reads
    # too heavy, so the orange grows into the ink a little (thinner outline and
    # finger lines), staying inside the silhouette.
    near_cut = shape & (
        np.abs((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / math.hypot(bx - ax, by - ay) < 3.0
    )
    inner = ndi.binary_erosion(shape, iterations=5) | (near_cut & ndi.binary_erosion(shape, iterations=1))
    fill = ndi.binary_dilation(fill, iterations=3) & inner
    # The wrist/ankle edge keeps its outline: where the limb's tube meets the
    # shape, the tube's fill is drawn over it (limbs.ts), so the line only shows
    # where the hand or shoe is wider than the limb -- as a cartoon hand should.

    # Wrist/ankle centre: midpoint of the shape's pixels along the cut line.
    cut_band = shape & (np.abs((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / math.hypot(bx - ax, by - ay) < 1.2)
    if cut_band.any():
        cy, cx = np.nonzero(cut_band)
        origin = (cx.mean() / UP + x0, cy.mean() / UP + y0)
    else:
        origin = ((ax + bx) / 2, (ay + by) / 2)

    pys, pxs = np.nonzero(shape)
    pts = np.stack([pxs / UP + x0, pys / UP + y0], axis=1)
    centre = pts.mean(axis=0)
    if spec["kind"] == "hand":
        # Point the hand up: rotate so origin→farthest-centroid direction is -y.
        direction = centre - np.array(origin)
        angle = math.atan2(direction[0], -direction[1])
        far = np.max(np.hypot(*(pts - np.array(origin)).T))
        scale = 24 / far
    else:
        # Toe along +x: the foot's long axis points away from the ankle.
        direction = centre - np.array(origin)
        angle = math.atan2(direction[1], direction[0]) * 0  # keep the sheet's horizontal
        toe = pts[np.argmax(np.abs(pts[:, 0] - origin[0]))]
        flip_x = toe[0] < origin[0]
        span = pts[:, 0].max() - pts[:, 0].min()
        scale = 26 / span

    if spec["kind"] == "hand":
        # Square the wrist: in the hand's own upright frame, drop everything
        # below the wrist line, so the cut is short and square to the arm
        # rather than a long wedge left by a slanted crop line.
        ox, oy = origin
        dxs, dys = sx - ox, sy - oy
        c0, s0 = math.cos(-angle), math.sin(-angle)
        upright_y = (dxs * s0 + dys * c0) * scale
        keep = upright_y < 0.2
        shape = shape & keep
        # Inset the fill from the new wrist edge too, so the edge keeps its
        # outline wherever the arm's tube doesn't cover it.
        fill = fill & keep & ndi.binary_erosion(shape, iterations=4)

    def transform(px: float, py: float) -> tuple[float, float]:
        dx, dy = px - origin[0], py - origin[1]
        if spec["kind"] == "hand":
            c, s = math.cos(-angle), math.sin(-angle)
            dx, dy = dx * c - dy * s, dx * s + dy * c
        elif flip_x:
            dx = -dx
        if spec["flip"]:
            dx = -dx
        return dx * scale, dy * scale

    def paths(mask: np.ndarray, min_len: int = 20) -> str:
        padded = ndi.gaussian_filter(np.pad(mask.astype(float), 1), 1.4)
        out = []
        for contour in measure.find_contours(padded, 0.5):
            if len(contour) < min_len:
                continue
            simple = measure.approximate_polygon(contour, 2.6)
            pts2 = [transform((c[1] - 1) / UP + x0, (c[0] - 1) / UP + y0) for c in simple[:-1]]
            if len(pts2) >= 3:
                out.append(catmull_rom(pts2))
        return "".join(out)

    # Half-width of the silhouette along the cut, in output units.
    if cut_band.any():
        ux, uy = (bx - ax), (by - ay)
        ul = math.hypot(ux, uy)
        proj = ((cx / UP + x0) - origin[0]) * ux / ul + ((cy / UP + y0) - origin[1]) * uy / ul
        joint_half = (proj.max() - proj.min()) / 2 * scale
    else:
        joint_half = 4.0
    return {"ink": paths(shape), "fill": paths(fill, 12), "joint": round(joint_half, 2)}


def fmt(v: float) -> str:
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def catmull_rom(pts: list[tuple[float, float]]) -> str:
    n = len(pts)
    out = [f"M{fmt(pts[0][0])} {fmt(pts[0][1])}"]
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append(f"C{fmt(c1[0])} {fmt(c1[1])} {fmt(c2[0])} {fmt(c2[1])} {fmt(p2[0])} {fmt(p2[1])}")
    out.append("Z")
    return "".join(out)


def author_point() -> dict:
    """The pointing hand, drawn from parts rather than traced.

    The sheet's pointing hand (top-right cell) is about 50px across and its
    crop catches a ray, so the trace came out as a fist with a finger stuck up
    and a wide wrist -- ambiguous at Sunny's sizes. This rebuilds it as a
    finger-gun with the sheet's proportions: index finger straight along the
    arm, thumb cocked on the thumb side (-x, the same side as the other hands),
    the other three fingers curled into knuckles with crease lines between
    them. It runs through the same contour -> spline pipeline as the traced
    shapes, so outline weight and crease style match.
    """
    S = 20  # raster pixels per output unit
    x0, x1, y0, y1 = -16.0, 12.0, -28.0, 3.0
    w, h = int((x1 - x0) * S), int((y1 - y0) * S)
    ys, xs = np.mgrid[0:h, 0:w]
    ux = xs / S + x0
    uy = ys / S + y0

    def capsule(ax, ay, bx, by, r):
        dx, dy = bx - ax, by - ay
        t = np.clip(((ux - ax) * dx + (uy - ay) * dy) / (dx * dx + dy * dy), 0, 1)
        return np.hypot(ux - (ax + t * dx), uy - (ay + t * dy)) <= r

    def rounded_rect(left, top, right, bottom, r):
        cx = np.clip(ux, left + r, right - r)
        cy = np.clip(uy, top + r, bottom - r)
        return np.hypot(ux - cx, uy - cy) <= r

    outline = 1.75
    palm = rounded_rect(-6.6, -9.4, 6.6, 0.8, 3.6)
    index = capsule(-3.3, -10.0, -3.3, -21.4, 2.6)
    thumb = capsule(-5.0, -9.4, -9.6, -13.6, 2.35)
    knuckles = [capsule(x, -7.6, x, -12.6, 2.05) for x in (1.1, 4.75)]
    parts = [palm, index, thumb, *knuckles]
    union = np.logical_or.reduce(parts)

    grow = ndi.binary_dilation(union, iterations=int(round(outline * S)))
    ink = grow & (uy <= 0.3)

    crease = np.zeros_like(union)
    half = 0.36
    # Between the index finger and the first knuckle, and between knuckles.
    for gx in (-1.05, 2.95):
        crease |= (np.abs(ux - gx) <= half) & (uy <= -10.6) & (uy >= -15.2)
    # Where the thumb folds against the palm.
    crease |= capsule(-6.0, -8.6, -4.4, -11.2, half)
    fill = union & ~crease & (uy <= -1.1)
    fill = ndi.binary_opening(fill, iterations=2)

    def contours(mask: np.ndarray, min_len: int) -> str:
        padded = ndi.gaussian_filter(np.pad(mask.astype(float), 1), 1.2)
        out = []
        for contour in measure.find_contours(padded, 0.5):
            if len(contour) < min_len:
                continue
            simple = measure.approximate_polygon(contour, 0.9)
            pts = [((c[1] - 1) / S + x0, (c[0] - 1) / S + y0) for c in simple[:-1]]
            if len(pts) >= 3:
                out.append(catmull_rom(pts))
        return "".join(out)

    return {"ink": contours(ink, 40), "fill": contours(fill, 30), "joint": 8.0}


img = np.asarray(Image.open(SRC).convert("RGB"))
traced = {name: trace_shape(img, spec) for name, spec in SHAPES.items() if name != "point"}
traced["point"] = author_point()
traced = {name: traced[name] for name in SHAPES}
header = """// GENERATED by scripts/trace-hands.py from reference_poses.png -- do not edit by hand.
//
// Sunny's hands and shoes, traced from the pose sheet. Hands: wrist at the
// origin, pointing up (-y), 24 units long. Shoes: ankle at the origin, toe
// along +x, 26 units long. `ink` is the silhouette (drawn in ink), `fill` the
// orange regions inside it, so finger separations are the sheet's own lines.

"""
OUT.write_text(header + "export const TRACED_HANDS = " + json.dumps(traced, separators=(",", ":")) + " as const;\n", encoding="utf-8")
print("wrote", OUT.relative_to(ROOT), OUT.stat().st_size, "bytes")
