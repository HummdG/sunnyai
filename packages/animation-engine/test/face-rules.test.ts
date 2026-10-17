import { defaultRig, EXPRESSION_NAMES, withExpression } from '@sunny/character';
import { describe, expect, it } from 'vitest';

import { OPEN_AT, SEQUENCES, SQUINT_AT } from '../src/index.js';

const STEPS = 60;

describe('face rules', () => {
  // The owner found the old moments creepy: a smile stretched to twice its
  // depth, and eyes held half shut. Every sequence, over every base a scene or
  // the chat can give it, is held to the rules that replaced them.
  const bases = [defaultRig(), ...EXPRESSION_NAMES.map((n) => withExpression(defaultRig(), n))];

  it('never holds an eye half shut, nor squashes it into a squint', () => {
    for (const sequence of SEQUENCES) {
      for (const base of bases) {
        for (let k = 0; k <= STEPS; k++) {
          const r = sequence.pose(base, k / STEPS);
          for (const side of ['left', 'right'] as const) {
            const eye = r.eyes[side];
            if (eye.shape !== 'open') continue;
            expect(eye.closed, `${sequence.id} ${side} lid at ${k / STEPS}`).toBe(0);
            expect(eye.scaleY / base.eyes[side].scaleY).toBeGreaterThanOrEqual(SQUINT_AT);
          }
        }
      }
    }
  });

  it('shows a bigger smile as a different mouth, never a deeper one', () => {
    for (const sequence of SEQUENCES) {
      for (const base of bases) {
        for (let k = 0; k <= STEPS; k++) {
          const r = sequence.pose(base, k / STEPS);
          if (r.smile.shape !== base.smile.shape) continue;
          expect(r.smile.depth / base.smile.depth, `${sequence.id} at ${k / STEPS}`).toBeLessThan(
            OPEN_AT,
          );
        }
      }
    }
  });

  it('opens the mouth at the peak of a celebration and on a spoken word', () => {
    const peak = (id: string, shapes: string[]): boolean => {
      const sequence = SEQUENCES.find((s) => s.id === id)!;
      return Array.from({ length: STEPS + 1 }, (_, k) =>
        sequence.pose(defaultRig(), k / STEPS),
      ).some((r) => shapes.includes(r.smile.shape));
    };
    expect(peak('celebrate-bounce', ['laugh'])).toBe(true);
    expect(peak('speaking-pulse', ['open'])).toBe(true);
    expect(peak('listening-perk', ['open'])).toBe(true);
  });
});
