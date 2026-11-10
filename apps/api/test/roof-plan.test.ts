import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { roofPlanFor, type RoofPlan } from '../src/proposal/roof-plan.js';

const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../assets/sample/house.spec.json', import.meta.url)), 'utf8'),
) as unknown;

interface SampleSpec {
  parts: {
    footprint: { outer: [number, number][] };
    edgeKinds: string[];
    overhang: number;
    roof: { pitchDeg: number };
  }[];
  context: { neighbours: { attached?: boolean; footprint: { outer: [number, number][] } }[] };
}
const SPEC = SAMPLE as SampleSpec;
const PART = SPEC.parts[0]!;

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

/** p turned counter-clockwise by deg about the origin, as the plan turns. */
function rotate(p: P, deg: number): P {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
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
  it('draws exactly the quoted panel count', () => {
    const p = plan(10);
    expect(p.panels).toHaveLength(10);
    for (const panel of p.panels) expect(panel).toHaveLength(4);
    expect(p.mainFacing).toBe('South');
    expect(p.sample).toBe(false);
    expect(p).not.toHaveProperty('dimensions');
  });

  it('marks the sample house', () => {
    expect(plan(4, { sample: true }).sample).toBe(true);
  });

  it("returns the house's own footprint, turned with the plan, and its party walls", () => {
    const p = plan(10);
    expect(p.footprints).toHaveLength(1);
    const fp = p.footprints[0]!;
    const want = PART.footprint.outer.map((q) => rotate(q, p.rotationDeg));
    expect(fp.outline).toHaveLength(want.length);
    fp.outline.forEach((q, i) => {
      expect(Math.hypot(q[0] - want[i]![0], q[1] - want[i]![1])).toBeLessThan(0.01);
    });
    expect(fp.partyEdges).toEqual(PART.edgeKinds.flatMap((k, i) => (k === 'party' ? [i] : [])));
    expect(fp.partyEdges).toEqual([0, 2]);
  });

  it('returns the attached neighbours only, turned with the plan', () => {
    const p = plan(10);
    const attached = SPEC.context.neighbours.filter((n) => n.attached);
    expect(attached.length).toBe(2);
    expect(p.neighbours).toHaveLength(attached.length);
    attached.forEach((n, i) => {
      const want = n.footprint.outer.map((q) => rotate(q, p.rotationDeg));
      expect(p.neighbours[i]).toHaveLength(want.length);
      p.neighbours[i]!.forEach((q, k) => {
        expect(Math.hypot(q[0] - want[k]![0], q[1] - want[k]![1])).toBeLessThan(0.01);
      });
    });
  });

  it('puts every roof face within the footprint grown by the overhang', () => {
    const p = plan(10);
    const fp = p.footprints[0]!.outline;
    for (const face of p.faces) {
      for (const q of face.outline) expect(insideOrNear(q, fp, PART.overhang + 0.05)).toBe(true);
    }
  });

  it('returns every roof face, panelled only where the panels are', () => {
    const p = plan(10);
    expect(p.faces).toHaveLength(2);
    for (const face of p.faces) {
      expect(face.outline.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(face.pitchDeg)).toBe(true);
    }
    const south = p.faces.find((f) => f.azimuthDeg > 135 && f.azimuthDeg < 225)!;
    const north = p.faces.find((f) => f !== south)!;
    expect(south.panelled).toBe(true);
    expect(north.panelled).toBe(false);
    expect(p.mainFace.id).toBe(south.id);
  });

  it('draws the ridge between the two gable slopes', () => {
    const p = plan(10);
    const ridges = p.lines.filter((l) => l.kind === 'ridge');
    expect(ridges.length).toBeGreaterThanOrEqual(1);
    const len = Math.max(
      ...ridges.map((r) => Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1])),
    );
    expect(len).toBeGreaterThan(6);
    // A plain gable has no hips or valleys.
    expect(p.lines.every((l) => l.kind === 'ridge')).toBe(true);
  });

  it('turns the plan so the main eave runs level along the bottom of the main face', () => {
    const p = plan(10);
    const [a, b] = p.mainFace.eave;
    expect(Math.abs(a[1] - b[1])).toBeLessThan(0.01);
    const face = p.faces.find((f) => f.id === p.mainFace.id)!;
    for (const q of face.outline) expect(q[1]).toBeGreaterThanOrEqual(a[1] - 0.01);
    // The sample's downslope bearing is about 162 degrees, so the plan turns about 18 degrees clockwise.
    expect(p.rotationDeg).toBeCloseTo(-18.3, 0);
  });

  it('measures the real eave and the true rafter of the main face', () => {
    const p = plan(10);
    const outer = PART.footprint.outer;
    const eave = Math.hypot(outer[2]![0] - outer[1]![0], outer[2]![1] - outer[1]![1]);
    const depth = Math.hypot(outer[1]![0] - outer[0]![0], outer[1]![1] - outer[0]![1]);
    const rafter = (depth / 2 + PART.overhang) / Math.cos((PART.roof.pitchDeg * Math.PI) / 180);
    expect(Math.abs(p.mainFace.eaveM - eave)).toBeLessThan(0.05);
    expect(Math.abs(p.mainFace.rafterM - rafter)).toBeLessThan(0.05);
    const [a, b] = p.mainFace.eave;
    expect(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - p.mainFace.eaveM)).toBeLessThan(0.01);
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

  it('bounds cover the footprint, faces and panels, never the neighbours', () => {
    const p = plan(10);
    const eps = 1e-9;
    const points = [
      ...p.footprints.flatMap((f) => f.outline),
      ...p.faces.flatMap((f) => f.outline),
      ...p.panels.flat(),
    ];
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(p.bounds.minX - eps);
      expect(x).toBeLessThanOrEqual(p.bounds.maxX + eps);
      expect(y).toBeGreaterThanOrEqual(p.bounds.minY - eps);
      expect(y).toBeLessThanOrEqual(p.bounds.maxY + eps);
    }
    // The neighbours run well past the house, the bounds do not follow them.
    expect(p.bounds.maxX - p.bounds.minX).toBeLessThan(10);
    expect(p.neighbours.flat().some(([x]) => x > p.bounds.maxX + 1 || x < p.bounds.minX - 1)).toBe(
      true,
    );
  });

  it('every panel corner lies inside a panelled face outline (1 cm tolerance)', () => {
    const p = plan(10);
    for (const panel of p.panels) {
      for (const corner of panel) {
        expect(p.faces.some((f) => f.panelled && insideOrNear(corner, f.outline, 0.01))).toBe(true);
      }
    }
  });

  it('is null for an empty face list, as the widget places nothing then', () => {
    expect(roofPlanFor(SAMPLE, { panelCount: 4, planeIds: [], reliable: true })).toBeNull();
  });

  it('honours the quote plane ids', () => {
    // Asking only for the north slope (id 1) places them there, so it is the main face.
    const p = roofPlanFor(SAMPLE, { panelCount: 2, planeIds: [1], reliable: true });
    expect(p).not.toBeNull();
    expect(p!.faces.filter((f) => f.panelled).map((f) => f.id)).toEqual([1]);
    expect(p!.mainFace.id).toBe(1);
    expect(p!.mainFacing).toBe('North');
    const [a, b] = p!.mainFace.eave;
    expect(Math.abs(a[1] - b[1])).toBeLessThan(0.01);
    const face = p!.faces.find((f) => f.id === 1)!;
    for (const q of face.outline) expect(q[1]).toBeGreaterThanOrEqual(a[1] - 0.01);
  });
});
