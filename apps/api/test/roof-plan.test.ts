import { describe, expect, it } from 'vitest';

import {
  NEIGHBOUR_STUB_M,
  roofPlanFor,
  type RoofPlan,
  type V3,
} from '../src/proposal/roof-plan.js';

import { HIP_SPEC, L_SPEC, SAMPLE, SEMI_SPEC } from './roof-fixtures.js';

interface SampleSpec {
  parts: {
    footprint: { outer: [number, number][] };
    edgeKinds: string[];
    overhang: number;
    eaveHeight: number;
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

function plan(
  panelCount: number,
  extra: Partial<Parameters<typeof roofPlanFor>[1]> = {},
): RoofPlan {
  const out = roofPlanFor(SAMPLE, { panelCount, reliable: true, ...extra });
  if (!out) throw new Error('expected a roof plan');
  return out;
}

const zs = (pts: V3[]) => pts.map((p) => p[2]);
const top = (pts: V3[]) => Math.max(...zs(pts));
const bottom = (pts: V3[]) => Math.min(...zs(pts));
/** The wall's foot in plan: its lowest points. */
const footOf = (pts: V3[]): P[] =>
  pts.filter((p) => p[2] < bottom(pts) + 0.01).map((p) => [p[0], p[1]]);

describe('roofPlanFor', () => {
  it('puts exactly the quoted panels on the roof, four corners each', () => {
    const p = plan(10);
    expect(p.panels).toHaveLength(10);
    for (const panel of p.panels) expect(panel.corners).toHaveLength(4);
    expect(p.mainFacing).toBe('South');
    expect(p.sample).toBe(false);
  });

  it('marks the sample house and knows its address', () => {
    const p = plan(4, { sample: true });
    expect(p.sample).toBe(true);
    expect(p.address).toBe('20 Forthlin Road');
  });

  it("raises the house's walls from its footprint, gables to the ridge", () => {
    const p = plan(10);
    expect(p.parts).toHaveLength(1);
    const walls = p.parts[0]!.walls;
    expect(walls).toHaveLength(4);
    const fp = PART.footprint.outer;
    const ridge = Math.max(...p.faces.flatMap((f) => zs(f.outline)));
    for (const w of walls) {
      expect(bottom(w.pts)).toBeCloseTo(0, 5);
      expect(Math.abs(w.normal[2])).toBeLessThan(1e-9);
      for (const q of footOf(w.pts)) expect(insideOrNear(q, fp, 0.01)).toBe(true);
      // the party walls are the gable ends here, rising to the ridge; the others stop at the eave
      if (w.party) expect(top(w.pts)).toBeCloseTo(ridge, 1);
      else expect(top(w.pts)).toBeCloseTo(PART.eaveHeight, 2);
    }
    expect(walls.filter((w) => w.party)).toHaveLength(2);
    // outward normals: away from the footprint's centre
    const c = fp.reduce<P>((s, q) => [s[0] + q[0] / fp.length, s[1] + q[1] / fp.length], [0, 0]);
    for (const w of walls) {
      const [q] = footOf(w.pts);
      expect((q![0] - c[0]) * w.normal[0] + (q![1] - c[1]) * w.normal[1]).toBeGreaterThan(0);
    }
  });

  it('returns both roof slopes, panelled only where the panels are', () => {
    const p = plan(10);
    expect(p.faces).toHaveLength(2);
    const fp = PART.footprint.outer;
    for (const face of p.faces) {
      expect(face.outline.length).toBeGreaterThanOrEqual(3);
      expect(face.normal[2]).toBeGreaterThan(0);
      for (const q of face.outline) {
        expect(insideOrNear([q[0], q[1]], fp, PART.overhang + 0.05)).toBe(true);
      }
    }
    const south = p.faces.find((f) => f.azimuthDeg > 135 && f.azimuthDeg < 225)!;
    const north = p.faces.find((f) => f !== south)!;
    expect(south.panelled).toBe(true);
    expect(north.panelled).toBe(false);
    expect(p.mainFace.id).toBe(south.id);
    expect(p.mainFace.pitchDeg).toBeCloseTo(PART.roof.pitchDeg, 1);
  });

  it('lays every panel on its panelled face, within its outline and just off its plane', () => {
    const p = plan(10);
    for (const panel of p.panels) {
      const face = p.faces.find((f) => f.id === panel.faceId)!;
      expect(face.panelled).toBe(true);
      const outline = face.outline.map((q): P => [q[0], q[1]]);
      const o = face.outline[0]!;
      for (const c of panel.corners) {
        expect(insideOrNear([c[0], c[1]], outline, 0.01)).toBe(true);
        const off =
          (c[0] - o[0]) * face.normal[0] +
          (c[1] - o[1]) * face.normal[1] +
          (c[2] - o[2]) * face.normal[2];
        expect(off).toBeGreaterThan(-0.01);
        expect(off).toBeLessThan(0.2);
      }
    }
  });

  it('sets windows and doors on the outside walls', () => {
    const p = plan(10);
    expect(p.openings.some((o) => o.kind === 'window')).toBe(true);
    expect(p.openings.some((o) => o.kind === 'door')).toBe(true);
    for (const o of p.openings) {
      const wall = p.parts[0]!.walls[o.wall]!;
      expect(wall.party).toBe(false);
      expect(o.pts).toHaveLength(4);
      for (const q of o.pts) expect(q[2]).toBeLessThanOrEqual(top(wall.pts) + 0.01);
    }
  });

  it('returns the attached neighbours only, cut short, gabled like the house', () => {
    const p = plan(10);
    const attached = SPEC.context.neighbours.filter((n) => n.attached);
    expect(attached.length).toBe(2);
    expect(p.neighbours).toHaveLength(2);
    const fp = PART.footprint.outer;
    for (const nb of p.neighbours) {
      // it shares a party wall line with the house
      for (const q of nb.shared) expect(insideOrNear(q, fp, 0.05)).toBe(true);
      const [a, b] = nb.shared;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // and runs no further than the stub from it
      for (const poly of [...nb.walls, ...nb.roofs]) {
        for (const q of poly.pts) {
          const d = Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) / len;
          expect(d).toBeLessThanOrEqual(NEIGHBOUR_STUB_M + 0.01);
        }
      }
      expect(nb.cut).not.toBeNull();
      expect(nb.roofs).toHaveLength(2);
    }
  });

  it("carries the house's slopes on into its terraced neighbours: one eave line, one ridge", () => {
    for (const spec of [SAMPLE, SEMI_SPEC]) {
      const p = roofPlanFor(spec, { panelCount: 10, reliable: true })!;
      expect(p.neighbours).toHaveLength(spec === SAMPLE ? 2 : 1);
      for (const nb of p.neighbours) {
        expect(nb.joined).toBe(true);
        expect(nb.reach).toBeGreaterThan(0);
        expect(nb.reach).toBeLessThanOrEqual(NEIGHBOUR_STUB_M + 0.01);
        expect(Math.hypot(...nb.away)).toBeCloseTo(1, 6);
        for (const roof of nb.roofs) {
          // the house slope it carries on: same plane, sharing the edge on the party line
          const face = p.faces.find(
            (f) =>
              Math.abs(
                f.normal[0] * roof.normal[0] +
                  f.normal[1] * roof.normal[1] +
                  f.normal[2] * roof.normal[2],
              ) >
              1 - 1e-4,
          )!;
          expect(face).toBeDefined();
          const o = face.outline[0]!;
          for (const q of roof.pts) {
            const off =
              (q[0] - o[0]) * face.normal[0] +
              (q[1] - o[1]) * face.normal[1] +
              (q[2] - o[2]) * face.normal[2];
            expect(Math.abs(off)).toBeLessThan(0.01);
          }
          // its eave and ridge at the house's eave and ridge heights
          expect(bottom(roof.pts)).toBeCloseTo(bottom(face.outline), 3);
          expect(top(roof.pts)).toBeCloseTo(top(face.outline), 3);
        }
      }
    }
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
  });

  it('stands no wall along the cut between two fitted parts, below the lower roof', () => {
    const p = roofPlanFor(L_SPEC, { panelCount: 4, reliable: true });
    expect(p).not.toBeNull();
    expect(p!.parts).toHaveLength(2);
    const chord: [P, P] = [
      [0, 6],
      [4, 6],
    ];
    const onChord = (q: P) => segDist(q, chord[0], chord[1]) < 0.02;
    const all = p!.parts.flatMap((part) => part.walls);
    for (const w of all) {
      if (!footOf(w.pts).every(onChord)) continue;
      // only the main block's wall above the flat rear roof (eave 3 m) stands there
      expect(bottom(w.pts)).toBeGreaterThan(2.95);
    }
    // The walls standing on the ground run round the L: 8 + 6 + 4 + 4 + 4 + 10 = 36 m.
    const ground = all.filter((w) => bottom(w.pts) < 0.01);
    const total = ground.reduce((sum, w) => {
      const f = footOf(w.pts);
      return sum + Math.hypot(f[1]![0] - f[0]![0], f[1]![1] - f[0]![1]);
    }, 0);
    expect(total).toBeCloseTo(36, 1);
  });

  it('builds a hipped roof: four slopes over four eave-high walls', () => {
    const p = roofPlanFor(HIP_SPEC, { panelCount: 4, reliable: true });
    expect(p).not.toBeNull();
    expect(p!.faces).toHaveLength(4);
    expect(p!.parts[0]!.walls).toHaveLength(4);
    for (const w of p!.parts[0]!.walls) expect(top(w.pts)).toBeCloseTo(5, 2);
    expect(p!.neighbours).toEqual([]);
  });
});
