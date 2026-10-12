// core/interior: worked examples of research 05 §7.4, Python-prototype parity, robustness, determinism, speed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { layoutInterior, INTERIOR_RULES, stairRisers } from '../src/interior/index.js';
import type { BuiltForm, EdgeKind, InteriorInput, InteriorLayout, RoomInfo, Vec2 } from '../src/types.js';
import { checkPlan, insetByLines, pointInPoly, randomPlan, signedArea, unionArea, type RandomPlan } from './fixtures/interior/plans.js';

type Box = [number, number, number, number]; // x0, x1, y0, y1

const bbox = (p: Vec2[]): Box => {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const sameBox = (a: Box, b: Box, tol = 1e-9) => a.every((v, i) => near(v, b[i], tol));
const roomsOf = (L: InteriorLayout, s: number) => L.rooms.filter((r) => r.storey === s);
const isCirc = (r: RoomInfo) => r.label === 'hall' || r.label === 'landing';

/** Rectangle footprint W x D (front edge 0 along +x, y = depth), party walls on the left (edge 3) / right (edge 1). */
function rectInput(W: number, D: number, o: {
  t?: number; storeys?: number; ff?: number; partyL?: boolean; partyR?: boolean; form?: BuiltForm;
  rear?: { x0: number; x1: number; rd: number; storeys: number };
} = {}): InteriorInput {
  const storeys = o.storeys ?? 2, ff = o.ff ?? 2.7;
  return {
    partId: 'main',
    footprint: { outer: [[0, 0], [W, 0], [W, D], [0, D]] },
    edgeKinds: ['eave', o.partyR ? 'party' : 'eave', 'eave', o.partyL ? 'party' : 'eave'],
    frontEdge: 0,
    storeys,
    levels: Array.from({ length: storeys }, (_, s) => ({ floorZ: 0.15 + s * ff, ceilingZ: 0.15 + s * ff + ff - 0.25 })),
    wallThickness: o.t ?? 0,
    era: 'unknown',
    builtForm: o.form ?? 'detached',
    role: 'main',
    rearPart: o.rear
      ? { partId: 'rear-1', footprint: { outer: [[o.rear.x0, D], [o.rear.x1, D], [o.rear.x1, D + o.rear.rd], [o.rear.x0, D + o.rear.rd]] }, storeys: o.rear.storeys }
      : undefined,
  };
}

/** Rooms on both sides of every door: [storey, label A, label B] with labels sorted. */
function doorLinks(L: InteriorLayout): string[] {
  const out: string[] = [];
  for (const w of L.walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const d: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    for (const dr of w.doors) {
      const c: Vec2 = [w.a[0] + d[0] * dr.at, w.a[1] + d[1] * dr.at], o = w.thickness / 2 + 0.05;
      const rooms = roomsOf(L, w.storey);
      const p = rooms.find((r) => pointInPoly([c[0] - d[1] * o, c[1] + d[0] * o], r.polygon));
      const q = rooms.find((r) => pointInPoly([c[0] + d[1] * o, c[1] - d[0] * o], r.polygon));
      out.push(`${w.storey}:${[p?.label ?? '?', q?.label ?? '?'].sort().join(' | ')}`);
    }
  }
  return out.sort();
}

function expectSchedule(L: InteriorLayout, schedule: [number, string, string, Box][], tol = 1e-9) {
  expect(L.rooms.length).toBe(schedule.length);
  for (const [s, partId, label, box] of schedule) {
    const r = L.rooms.find((q) => q.storey === s && q.label === label && sameBox(bbox(q.polygon), box, tol));
    expect(r, `storey ${s} ${label} ${box.join(',')}`).toBeDefined();
    expect(r!.partId).toBe(partId);
    expect(r!.polygon.length).toBe(4); // a plain rectangle
    expect(r!.area).toBeCloseTo((box[1] - box[0]) * (box[3] - box[2]), 9);
  }
}

// Victorian mid-terrace 4.9 x 8.0 m with a 2.8 x 4.8 m two-storey outrigger, ff 2.9 m (research 05 §7.4).
const WORKED: InteriorInput = {
  partId: 'main',
  footprint: { outer: [[0, 0], [4.9, 0], [4.9, 8], [0, 8]] },
  edgeKinds: ['eave', 'party', 'eave', 'party'],
  frontEdge: 0,
  storeys: 2,
  levels: [{ floorZ: 0.15, ceilingZ: 2.8 }, { floorZ: 3.05, ceilingZ: 5.7 }],
  wallThickness: 0,
  era: 'pre-1919',
  builtForm: 'mid-terrace',
  role: 'main',
  rearPart: { partId: 'rear-1', footprint: { outer: [[0, 8], [2.8, 8], [2.8, 12.8], [0, 12.8]] }, storeys: 2 },
};
const WORKED_SCHEDULE: [number, string, string, Box][] = [
  [0, 'main', 'hall', [0, 1, 0, 8]],
  [0, 'main', 'front room / living', [1, 4.9, 0, 4]],
  [0, 'main', 'dining room', [1, 4.9, 4, 8]],
  [0, 'rear-1', 'kitchen', [0, 2.8, 8, 11]],
  [0, 'rear-1', 'utility / WC', [0, 2.8, 11, 12.8]],
  [1, 'main', 'landing', [0, 1.75, 0, 8]],
  [1, 'main', 'bedroom 1', [1.75, 4.9, 0, 4]],
  [1, 'main', 'bedroom 2', [1.75, 4.9, 4, 8]],
  [1, 'rear-1', 'study / box room', [0, 2.8, 8, 10.6]],
  [1, 'rear-1', 'bathroom', [0, 2.8, 10.6, 12.8]],
];

/** The worked example with t-thick walls: footprints grown so the internal dimensions stay the same. */
function workedWithWalls(t: number): InteriorInput {
  const W = 4.9 + 2 * t, D = 8 + 2 * t, rw = 2.8 + 2 * t, rd = 4.8 + 2 * t;
  return {
    ...WORKED,
    wallThickness: t,
    footprint: { outer: [[0, 0], [W, 0], [W, D], [0, D]] },
    rearPart: { partId: 'rear-1', footprint: { outer: [[0, D], [rw, D], [rw, D + rd], [0, D + rd]] }, storeys: 2 },
  };
}

describe('worked example: Victorian mid-terrace 4.9 x 8.0 m + 2.8 x 4.8 m two-storey outrigger, ff 2.9 m', () => {
  it('reproduces the documented room schedule (research 05 §7.4)', () => {
    const L = layoutInterior(WORKED);
    expect(L.warnings).toEqual([]);
    expectSchedule(L, WORKED_SCHEDULE);
    for (const r of L.rooms) {
      expect(r.estimated).toBe(true);
      expect(r.floorZ).toBe(WORKED.levels[r.storey].floorZ);
      expect(r.ceilingZ).toBe(WORKED.levels[r.storey].ceilingZ);
      expect(signedArea(r.polygon)).toBeGreaterThan(0);
    }
    expect(L.rooms.map((r) => r.id)).toEqual([
      'main/s0/hall', 'main/s0/z0f', 'main/s0/z0b', 'rear-1/s0/rear0', 'rear-1/s0/rear1',
      'main/s1/landing', 'main/s1/z0f', 'main/s1/z0b', 'rear-1/s1/rear0', 'rear-1/s1/rear1',
    ]);
  });

  it('has one straight flight of 15 risers x 193 mm in the 1.0 m hall, 1.2 m behind the front wall', () => {
    const L = layoutInterior(WORKED);
    expect(L.stairs).toHaveLength(1);
    const f = L.stairs[0];
    expect(f.storey).toBe(0);
    expect(f.risers).toBe(15);
    expect(Math.round(f.riserHeight * 1000)).toBe(193);
    expect(f.going).toBe(0.225);
    expect(f.width).toBe(0.85);
    expect(f.start[0]).toBeCloseTo(0.425, 12);
    expect(f.start[1]).toBeCloseTo(1.2, 12);
    expect(f.direction[0]).toBeCloseTo(0, 12);
    expect(f.direction[1]).toBeCloseTo(1, 12);
    expect(sameBox(bbox(f.polygon), [0, 0.85, 1.2, 4.35])).toBe(true);
    expect(signedArea(f.polygon)).toBeGreaterThan(0);
    expect((Math.atan(f.riserHeight / f.going) * 180) / Math.PI).toBeLessThanOrEqual(42);
    expect(f.riserHeight * f.risers).toBeCloseTo(2.9, 12);
  });

  it('places 6 partitions and 4 doors per storey (as the prototype), doors clear of the stair', () => {
    const L = layoutInterior(WORKED);
    for (const s of [0, 1]) {
      const walls = L.walls.filter((w) => w.storey === s);
      expect(walls).toHaveLength(6);
      expect(walls.reduce((n, w) => n + w.doors.length, 0)).toBe(4);
      for (const w of walls) {
        expect(w.thickness).toBe(INTERIOR_RULES.partitionThickness);
        for (const d of w.doors) expect([d.width, d.height]).toEqual([0.76, 2.0]);
      }
    }
    expect(doorLinks(L)).toEqual([
      '0:dining room | hall', '0:front room / living | hall', '0:hall | kitchen', '0:kitchen | utility / WC',
      '1:bathroom | study / box room', '1:bedroom 1 | landing', '1:bedroom 2 | landing', '1:landing | study / box room',
    ]);
    // the dining-room door is hung beyond the stair head (y >= 4.35), not beside the flight
    const w = L.walls.find((q) => q.storey === 0 && near(q.a[0], 1) && near(q.a[1], 4) && near(q.b[1], 8))!;
    expect(w.doors).toHaveLength(1);
    expect(w.a[1] + w.doors[0].at - 0.38).toBeGreaterThanOrEqual(4.35);
    // the front-room door sits 0.1 m from the front end of its wall
    const f = L.walls.find((q) => q.storey === 0 && near(q.a[0], 1) && near(q.a[1], 0))!;
    expect(f.doors[0].at).toBeCloseTo(0.48, 12);
  });

  it('keeps the internal schedule with 0.25 m walls; the 0.5 m joint to the outrigger carries the kitchen door', () => {
    const t = 0.25;
    const L = layoutInterior(workedWithWalls(t));
    expect(L.warnings).toEqual([]);
    const shifted = WORKED_SCHEDULE.map(([s, p, l, b]): [number, string, string, Box] => {
      const dy = p === 'main' ? t : 3 * t; // rear rooms: behind the main back wall (t) and their own front wall (t)
      return [s, p, l, [b[0] + t, b[1] + t, b[2] + dy, b[3] + dy]];
    });
    expectSchedule(L, shifted);
    const joints = L.walls.filter((w) => w.thickness !== INTERIOR_RULES.partitionThickness);
    expect(joints).toHaveLength(4);
    for (const j of joints) {
      expect(j.thickness).toBeCloseTo(2 * t, 12);
      expect(j.a[1]).toBeCloseTo(8 + 2 * t, 12); // on the shared external wall line
      expect(j.b[1]).toBeCloseTo(8 + 2 * t, 12);
    }
    expect(doorLinks(L)).toContain('0:hall | kitchen');
    expect(doorLinks(L)).toContain('1:landing | study / box room');
  });

  it('is invariant under rotation and translation of the footprint', () => {
    const base = workedWithWalls(0.3);
    const th = 0.6, tx = 100, ty = -40;
    const T = (p: Vec2): Vec2 => [tx + p[0] * Math.cos(th) - p[1] * Math.sin(th), ty + p[0] * Math.sin(th) + p[1] * Math.cos(th)];
    const moved: InteriorInput = {
      ...base,
      footprint: { outer: base.footprint.outer.map(T) },
      rearPart: { ...base.rearPart!, footprint: { outer: base.rearPart!.footprint.outer.map(T) } },
    };
    const A = layoutInterior(base), B = layoutInterior(moved);
    expect(B.rooms.map((r) => [r.id, r.label])).toEqual(A.rooms.map((r) => [r.id, r.label]));
    A.rooms.forEach((r, i) => {
      const q = B.rooms[i];
      expect(q.polygon.length).toBe(r.polygon.length);
      r.polygon.forEach((p, k) => expect(Math.hypot(T(p)[0] - q.polygon[k][0], T(p)[1] - q.polygon[k][1])).toBeLessThan(1e-9));
      expect(q.area).toBeCloseTo(r.area, 9);
    });
    expect(B.walls.length).toBe(A.walls.length);
    A.walls.forEach((w, i) => {
      const v = B.walls[i];
      expect(Math.hypot(T(w.a)[0] - v.a[0], T(w.a)[1] - v.a[1])).toBeLessThan(1e-9);
      expect(Math.hypot(T(w.b)[0] - v.b[0], T(w.b)[1] - v.b[1])).toBeLessThan(1e-9);
      expect(v.doors.map((d) => d.at.toFixed(9))).toEqual(w.doors.map((d) => d.at.toFixed(9)));
    });
    const s = B.stairs[0], s0 = A.stairs[0];
    expect(Math.hypot(T(s0.start)[0] - s.start[0], T(s0.start)[1] - s.start[1])).toBeLessThan(1e-9);
    expect(s.direction[0]).toBeCloseTo(-Math.sin(th), 12);
    expect(s.direction[1]).toBeCloseTo(Math.cos(th), 12);
  });
});

describe('archetype examples of research 05 §7.4 (prototype demo plans)', () => {
  it('inter-war semi 7.6 x 8.4 m: 1.8 m hall, kitchen + dining at the back, box room over the front lobby', () => {
    const L = layoutInterior(rectInput(7.6, 8.4, { ff: 2.6, partyL: true, form: 'semi-detached' }));
    expectSchedule(L, [
      [0, 'main', 'hall', [0, 1.8, 0, 8.4]],
      [0, 'main', 'front room / living', [1.8, 7.6, 0, 4.25]],
      [0, 'main', 'kitchen', [1.8, 4.4, 4.25, 8.4]],
      [0, 'main', 'dining room', [4.4, 7.6, 4.25, 8.4]],
      [1, 'main', 'box room', [0, 1.75, 0, 2.3]],
      [1, 'main', 'landing', [0, 1.75, 2.3, 8.4]],
      [1, 'main', 'bedroom 1', [1.75, 7.6, 0, 4.25]],
      [1, 'main', 'bathroom', [1.75, 3.95, 4.25, 8.4]],
      [1, 'main', 'bedroom 2', [3.95, 7.6, 4.25, 8.4]],
    ]);
    const f = L.stairs[0];
    expect([f.risers, Math.round(f.riserHeight * 1000)]).toEqual([13, 200]);
    expect(sameBox(bbox(f.polygon), [0, 0.85, 2.0, 4.7])).toBe(true);
    // the box-room door opens onto the landing beside, not over, the stairwell
    const w = L.walls.find((q) => q.storey === 1 && near(q.a[1], 2.3) && near(q.b[1], 2.3))!;
    expect(w.a[0] + w.doors[0].at - 0.38).toBeGreaterThanOrEqual(0.85);
    // the bathroom sits between the landing and bedroom 2, so bedroom 2 opens onto its largest neighbour
    // (bedroom 1) - the prototype's fallback rule (research 05 §7.4 step 8), likewise the dining room
    expect(doorLinks(L)).toEqual([
      '0:dining room | front room / living', '0:front room / living | hall', '0:hall | kitchen',
      '1:bathroom | landing', '1:bedroom 1 | bedroom 2', '1:bedroom 1 | landing', '1:box room | landing',
    ]);
  });

  it('modern detached 10 x 8.5 m: central hall, four bedrooms, bathroom at the end of the landing', () => {
    const L = layoutInterior(rectInput(10, 8.5, { ff: 2.6 }));
    expectSchedule(L, [
      [0, 'main', 'hall', [4.5, 5.5, 0, 8.5]],
      [0, 'main', 'living room', [0, 4.5, 0, 4.25]],
      [0, 'main', 'study / utility', [0, 4.5, 4.25, 8.5]],
      [0, 'main', 'dining room', [5.5, 10, 0, 4.25]],
      [0, 'main', 'kitchen', [5.5, 10, 4.25, 8.5]],
      [1, 'main', 'landing', [4.125, 5.875, 0, 6.3]],
      [1, 'main', 'bathroom', [4.125, 5.875, 6.3, 8.5]],
      [1, 'main', 'bedroom 1', [0, 4.125, 0, 4.25]],
      [1, 'main', 'bedroom 2', [0, 4.125, 4.25, 8.5]],
      [1, 'main', 'bedroom 3', [5.875, 10, 0, 4.25]],
      [1, 'main', 'bedroom 4', [5.875, 10, 4.25, 8.5]],
    ]);
    expect(sameBox(bbox(L.stairs[0].polygon), [4.5, 5.35, 1.2, 3.9])).toBe(true);
  });

  it('bungalow 11 x 8 m: central spine, living / kitchen-diner, bathroom and two bedrooms, no stairs', () => {
    const L = layoutInterior(rectInput(11, 8, { storeys: 1, ff: 2.5 }));
    expectSchedule(L, [
      [0, 'main', 'hall', [4.95, 6.05, 0, 8]],
      [0, 'main', 'living room', [0, 4.95, 0, 4]],
      [0, 'main', 'bedroom 1', [0, 4.95, 4, 8]],
      [0, 'main', 'kitchen / diner', [6.05, 11, 0, 4]],
      [0, 'main', 'bathroom', [6.05, 8.25, 4, 8]],
      [0, 'main', 'bedroom 2', [8.25, 11, 4, 8]],
    ]);
    expect(L.stairs).toEqual([]);
  });

  it('terrace with a single-storey rear extension: kitchen behind, bathroom at the end of the landing', () => {
    const L = layoutInterior(rectInput(5, 8.5, { ff: 2.6, partyL: true, partyR: true, form: 'mid-terrace', rear: { x0: 0, x1: 5, rd: 3, storeys: 1 } }));
    expectSchedule(L, [
      [0, 'main', 'hall', [0, 1, 0, 8.5]],
      [0, 'main', 'front room / living', [1, 5, 0, 4.25]],
      [0, 'main', 'dining room', [1, 5, 4.25, 8.5]],
      [0, 'rear-1', 'kitchen', [0, 5, 8.5, 11.5]],
      [1, 'main', 'landing', [0, 1.75, 0, 6.3]],
      [1, 'main', 'bathroom', [0, 1.75, 6.3, 8.5]],
      [1, 'main', 'bedroom 1', [1.75, 5, 0, 4.25]],
      [1, 'main', 'bedroom 2', [1.75, 5, 4.25, 8.5]],
    ]);
  });

  it('counts risers as ceil(ff / 0.20) (rise <= 200 mm), exact multiples included', () => {
    expect([stairRisers(2.9), stairRisers(2.6), stairRisers(3.0), stairRisers(2.4), stairRisers(2.61)]).toEqual([15, 13, 15, 12, 14]);
  });
});

interface OracleCase {
  archetype: 'terrace' | 'semi' | 'detached' | 'bungalow';
  W: number; D: number; storeys: number; ff: number;
  party: { L: boolean; R: boolean };
  rear: [number, number, number] | null; rearStoreys: number | null;
  plan: { rooms: [number, number, number, number, string][]; stair: Box | null }[];
}

describe('parity with the Python prototype (research/methods/roofit/layout.py, 200 seeded plans)', () => {
  const oracle = JSON.parse(readFileSync(new URL('./fixtures/interior/python-oracle.json', import.meta.url), 'utf8')) as { cases: OracleCase[] };
  // documented deviations: bedrooms are numbered house-wide, 'bedroom (box room)' -> 'box room',
  // 'kitchen/diner' -> 'kitchen / diner', and central-hall stairs keep their ground-floor position upstairs
  const norm = (l: string) => l.replace(/^bedroom( \d+)?$/, 'bedroom').replace('bedroom (box room)', 'box room').replace('kitchen/diner', 'kitchen / diner');

  it('reproduces every room rectangle, label and stair rectangle', () => {
    expect(oracle.cases).toHaveLength(200);
    const mismatches: string[] = [];
    for (const [ci, c] of oracle.cases.entries()) {
      const form: BuiltForm = c.archetype === 'terrace' ? (c.party.L && c.party.R ? 'mid-terrace' : 'end-terrace') : c.archetype === 'semi' ? 'semi-detached' : 'detached';
      const input = rectInput(c.W, c.D, {
        storeys: c.storeys, ff: c.ff, partyL: c.party.L, partyR: c.party.R, form,
        rear: c.rear ? { x0: c.rear[0], x1: c.rear[1], rd: c.rear[2], storeys: c.rearStoreys ?? c.storeys } : undefined,
      });
      const L = layoutInterior(input);
      c.plan.forEach((st, s) => {
        const mine = roomsOf(L, s);
        if (mine.length !== st.rooms.length) mismatches.push(`#${ci} S${s}: ${mine.length} rooms vs ${st.rooms.length}`);
        for (const [x0, x1, y0, y1, label] of st.rooms) {
          const m = mine.find((r) => sameBox(bbox(r.polygon), [x0, x1, y0, y1]) && r.polygon.length === 4);
          if (!m) mismatches.push(`#${ci} S${s}: no room [${x0},${x1}]x[${y0},${y1}] (${label})`);
          else if (norm(m.label) !== norm(label)) mismatches.push(`#${ci} S${s}: ${label} labelled ${m.label}`);
        }
        const centralUpper = s > 0 && c.archetype === 'detached' && c.W >= 8.5;
        if (st.stair && !centralUpper && !sameBox(bbox(L.stairs[0].polygon), st.stair)) mismatches.push(`#${ci} S${s}: stair ${bbox(L.stairs[0].polygon)} vs ${st.stair}`);
      });
    }
    expect(mismatches).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------

const shapePlan = (outer: Vec2[], kinds: EdgeKind[], t: number, storeys: number, form: BuiltForm, ff = 2.7): RandomPlan => ({
  kind: 'detached',
  input: {
    partId: 'main', footprint: { outer }, edgeKinds: kinds, frontEdge: 0, storeys,
    levels: Array.from({ length: storeys }, (_, s) => ({ floorZ: 0.15 + s * ff, ceilingZ: 0.15 + s * ff + ff - 0.25 })),
    wallThickness: t, era: 'unknown', builtForm: form, role: 'main',
  },
  mainUsable: insetByLines(outer, t),
  rearUsable: null,
  rearStoreys: 0,
  ff: Array.from({ length: storeys - 1 }, () => ff),
});

describe('non-rectangular footprints and robustness', () => {
  it('lays a single-polygon terrace + outrigger out with the wing as kitchen / utility and bathroom above', () => {
    const plan = shapePlan([[0, 0], [5.5, 0], [5.5, 13], [2.5, 13], [2.5, 8], [0, 8]], ['eave', 'party', 'eave', 'eave', 'eave', 'party'], 0.3, 2, 'mid-terrace');
    const L = layoutInterior(plan.input);
    expect(checkPlan(plan, L)).toEqual([]);
    const label = (s: number, l: string) => roomsOf(L, s).find((r) => r.label === l);
    expect(sameBox(bbox(label(0, 'kitchen')!.polygon), [2.8, 5.2, 7.7, 10.9])).toBe(true);
    expect(sameBox(bbox(label(0, 'utility / WC')!.polygon), [2.8, 5.2, 10.9, 12.7])).toBe(true);
    expect(sameBox(bbox(label(1, 'bathroom')!.polygon), [2.8, 5.2, 10.5, 12.7])).toBe(true);
    expect(label(0, 'dining room')).toBeDefined(); // the kitchen is in the wing
    expect(sameBox(bbox(label(0, 'hall')!.polygon), [4.2, 5.2, 0.3, 7.7])).toBe(true); // hall on the outrigger side
  });

  it('merges a canted front bay into the front room', () => {
    const outer: Vec2[] = [[0, 0], [2, 0], [2.9, -0.9], [4.1, -0.9], [5, 0], [9, 0], [9, 7], [0, 7]];
    const plan = shapePlan(outer, ['eave', 'eave', 'eave', 'eave', 'eave', 'eave', 'eave', 'eave'], 0.3, 2, 'detached');
    const L = layoutInterior(plan.input);
    expect(checkPlan(plan, L)).toEqual([]);
    for (const s of [0, 1]) {
      const front = roomsOf(L, s).find((r) => bbox(r.polygon)[2] < 0)!; // the room reaching into the bay
      expect(front.label).toBe(s === 0 ? 'front room / living' : 'bedroom 1');
      expect(front.polygon.length).toBeGreaterThan(4);
      expect(bbox(front.polygon)[2]).toBeCloseTo(-0.6, 9);
    }
  });

  it('tiles a courtyard footprint (hole) with extra rooms around the court', () => {
    const outer: Vec2[] = [[0, 0], [20, 0], [20, 16], [0, 16]];
    const hole: Vec2[] = [[6, 5], [6, 11], [14, 11], [14, 5]];
    const input = { ...rectInput(20, 16), footprint: { outer, holes: [hole] }, wallThickness: 0.3 };
    const L = layoutInterior(input);
    const usable = 19.4 * 15.4 - 8.6 * 6.6;
    for (const s of [0, 1]) {
      const rooms = roomsOf(L, s);
      const sum = rooms.reduce((a, r) => a + r.area, 0);
      expect(sum).toBeCloseTo(usable, 6);
      expect(unionArea(rooms.map((r) => r.polygon))).toBeCloseTo(sum, 6);
      for (const r of rooms) {
        expect(signedArea(r.polygon)).toBeGreaterThan(0);
        expect(pointInPoly([10, 8], r.polygon)).toBe(false); // nothing in the court
      }
      expect(rooms.filter((r) => !isCirc(r)).every((r) => doorLinks(L).some((d) => d.startsWith(`${s}:`) && d.includes(r.label)))).toBe(true);
    }
    expect(L.warnings.some((w) => w.includes('landing beyond the stair head'))).toBe(true);
  });

  it('falls back to a compact plan for a tiny footprint and says so', () => {
    const L = layoutInterior(rectInput(3.2, 4.5, { t: 0.25, ff: 2.6 }));
    expect(L.warnings.some((w) => w.includes('compact plan'))).toBe(true);
    expect(L.warnings.some((w) => w.includes('no bathroom fits'))).toBe(true);
    for (const s of [0, 1]) expect(roomsOf(L, s).reduce((a, r) => a + r.area, 0)).toBeCloseTo(2.7 * 4.0, 9);
    expect(L.stairs).toHaveLength(1);
  });

  it('accepts a clockwise ring (edge kinds and front edge remapped) with the same result', () => {
    const ccw = rectInput(5.2, 8.6, { t: 0.3, partyL: true, form: 'end-terrace' });
    const o = ccw.footprint.outer, n = o.length;
    const cw: InteriorInput = {
      ...ccw,
      footprint: { outer: o.slice().reverse() },
      edgeKinds: Array.from({ length: n }, (_, j) => ccw.edgeKinds[(((n - 2 - j) % n) + n) % n]),
      frontEdge: n - 2,
    };
    expect(JSON.stringify(layoutInterior(cw).rooms.map((r) => [r.label, bbox(r.polygon).map((v) => v.toFixed(9))])))
      .toBe(JSON.stringify(layoutInterior(ccw).rooms.map((r) => [r.label, bbox(r.polygon).map((v) => v.toFixed(9))])));
  });

  it('without frontEdge picks the street side of an end-terrace, not its long gable wall', () => {
    const input = { ...rectInput(5, 9.5, { t: 0.25, partyR: true, form: 'end-terrace' }), frontEdge: undefined };
    const hall = layoutInterior(input).rooms.find((r) => r.label === 'hall')!;
    const [x0, x1, , y1] = bbox(hall.polygon);
    expect(x1 - x0).toBeCloseTo(1.0, 9); // a 1 m hall along the 9 m depth, by the party wall
    expect(y1 - 0.25).toBeCloseTo(9, 9);
    expect(x1).toBeCloseTo(4.75, 9);
  });

  it('never throws on degenerate input and explains why nothing was planned', () => {
    const bad: InteriorInput[] = [
      { ...WORKED, footprint: { outer: [[0, 0], [1, 0]] } },
      { ...WORKED, footprint: { outer: [[0, 0], [NaN, 0], [1, 1]] } },
      { ...WORKED, footprint: { outer: [[0, 0], [1, 1], [2, 2]] } },
      { ...rectInput(1.5, 1.5, { t: 1 }) },
    ];
    for (const input of bad) {
      const L = layoutInterior(input);
      expect(L.rooms).toEqual([]);
      expect(L.warnings.length).toBeGreaterThan(0);
    }
  });

  it('synthesises missing storey levels and flags a detached rear part', () => {
    const L = layoutInterior({ ...WORKED, levels: [] });
    expect(L.rooms).toHaveLength(10);
    expect(L.warnings.filter((w) => w.includes('no valid level'))).toHaveLength(2);
    const far = layoutInterior({ ...WORKED, rearPart: { partId: 'rear-1', footprint: { outer: [[0, 10], [2.8, 10], [2.8, 14], [0, 14]] }, storeys: 1 } });
    expect(far.warnings.some((w) => w.includes('does not adjoin'))).toBe(true);
    expect(far.rooms.some((r) => r.partId === 'rear-1' && r.label === 'kitchen')).toBe(true);
  });

  it('flags a straight flight that leaves no landing in a shallow plan but keeps it inside the block', () => {
    const L = layoutInterior(rectInput(8, 4.6, { t: 0.3, ff: 3.0 }));
    expect(L.warnings.some((w) => w.startsWith('stair:'))).toBe(true);
    const [, , y0, y1] = bbox(L.stairs[0].polygon);
    expect(y0).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(y1).toBeLessThanOrEqual(4.3 + 1e-9);
  });

  it('plans other parts on their own: garage, outrigger programme, generic extension room', () => {
    const part = (role: InteriorInput['role'], storeys: number): InteriorLayout =>
      layoutInterior({ ...rectInput(3, 5.5, { t: 0.3, storeys }), partId: role, role, frontEdge: undefined });
    expect(part('garage', 1).rooms.map((r) => r.label)).toEqual(['garage']);
    const rear = part('rear', 2);
    expect(rear.rooms.map((r) => `${r.storey}:${r.label}`)).toEqual(['0:kitchen', '0:utility / WC', '1:study / box room', '1:bathroom']);
    expect(rear.stairs).toEqual([]);
    expect(rear.walls.filter((w) => w.doors.length)).toHaveLength(2);
    expect(part('side', 1).rooms.map((r) => r.label)).toEqual(['other']);
  });
});

describe('determinism and performance', () => {
  it('returns identical output for identical input and does not mutate it', () => {
    const plan = randomPlan(11, 'terrace+outrigger');
    const before = structuredClone(plan.input);
    const a = JSON.stringify(layoutInterior(plan.input));
    const b = JSON.stringify(layoutInterior(plan.input));
    expect(a).toBe(b);
    expect(plan.input).toEqual(before);
    expect(JSON.stringify(layoutInterior(structuredClone(WORKED)))).toBe(JSON.stringify(layoutInterior(WORKED)));
  });

  it('lays out a typical house in well under 5 ms', () => {
    const cases = [workedWithWalls(0.3), randomPlan(3, 'terrace+outrigger').input, randomPlan(5, 'semi').input, randomPlan(8, 'detached').input];
    for (let i = 0; i < 50; i++) for (const c of cases) layoutInterior(c); // warm-up
    for (const c of cases) {
      const n = 100;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) layoutInterior(c);
      const ms = (performance.now() - t0) / n;
      expect(ms).toBeLessThan(5);
    }
  });
});
