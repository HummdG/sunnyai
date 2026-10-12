// Shared-wall (party wall) geometry between footprints in local metres (research 01 §3.5).
// A piece of target edge a->b is shared with a neighbour edge c->d when the edges are parallel within `angleTolDeg`,
// their projections overlap by >= `minOverlap` and the neighbour edge lies within `offsetTol` of the target edge line
// over the whole overlap. Handles shared OSM nodes (offset 0), separately digitised walls and walls split at
// different vertices (interval union). Ring orientation does not matter.
import type { Vec2 } from '../geometry/geom.js';

/** Tolerances of the shared-wall test. */
export interface PartyTolerance {
  /** Max perpendicular distance between the two walls over the overlap, metres (default 0.3). */
  offsetTol: number;
  /** Max angle between the two walls, degrees (default 10). */
  angleTolDeg: number;
  /** Min overlap length of one shared piece, metres (default 0.5). */
  minOverlap: number;
}

/** Defaults from the spec (§5.3): parallel <= 10 deg, offset <= 0.3 m, overlap >= 0.5 m. */
export const DEFAULT_PARTY_TOLERANCE: PartyTolerance = { offsetTol: 0.3, angleTolDeg: 10, minOverlap: 0.5 };

/** One shared piece of a target edge. */
export interface SharedPiece {
  neighbour: string;
  /** Metres along the target edge from its start vertex. */
  t0: number;
  t1: number;
  length: number;
  /** Max perpendicular offset between the walls over the piece, metres. */
  maxOffset: number;
  /** 'opposite' for true shared walls of two consistently oriented rings. */
  orientation: 'opposite' | 'same';
}

/** Pieces of the target edge a->b that coincide with edges of `ring` (a neighbour ring in the same frame). */
export function sharedPiecesOnEdge(a: Vec2, b: Vec2, ring: Vec2[], neighbour: string, tol: PartyTolerance = DEFAULT_PARTY_TOLERANCE): SharedPiece[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return [];
  const ux = (b[0] - a[0]) / L;
  const uy = (b[1] - a[1]) / L;
  const cosTol = Math.cos((tol.angleTolDeg * Math.PI) / 180);
  const out: SharedPiece[] = [];
  for (let j = 0; j < ring.length; j++) {
    const c = ring[j];
    const d = ring[(j + 1) % ring.length];
    const Lf = Math.hypot(d[0] - c[0], d[1] - c[1]);
    if (Lf < 1e-6) continue;
    const dot = (ux * (d[0] - c[0]) + uy * (d[1] - c[1])) / Lf;
    if (Math.abs(dot) < cosTol) continue;
    const tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uy;
    const td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uy;
    const oc = (c[0] - a[0]) * -uy + (c[1] - a[1]) * ux;
    const od = (d[0] - a[0]) * -uy + (d[1] - a[1]) * ux;
    const lo = Math.max(0, Math.min(tc, td));
    const hi = Math.min(L, Math.max(tc, td));
    if (hi - lo < tol.minOverlap) continue;
    const offAt = (t: number) => (Math.abs(td - tc) < 1e-12 ? oc : oc + ((t - tc) / (td - tc)) * (od - oc));
    const maxOff = Math.max(Math.abs(offAt(lo)), Math.abs(offAt(hi)));
    if (maxOff > tol.offsetTol) continue;
    out.push({ neighbour, t0: lo, t1: hi, length: hi - lo, maxOffset: maxOff, orientation: dot < 0 ? 'opposite' : 'same' });
  }
  return out;
}

/** Union of 1-D intervals: total covered length and the merged, sorted intervals. */
export function unionIntervals(intervals: [number, number][]): { total: number; merged: [number, number][] } {
  const s = intervals.slice().sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const iv of s) {
    const last = merged[merged.length - 1];
    if (!last || iv[0] > last[1]) merged.push([iv[0], iv[1]]);
    else last[1] = Math.max(last[1], iv[1]);
  }
  return { total: merged.reduce((t, m) => t + (m[1] - m[0]), 0), merged };
}

/** Total shared wall length between ring A and ring B (summed over A's edges, union per edge). */
export function sharedLengthBetween(A: Vec2[], B: Vec2[], tol: PartyTolerance = DEFAULT_PARTY_TOLERANCE): number {
  let t = 0;
  for (let i = 0; i < A.length; i++) {
    const ps = sharedPiecesOnEdge(A[i], A[(i + 1) % A.length], B, 'b', tol);
    if (ps.length) t += unionIntervals(ps.map((p) => [p.t0, p.t1])).total;
  }
  return t;
}

/** Per-edge sharing summary. */
export interface EdgeSharing {
  length: number;
  shared: number;
  fraction: number;
  intervals: [number, number][];
  /** Neighbour id -> shared length on this edge. */
  byNeighbour: Map<string, number>;
}

/** Sharing of every edge of `rings` (outer first, then holes; edge i joins vertex i -> i+1) with the neighbours. */
export function edgeSharing(rings: Vec2[][], neighbours: { id: string; ring: Vec2[] }[], tol: PartyTolerance = DEFAULT_PARTY_TOLERANCE): EdgeSharing[] {
  const out: EdgeSharing[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const pieces: SharedPiece[] = [];
      for (const n of neighbours) pieces.push(...sharedPiecesOnEdge(a, b, n.ring, n.id, tol));
      const { total, merged } = unionIntervals(pieces.map((p) => [p.t0, p.t1]));
      const byNeighbour = new Map<string, number>();
      for (const id of new Set(pieces.map((p) => p.neighbour))) {
        byNeighbour.set(id, unionIntervals(pieces.filter((p) => p.neighbour === id).map((p) => [p.t0, p.t1])).total);
      }
      out.push({ length: L, shared: total, fraction: L > 0 ? Math.min(1, total / L) : 0, intervals: merged, byNeighbour });
    }
  }
  return out;
}
