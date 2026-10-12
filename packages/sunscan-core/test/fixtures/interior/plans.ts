// Seeded random UK house plans + an independent validity checker for core/interior.
// The geometry here (insets, union areas, inscribed widths) is deliberately written from scratch so the
// checks do not reuse the planner's own slab machinery.
import type { EdgeKind } from '../../../src/geometry/roof.js';
import { mulberry32, type Vec2 } from '../../../src/geometry/geom.js';
import type { BuiltForm, InteriorInput, InteriorLayout, RoomInfo } from '../../../src/types.js';

// ------------------------------------------------------------------------------------------------
// geometry
// ------------------------------------------------------------------------------------------------

export const signedArea = (p: Vec2[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
};

export function pointInPoly(q: Vec2, p: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function distToBoundary(q: Vec2, p: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0;
    d = Math.min(d, Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy));
  }
  return d;
}

/** Inward offset by intersecting the offset edge lines (valid when no edge collapses). */
export function insetByLines(ring: Vec2[], t: number): Vec2[] {
  const n = ring.length;
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L; // left = inward for CCW
    return { nx, ny, c: nx * a[0] + ny * a[1] + t };
  });
  return ring.map((_, i) => {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    const det = l1.nx * l2.ny - l1.ny * l2.nx;
    return [(l1.c * l2.ny - l1.ny * l2.c) / det, (l1.nx * l2.c - l1.c * l2.nx) / det];
  });
}

/** Exact area of the union of simple polygons (slab method with all crossing levels). */
export function unionArea(polys: Vec2[][]): number {
  const edges: [Vec2, Vec2][] = [];
  const ys = new Set<number>();
  for (const p of polys)
    for (let i = 0; i < p.length; i++) {
      edges.push([p[i], p[(i + 1) % p.length]]);
      ys.add(p[i][1]);
    }
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i], [c, d] = edges[j];
      const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-15) continue;
      const u = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
      const v = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
      if (u > 0 && u < 1 && v > 0 && v < 1) ys.add(a[1] + u * r[1]);
    }
  const L = [...ys].sort((x, y) => x - y);
  let area = 0;
  for (let k = 0; k + 1 < L.length; k++) {
    const h = L[k + 1] - L[k];
    if (h < 1e-13) continue;
    const ym = (L[k] + L[k + 1]) / 2;
    const iv: [number, number][] = [];
    for (const p of polys) {
      const xs: number[] = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if (a[1] > ym !== b[1] > ym) xs.push(a[0] + ((ym - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((x, y) => x - y);
      for (let m = 0; m + 1 < xs.length; m += 2) iv.push([xs[m], xs[m + 1]]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let lo = -Infinity, hi = -Infinity, len = 0;
    for (const [x0, x1] of iv) {
      if (x0 > hi) { if (hi > lo) len += hi - lo; lo = x0; hi = x1; }
      else hi = Math.max(hi, x1);
    }
    if (hi > lo) len += hi - lo;
    area += len * h;
  }
  return area;
}

/** True when some point of the polygon is at least w/2 from its boundary (inscribed circle >= w). */
export function widthAtLeast(p: Vec2[], w: number): boolean {
  const r = w / 2 - 1e-6;
  const f = (q: Vec2) => (pointInPoly(q, p) ? distToBoundary(q, p) : -1);
  const A = signedArea(p);
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * c;
    cy += (a[1] + b[1]) * c;
  }
  let best: Vec2 = [cx / (6 * A), cy / (6 * A)];
  let bestF = f(best);
  if (bestF >= r) return true;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const h = 0.05;
  for (let x = x0 + h / 2; x < x1; x += h)
    for (let y = y0 + h / 2; y < y1; y += h) {
      const v = f([x, y]);
      if (v > bestF) { bestF = v; best = [x, y]; }
    }
  for (let step = h / 2; step > 1e-5; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
        const q: Vec2 = [best[0] + dx, best[1] + dy];
        const v = f(q);
        if (v > bestF + 1e-12) { bestF = v; best = q; moved = true; }
      }
    }
  }
  return bestF >= r;
}

// ------------------------------------------------------------------------------------------------
// random plans
// ------------------------------------------------------------------------------------------------

export type PlanKind = 'terrace' | 'terrace+outrigger' | 'semi' | 'detached' | 'bungalow';
export const PLAN_KINDS: PlanKind[] = ['terrace', 'terrace+outrigger', 'semi', 'detached', 'bungalow'];

export interface RandomPlan {
  kind: PlanKind;
  input: InteriorInput;
  /** Expected usable areas (footprints inset by the wall thickness), local ENU, CCW. */
  mainUsable: Vec2[];
  rearUsable: Vec2[] | null;
  rearStoreys: number;
  /** Floor-to-floor height of each storey transition. */
  ff: number[];
}

const deg = Math.PI / 180;

/** A random UK house (dimensions in typical ranges) with random rotation, translation and skew. */
export function randomPlan(seed: number, kind: PlanKind): RandomPlan {
  const rnd = mulberry32(seed * 7919 + 13);
  const U = (a: number, b: number) => a + (b - a) * rnd();
  let W: number, D: number, storeys: number, builtForm: BuiltForm;
  let partyL = false, partyR = false;
  if (kind === 'terrace' || kind === 'terrace+outrigger') {
    W = U(4.2, 6.5); D = U(7.0, 10.5);
    partyL = true; partyR = rnd() < 0.7;
    storeys = rnd() < 0.85 ? 2 : 3;
    builtForm = partyR ? 'mid-terrace' : 'end-terrace';
    if (rnd() < 0.5) [partyL, partyR] = [partyR, partyL]; // end terraces on either side
  } else if (kind === 'semi') {
    W = U(6.0, 9.0); D = U(7.0, 10.0);
    if (rnd() < 0.5) partyL = true; else partyR = true;
    storeys = 2; builtForm = 'semi-detached';
  } else if (kind === 'detached') {
    W = U(7.0, 13.0); D = U(7.0, 11.0); storeys = 2; builtForm = 'detached';
  } else {
    W = U(8.0, 14.0); D = U(6.5, 10.0); storeys = 1; builtForm = 'detached';
  }
  const t = rnd() < 0.1 ? 0 : U(0.2, 0.35);
  const skew = rnd() < 0.3 ? 0 : 1;
  const aL = skew * U(-3, 3) * deg, aR = skew * U(-3, 3) * deg, tilt = skew * U(-0.15, 0.15);
  const P: Vec2[] = [[0, 0], [W, 0], [W + D * Math.tan(aR), D + tilt], [D * Math.tan(aL), D]];
  let ring: Vec2[] = P.slice();
  let kinds: EdgeKind[] = ['eave', partyR ? 'party' : 'eave', 'eave', partyL ? 'party' : 'eave'];
  let rear: Vec2[] | null = null, rs = 0;
  if (kind === 'terrace+outrigger') {
    const ow = U(2.3, Math.min(3.5, W - 1.2)), rd = U(3.0, 7.0);
    rs = rnd() < 0.5 ? 1 : 2;
    rs = Math.min(rs, storeys);
    const e: Vec2 = [P[2][0] - P[3][0], P[2][1] - P[3][1]];
    const eL = Math.hypot(e[0], e[1]);
    const u: Vec2 = [e[0] / eL, e[1] / eL];
    const left = rnd() < 0.5;
    const q0: Vec2 = left ? P[3] : [P[2][0] - u[0] * ow, P[2][1] - u[1] * ow];
    const q1: Vec2 = left ? [P[3][0] + u[0] * ow, P[3][1] + u[1] * ow] : P[2];
    const sk = U(-2, 2) * deg * skew;
    const v: Vec2 = [-u[1] * Math.cos(sk) - u[0] * Math.sin(sk), u[0] * Math.cos(sk) - u[1] * Math.sin(sk)];
    rear = [q0, q1, [q1[0] + v[0] * rd, q1[1] + v[1] * rd], [q0[0] + v[0] * rd, q0[1] + v[1] * rd]];
    if (rnd() < 0.5) {
      // OSM-style shared nodes: split the main back edge at the outrigger corners
      const mid = left ? [q1] : [q0];
      ring = [P[0], P[1], P[2], ...mid, P[3]];
      kinds = ['eave', kinds[1], 'eave', 'eave', kinds[3]];
    }
  }
  const ff: number[] = [];
  const levels: { floorZ: number; ceilingZ: number }[] = [];
  let z = 0.15;
  for (let s = 0; s < storeys; s++) {
    const f = s === 0 ? U(2.5, 3.1) : U(2.5, 3.0);
    levels.push({ floorZ: z, ceilingZ: z + f - 0.25 });
    if (s + 1 < storeys) ff.push(f);
    z += f;
  }
  const th = U(0, 2 * Math.PI), tx = U(-50, 50), ty = U(-50, 50);
  const rot = (p: Vec2): Vec2 => [tx + p[0] * Math.cos(th) - p[1] * Math.sin(th), ty + p[0] * Math.sin(th) + p[1] * Math.cos(th)];
  const input: InteriorInput = {
    partId: 'main',
    footprint: { outer: ring.map(rot) },
    edgeKinds: kinds,
    frontEdge: rnd() < 0.8 ? 0 : undefined,
    storeys,
    levels,
    wallThickness: t,
    era: 'unknown',
    builtForm,
    role: 'main',
    rearPart: rear ? { partId: 'rear-1', footprint: { outer: rear.map(rot) }, storeys: rs } : undefined,
  };
  return {
    kind, input, ff, rearStoreys: rs,
    mainUsable: insetByLines(P, t).map(rot),
    rearUsable: rear ? insetByLines(rear, t).map(rot) : null,
  };
}

export type ShapeKind = 'terrace-L' | 'bay-front';
export const SHAPE_KINDS: ShapeKind[] = ['terrace-L', 'bay-front'];

/**
 * Non-rectangular single polygons: a terrace mapped with its outrigger as one L-shaped polygon, or a
 * semi/detached house with a canted front bay (front edge = the facade piece left of the bay).
 */
export function randomShape(seed: number, kind: ShapeKind): RandomPlan {
  const rnd = mulberry32(seed * 104729 + 7);
  const U = (a: number, b: number) => a + (b - a) * rnd();
  const t = rnd() < 0.1 ? 0 : U(0.2, 0.35);
  let ring: Vec2[], kinds: EdgeKind[], storeys: number, builtForm: BuiltForm;
  if (kind === 'terrace-L') {
    const W = U(4.5, 6.5), D = U(7.0, 9.5), ow = U(2.4, Math.min(3.5, W - 1.4)), rd = U(3.0, 6.5);
    const partyR = rnd() < 0.7;
    storeys = 2;
    builtForm = partyR ? 'mid-terrace' : 'end-terrace';
    if (rnd() < 0.5) {
      ring = [[0, 0], [W, 0], [W, D], [ow, D], [ow, D + rd], [0, D + rd]];
      kinds = ['eave', partyR ? 'party' : 'eave', 'eave', 'eave', 'eave', 'party'];
    } else {
      ring = [[0, 0], [W, 0], [W, D + rd], [W - ow, D + rd], [W - ow, D], [0, D]];
      kinds = ['eave', 'party', 'eave', 'eave', 'eave', partyR ? 'party' : 'eave'];
    }
  } else {
    const semi = rnd() < 0.5;
    const W = semi ? U(6.5, 9.0) : U(8.0, 12.0), D = U(7.0, 10.0);
    const bw = U(2.4, 3.0), p = U(0.6, 0.9), b0 = semi ? U(1.2, 2.0) : U(1.0, W - bw - 1.0);
    ring = [[0, 0], [b0, 0], [b0 + p, -p], [b0 + bw - p, -p], [b0 + bw, 0], [W, 0], [W, D], [0, D]];
    kinds = ['eave', 'eave', 'eave', 'eave', 'eave', semi ? 'party' : 'eave', 'eave', 'eave'];
    storeys = rnd() < 0.15 ? 1 : 2;
    builtForm = semi ? 'semi-detached' : 'detached';
  }
  const ff: number[] = [];
  const levels: { floorZ: number; ceilingZ: number }[] = [];
  let z = 0.15;
  for (let s = 0; s < storeys; s++) {
    const f = U(2.5, 3.0);
    levels.push({ floorZ: z, ceilingZ: z + f - 0.25 });
    if (s + 1 < storeys) ff.push(f);
    z += f;
  }
  const th = U(0, 2 * Math.PI), tx = U(-30, 30), ty = U(-30, 30);
  const rot = (q: Vec2): Vec2 => [tx + q[0] * Math.cos(th) - q[1] * Math.sin(th), ty + q[0] * Math.sin(th) + q[1] * Math.cos(th)];
  return {
    kind: 'detached',
    input: {
      partId: 'main', footprint: { outer: ring.map(rot) }, edgeKinds: kinds, frontEdge: 0, storeys, levels,
      wallThickness: t, era: 'unknown', builtForm, role: 'main',
    },
    mainUsable: insetByLines(ring, t).map(rot),
    rearUsable: null,
    rearStoreys: 0,
    ff,
  };
}

// ------------------------------------------------------------------------------------------------
// validity checks
// ------------------------------------------------------------------------------------------------

const finite = (v: number[]) => v.every(Number.isFinite);
const isCirc = (r: RoomInfo) => r.label === 'hall' || r.label === 'landing';

/** Room of `rooms` containing point q (strictly inside), or -1. */
const roomAt = (q: Vec2, rooms: RoomInfo[]) => rooms.findIndex((r) => pointInPoly(q, r.polygon));

/** Validity issues of a layout (empty = valid). `tilingTol` is relative. */
export function checkPlan(plan: RandomPlan, L: InteriorLayout, tilingTol = 1e-6): string[] {
  const issues: string[] = [];
  const { input } = plan;
  const ids = new Set<string>();
  for (const r of L.rooms) {
    if (ids.has(r.id)) issues.push(`duplicate id ${r.id}`);
    ids.add(r.id);
    if (!finite(r.polygon.flat()) || !Number.isFinite(r.area)) issues.push(`non-finite room ${r.id}`);
    const a = signedArea(r.polygon);
    if (!(a > 0)) issues.push(`room ${r.id} not CCW (${a})`);
    if (Math.abs(a - r.area) > 1e-9 * Math.max(1, a)) issues.push(`room ${r.id} area mismatch`);
    if (!r.label || r.estimated !== true) issues.push(`room ${r.id} label/estimated`);
    const lv = input.levels[r.storey];
    if (!lv || r.floorZ !== lv.floorZ || r.ceilingZ !== lv.ceilingZ) issues.push(`room ${r.id} levels`);
    if (!widthAtLeast(r.polygon, 0.9)) issues.push(`room ${r.id} (${r.label}) narrower than 0.9 m`);
    if (/^bedroom \d+$/.test(r.label) && (r.area < 7.5 - 1e-9 || !widthAtLeast(r.polygon, 2.15)))
      issues.push(`room ${r.id} is a 'bedroom' below NDSS (${r.area.toFixed(2)} m2)`);
  }
  const beds = L.rooms.filter((r) => /^bedroom \d+$/.test(r.label)).map((r) => Number(r.label.slice(8))).sort((a, b) => a - b);
  if (beds.some((b, i) => b !== i + 1)) issues.push(`bedroom numbering ${beds.join(',')}`);
  for (let s = 0; s < input.storeys; s++) {
    const rooms = L.rooms.filter((r) => r.storey === s);
    const usable = [plan.mainUsable, ...(plan.rearUsable && s < plan.rearStoreys ? [plan.rearUsable] : [])];
    const uA = usable.reduce((t, p) => t + signedArea(p), 0);
    const sum = rooms.reduce((t, r) => t + r.area, 0);
    const uni = unionArea(rooms.map((r) => r.polygon));
    const outside = unionArea([...usable, ...rooms.map((r) => r.polygon)]) - unionArea(usable);
    if (Math.abs(sum - uA) > tilingTol * uA) issues.push(`S${s}: room area ${sum.toFixed(6)} vs usable ${uA.toFixed(6)}`);
    if (sum - uni > 1e-6) issues.push(`S${s}: overlap ${(sum - uni).toExponential(2)} m2`);
    if (outside > 1e-6) issues.push(`S${s}: ${outside.toExponential(2)} m2 of rooms outside the usable area`);
    // walls: inside the plan, between two different rooms, no duplicates; doors on the wall
    const walls = L.walls.filter((w) => w.storey === s);
    const edges: [number, number][] = [];
    walls.forEach((w, wi) => {
      if (!finite([...w.a, ...w.b, w.thickness])) issues.push(`S${s}: non-finite wall`);
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const d: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len], n: Vec2 = [-d[1], d[0]];
      const side = (at: number, o: number): Vec2 => [w.a[0] + d[0] * at + n[0] * o, w.a[1] + d[1] * at + n[1] * o];
      const off = w.thickness / 2 + 0.02;
      const i = roomAt(side(len / 2, off), rooms), j = roomAt(side(len / 2, -off), rooms);
      if (i < 0 || j < 0 || i === j) issues.push(`S${s}: wall ${wi} is not between two rooms`);
      for (const dr of w.doors) {
        if (dr.at - dr.width / 2 < -1e-9 || dr.at + dr.width / 2 > len + 1e-9 || dr.height !== 2) issues.push(`S${s}: door outside wall ${wi}`);
        const p = roomAt(side(dr.at, off + 0.03), rooms), q = roomAt(side(dr.at, -off - 0.03), rooms);
        if (p < 0 || q < 0 || p === q) issues.push(`S${s}: door on wall ${wi} does not connect two rooms`);
        else edges.push([p, q]);
      }
      for (let k = wi + 1; k < walls.length; k++) {
        const o = walls[k];
        const c1 = (o.a[0] - w.a[0]) * n[0] + (o.a[1] - w.a[1]) * n[1], c2 = (o.b[0] - w.a[0]) * n[0] + (o.b[1] - w.a[1]) * n[1];
        if (Math.abs(c1) > 1e-6 || Math.abs(c2) > 1e-6) continue;
        const u1 = (o.a[0] - w.a[0]) * d[0] + (o.a[1] - w.a[1]) * d[1], u2 = (o.b[0] - w.a[0]) * d[0] + (o.b[1] - w.a[1]) * d[1];
        if (Math.min(len, Math.max(u1, u2)) - Math.max(0, Math.min(u1, u2)) > 1e-6) issues.push(`S${s}: walls ${wi}/${k} overlap`);
      }
    });
    // every room reachable from the circulation through doors
    const reach = rooms.map(isCirc);
    if (!reach.some(Boolean) && rooms.length) reach[0] = true;
    for (let changed = true; changed;) {
      changed = false;
      for (const [p, q] of edges)
        if (reach[p] !== reach[q]) { reach[p] = reach[q] = true; changed = true; }
    }
    rooms.forEach((r, i) => { if (!reach[i]) issues.push(`S${s}: ${r.label} has no door path to the circulation`); });
    if (input.storeys > 1 && s === 1 && !rooms.some((r) => r.label === 'bathroom')) issues.push('S1: no bathroom');
    if (input.storeys === 1 && !rooms.some((r) => r.label === 'bathroom')) issues.push('bungalow without bathroom');
  }
  // stairs: one flight per transition, identical position, inside the main block, Approved Document K
  if (L.stairs.length !== input.storeys - 1) issues.push(`${L.stairs.length} flights for ${input.storeys} storeys`);
  L.stairs.forEach((f, i) => {
    if (f.storey !== i) issues.push(`flight ${i} storey ${f.storey}`);
    if (!finite([...f.start, ...f.direction, ...f.polygon.flat(), f.width, f.going, f.riserHeight])) issues.push('non-finite stair');
    const f0 = L.stairs[0];
    if (Math.hypot(f.start[0] - f0.start[0], f.start[1] - f0.start[1]) > 1e-9 || Math.hypot(f.direction[0] - f0.direction[0], f.direction[1] - f0.direction[1]) > 1e-9 || f.width !== f0.width)
      issues.push(`flight ${i} not stacked on flight 0`);
    if (f.riserHeight > 0.22 + 1e-12 || f.going < 0.22 || Math.atan(f.riserHeight / f.going) > 42 * deg) issues.push(`flight ${i} breaks Approved Document K`);
    if (Math.abs(f.risers * f.riserHeight - plan.ff[i]) > 1e-9) issues.push(`flight ${i} rises ${f.risers * f.riserHeight} for ff ${plan.ff[i]}`);
    if (!(signedArea(f.polygon) > 0)) issues.push(`flight ${i} polygon not CCW`);
    for (const v of f.polygon)
      if (!pointInPoly(v, plan.mainUsable) && distToBoundary(v, plan.mainUsable) > 1e-6) issues.push(`flight ${i} leaves the main block`);
    const circ = L.rooms.filter((r) => r.storey === i && isCirc(r));
    const inner: Vec2 = [f.start[0] + f.direction[0] * 0.05, f.start[1] + f.direction[1] * 0.05];
    if (!circ.some((r) => pointInPoly(inner, r.polygon))) issues.push(`flight ${i} does not start in the hall/landing`);
  });
  return issues;
}
