#!/usr/bin/env python3
"""Compare a rendered Sunny against the reference artwork, objectively.

    python scripts/compare-reference.py reference.png render.png

Both images are aligned by detecting the body circle in each (same method as
measure-reference.py) and resampling into a shared "local unit" frame centred on
the body. The tool then reports:

  * per-feature geometry (eyes, brows, smile, highlights) for both images
  * the ink / body / highlight masks' intersection-over-union

IoU is the number to move. 1.0 means pixel-identical once aligned and scaled.
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image
from scipy import ndimage

# Must match BODY.radius in packages/character/src/geometry.ts.
BODY_RADIUS_UNITS = 46.0
# Half-width of the compared frame, in local units.
HALF_FRAME = 80.0
# Resolution of the compared frame.
N = 480


def classify(rgb: np.ndarray):
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    orange = (r > 200) & (g > 70) & (g < 180) & (b < 90)
    cream = (r > 225) & (g > 215) & (b > 185)
    black = (r < 90) & (g < 90) & (b < 90)
    return orange, cream, black


def character_silhouette(orange, cream, black) -> np.ndarray:
    """The character's full extent, outline strokes included.

    The background is black, the same colour as the ink, so it cannot be found by
    colour. Instead we grow the orange/grey fill by just over the outline's
    measured thickness (20 px) and take the ink that falls inside that reach.
    Filling the interior afterwards carries the eyes and the smile.
    """
    fill = orange | cream
    ring = black & ndimage.binary_dilation(fill, iterations=22)
    return ndimage.binary_fill_holes(fill | ring)


def align(path: str):
    """Return (masks resampled to local units, scale, centre)."""
    rgb = np.asarray(Image.open(path).convert("RGB"))
    orange, cream, black = classify(rgb)
    # The alignment reference is the orange fill ALONE: its inscribed radius is
    # what BODY_RADIUS_UNITS means, and it is the one feature whose shape does
    # not depend on the face. This used to pass `orange | cream`, which let the
    # eye highlights -- which have nothing to do with where the body is -- move
    # the centre and the scale. The effect was not subtle: nudging the eyes
    # changed the reported body IoU by 2%, because a slightly different scale
    # resamples the whole disc. Alignment has to be independent of the thing
    # being measured, or every eye edit is silently scored against a moving
    # frame. The black crescent inside each eye is not orange either, so it does
    # not drag the estimate the way the cream did.
    silhouette = character_silhouette(orange, cream, black)
    edt = ndimage.distance_transform_edt(ndimage.binary_fill_holes(orange))
    cy, cx = np.unravel_index(np.argmax(edt), edt.shape)
    radius = float(edt[cy, cx])
    scale = BODY_RADIUS_UNITS / radius

    # Resample each mask into the local frame.
    axis = np.linspace(-HALF_FRAME, HALF_FRAME, N)
    gx, gy = np.meshgrid(axis, axis)
    sx = cx + gx / scale
    sy = cy + gy / scale
    coords = np.array([sy.ravel(), sx.ravel()])
    out = {}
    for name, mask in (
        ("body", orange),
        ("cream", cream),
        ("_ink", black),
        ("_in", silhouette),
    ):
        sampled = ndimage.map_coordinates(
            mask.astype(np.float32), coords, order=1, mode="constant", cval=0.0
        )
        out[name] = sampled.reshape(N, N) > 0.5
    # Both images sit on a black background, so the raw `black` mask is mostly
    # background and would agree with itself no matter how wrong the artwork was.
    # Ink only counts inside the character.
    out["ink"] = out.pop("_ink") & out.pop("_in")
    return out, scale, (cx, cy), radius


def iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum()) / float(union) if union else 1.0


def components(mask: np.ndarray, min_area: float, limit: int = 6):
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    found = []
    if count == 0:
        return found
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    for idx in np.argsort(-sizes)[:limit]:
        if sizes[idx] < min_area:
            continue
        yy, xx = np.nonzero(labels == idx + 1)
        pts = np.stack([xx.astype(np.float64), yy.astype(np.float64)])
        mean = pts.mean(axis=1)
        cov = np.cov(pts - mean[:, None])
        vals, vecs = np.linalg.eigh(cov)
        major = vecs[:, int(np.argmax(vals))]
        ang = np.degrees(np.arctan2(major[1], major[0]))
        # Points are already in local units: convert to a signed, 1 unit = 1 grid
        # step frame, so lengths scale by the frame's units-per-pixel.
        per = (2 * HALF_FRAME) / N
        found.append(
            {
                "area": int(sizes[idx]),
                "centre": ((mean[0] - N / 2) * per, (mean[1] - N / 2) * per),
                "angle": float(ang),
                "major": float((np.ptp((pts - mean[:, None]).T @ major))) * per,
                "minor": float((np.ptp((pts - mean[:, None]).T @ vecs[:, int(np.argmin(vals))]))) * per,
            }
        )
    return found


def describe(mask: np.ndarray, min_area: float, limit: int = 6) -> list[str]:
    per = (2 * HALF_FRAME) / N
    comps = components(mask, min_area, limit)
    lines = []
    for c in comps:
        cx, cy = c["centre"]
        lines.append(
            f"    area {c['area'] * per * per:7.1f}u2  centre ({cx:+6.2f},{cy:+6.2f})"
            f"  axis {c['angle']:+6.1f}  major {c['major']:5.2f}  minor {c['minor']:5.2f}"
        )
    if not lines:
        lines.append("    (none)")
    return lines


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    a, sa, ca, ra = align(sys.argv[1])
    b, sb, cb, rb = align(sys.argv[2])

    # Full precision, because this is the frame everything else is measured in.
    # At one decimal a change of a tenth of a pixel in the detected radius
    # prints as no change at all, while still being enough to resample the whole
    # disc onto a slightly different grid and move the body IoU by a percent.
    print(f"reference  {sys.argv[1]}   body ({ca[0]:.2f},{ca[1]:.2f}) r={ra:.4f}px")
    print(f"candidate  {sys.argv[2]}   body ({cb[0]:.2f},{cb[1]:.2f}) r={rb:.4f}px")
    print()
    print("MASK IoU (1.0 = identical once aligned and scaled)")
    print(f"  ink (outlines, eyes, brows, smile)   {iou(a['ink'], b['ink']):.4f}")
    print(f"  body (orange fill)                   {iou(a['body'], b['body']):.4f}")
    print(f"  cream (eye highlights)               {iou(a['cream'], b['cream']):.4f}")

    # The ink mask's connected components are, in size order: the two eyes and
    # the smile (which is merged with whichever eye it touches), then the brows.
    print()
    print("INK COMPONENTS   (areas in local units squared)")
    print("  reference")
    for line in describe(a["ink"], 40.0):
        print(line)
    print("  candidate")
    for line in describe(b["ink"], 40.0):
        print(line)

    # The orange mask is the body disc plus the eight ray triangles. Comparing
    # the rays by centroid and principal axis shows whether the ring is rotated,
    # mis-sized or mis-shaped -- which is most of what the ink IoU measures.
    print()
    print("ORANGE COMPONENTS   (disc first, then the eight rays)")
    for label, masks in (("reference", a), ("candidate", b)):
        print(f"  {label}")
        for line in describe(masks["body"], 500.0, 12):
            print(line)

    print()
    print("CREAM HIGHLIGHTS")
    print("  reference")
    for line in describe(a["cream"], 40.0):
        print(line)
    print("  candidate")
    for line in describe(b["cream"], 40.0):
        print(line)

    # A visual overlay: reference-only ink in red, candidate-only ink in blue,
    # agreement in black, no ink in white. This shows WHERE the two disagree,
    # which the numbers alone cannot.
    if len(sys.argv) > 3:
        overlay = np.full((N, N, 3), 255, dtype=np.uint8)
        only_a = a["ink"] & ~b["ink"]
        only_b = b["ink"] & ~a["ink"]
        both = a["ink"] & b["ink"]
        solid = a["body"] | b["body"]
        overlay[solid] = (235, 235, 235)
        overlay[both] = (0, 0, 0)
        overlay[only_a] = (220, 30, 30)
        overlay[only_b] = (40, 90, 220)
        Image.fromarray(overlay).save(sys.argv[3])
        print()
        print(f"wrote overlay to {sys.argv[3]}  (red = reference only, blue = ours only)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
