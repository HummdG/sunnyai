# Sunny: the character reference

Sunny's appearance is not designed in this repository. It is **measured from a
supplied piece of artwork** — `sunny.png`, 1254 x 1254, a sun with eight rays,
orange body, cream eyes and a wide smile. That file is canonical. Everything in
`packages/character` exists to reproduce it, and the test of whether the code is
right is an objective comparison against it, not a reviewer's opinion.

This document records the provenance of every number in
`packages/character/src/geometry.ts` and `rig.ts`, the fidelity actually
achieved, and — because a fidelity claim is worthless without them — the
discrepancies that remain and the limits of the tools that measure them.

## Why measurements rather than a redraw

The plan is explicit (section 1): _"Preserve the supplied reference artwork as
canonical; do not recreate the design from prose when reference assets are
available."_ Redrawing from a description would have produced a character that
is _a_ cartoon sun. The point of the supplied artwork is that it is _this_
cartoon sun, with specific asymmetries that read as deliberate once you look for
them.

Two measurement tools exist, and they are the only authority on fidelity here:

| Tool                           | Question it answers                                       |
| ------------------------------ | --------------------------------------------------------- |
| `scripts/measure-reference.py` | Where is each feature, and how big, in source pixels?     |
| `scripts/compare-reference.py` | How closely does a render match, once aligned and scaled? |

`compare-reference.py` reports intersection-over-union for three masks — `ink`
(black outlines and features), `body` (the orange fill) and `cream` (the eye
highlights). **IoU is the number to move: 1.0 is pixel-identical once aligned and
scaled.** It aligns both images by detecting the body's largest inscribed circle
and resampling into a shared local frame, so a difference in render size or
framing does not show up as a difference in shape.

Both need `numpy`, `Pillow` and `scipy`. On this machine the interpreter that has
them is `C:\Users\hummd\anaconda3\python.exe`; the default `python3` has numpy
but not scipy. Run them with `-I`.

## The scale

The whole rig hangs off one number. The body's orange interior has a measured
radius of **366.8 px** about a centre at **(625, 618)**, and that radius is
_declared_ to be **46 viewBox units**. So:

```
1 source px = 46 / 366.8 = 0.125417 viewBox units
```

Every other figure is a source-pixel measurement multiplied by that constant.
`BODY.radius` is `46 + 2.51/2`, not 46, because the measured 366.8 px is the
radius of the orange interior — the _inner edge_ of the outline stroke — so the
path that draws it sits half a stroke further out.

## Measured provenance

| Feature               | Source measurement     | ViewBox | Where                   |
| --------------------- | ---------------------- | ------- | ----------------------- |
| Body orange radius    | 366.8 px               | 46      | `BODY.radius`           |
| Body outline stroke   | 20.0 px                | 2.51    | `BODY.strokeWidth`      |
| Ray tip radius        | 601.9 px               | 75.5    | `RAY.tipRadius`         |
| Ray base radius       | 398.8 px               | 50.0    | `RAY.baseRadius`        |
| Ray base half-width   | 97.8 px                | 12.3    | `RAY.baseHalfWidth`     |
| Eye outline stroke    | 11.0 px                | 1.4     | `EYE.strokeWidth`       |
| Highlight notch depth | 53.7% down the opening | 0.54    | `EYE_HIGHLIGHT.notchAt` |
| Ray angles            | see below              | —       | `RAY.anglesDeg`         |

### The rays are not evenly spaced

The reference's eight rays sit at **0, 49, 91.5, 131.5, 180, 228.5, 268.5 and
311 degrees** clockwise from straight up. They are not at multiples of 45. The
pattern is symmetric about both axes, and each diagonal is pressed a few degrees
toward the horizontal. That symmetry is why this is reproduced rather than
"corrected" to 45: a hand-drawn irregularity that is symmetric about both axes
is a design decision, not measurement noise. Regularising it would have made the
character measurably wrong in a way nobody would have thought to check.

## Fidelity actually achieved

Measured by `compare-reference.py` between the reference and
`packages/character/out/measure.png` (the canonical pose, rendered on the
reference's framing and its black background — deliberately the same input the
reference measurements came from):

| Mask                   | Before | After  | Reads as                                        |
| ---------------------- | ------ | ------ | ----------------------------------------------- |
| ink (outlines, face)   | 0.4799 | 0.4828 | outlines overlap to within about a stroke       |
| body (orange fill)     | 0.8415 | 0.8207 | see the caveat below                            |
| cream (eye highlights) | 0.5665 | 0.7412 | the highlights now sit where the reference's do |

The "After" column is the result of fixing a real defect, described next. The
`body` figure moving _down_ is an artefact, not a regression — also explained
below.

### The eye transposition

The first version of the rig had the two eyes transposed: the tilt was authored
onto the left eye and it was made the smaller of the two. The reference is the
opposite way round. Measured long axes:

| Eye   | Reference | Wrong rig | Fixed rig |
| ----- | --------- | --------- | --------- |
| left  | +89.6°    | +76.5°    | +89.7°    |
| right | +76.6°    | +85.4°    | +76.8°    |

and the left eye was ~13% too short (major 34.85 vs 39.26 units). The
transposition is visible by eye once you know to look — a leaning eye on either
side looks plausible alone, which is exactly why it survived review. With the
tilt and size corrected, the eyes now match to within **0.2°** of tilt and
**0.1 unit** of extent:

| Measurement           | Reference        | Render           |
| --------------------- | ---------------- | ---------------- |
| left eye axis         | +89.6°           | +89.7°           |
| left eye major/minor  | 39.26 / 24.46 u  | 39.34 / 24.35 u  |
| right eye axis        | +76.6°           | +76.8°           |
| right eye major/minor | 33.15 / 21.23 u  | 33.23 / 21.28 u  |
| smile centre          | (+6.00, +19.45)  | (+6.06, +19.42)  |
| smile axis            | +164.5°          | +164.5°          |
| left brow centre      | (-22.28, -25.01) | (-22.28, -25.08) |
| right brow centre     | (+12.14, -31.92) | (+12.13, -31.95) |

The brows and the smile were never wrong: their centres match to within a tenth
of a unit. That is the standard the eyes were brought up to.

## Discrepancies that remain

Recorded rather than papered over. None of these is a bug in the sense of "the
code does something other than it says"; each is a place where the model of the
artwork is simpler than the artwork.

1. **The eye's internal split does not match, though its outline does.** The
   reference's black crescent inside the eye measures ~316 u² of ink and its
   cream highlight ~271 u²; ours measure ~449 u² and ~298 u². The outer eye is
   right — same tilt, same extent — so the difference is that the reference's
   highlight fills more of the opening and the black crescent is thinner. The
   cream is modelled as a fixed fraction of the eye's width
   (`EYE_HIGHLIGHT.widthFraction`), which cannot be right for both eyes at once
   because the reference traces the two highlights independently and they do not
   scale with the eye alike. The single fraction is tuned to the value that
   maximises the cream IoU (0.47, from 0.55); the residual is that aggregate
   number, 0.741.

2. **The rays are fatter than the reference's.** Measuring the eight orange
   protrusions: the reference's are 242.6–300.9 u² (they vary by a fifth — they
   are drawn by hand), ours are a uniform 318–322 u², about 18% larger. Our ray
   _positions_ also sit ~6% closer to the centre (diagonal centres at |x| 44.2 vs
   47.1). `RAY.baseHalfWidth` is a single measured value standing in for eight
   hand-drawn rays, so this cannot be tuned to zero without per-ray widths.

3. **The eyes' centres sit ~1.5 units away.** Reference centres (-12.26, -1.01)
   and (+19.61, -7.96); ours (-12.06, -2.47) and (+18.90, -9.12). On a 92-unit
   body this is under 2%. The `compare-reference.py` centroid includes the black
   crescent, which is asymmetric within the eye, so it is not exactly the
   opening's centre — this is at the edge of what the tool can resolve.

### Caveat: the `body` figure is not a pure measure of the body

The `body` IoU is computed from the orange mask, and the classifier that
produces it has **no antialias tolerance**. A pixel is orange if it falls in a
fixed RGB window, and the wide blend fringe where a black stroke meets orange
lands inside that window. Measured directly: correcting the eyes changed **17,311
orange-classified pixels**, and essentially all of them lie inside the two eye
bounding boxes.

So the orange mask is contaminated by the geometry of every black feature drawn
on top of it, and `body` cannot be read as "the disc matches this well". This is
why the number moved from 0.8415 to 0.8207 when the eyes changed and the disc did
not: the disc's own geometry is identical in both renders (the detected centre
and radius are equal to four decimal places), and the change is entirely the
fringe around the corrected eyes. The honest reading is that the disc has not
been scored cleanly by either run, and that `ink` and `cream` — and the
per-feature table above — are the numbers to trust.

The same fringe applies in the reference, so the two sides are comparable; but
the _metric_ should not be quoted as a body-shape score.

`compare-reference.py`'s alignment is also coupled to the face, but only in one
place and only weakly: it locates the body by the largest inscribed circle of the
orange mask, so a face change can in principle shift the detected centre. In this
case it did not — both runs detect the body at (626.00, 626.00) with radius
365.8552 px.

## How to reproduce any of this

```bash
# 1. Render the samples, including `measure.png` on the reference's framing
#    and black background.
npm run render:samples

# 2. Score the canonical pose against the reference.
"C:/Users/hummd/anaconda3/python.exe" -I scripts/compare-reference.py \
    C:/Work/Arkalith/SunScanV2/sunny.png packages/character/out/measure.png

# 3. Diff a specific feature's geometry between two rigs of your choosing --
#    this is how the eye transposition was confirmed to be confined to the eyes
#    (exactly 8 of 27 paths differed: four per eye, everything else identical).
```

Render a third argument to `compare-reference.py` and it writes a red/blue
overlay of the two masks, which is the fastest way to see _where_ a mismatch is
rather than how large it is.

## The rig is a pure function

`renderSunny(rig, options)` returns a string and holds no state; an animation
sequence is a function `(base, t) => rig` with `t` normalised to 0..1. So a pose
is fully serialisable, replay is deterministic, and the fidelity above is a
property of a data structure that can be asserted in a test rather than of a
timeline that has to be watched. That is what makes a 17,000-pixel comparison
meaningful: the same rig always produces the same pixels.
