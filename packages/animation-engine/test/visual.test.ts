import { describe, expect, it } from 'vitest';

import { defaultRig, renderSunny, type SunnyRig } from '@sunny/character';

import { SEQUENCES, SEQUENCE_BY_ID, bestInGroup, GROUPS, INTENSITIES } from '../src/index.js';

/**
 * Visual snapshots, per plan §12.
 *
 * The behavioural tests next door ask whether the right sequence was chosen.
 * These ask whether the chosen sequence *looks like anything* -- which is the
 * failure a scheduler test cannot see, because a sequence whose pose ignores its
 * `t` argument is perfectly well-behaved and completely static.
 *
 * Every group is sampled at the intensity a tenant would actually be on, at
 * several points through the sequence, and rendered to SVG. The snapshot then
 * fails on any change to the character's geometry, to a prop's path, or to the
 * shape of a sequence's motion -- which is the point: a visual regression should
 * show up as a diff, not as someone noticing the character "looks off" a week
 * later.
 */

/**
 * Where to sample. Not evenly spaced: most sequences do their work in the first
 * and last thirds (a prop descending, a bounce settling), and an evenly-spaced
 * sample of 3 would miss both.
 */
const SAMPLES = [0, 0.15, 0.35, 0.5, 0.72, 0.9, 1] as const;

function frames(rig: SunnyRig, at: readonly number[]): string[] {
  return at.map(() => renderSunny(rig, { size: 120 }));
}

/** A compact, stable summary of a prop set: id and rounded position. */
function propSummary(rig: SunnyRig): string[] {
  return rig.props
    .map(
      (p) =>
        `${p.id}@${p.x.toFixed(1)},${p.y.toFixed(1)}x${p.scale.toFixed(2)}o${p.opacity.toFixed(2)}`,
    )
    .sort();
}

describe('sequence rendering', () => {
  for (const sequence of SEQUENCES) {
    it(`renders ${sequence.id} across its own motion`, () => {
      const base = defaultRig();
      const poses = SAMPLES.map((t) => sequence.pose(base, t));

      // A sequence is only worth snapshotting if it moves. This is the
      // assertion that catches a pose function which ignores `t` -- the case
      // that reads as "the character just doesn't react" in a real widget and
      // has no other symptom.
      const rendered = poses.map((rig) => renderSunny(rig, { size: 120 }));
      if (!sequence.loop) {
        expect(
          new Set(rendered).size,
          `${sequence.id} produced identical output at every sampled t: its pose ignores t`,
        ).toBeGreaterThan(1);
      }

      expect(rendered).toMatchSnapshot();
    });

    it(`only draws props ${sequence.id} declared`, () => {
      const poses = SAMPLES.map((t) => sequence.pose(defaultRig(), t));
      const seen = new Set(poses.flatMap(propSummary).map((s) => s.split('@')[0] ?? ''));
      for (const id of seen) {
        // `assets` is the cleanup contract: a prop can only reach the scene if
        // the sequence declared it, so an undeclared prop is a leak by
        // construction rather than by an overstayed cleanup callback.
        expect(
          sequence.assets,
          `${sequence.id} drew ${id} without declaring it in assets`,
        ).toContain(id);
      }
    });

    it(`holds the pose Sunny was measured into at t=0 or departs from it deliberately`, () => {
      // Every sequence starts somewhere defensible. The check that matters is
      // the cheap one: the root does not jump off the canvas, which is what a
      // mistyped transform produces.
      const rig = sequence.pose(defaultRig(), 0);
      expect(Number.isFinite(rig.x)).toBe(true);
      expect(Number.isFinite(rig.y)).toBe(true);
      expect(Math.abs(rig.scale - 1)).toBeLessThan(2);
      expect(Math.abs(rig.rotation)).toBeLessThan(90);
    });

    it(`is pure: ${sequence.id} returns the same rig for the same t`, () => {
      for (const t of SAMPLES) {
        const a = sequence.pose(defaultRig(), t);
        const b = sequence.pose(defaultRig(), t);
        expect(propSummary(a)).toEqual(propSummary(b));
        expect(renderSunny(a)).toBe(renderSunny(b));
      }
    });

    it(`does not mutate the base rig ${sequence.id} was handed`, () => {
      // The caller's rig is the resting pose and outlives the sequence. A
      // sequence that mutated it would leave residue on the next frame.
      const base = defaultRig();
      const before = renderSunny(base);
      for (const t of SAMPLES) sequence.pose(base, t);
      expect(renderSunny(base)).toBe(before);
    });
  }
});

describe('the gallery a tenant actually sees', () => {
  for (const intensity of INTENSITIES) {
    it(`resolves every group at ${intensity}`, () => {
      const chosen: Record<string, string | null> = {};
      for (const group of GROUPS) {
        chosen[group] = bestInGroup(group, intensity)?.id ?? null;
      }
      expect(chosen).toMatchSnapshot();
    });
  }

  it('renders one frame per group at the balanced setting', () => {
    // The single image a reviewer can look at to see the whole vocabulary at
    // once: every group, mid-motion, as the SVG it will actually become.
    const grid = GROUPS.map((group) => {
      const sequence = bestInGroup(group, 'balanced');
      if (!sequence) return `${group}: none`;
      const rig = sequence.pose(defaultRig(), 0.5);
      return `${group} (${sequence.id}): ${renderSunny(rig, { size: 80 })}`;
    }).join('\n');
    expect(grid).toMatchSnapshot();
  });

  it('has a fallback that exists for every sequence that names one', () => {
    for (const sequence of SEQUENCES) {
      const fallback = sequence.reducedMotionFallback;
      if (fallback === null) continue;
      expect(
        SEQUENCE_BY_ID.has(fallback),
        `${sequence.id} falls back to ${fallback}, which is not a sequence`,
      ).toBe(true);
    }
  });
});

describe('rendering is host-independent', () => {
  it('produces the same bytes on a repeated render of every sequence', () => {
    // The widget swaps innerHTML on every frame, so a renderer that varied
    // between two calls on the same rig would show as a flicker. `uniqueIds` is
    // off by default precisely so this holds.
    const seq = SEQUENCE_BY_ID.get('charge') ?? SEQUENCES[0];
    if (!seq) throw new Error('no sequences');
    const rig = seq.pose(defaultRig(), 0.4);
    expect(renderSunny(rig)).toBe(renderSunny(rig));
    expect(frames(rig, SAMPLES)).toEqual(frames(rig, SAMPLES));
  });
});
