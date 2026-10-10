#!/usr/bin/env python3
"""Measure Sunny's reference artwork so the rig is derived from data, not guesswork.

    python scripts/measure-reference.py path/to/sunny.png

Prints, in source pixels and in viewBox units:
  * the body circle (centre, radius, outline stroke width)
  * the ray ring (count, angular centres, tip/base radius, base half-width)
  * each face feature (eyes, brows, smile) as a bounding box + centroid
  * each eye highlight (cream) bounding box + centroid

The viewBox units printed use the scale that makes the measured body radius
equal `BODY_RADIUS_UNITS`, i.e. the same convention as packages/character.
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image
from scipy import ndimage

# Must match BODY.radius in packages/character/src/geometry.ts.
BODY_RADIUS_UNITS = 46.0


def classify(rgb: np.ndarray):
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    orange = (r > 200) & (g > 70) & (g < 180) & (b < 90)
    cream = (r > 225) & (g > 215) & (b > 185)
    black = (r < 90) & (g < 90) & (b < 90)
    return orange, cream, black


def describe(cx, cy, scale):
    def fmt(x, y):
        return f"local ({ (x - cx) * scale:+7.2f}, { (y - cy) * scale:+7.2f})"

    return fmt


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    rgb = np.asarray(Image.open(sys.argv[1]).convert("RGB"))
    height, width = rgb.shape[:2]
    orange, cream, black = classify(rgb)

    # ------------------------------------------------------------------ body
    # Fill the black interior (body outline ring, face features, ray outlines)
    # to get the character silhouette, then take its largest inscribed circle.
    # Rays are thin triangles, so the body is what bounds that circle.
    silhouette = ndimage.binary_fill_holes(orange | cream)
    edt = ndimage.distance_transform_edt(silhouette)
    cy, cx = np.unravel_index(np.argmax(edt), edt.shape)
    radius = float(edt[cy, cx])
    scale = BODY_RADIUS_UNITS / radius

    print(f"image                 {width} x {height}")
    print(f"scale                 {scale:.6f} viewBox units per source px")
    print()
    print("BODY")
    print(f"  centre              ({cx}, {cy})  source px")
    print(f"  radius              {radius:.1f} px  ->  {radius * scale:.2f} units")

    # Outline stroke: measured outward along an angle that has no ray (22.5 deg
    # is the midpoint between two 45-degree rays).
    ang = np.radians(22.5)
    ux, uy = np.sin(ang), -np.cos(ang)
    rs = np.arange(radius * 0.7, radius * 1.4, 1.0)
    samples = np.array(
        [black[int(round(cy + uy * r)), int(round(cx + ux * r))] for r in rs]
    )
    runs, start = [], None
    for i, v in enumerate(samples.tolist()):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append(rs[i - 1] - rs[start] + 1)
            start = None
    if start is not None:
        runs.append(rs[-1] - rs[start] + 1)
    # The first black run past the interior is the outline.
    stroke = float(runs[0]) if runs else float("nan")
    print(f"  outline stroke      {stroke:.1f} px  ->  {stroke * scale:.2f} units")

    # ------------------------------------------------------------------ rays
    ys, xs = np.mgrid[0:height, 0:width]
    dx = (xs - cx).astype(np.float64)
    dy = (ys - cy).astype(np.float64)
    dist = np.hypot(dx, dy)
    angle = np.degrees(np.arctan2(dx, -dy)) % 360.0  # clockwise from up

    outside = dist > radius + stroke
    ray_px = orange & outside
    hist = np.bincount((angle[ray_px].astype(np.int32) % 360), minlength=360)

    # Ray centres: contiguous non-empty runs in the angular histogram.
    covered = hist > 0
    runs, start = [], None
    for a in range(720):
        v = covered[a % 360]
        if v and start is None:
            start = a
        elif not v and start is not None:
            runs.append((start, a - 1))
            start = None
    if start is not None:
        runs.append((start, 719))
    centres = [((s + e + 1) / 2.0) % 360.0 for s, e in runs if e - s >= 4]

    print()
    print("RAYS")
    print(f"  count               {len(centres)}")
    print(f"  angular centres     {[round(c, 1) for c in sorted(centres)]}")
    tips, bases, halfwidths = [], [], []
    for c in sorted(centres):
        delta = np.abs(((angle - c) + 180.0) % 360.0 - 180.0)
        sel = ray_px & (delta < 18.0)
        if not sel.any():
            continue
        r_sel = dist[sel]
        d_sel = delta[sel]
        tips.append(float(r_sel.max()))
        # Widest cross-section along the ray = its base.
        widths = {}
        for r, d in zip(r_sel.tolist(), d_sel.tolist()):
            k = int(r // 4)
            if d > widths.get(k, 0.0):
                widths[k] = d
        if not widths:
            continue
        base_r = min(widths) * 4
        # Half-width in source px at the base cross-section.
        halfwidths.append(np.radians(widths[min(widths)]) * max(base_r, 1.0))
        bases.append(base_r)
    if tips:
        print(f"  tip radius          {np.mean(tips):.1f} px  ->  {np.mean(tips) * scale:.2f} units")
        print(f"  base radius         {np.mean(bases):.1f} px  ->  {np.mean(bases) * scale:.2f} units")
        print(
            f"  base half-width     {np.mean(halfwidths):.1f} px"
            f"  ->  {np.mean(halfwidths) * scale:.2f} units"
        )

    # ------------------------------------------------------------------ face
    inner = dist < radius - stroke - 2
    fmt = describe(cx, cy, scale)

    def components(mask, min_area, limit=10):
        labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
        found = []
        if count == 0:
            return found
        sizes = ndimage.sum(mask, labels, range(1, count + 1))
        for idx in np.argsort(-sizes)[:limit]:
            if sizes[idx] < min_area:
                continue
            yy, xx = np.nonzero(labels == idx + 1)
            x0, x1, y0, y1 = int(xx.min()), int(xx.max()), int(yy.min()), int(yy.max())
            # Principal axis: angle of greatest variance, and the extent along it.
            pts = np.stack([xx.astype(np.float64), yy.astype(np.float64)])
            mean = pts.mean(axis=1)
            cov = np.cov(pts - mean[:, None])
            vals, vecs = np.linalg.eigh(cov)
            major = vecs[:, int(np.argmax(vals))]
            ang = np.degrees(np.arctan2(major[1], major[0]))  # screen coords, y down
            proj_major = (pts - mean[:, None]).T @ major
            proj_minor = (pts - mean[:, None]).T @ vecs[:, int(np.argmin(vals))]
            found.append(
                {
                    "area": int(sizes[idx]),
                    "bbox": (x0, y0, x1, y1),
                    "centre": (float(mean[0]), float(mean[1])),
                    "angle": float(ang),
                    "major_len": float(proj_major.max() - proj_major.min()),
                    "minor_len": float(proj_minor.max() - proj_minor.min()),
                    "pixels": (xx, yy),
                }
            )
        return found

    def report(name, mask, min_area, limit=10):
        print()
        print(f"{name}")
        comps = components(mask, min_area, limit)
        if not comps:
            print("  (none)")
        for c in comps:
            x0, y0, x1, y1 = c["bbox"]
            cxm, cym = c["centre"]
            print(
                f"  area {c['area']:>7}  bbox ({x0},{y0})-({x1},{y1})"
                f"  size {x1 - x0 + 1}x{y1 - y0 + 1}px"
            )
            print(
                f"      centre {fmt(cxm, cym)}"
                f"   corners {fmt(x0, y0)} .. {fmt(x1, y1)}"
                f"   units {(x1 - x0 + 1) * scale:.2f} x {(y1 - y0 + 1) * scale:.2f}"
            )
            print(
                f"      principal axis {c['angle']:+.1f} deg from +x (y down)"
                f"   major {c['major_len'] * scale:.2f} units"
                f"   minor {c['minor_len'] * scale:.2f} units"
            )
        return comps

    report("BLACK FACE COMPONENTS", black & inner, 300)
    report("CREAM EYE HIGHLIGHTS", cream & inner, 300)

    # Per-row edge profile: reveals an eye's oval shape and stroke width, and
    # the highlight's notch.
    def edge_profile(title, comps, index, rows=14):
        if len(comps) <= index:
            return
        c = comps[index]
        mask = np.zeros_like(black)
        xx, yy = c["pixels"]
        mask[yy, xx] = True
        x0, y0, x1, y1 = c["bbox"]
        print()
        print(f"{title}  (bbox {x0},{y0}-{x1},{y1})")
        for row in np.linspace(y0, y1, rows).astype(int):
            hit = np.nonzero(mask[row, x0 : x1 + 1])[0]
            if hit.size == 0:
                continue
            left = hit.min() + x0
            right = hit.max() + x0
            # Runs on this row, to show interior gaps (stroke vs fill).
            runs, start = [], None
            line = mask[row, x0 : x1 + 1]
            for i, v in enumerate(line.tolist()):
                if v and start is None:
                    start = i
                elif not v and start is not None:
                    runs.append((start + x0, i - 1 + x0))
                    start = None
            if start is not None:
                runs.append((start + x0, x1))
            spans = " ".join(f"{a}-{b}" for a, b in runs[:6])
            print(
                f"  y={(row - cy) * scale:+7.2f}  x {(left - cx) * scale:+7.2f} .. "
                f"{(right - cx) * scale:+7.2f}  width {(right - left + 1) * scale:5.2f}"
                f"   runs {spans}"
            )

    eyes = components(black & inner, 8000, 5)
    highlights = components(cream & inner, 3000, 4)
    edge_profile("LEFT EYE OUTLINE", eyes, 0)
    edge_profile("LEFT EYE HIGHLIGHT", highlights, 0)
    edge_profile("RIGHT EYE OUTLINE", eyes, 1)
    edge_profile("RIGHT EYE HIGHLIGHT", highlights, 1)

    # The smile's centreline: mean y of its pixels per x column. This is the
    # curve the smile path must follow.
    smile = components(black & inner, 8000, 5)
    widest = None
    for c in smile:
        x0, _, x1, _ = c["bbox"]
        if widest is None or (x1 - x0) > (widest["bbox"][2] - widest["bbox"][0]):
            widest = c
    if widest is not None and widest["area"] > 8000:
        print()
        print("SMILE CENTRELINE (mean of black pixels per column)")
        xx, yy = widest["pixels"]
        x0, _, x1, _ = widest["bbox"]
        for col in np.linspace(x0, x1, 17).astype(int):
            sel = yy[(xx >= col - 3) & (xx <= col + 3)]
            if sel.size == 0:
                continue
            print(
                f"  col {col:>4}  y {sel.mean():6.1f} (band {sel.min()}..{sel.max()})"
                f"   {fmt(col, sel.mean())}  half-thickness {np.ptp(sel) / 2 * scale:.2f}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
