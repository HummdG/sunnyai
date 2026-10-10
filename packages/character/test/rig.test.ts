import { describe, expect, it } from 'vitest';

import { cloneRig, defaultRig, toBodyFrame, toViewBox } from '../src/index.js';
import { renderSunny } from '../src/render.js';
import type { SunnyRig, Vec2 } from '../src/index.js';

/**
 * The rig, and the one piece of arithmetic the rig and the renderer share.
 *
 * `toViewBox` and `toBodyFrame` exist so that a point the visitor pointed at can
 * become a position a pose is authored against, and so that a pose can put
 * something back where the visitor pointed. Both of them are only correct if they
 * are the *inverse of the transform the renderer actually applies*, which is a
 * fact about `render.ts` that no other test in this repository can see: a
 * renderer and a helper that drifted apart would each be self-consistent, and
 * every pose would still be deterministic.
 *
 * So the first test reads the transform out of the emitted SVG and checks the
 * helpers against it, rather than checking them against a second copy of the same
 * arithmetic.
 */

/** A rig that exercises every part of the root transform. */
function transformed(): SunnyRig {
  const rig = defaultRig();
  rig.x = 88;
  rig.y = 112;
  rig.rotation = 17;
  rig.scale = 1.15;
  rig.squash = 0.2;
  rig.stretch = 0.1;
  return rig;
}

/** The root transform of a rendered rig, as the four numbers it is made of. */
function rootTransform(rig: SunnyRig): {
  x: number;
  y: number;
  rotation: number;
  sx: number;
  sy: number;
} {
  const svg = renderSunny(rig);
  const match =
    /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\)/.exec(svg);
  if (!match) throw new Error('no root transform in the rendered svg');
  const [, x, y, rotation, sx, sy] = match.map(Number);
  return { x: x!, y: y!, rotation: rotation!, sx: sx!, sy: sy! };
}

/** Apply the transform the renderer applies, to a point given in the body frame. */
function applyRoot(rig: SunnyRig, point: Vec2): Vec2 {
  const { x, y, rotation, sx, sy } = rootTransform(rig);
  const a = (rotation * Math.PI) / 180;
  const px = point.x * sx;
  const py = point.y * sy;
  return {
    x: x + px * Math.cos(a) - py * Math.sin(a),
    y: y + px * Math.sin(a) + py * Math.cos(a),
  };
}

describe('the body frame', () => {
  it('maps the body centre to the root position', () => {
    for (const rig of [defaultRig(), transformed()]) {
      expect(toViewBox(rig, { x: 0, y: 0 })).toEqual({ x: rig.x, y: rig.y });
      expect(toBodyFrame(rig, { x: rig.x, y: rig.y })).toEqual({ x: 0, y: 0 });
    }
  });

  it('agrees with the transform the renderer actually applies', () => {
    // The claim in the source: these two are the forward and inverse of
    // `renderSunny`'s root transform. Read it off the SVG and check.
    const rig = transformed();
    for (const point of [
      { x: 0, y: 0 },
      { x: 34, y: -62 },
      { x: -47, y: 12 },
      { x: 8, y: 58 },
    ]) {
      const mine = toViewBox(rig, point);
      const theirs = applyRoot(rig, point);
      expect(mine.x, `x for ${point.x},${point.y}`).toBeCloseTo(theirs.x, 6);
      expect(mine.y, `y for ${point.x},${point.y}`).toBeCloseTo(theirs.y, 6);
    }
  });

  it('round-trips a point through both directions', () => {
    // Rotation, non-uniform scale and translation all at once, which is the case
    // a naive negation gets wrong: undoing a scale-then-rotate is not undoing a
    // rotate-and-translate.
    for (const rig of [defaultRig(), transformed()]) {
      for (const point of [
        { x: 61, y: 4 },
        { x: -18, y: -77 },
        { x: 0.5, y: 0 },
      ]) {
        const back = toBodyFrame(rig, toViewBox(rig, point));
        expect(back.x, `x for ${point.x},${point.y}`).toBeCloseTo(point.x, 9);
        expect(back.y, `y for ${point.x},${point.y}`).toBeCloseTo(point.y, 9);
      }
    }
  });

  it('does not mutate the rig it was handed', () => {
    const rig = transformed();
    const before = cloneRig(rig);
    toViewBox(rig, { x: 3, y: 4 });
    toBodyFrame(rig, { x: 3, y: 4 });
    expect(rig).toEqual(before);
  });
});
