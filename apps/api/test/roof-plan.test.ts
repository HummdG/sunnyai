import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { roofPlanFor, type RoofPlan } from '../src/proposal/roof-plan.js';

const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../assets/sample/house.spec.json', import.meta.url)), 'utf8'),
) as unknown;

type P = [number, number];

/** Distance from p to segment ab. */
function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Inside the polygon, or within `tol` metres of its boundary. */
function insideOrNear(p: P, poly: P[], tol: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (segDist(p, a, b) <= tol) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function plan(
  panelCount: number,
  extra: Partial<Parameters<typeof roofPlanFor>[1]> = {},
): RoofPlan {
  const out = roofPlanFor(SAMPLE, { panelCount, reliable: true, ...extra });
  if (!out) throw new Error('expected a roof plan');
  return out;
}

describe('roofPlanFor', () => {
  it('draws the faces holding panels and exactly the quoted panel count', () => {
    const p = plan(10);
    expect(p.panels).toHaveLength(10);
    expect(p.faces.length).toBeGreaterThan(0);
    for (const face of p.faces) {
      expect(face.outline.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(face.pitchDeg)).toBe(true);
    }
    for (const panel of p.panels) expect(panel).toHaveLength(4);
    expect(p.mainFacing).toBe('South');
    expect(p.sample).toBe(false);
    expect(p.dimensions.widthM).toBeCloseTo(p.bounds.maxX - p.bounds.minX, 6);
    expect(p.dimensions.depthM).toBeCloseTo(p.bounds.maxY - p.bounds.minY, 6);
    expect(p.dimensions.widthM).toBeGreaterThan(3);
  });

  it('marks the sample house', () => {
    expect(plan(4, { sample: true }).sample).toBe(true);
  });

  it('returns only faces that hold at least one panel', () => {
    // The sample is a gable: the north slope takes no panels.
    const p = plan(10);
    expect(p.faces).toHaveLength(1);
    expect(p.faces[0]!.azimuthDeg).toBeGreaterThan(135);
    expect(p.faces[0]!.azimuthDeg).toBeLessThan(225);
  });

  it('is null when the assessment is not reliable', () => {
    expect(roofPlanFor(SAMPLE, { panelCount: 10, reliable: false })).toBeNull();
  });

  it('is null when the quote has more panels than the roof can take', () => {
    expect(roofPlanFor(SAMPLE, { panelCount: 60, reliable: true })).toBeNull();
  });

  it('is null for a malformed spec', () => {
    for (const bad of [
      null,
      42,
      'house',
      {},
      { schema: 'sunscan.house/1' },
      { schema: 'nope', parts: [] },
    ]) {
      expect(roofPlanFor(bad, { panelCount: 4, reliable: true })).toBeNull();
    }
  });

  it('is null when no panels are quoted', () => {
    expect(roofPlanFor(SAMPLE, { panelCount: 0, reliable: true })).toBeNull();
  });

  it('bounds contain every face point and every panel corner', () => {
    const p = plan(10);
    const eps = 1e-9;
    const points = [...p.faces.flatMap((f) => f.outline), ...p.panels.flat()];
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(p.bounds.minX - eps);
      expect(x).toBeLessThanOrEqual(p.bounds.maxX + eps);
      expect(y).toBeGreaterThanOrEqual(p.bounds.minY - eps);
      expect(y).toBeLessThanOrEqual(p.bounds.maxY + eps);
    }
  });

  it('every panel corner lies inside a face outline (1 cm tolerance)', () => {
    const p = plan(10);
    for (const panel of p.panels) {
      for (const corner of panel) {
        expect(p.faces.some((f) => insideOrNear(corner, f.outline, 0.01))).toBe(true);
      }
    }
  });

  it('is null for an empty face list, as the widget places nothing then', () => {
    expect(roofPlanFor(SAMPLE, { panelCount: 4, planeIds: [], reliable: true })).toBeNull();
  });

  it('honours the quote plane ids', () => {
    // Asking only for the north slope (id 1) still places them there, so its face is drawn.
    const p = roofPlanFor(SAMPLE, { panelCount: 2, planeIds: [1], reliable: true });
    expect(p).not.toBeNull();
    expect(p!.faces.map((f) => f.id)).toEqual([1]);
    expect(p!.mainFacing).toBe('North');
  });
});
