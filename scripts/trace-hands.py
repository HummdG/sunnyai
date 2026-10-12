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


class HandCanvas:
    """A raster in output units for drawing a hand from parts, then running it
    through the same contour -> spline pipeline as the traced shapes, so the
    outline weight and crease style match the traced hands."""

    S = 20  # raster pixels per output unit
    OUTLINE = 1.75
    CREASE = 0.36

    def __init__(self) -> None:
        self.x0, x1, self.y0, y1 = -16.0, 12.0, -28.0, 3.0
        w, h = int((x1 - self.x0) * self.S), int((y1 - self.y0) * self.S)
        ys, xs = np.mgrid[0:h, 0:w]
        self.ux = xs / self.S + self.x0
        self.uy = ys / self.S + self.y0

    def capsule(self, ax, ay, bx, by, r):
        ux, uy = self.ux, self.uy
        dx, dy = bx - ax, by - ay
        t = np.clip(((ux - ax) * dx + (uy - ay) * dy) / (dx * dx + dy * dy), 0, 1)
        return np.hypot(ux - (ax + t * dx), uy - (ay + t * dy)) <= r

    def rounded_rect(self, left, top, right, bottom, r):
        cx = np.clip(self.ux, left + r, right - r)
        cy = np.clip(self.uy, top + r, bottom - r)
        return np.hypot(self.ux - cx, self.uy - cy) <= r

    def vline(self, x, top, bottom):
        return (np.abs(self.ux - x) <= self.CREASE) & (self.uy >= top) & (self.uy <= bottom)

    def shape(self, parts, crease, joint: float) -> dict:
        union = np.logical_or.reduce(parts)
        grow = ndi.binary_dilation(union, iterations=int(round(self.OUTLINE * self.S)))
        ink = grow & (self.uy <= 0.3)
        fill = ndi.binary_opening(union & ~crease & (self.uy <= -1.1), iterations=2)
        return {"ink": self._contours(ink, 40), "fill": self._contours(fill, 30), "joint": joint}

    def _contours(self, mask: np.ndarray, min_len: int) -> str:
        padded = ndi.gaussian_filter(np.pad(mask.astype(float), 1), 1.2)
        out = []
        for contour in measure.find_contours(padded, 0.5):
            if len(contour) < min_len:
                continue
            simple = measure.approximate_polygon(contour, 1.6)
            pts = [((c[1] - 1) / self.S + self.x0, (c[0] - 1) / self.S + self.y0) for c in simple[:-1]]
            if len(pts) >= 3:
                out.append(catmull_rom(pts))
        return "".join(out)


def author_point() -> dict:
    """The finger-gun (sheet: top-right cell), drawn from parts.

    The sheet's pointing hand is about 50px across and its crop catches a ray,
    so its trace read as a fist with a finger stuck up. Drawn instead as an
    "L", never a single central digit: the index finger runs along the
    hand's thumb-side edge (-x), flush with the palm; the thumb sticks out
    sideways ON TOP of the index base, angled back towards the wrist; the
    other fingers are short curled knuckles stacked on the far side (+x), well
    behind the index tip. Used side-on (pointing along the arm).
    """
    c = HandCanvas()
    palm = c.rounded_rect(-6.4, -9.0, 6.6, 0.8, 3.4)
    index = c.capsule(-4.0, -7.0, -4.0, -21.6, 2.45)
    thumb = c.capsule(-5.2, -6.6, -10.6, -4.2, 2.3)
    knuckles = [c.capsule(0.2, -6.0, 0.2, -11.4, 1.95), c.capsule(3.9, -5.6, 3.9, -10.6, 1.95)]
    crease = (
        c.vline(-1.75, -14.2, -6.8)  # the index stands apart along its length
        | c.vline(2.05, -13.4, -9.2)  # curled fingers part only at their fronts
        | c.capsule(-6.3, -5.0, -5.4, -8.4, c.CREASE)  # thumb over the index base
    )
    return c.shape([palm, index, thumb, *knuckles], crease, joint=8.0)






def author_index() -> dict:
    """A raised index finger (sheet: the "idea" pose, second row), drawn from parts.

    Seen from the back of the hand: the index finger rises from the edge of
    the fist (-x, the side the hand is mirrored towards the head), the other
    fingers are a rounded fist beside and below it with knuckle creases, and
    the thumb is folded ACROSS the front of the fist (the sheet's "J" line) --
    no digit sticks out on the far side of the index, so it can only read as
    an index finger.
    """
    c = HandCanvas()
    fist = c.rounded_rect(-6.2, -12.0, 7.0, 0.8, 4.6)
    index = c.capsule(-3.9, -9.0, -3.9, -21.6, 2.45)
    curl_top = c.capsule(-0.6, -11.6, 4.8, -11.0, 2.0)
    crease = (
        c.vline(-1.55, -15.0, -8.6)  # index finger against the fist
        | c.capsule(-0.4, -9.0, 5.2, -8.6, c.CREASE)  # between the curled fingers
        # The folded thumb across the front: the sheet's "J".
        | c.capsule(-3.6, -4.2, 0.4, -5.6, c.CREASE)
        | c.capsule(0.4, -5.6, 3.4, -4.6, c.CREASE)
        | c.capsule(3.4, -4.6, 4.2, -2.6, c.CREASE)
    )
    # In the pose the left hand is mirrored, which puts the raised finger on
    # the side towards the head and the fist outside it, as in the sheet.
    return c.shape([fist, index, curl_top], crease, joint=8.0)


img = np.asarray(Image.open(SRC).convert("RGB"))
AUTHORED = {"point": author_point, "index": author_index}
traced = {name: trace_shape(img, spec) for name, spec in SHAPES.items() if name not in AUTHORED}
for name, author in AUTHORED.items():
    traced[name] = author()
order = [*SHAPES, *[name for name in AUTHORED if name not in SHAPES]]
traced = {name: traced[name] for name in order}
header = """// GENERATED by scripts/trace-hands.py from reference_poses.png -- do not edit by hand.
//
// Sunny's hands and shoes, traced from the pose sheet. Hands: wrist at the
// origin, pointing up (-y), 24 units long. Shoes: ankle at the origin, toe
// along +x, 26 units long. `ink` is the silhouette (drawn in ink), `fill` the
// orange regions inside it, so finger separations are the sheet's own lines.

"""
OUT.write_text(header + "export const TRACED_HANDS = " + json.dumps(traced, separators=(",", ":")) + " as const;\n", encoding="utf-8")
print("wrote", OUT.relative_to(ROOT), OUT.stat().st_size, "bytes")
