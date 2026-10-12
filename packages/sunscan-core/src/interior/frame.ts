// Plan frame of a house: x along the street-facing (front) wall, y = depth from the front wall into the house.
// The frame is a rotation of local ENU (right-handed), so CCW plan polygons stay CCW in ENU.
import type { EdgeKind } from '../geometry/roof.js';
import type { Ring, Vec2 } from '../geometry/geom.js';
import { INTERIOR_RULES as RULES } from './constants.js';

/** Rotation + origin mapping plan coordinates (metres) to local ENU. */
export interface PlanFrame {
  /** Local ENU point of plan (0, 0) (start vertex of the front edge). */
  origin: Vec2;
  /** ENU unit vector of plan +x (along the front wall, left to right seen from the street). */
  ux: Vec2;
  /** ENU unit vector of plan +y (into the house) = ux rotated +90 deg. */
  uy: Vec2;
}

/** Local ENU -> plan coordinates. */
export function toPlan(f: PlanFrame, p: Vec2): Vec2 {
  const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1];
  return [dx * f.ux[0] + dy * f.ux[1], dx * f.uy[0] + dy * f.uy[1]];
}

/** Plan coordinates -> local ENU. */
export function toWorld(f: PlanFrame, q: Vec2): Vec2 {
  return [f.origin[0] + q[0] * f.ux[0] + q[1] * f.uy[0], f.origin[1] + q[0] * f.ux[1] + q[1] * f.uy[1]];
}

/** Rotates plan coordinates by k quarter turns counter-clockwise (k taken mod 4). Exact for axis-aligned data. */
export function quarterTurn(q: Vec2, k: number): Vec2 {
  switch (((k % 4) + 4) % 4) {
    case 1: return [-q[1], q[0]];
    case 2: return [-q[0], -q[1]];
    case 3: return [q[1], -q[0]];
    default: return [q[0], q[1]];
  }
}

const edgeLen = (r: Ring, i: number) => {
  const a = r[i], b = r[(i + 1) % r.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};

/**
 * Street-facing edge of the outer ring: `front` when it is a valid outer-edge index, else the longest
 * non-party edge (else the longest edge). When the ring has party walls, only non-party edges within
 * 45 deg of perpendicular to them compete (a terrace or semi faces the street across its party walls,
 * so an end-terrace's long gable wall is never taken for the front).
 */
export function chooseFrontEdge(outer: Ring, kinds: readonly EdgeKind[], front?: number): number {
  const n = outer.length;
  if (front !== undefined && Number.isInteger(front) && front >= 0 && front < n && edgeLen(outer, front) > 0.01) return front;
  const dir = (i: number) => {
    const a = outer[i], b = outer[(i + 1) % n];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  let px = 0, py = 0;
  for (let i = 0; i < n; i++)
    if (kinds[i] === 'party') {
      px += edgeLen(outer, i) * Math.cos(2 * dir(i));
      py += edgeLen(outer, i) * Math.sin(2 * dir(i));
    }
  const thP = Math.hypot(px, py) > 1e-9 ? Math.atan2(py, px) / 2 : null;
  const pick = (perpendicularOnly: boolean) => {
    let best = -1, bestLen = 0;
    for (let i = 0; i < n; i++) {
      const L = edgeLen(outer, i);
      if (kinds[i] === 'party' || L <= bestLen) continue;
      if (perpendicularOnly && thP !== null && Math.abs(Math.sin(dir(i) - thP)) < Math.SQRT1_2) continue;
      best = i;
      bestLen = L;
    }
    return best;
  };
  let best = pick(true);
  if (best < 0) best = pick(false);
  if (best >= 0) return best;
  let any = 0;
  for (let i = 1; i < n; i++) if (edgeLen(outer, i) > edgeLen(outer, any)) any = i;
  return any;
}

/**
 * Plan frame whose x-axis runs along the front edge (origin at its start vertex, y into the house).
 * If the front edge deviates from the footprint's dominant orientation (length-weighted mean of edge
 * directions mod 90 deg) by more than RULES.frontSnapDeg, the nearest dominant axis is used instead.
 */
export function makePlanFrame(outer: Ring, frontEdge: number): PlanFrame {
  const n = outer.length;
  const a = outer[frontEdge], b = outer[(frontEdge + 1) % n];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const p = outer[i], q = outer[(i + 1) % n];
    const th = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const w = Math.hypot(q[0] - p[0], q[1] - p[1]);
    sx += w * Math.cos(4 * th);
    sy += w * Math.sin(4 * th);
  }
  let ux = d;
  if (Math.hypot(sx, sy) > 1e-9 * L) {
    const thD = Math.atan2(sy, sx) / 4;
    const thF = Math.atan2(d[1], d[0]);
    let dev = thF - thD;
    dev -= Math.round(dev / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(dev) > (RULES.frontSnapDeg * Math.PI) / 180) ux = [Math.cos(thF - dev), Math.sin(thF - dev)];
  }
  return { origin: [a[0], a[1]], ux, uy: [-ux[1], ux[0]] };
}

/** Which sides of the plan carry party walls (length >= 1 m of 'party' edges facing that way). */
export interface PartySides { left: boolean; right: boolean; front: boolean; back: boolean }

/** Party-wall sides of an outer ring given in plan coordinates (CCW, edge i joins vertex i -> i+1). */
export function partySides(outerPlan: Ring, kinds: readonly EdgeKind[]): PartySides {
  const acc = { left: 0, right: 0, front: 0, back: 0 };
  const n = outerPlan.length;
  for (let i = 0; i < n; i++) {
    if (kinds[i] !== 'party') continue;
    const p = outerPlan[i], q = outerPlan[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const nx = dy / L, ny = -dx / L; // outward normal of a CCW ring
    if (nx < -0.7) acc.left += L;
    else if (nx > 0.7) acc.right += L;
    else if (ny < -0.7) acc.front += L;
    else if (ny > 0.7) acc.back += L;
  }
  return { left: acc.left >= 1, right: acc.right >= 1, front: acc.front >= 1, back: acc.back >= 1 };
}
