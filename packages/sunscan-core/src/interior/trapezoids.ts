// Exact slab ("trapezoid") decomposition of a polygon set, cut by vertical lines at given x and horizontal
// levels at given y. Every piece is a trapezoid with horizontal bottom/top and straight sides that never
// cross a cut inside its slab, so a piece lies entirely inside or outside any axis-aligned rectangle whose
// sides are among the cuts. Rooms are unions of pieces; walls are shared piece boundaries.
import type { Ring, Vec2 } from '../geometry/geom.js';
import { simplifyRing } from './polygon.js';

/** Geometric tolerance (m) of the decomposition. */
export const TOL = 1e-7;

/** Trapezoidal piece: bottom y = yb, top y = yt, left side (xlb -> xlt), right side (xrb -> xrt). */
export interface Piece {
  slab: number;
  yb: number;
  yt: number;
  xlb: number;
  xlt: number;
  xrb: number;
  xrt: number;
  /** Piece across a vertical cut on the left/right in the same slab (-1: the side is the region boundary). */
  left: number;
  right: number;
}

/** Pieces grouped by slab; `levels[k]`..`levels[k + 1]` bound slab k; slab lists are sorted left to right. */
export interface Decomposition {
  levels: number[];
  pieces: Piece[];
  slabs: number[][];
}

/** Boundary segment p -> q (vertical cut or horizontal level) shared by pieces a and b. */
export interface Contact {
  a: number;
  b: number;
  p: Vec2;
  q: Vec2;
  len: number;
  vertical: boolean;
}

interface Edge { xa: number; ya: number; xb: number; yb: number } // ya < yb

const xAt = (e: Edge, y: number): number =>
  y === e.ya ? e.xa : y === e.yb ? e.xb : e.xa + ((y - e.ya) * (e.xb - e.xa)) / (e.yb - e.ya);

/** Sorted levels: all base values plus the extras that are not within TOL of a kept level. */
function mergeLevels(base: number[], extra: number[]): number[] {
  const b = [...new Set(base)].sort((x, y) => x - y);
  if (!b.length) return [];
  const lo = b[0], hi = b[b.length - 1];
  const ex = extra.filter((v) => Number.isFinite(v) && v > lo + TOL && v < hi - TOL).sort((x, y) => x - y);
  const out: number[] = [];
  let i = 0;
  for (const v of ex) {
    while (i < b.length && b[i] <= v) out.push(b[i++]);
    if (out.length && v - out[out.length - 1] < TOL) continue;
    if (i < b.length && b[i] - v < TOL) continue;
    out.push(v);
  }
  while (i < b.length) out.push(b[i++]);
  return out;
}

/**
 * Decomposes the region bounded by `rings` (even-odd rule; outer rings and holes, any orientation) into
 * trapezoids between consecutive levels (all vertex y, `ycuts`, and the y where an edge crosses an x-cut),
 * each split at the `xcuts` that pass through its interior.
 */
export function decompose(rings: Ring[], xcuts: number[], ycuts: number[] = []): Decomposition {
  const edges: Edge[] = [];
  const base: number[] = [];
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      base.push(a[1]);
      if (a[1] !== b[1]) edges.push(a[1] < b[1] ? { xa: a[0], ya: a[1], xb: b[0], yb: b[1] } : { xa: b[0], ya: b[1], xb: a[0], yb: a[1] });
    }
  const cuts = [...new Set(xcuts.filter(Number.isFinite))].sort((a, b) => a - b);
  const extra = [...ycuts];
  for (const e of edges) {
    if (e.xa === e.xb) continue;
    const lo = Math.min(e.xa, e.xb), hi = Math.max(e.xa, e.xb);
    for (const c of cuts) if (c > lo + TOL && c < hi - TOL) extra.push(e.ya + ((c - e.xa) * (e.yb - e.ya)) / (e.xb - e.xa));
  }
  const levels = mergeLevels(base, extra);
  const pieces: Piece[] = [];
  const slabs: number[][] = [];
  for (let k = 0; k + 1 < levels.length; k++) {
    const y0 = levels[k], y1 = levels[k + 1];
    const act: [number, number][] = [];
    for (const e of edges) if (e.ya <= y0 && e.yb >= y1) act.push([xAt(e, y0), xAt(e, y1)]);
    act.sort((p, q) => p[0] + p[1] - (q[0] + q[1]) || p[0] - q[0] || p[1] - q[1]);
    const ids: number[] = [];
    for (let m = 0; m + 1 < act.length; m += 2) {
      const [lb, lt] = act[m], [rb, rt] = act[m + 1];
      // no side crosses a cut inside the slab (crossing levels), so a cut right of the left side's
      // leftmost end and left of the right side's rightmost end lies inside (it may touch a side at a level)
      const lo = Math.min(lb, lt) + TOL, hi = Math.max(rb, rt) - TOL;
      let xb = lb, xt = lt, prev = -1;
      const emit = (nb: number, nt: number, cut: boolean) => {
        const id = pieces.length;
        pieces.push({ slab: k, yb: y0, yt: y1, xlb: xb, xlt: xt, xrb: nb, xrt: nt, left: prev, right: -1 });
        if (prev >= 0) pieces[prev].right = id;
        ids.push(id);
        prev = cut ? id : -1;
        xb = nb;
        xt = nt;
      };
      for (const c of cuts) if (c > lo && c < hi) emit(c, c, true);
      emit(rb, rt, false);
    }
    slabs.push(ids);
  }
  return { levels, pieces, slabs };
}

/** All shared boundary segments between pieces (vertical cuts within a slab, overlaps across levels). */
export function contacts(d: Decomposition): Contact[] {
  const out: Contact[] = [];
  d.pieces.forEach((P, id) => {
    if (P.right >= 0) out.push({ a: id, b: P.right, p: [P.xrb, P.yb], q: [P.xrt, P.yt], len: P.yt - P.yb, vertical: true });
  });
  for (let k = 1; k < d.slabs.length; k++) {
    const lower = d.slabs[k - 1], upper = d.slabs[k], y = d.levels[k];
    let i = 0, j = 0;
    while (i < lower.length && j < upper.length) {
      const A = d.pieces[lower[i]], B = d.pieces[upper[j]];
      const lo = Math.max(A.xlt, B.xlb), hi = Math.min(A.xrt, B.xrb);
      if (hi - lo > TOL) out.push({ a: lower[i], b: upper[j], p: [lo, y], q: [hi, y], len: hi - lo, vertical: false });
      if (A.xrt < B.xrb) i++;
      else j++;
    }
  }
  return out;
}

/** Area of a piece. */
export const pieceArea = (P: Piece): number => ((P.xrb - P.xlb + (P.xrt - P.xlt)) * (P.yt - P.yb)) / 2;

/** Representative interior point of a piece. */
export const pieceMid = (P: Piece): Vec2 => [(P.xlb + P.xlt + P.xrb + P.xrt) / 4, (P.yb + P.yt) / 2];

type Iv = [number, number];

function sortedIntervals(iv: Iv[]): Iv[] {
  return iv.filter(([a, b]) => b - a > TOL).sort((p, q) => p[0] - q[0]);
}

/** A \ B for sorted lists of disjoint intervals; pieces shorter than TOL are dropped. */
function subtract(A: Iv[], B: Iv[]): Iv[] {
  const out: Iv[] = [];
  for (const [a0, a1] of A) {
    let cur = a0;
    for (const [b0, b1] of B) {
      if (b1 <= cur || b0 >= a1) continue;
      if (b0 - cur > TOL) out.push([cur, b0]);
      cur = Math.max(cur, b1);
    }
    if (a1 - cur > TOL) out.push([cur, a1]);
  }
  return out;
}

const near = (p: Vec2, q: Vec2) => Math.abs(p[0] - q[0]) <= 1e-6 && Math.abs(p[1] - q[1]) <= 1e-6;

/** Chains directed boundary edges into closed rings, taking the leftmost turn at shared vertices. */
function chainEdges(edges: [Vec2, Vec2][]): Ring[] {
  const n = edges.length;
  const used = new Uint8Array(n);
  const rings: Ring[] = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    const ring: Vec2[] = [];
    let cur = s;
    for (let guard = 0; guard <= n; guard++) {
      used[cur] = 1;
      ring.push(edges[cur][0]);
      const [a, b] = edges[cur];
      let best = -1, bestAng = -Infinity;
      for (let i = 0; i < n; i++) {
        if ((used[i] && i !== s) || !near(edges[i][0], b)) continue;
        const c = edges[i][1];
        const dx1 = b[0] - a[0], dy1 = b[1] - a[1], dx2 = c[0] - b[0], dy2 = c[1] - b[1];
        let ang = Math.atan2(dx1 * dy2 - dy1 * dx2, dx1 * dx2 + dy1 * dy2);
        if (ang >= Math.PI - 1e-12) ang = -Math.PI; // a U-turn is the last resort
        if (ang > bestAng) { bestAng = ang; best = i; }
      }
      if (best < 0 || best === s) break;
      cur = best;
    }
    const r = simplifyRing(ring);
    if (r.length >= 3) rings.push(r);
  }
  return rings;
}

/**
 * Boundary rings of the union of the pieces owned by `room` (CCW outer rings, CW holes). Internal piece
 * boundaries cancel exactly because neighbouring pieces share their coordinates.
 */
export function outlineRings(d: Decomposition, owner: ArrayLike<number>, room: number): Ring[] {
  const mine = (id: number) => id >= 0 && owner[id] === room;
  const edges: [Vec2, Vec2][] = [];
  const rows: number[][] = d.slabs.map((ids) => ids.filter(mine));
  for (const ids of rows)
    for (const id of ids) {
      const P = d.pieces[id];
      if (!mine(P.right)) edges.push([[P.xrb, P.yb], [P.xrt, P.yt]]);
      if (!mine(P.left)) edges.push([[P.xlt, P.yt], [P.xlb, P.yb]]);
    }
  for (let k = 0; k < d.levels.length; k++) {
    const y = d.levels[k];
    const tops = k > 0 ? sortedIntervals(rows[k - 1].map((id): Iv => [d.pieces[id].xlt, d.pieces[id].xrt])) : [];
    const bots = k < rows.length ? sortedIntervals(rows[k].map((id): Iv => [d.pieces[id].xlb, d.pieces[id].xrb])) : [];
    if (!tops.length && !bots.length) continue;
    for (const [lo, hi] of subtract(tops, bots)) edges.push([[hi, y], [lo, y]]);
    for (const [lo, hi] of subtract(bots, tops)) edges.push([[lo, y], [hi, y]]);
  }
  return chainEdges(edges);
}

/** Connected components (by shared boundary length > TOL) of the pieces accepted by `include`. */
export function components(d: Decomposition, adj: number[][], cs: Contact[], include: (id: number) => boolean): number[][] {
  const seen = new Uint8Array(d.pieces.length);
  const comps: number[][] = [];
  for (let s = 0; s < d.pieces.length; s++) {
    if (seen[s] || !include(s)) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const ci of adj[id]) {
        const c = cs[ci];
        const o = c.a === id ? c.b : c.a;
        if (!seen[o] && include(o)) { seen[o] = 1; stack.push(o); }
      }
    }
    comps.push(comp.sort((a, b) => a - b));
  }
  return comps;
}
