import { describe, expect, it } from 'vitest';

import { armTo, cloneRig, defaultRig, rayTip, toBodyFrame, toViewBox } from '../src/index.js';
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

describe('the ray-to-arm morph', () => {
  const rayAt = (index: number) => defaultRig().rays[index]!;

  it('puts the tip on the target, which is the whole of the claim', () => {
    // The tip is read back out of `rayTip`, which is the renderer's own
    // arithmetic for where a ray ends. Checking against a second copy of the
    // angle maths here would pass for a morph that pointed somewhere else.
    const targets: Vec2[] = [
      { x: 66, y: 0 },
      { x: 66, y: 30 },
      { x: 0, y: -66 },
      { x: -50, y: 60 },
    ];
    for (const target of targets) {
      const tip = rayTip(armTo(rayAt(2), target));
      expect(tip.x, `x for ${target.x},${target.y}`).toBeCloseTo(target.x, 6);
      expect(tip.y, `y for ${target.x},${target.y}`).toBeCloseTo(target.y, 6);
    }
  });

  it('is a property of the ray it is handed, not of one particular ray', () => {
    // The eight rays point in eight directions; the morph has to work from any
    // of them, or "ray-to-arm" is really "the third ray, twice".
    for (let index = 0; index < defaultRig().rays.length; index++) {
      const target = { x: index % 2 === 0 ? 55 : -55, y: index % 4 < 2 ? 25 : -25 };
      const tip = rayTip(armTo(rayAt(index), target));
      expect(tip.x, `ray ${index}`).toBeCloseTo(target.x, 6);
      expect(tip.y, `ray ${index}`).toBeCloseTo(target.y, 6);
    }
  });

  it('leaves the ray attached to the body, whatever it is pointed at', () => {
    // The base is the ray's own anchor at the silhouette. A morph that moved it
    // would be an object parked beside the character rather than an arm.
    for (const target of [
      { x: 200, y: 200 },
      { x: -120, y: 40 },
    ]) {
      const morphed = armTo(rayAt(2), target);
      expect(morphed.offset).toEqual({ x: 0, y: 0 });
      expect(morphed.visible).toBe(true);
      // The base stays at the ray radius in the aim direction, which is what
      // "attached at the silhouette" means as a number.
      expect(morphed.angleDeg + morphed.rotation).toBeCloseTo(
        (Math.atan2(target.x, -target.y) * 180) / Math.PI,
        6,
      );
    }
  });

  it('collapses rather than turning inside out when the target is too close', () => {
    const morphed = armTo(rayAt(2), { x: 4, y: 0 });
    expect(morphed.lengthScale).toBe(0);
    // At zero length the tip is at the base, just outside the body -- never
    // inside it, and never on the far side of the target.
    const tip = rayTip(morphed);
    expect(Math.hypot(tip.x, tip.y)).toBeGreaterThan(46);
  });

  it('refuses to stretch further than the picture can hold', () => {
    const morphed = armTo(rayAt(2), { x: 9000, y: 0 });
    expect(morphed.lengthScale).toBeLessThan(6);
    expect(Number.isFinite(rayTip(morphed).x)).toBe(true);
  });
});
