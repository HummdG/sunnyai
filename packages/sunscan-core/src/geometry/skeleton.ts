// Weighted straight skeleton ("procedural extrusion lite") for polygons with holes.
//
// Every input edge moves inward (to its left) at a speed w >= 0 that may change at given times
// (piecewise-constant profile). With w = cot(pitch), skeleton TIME == roof HEIGHT above the eave, so the
// lifted skeleton is directly the roof surface:  w = 0 -> vertical face (gable / party wall), w > 0 -> pitched
// face. Changing w over time gives mansard / gambrel / half-hip / dutch-gable profiles; `capTime` closes the
// remaining wavefront with flat faces (flat-topped mansard, parapet insets, flat roofs).
//
// Algorithm: kinetic wavefront simulation with global event scheduling (O(n^2) per event, fine for n < 300):
//   repeat: find earliest event (edge collapse | reflex vertex hits an edge | profile change | cap)
//           advance all vertices; force-apply that event; then clean-up at the same instant:
//           R1 merge consecutive coincident vertices whose connecting edge is not growing (multi-way collapses)
//           R2 "zip" spikes (vertex between antiparallel coincident edges) into ridge arcs (zero-area slivers)
//   Collinear consecutive edges with different weights get a virtual vertical "riser" edge (w = 0).
// Output: nodes (x, y, t), arcs (trajectories, labelled with the faces on their left/right), faces as node loops.
//
// Robustness (docs/research/03-roof-geometry.md section 8):
//   * Parallel / antiparallel edge pairs are classified with a SCALE-RELATIVE angle tolerance (PAR_REL * epsRel):
//     two lines closer than that to parallel deviate by < PAR_REL * epsP over the whole footprint, i.e. they are
//     coincident within tolerance. Rotated and re-projected plans make every "parallel" wall pair parallel only to
//     1e-16 .. 1e-6 rad; an exact test let such pairs through to the general velocity solve, whose speed
//     2w / |nL + nR| reaches 1e7 .. 1e12 and turns 1-ulp time errors into metre-scale position errors.
//   * A wavefront cycle with two vertices bounds no area (both vertices lie on both of its lines): it is closed at
//     once as one ridge arc instead of being left to translate at that speed until the final cap ("runaway nodes").
//   * Every result is validated (finite nodes inside the footprint bbox, times within the eave-extent bound, faces
//     tiling the footprint, no warnings). An invalid result is recomputed in the polygon's dominant-axis frame with
//     near-axis walls snapped onto the axes (micro- then milli-metre), and transformed back; if no attempt validates,
//     a typed SkeletonError is thrown: never silent garbage.

import { type PolygonM, type Vec2, sub, add, mul, dot, cross, leftNormal, normalize, bboxDiag, orientPolygon, polygonArea } from './geom.js';

/** Angle tolerance of the parallel / antiparallel classification, relative to epsRel (100 * 1e-9 = 1e-7 rad). */
const PAR_REL = 100;
/** Snap tolerances (m) of the dominant-axis retries after a failed first attempt. */
export const SKELETON_RETRY_SNAPS = [1e-6, 1e-3];

export interface ProfileSeg { t0: number; w: number }

export interface SkEdge {
  id: number;
  ring: number; // ring index (0 = outer) or -1 for virtual risers
  index: number; // index within its ring, -1 for virtual
  a: Vec2; b: Vec2;
  d: Vec2; n: Vec2; c: number; // unit direction, inward unit normal, n . a
  profile: ProfileSeg[];
  virtual: boolean;
}
export interface SkNode { x: number; y: number; t: number }
export interface SkArc { u: number; v: number; left: string; right: string }
export interface SkFace {
  key: string; // `${edge}:${seg}` or `cap`
  edge: number; // -1 for cap
  seg: number;
  w: number; // speed in this segment (0 = vertical face); NaN for cap
  loops: number[][]; // node-index loops; outer CCW (in the face's 2D frame), holes CW
}
export interface SkeletonStats {
  events: number; collapses: number; splits: number; zips: number; risers: number; profileEvents: number; skippedRepeatSplits: number;
  /** Zero-area two-vertex wavefront cycles closed as one ridge arc. */
  slivers: number;
  /** Problems of the returned skeleton (empty for every validated result). */
  warnings: string[];
  /** Attempts used: 1 = the polygon as given; more = dominant-axis retries (see `snap`). */
  attempts: number;
  /** Snap tolerance (m) of the dominant-axis attempt that produced this skeleton; undefined = the input as given. */
  snap?: number;
  /** Non-fatal notes, e.g. why an earlier attempt was rejected. */
  notes: string[];
}
export interface Skeleton {
  edges: SkEdge[]; nodes: SkNode[]; arcs: SkArc[]; faces: SkFace[]; stats: SkeletonStats; maxTime: number;
  /** The polygon actually skeletonised (outer CCW, holes CW, caller's frame): the input, or its snapped version. */
  poly: PolygonM;
}

export interface SkeletonOptions {
  /** Speed (or piecewise profile) for edge `id` (global index: outer ring edges first, then each hole). */
  weights: (id: number, ring: number, index: number) => number | ProfileSeg[];
  /** Stop at this time and close the remaining wavefront with flat 'cap' faces. */
  capTime?: number;
  /** Relative epsilon (times bbox diagonal) for coincidence tests. Default 1e-9. */
  epsRel?: number;
  maxEvents?: number;
  /**
   * Validate the result (validateSkeleton) and, when invalid, retry in the dominant-axis frame with near-axis walls
   * snapped onto the axes (SKELETON_RETRY_SNAPS); throws SkeletonError when no attempt validates. Default true;
   * false returns the single raw attempt (for diagnostics).
   */
  validate?: boolean;
  /** Start directly with the dominant-axis attempt at this snap tolerance (m); larger retry snaps follow. */
  alignSnap?: number;
}

/** The engine could not produce a valid skeleton (or roof) for this input. Never returned silently. */
export class SkeletonError extends Error {
  override readonly name = 'SkeletonError';
  constructor(
    message: string,
    /** One entry per failed attempt / check. */
    readonly issues: string[],
    /** Number of attempts made. */
    readonly attempts: number,
    /** The last (invalid) skeleton, for diagnostics; its stats.warnings list the validation failures. */
    readonly skeleton?: Skeleton,
  ) {
    super(message);
  }
}

interface WV {
  id: number;
  eL: number; eR: number; // incoming / outgoing edge ids (interior on the left)
  node: number; // birth node
  p: Vec2; v: Vec2; // position at current time T, velocity
  segL: number; segR: number; // profile segment of eL / eR during this trajectory
  reflex: boolean; spike: boolean;
  alive: boolean;
}

type Ev =
  | { t: number; kind: 'collapse'; A: WV; B: WV }
  | { t: number; kind: 'split'; V: WV; A: WV; B: WV }
  | { t: number; kind: 'profile' }
  | { t: number; kind: 'cap' };

export const faceKey = (edge: number, seg: number) => `${edge}:${seg}`;

/**
 * Weighted straight skeleton of `input` (local metres; rings are re-oriented). The result is validated
 * ({@link validateSkeleton}); an invalid attempt is retried in the polygon's dominant-axis frame with near-axis walls
 * snapped onto the axes, and the skeleton is transformed back (then `stats.snap` / `stats.notes` say so and `poly` is
 * the snapped polygon).
 * @throws SkeletonError when no attempt yields a valid skeleton.
 */
export function computeSkeleton(input: PolygonM, opts: SkeletonOptions): Skeleton {
  const poly = orientPolygon(input);
  if (opts.validate === false) return skeletonOnce(poly, opts);
  const snaps: (number | undefined)[] = opts.alignSnap !== undefined
    ? [opts.alignSnap, ...SKELETON_RETRY_SNAPS.filter((s) => s > (opts.alignSnap as number))]
    : [undefined, ...SKELETON_RETRY_SNAPS];
  const issues: string[] = [];
  let last: Skeleton | undefined;
  for (let k = 0; k < snaps.length; k++) {
    const snap = snaps[k];
    const what = snap === undefined ? 'as given' : `dominant-axis frame, snap ${snap} m`;
    let sk: Skeleton;
    try {
      sk = snap === undefined ? skeletonOnce(poly, opts) : alignedSkeleton(poly, opts, snap);
    } catch (e) {
      issues.push(`attempt ${k + 1} (${what}): ${(e as Error).message}`);
      continue;
    }
    const bad = validateSkeleton(sk, sk.poly);
    sk.stats.attempts = k + 1;
    sk.stats.snap = snap;
    if (!bad.length) {
      sk.stats.notes.push(...issues);
      if (snap !== undefined) sk.stats.notes.push(`skeletonised in the dominant-axis frame (walls within ${snap} m of the axes snapped onto them)`);
      return sk;
    }
    issues.push(`attempt ${k + 1} (${what}): ${bad.join('; ')}`);
    last = sk;
  }
  if (last) last.stats.warnings.push(...issues);
  throw new SkeletonError(`weighted skeleton invalid after ${snaps.length} attempt(s): ${issues[issues.length - 1] ?? 'no result'}`, issues, snaps.length, last);
}

/** One raw skeleton computation of an oriented polygon (no validation, no retry). */
function skeletonOnce(poly: PolygonM, opts: SkeletonOptions): Skeleton {
  const S = Math.max(bboxDiag(poly), 1e-9);
  const epsP = (opts.epsRel ?? 1e-9) * S; // position coincidence
  const epsT = epsP; // time coincidence (speeds are O(1))
  // edge pairs closer than tauPar to (anti)parallel are coincident within PAR_REL * epsP over the footprint
  const tauPar = PAR_REL * (opts.epsRel ?? 1e-9);
  const rings = [poly.outer, ...(poly.holes ?? [])];

  // ---------- edges ----------
  const E: SkEdge[] = [];
  rings.forEach((r, ri) =>
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length];
      const d = normalize(sub(b, a));
      const n = leftNormal(d);
      const id = E.length;
      const wv = opts.weights(id, ri, i);
      const profile = (typeof wv === 'number' ? [{ t0: 0, w: wv }] : [...wv].sort((x, y) => x.t0 - y.t0)).map((s) => ({ ...s }));
      if (profile[0].t0 !== 0) profile.unshift({ t0: 0, w: 0 });
      for (const s of profile) if (!(s.w >= 0) || !Number.isFinite(s.w)) throw new Error(`edge ${id}: weight must be finite and >= 0`);
      E.push({ id, ring: ri, index: i, a, b, d, n, c: dot(n, a), profile, virtual: false });
    }),
  );
  // Current profile segment per edge: explicit state advanced ONLY by profile events, so that events at the very
  // instant of a breakpoint (processed before it) still see the old speed / face label.
  const curSeg: number[] = [];
  const segAt = (e: SkEdge, _t: number) => curSeg[e.id] ?? 0;
  const wAt = (e: SkEdge, t: number) => e.profile[segAt(e, t)].w;
  const offAt = (e: SkEdge, t: number) => {
    let off = 0;
    for (let k = 0; k < e.profile.length; k++) {
      const t0 = e.profile[k].t0, t1 = k + 1 < e.profile.length ? e.profile[k + 1].t0 : Infinity;
      if (t <= t0) break;
      off += e.profile[k].w * (Math.min(t, t1) - t0);
    }
    return off;
  };
  /** Signed distance of p in front of edge e's offset line at time t (>0 = on the unswept side). */
  const ahead = (e: SkEdge, p: Vec2, t: number) => dot(e.n, p) - e.c - offAt(e, t);

  // ---------- output ----------
  const nodes: SkNode[] = [];
  const arcs: SkArc[] = [];
  const stats: SkeletonStats = { events: 0, collapses: 0, splits: 0, zips: 0, risers: 0, profileEvents: 0, skippedRepeatSplits: 0, slivers: 0, warnings: [], attempts: 1, notes: [] };
  let T = 0;
  let pool: number[] = []; // nodes created at the current time T
  const getNode = (p: Vec2): number => {
    for (const id of pool) {
      const q = nodes[id];
      if (Math.abs(q.x - p[0]) <= 10 * epsP && Math.abs(q.y - p[1]) <= 10 * epsP && Math.abs(q.t - T) <= 10 * epsT) return id;
    }
    nodes.push({ x: p[0], y: p[1], t: T });
    pool.push(nodes.length - 1);
    return nodes.length - 1;
  };
  /** Least-squares intersection of the offset lines of `edges` at time T, regularised towards p0. */
  const refine = (p0: Vec2, edges: number[]): Vec2 => {
    const lam = 1e-6;
    let a11 = lam, a12 = 0, a22 = lam, b1 = lam * p0[0], b2 = lam * p0[1];
    for (const id of new Set(edges)) {
      const e = E[id];
      const rhs = e.c + offAt(e, T);
      a11 += e.n[0] * e.n[0]; a12 += e.n[0] * e.n[1]; a22 += e.n[1] * e.n[1];
      b1 += e.n[0] * rhs; b2 += e.n[1] * rhs;
    }
    const det = a11 * a22 - a12 * a12;
    const p: Vec2 = [(a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det];
    return Math.hypot(p[0] - p0[0], p[1] - p0[1]) < 1000 * epsP ? p : p0;
  };
  const fk = (e: number, seg: number) => faceKey(e, seg);
  const kill = (V: WV, node: number) => {
    if (!V.alive) return;
    V.alive = false;
    if (node !== V.node) arcs.push({ u: V.node, v: node, left: fk(V.eL, V.segL), right: fk(V.eR, V.segR) });
  };

  let wvId = 0;
  /** Create the wavefront vertex/vertices between eL and eR at node (inserting a riser if needed). */
  const makeVertices = (eL: number, eR: number, node: number): WV[] => {
    const p: Vec2 = [nodes[node].x, nodes[node].y];
    const L = E[eL], R = E[eR];
    const wL = wAt(L, T), wR = wAt(R, T);
    const det = cross(L.d, R.d);
    const dp = dot(L.d, R.d);
    const mk = (a: number, b: number, v: Vec2, spike = false): WV => ({
      id: wvId++, eL: a, eR: b, node, p: [...p] as Vec2, v,
      segL: segAt(E[a], T), segR: segAt(E[b], T),
      reflex: cross(E[a].d, E[b].d) < -1e-12, spike, alive: true,
    });
    // (anti)parallel within the scale-relative tolerance: both lines pass through the node, so they coincide to within
    // PAR_REL * epsP over the footprint and are treated as exactly (anti)parallel. The general solve would give the
    // vertex a speed ~ (wL + wR) / |det|, unusable below tauPar (1-ulp time errors become > 10 epsP position errors).
    const parallel = Math.abs(det) <= tauPar;
    // (nearly) antiparallel and coincident: a zero-area spike between two facing wavefronts, zipped in clean-up (R2)
    if (parallel && dp < 0) return [mk(eL, eR, [0, 0], true)];
    if (Math.abs(wL - wR) <= 1e-12 * Math.max(1, wL, wR)) {
      // equal speeds: v = w (nL + nR) / (1 + nL.nR) = 2 w s / |s|^2 with s = nL + nR (stable for nearly antiparallel
      // edges; |s| > tauPar here, so |v| < 2 w / tauPar)
      const sv = add(L.n, R.n);
      return [mk(eL, eR, mul(sv, (2 * wL) / dot(sv, sv)))];
    }
    if (parallel) {
      // collinear, different speeds: insert a vertical riser edge (w = 0) perpendicular to the edges
      const dr: Vec2 = wL > wR ? mul(L.n, -1) : [...L.n];
      const nr = leftNormal(dr);
      const r: SkEdge = { id: E.length, ring: -1, index: -1, a: [...p] as Vec2, b: [...p] as Vec2, d: dr, n: nr, c: dot(nr, p) - 0, profile: [{ t0: 0, w: 0 }], virtual: true };
      E.push(r);
      stats.risers++;
      // both vertices slide along the riser (velocity parallel to L.n), each exactly on its own edge's offset line
      return [mk(eL, r.id, mul(L.n, wL)), mk(r.id, eR, mul(L.n, wR / dot(R.n, L.n)))];
    }
    const v: Vec2 = [(R.n[1] * wL - L.n[1] * wR) / det, (-R.n[0] * wL + L.n[0] * wR) / det];
    return [mk(eL, eR, v)];
  };

  // ---------- initial wavefront ----------
  let cycles: WV[][] = [];
  let eBase = 0;
  for (const r of rings) {
    const n = r.length;
    const cyc: WV[] = [];
    for (let i = 0; i < n; i++) {
      const node = getNode(r[i]);
      cyc.push(...makeVertices(eBase + ((i - 1 + n) % n), eBase + i, node));
    }
    eBase += n;
    cycles.push(cyc);
  }
  const nInputEdges = eBase;
  const bottomNode: number[] = []; // node at the start of each input edge
  {
    let base = 0;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) bottomNode[base + i] = getNode(r[i]);
      base += r.length;
    }
  }

  // ping-pong guard: a split (V.eL, V.eR, f) applied once at an instant may not be re-applied at the same instant
  let appliedSplits = new Set<string>();
  let blockedSplits = new Set<string>();
  const splitKey = (V: WV, f: number) => `${V.eL}|${V.eR}|${f}`;

  // profile breakpoints
  const breaks = [...new Set(E.flatMap((e) => e.profile.slice(1).map((s) => s.t0)))].filter((t) => t > 0).sort((a, b) => a - b);
  let nextBreak = 0;

  // ---------- event scheduling ----------
  const findEvent = (): Ev | null => {
    let best: Ev | null = null;
    // at (numerically) equal times: collapses first, then splits, then profile changes, then the cap
    const prio = { collapse: 0, split: 1, profile: 2, cap: 3 } as const;
    const better = (ev: Ev, b: Ev | null) =>
      !b || ev.t < b.t - epsT || (ev.t <= b.t + epsT && (prio[ev.kind] < prio[b.kind] || (prio[ev.kind] === prio[b.kind] && ev.t < b.t)));
    const consider = (ev: Ev) => { if (better(ev, best)) best = ev; };
    if (nextBreak < breaks.length) consider({ t: breaks[nextBreak], kind: 'profile' });
    if (opts.capTime !== undefined) consider({ t: Math.max(T, opts.capTime), kind: 'cap' });
    for (const C of cycles) {
      const n = C.length;
      for (let i = 0; i < n; i++) {
        const A = C[i], B = C[(i + 1) % n];
        const e = E[A.eR];
        const Lc = dot(e.d, sub(B.p, A.p));
        const rate = dot(e.d, sub(B.v, A.v));
        if (rate < -1e-12) consider({ t: T + Math.max(0, Lc / -rate), kind: 'collapse', A, B });
      }
    }
    for (const C1 of cycles)
      for (const V of C1) {
        if (!V.reflex) continue;
        for (const C2 of cycles) {
          const m = C2.length;
          for (let j = 0; j < m; j++) {
            const A = C2[j], B = C2[(j + 1) % m];
            if (A === V || B === V) continue;
            const f = E[A.eR];
            const d0 = ahead(f, V.p, T);
            const closing = wAt(f, T) - dot(f.n, V.v);
            let dt: number;
            if (Math.abs(d0) <= 10 * epsP && Math.abs(closing) <= 1e-9) {
              // V travels along f's line: collision when it enters the segment [A, B]
              const s0 = dot(f.d, sub(V.p, A.p)), Lf = dot(f.d, sub(B.p, A.p));
              const vs = dot(f.d, sub(V.v, A.v)), vL = dot(f.d, sub(B.v, A.v));
              if (s0 < -epsP && vs > 1e-12) dt = -s0 / vs;
              else if (s0 > Lf + epsP && vs - vL < -1e-12) dt = (s0 - Lf) / (vL - vs);
              else continue;
            } else {
              if (closing <= 1e-12 || d0 < -10 * epsP) continue;
              dt = Math.max(0, d0 / closing);
            }
            const t = T + dt;
            const cur = best as Ev | null; // (assigned inside `consider`; TS cannot see that)
            if (cur && t > cur.t + epsT) continue;
            if (dt <= epsT && blockedSplits.has(splitKey(V, A.eR))) continue;
            const Vp = add(V.p, mul(V.v, dt)), Ap = add(A.p, mul(A.v, dt)), Bp = add(B.p, mul(B.v, dt));
            const s = dot(f.d, sub(Vp, Ap)), Lf = dot(f.d, sub(Bp, Ap));
            const off = Math.abs(ahead(f, Vp, t));
            if (s < -10 * epsP || s > Lf + 10 * epsP || off > 100 * epsP) continue;
            consider({ t, kind: 'split', V, A, B });
          }
        }
      }
    return best;
  };

  const advance = (t: number) => {
    const dt = t - T;
    if (dt > 0) for (const C of cycles) for (const V of C) { V.p[0] += V.v[0] * dt; V.p[1] += V.v[1] * dt; }
    if (t > T + epsT) { appliedSplits = new Set(); blockedSplits = new Set(); }
    if (t > T) { T = t; pool = pool.filter((id) => nodes[id].t >= T - 10 * epsT); } // keep near-simultaneous nodes
  };

  // ---------- topology operations ----------
  /** Cyclic range replacement: drop C[s..s+k-1] and put `nv` in their place (result starts with nv). */
  const replaceRange = (C: WV[], s: number, k: number, nv: WV[]): WV[] => {
    const n = C.length;
    const out = [...nv];
    for (let j = k; j < n; j++) out.push(C[(s + j) % n]);
    return out;
  };
  /** Kill the run C[i..i+k-1] at one (refined) node and return the replacement vertices. */
  const mergeRun = (C: WV[], i: number, k: number): WV[] => {
    const n = C.length;
    const run = Array.from({ length: k }, (_, j) => C[(i + j) % n]);
    const avg: Vec2 = mul(run.reduce((s, V) => add(s, V.p), [0, 0] as Vec2), 1 / k);
    const first = run[0], last = run[k - 1];
    const node = getNode(refine(avg, run.flatMap((V) => [V.eL, V.eR])));
    for (const V of run) kill(V, node);
    if (k >= n) return [];
    return makeVertices(first.eL, last.eR, node);
  };

  /** R1: merge consecutive coincident vertices whose connecting edge is not growing. Returns null if unchanged. */
  const r1 = (C: WV[]): WV[] | null => {
    const n = C.length;
    if (n < 2) return null;
    const join = C.map((A, i) => {
      const B = C[(i + 1) % n];
      if (Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]) > epsP * 10) return false;
      return dot(E[A.eR].d, sub(B.v, A.v)) <= 1e-9;
    });
    if (!join.some(Boolean)) return null;
    if (join.every(Boolean)) { mergeRun(C, 0, n); return []; }
    const start = (join.findIndex((j) => !j) + 1) % n;
    const out: WV[] = [];
    let i = start, done = 0;
    while (done < n) {
      let k = 1;
      while (k < n && join[(i + k - 1) % n]) k++;
      if (k === 1) out.push(C[i]);
      else out.push(...mergeRun(C, i, k));
      done += k;
      i = (i + k) % n;
    }
    return out;
  };

  /**
   * R2: zip the first spike (vertex between antiparallel coincident edges) into a ridge arc. Besides the vertices
   * classified as spikes at creation (|det| <= tauPar), a vertex between NEARLY antiparallel edges is zipped when the
   * two lines coincide (within 10 epsP, the merge radius) over the whole stretch to its nearer neighbour: there its
   * position along the lines (uncertain by ~epsP / |det|) and hence its direction of travel are noise, and the sliver
   * it bounds is finished within tolerance. Only closing configurations qualify: vertices born at events (T > 0) between facing
   * wavefronts, or convex input vertices (needles), never reflex input vertices (cracks).
   */
  const r2 = (C: WV[]): WV[] | null => {
    const n = C.length;
    for (let i = 0; i < n; i++) {
      const V = C[i];
      const Lr = E[V.eL], Rr = E[V.eR];
      if (!V.spike) {
        const det = cross(Lr.d, Rr.d);
        if (!(dot(Lr.d, Rr.d) < 0 && Math.abs(det) <= 1e-3 && (T > 0 || det > 0))) continue;
      }
      const P = C[(i - 1 + n) % n], N = C[(i + 1) % n];
      // the two (nearly) antiparallel lines must coincide along the zipped stretch: V lies on both, and so must the
      // consumed neighbour(s) (P on eL, N on eR) up to the tolerance; measured where it matters, not at the origin
      const a = Math.hypot(V.p[0] - P.p[0], V.p[1] - P.p[1]);
      const b = Math.hypot(N.p[0] - V.p[0], N.p[1] - V.p[1]);
      const sepP = Math.abs(ahead(Rr, P.p, T)), sepN = Math.abs(ahead(Lr, N.p, T));
      const sep = P === N || Math.abs(a - b) <= 10 * epsP ? Math.max(sepP, sepN) : a < b ? sepP : sepN;
      if (!V.spike && !(sep <= 10 * epsP)) continue; // a genuine thin wedge: its fast vertex is well resolved
      if (sep > 100 * epsP) stats.warnings.push(`non-coincident spike (sep ${sep.toExponential(2)}) at t=${T}`);
      stats.zips++;
      const vNode = getNode(V.p);
      const ridge = (to: number) => { if (vNode !== to) arcs.push({ u: vNode, v: to, left: fk(V.eL, V.segL), right: fk(V.eR, V.segR) }); };
      if (P === N) { // 2-cycle: the whole cycle is one ridge
        const pn = getNode(P.p);
        ridge(pn); kill(V, vNode); kill(P, pn);
        return [];
      }
      if (Math.abs(a - b) <= 10 * epsP) {
        const pn = getNode(refine(mul(add(P.p, N.p), 0.5), [P.eL, P.eR, N.eL, N.eR]));
        ridge(pn); kill(V, vNode); kill(P, pn); kill(N, pn);
        if (n === 3) return [];
        return replaceRange(C, (i - 1 + n) % n, 3, makeVertices(P.eL, N.eR, pn));
      }
      if (a < b) { // P is consumed: new vertex (P.eL, V.eR) at P
        const pn = getNode(refine(P.p, [P.eL, P.eR, V.eR]));
        ridge(pn); kill(V, vNode); kill(P, pn);
        return replaceRange(C, (i - 1 + n) % n, 2, makeVertices(P.eL, V.eR, pn));
      }
      const nn = getNode(refine(N.p, [N.eL, N.eR, V.eL])); // N is consumed: new vertex (V.eL, N.eR) at N
      ridge(nn); kill(V, vNode); kill(N, nn);
      return replaceRange(C, i, 2, makeVertices(V.eL, N.eR, nn));
    }
    return null;
  };

  /**
   * A two-vertex cycle [A = (e|f), B = (f|e)] bounds no area: both vertices lie on both lines, so either they coincide
   * or the lines do (a sliver between facing walls whose near end R1 already merged). Either way the wavefront there
   * is finished: one ridge arc A-B between faces e and f. Left alone, its vertices (equal velocities, nothing
   * shrinking) would translate until the final cap: the runaway nodes of nearly antiparallel walls.
   */
  const closeSliver = (C: WV[]) => {
    const [A, B] = C;
    const Le = E[A.eL], Re = E[A.eR];
    const sep = Math.max(Math.abs(ahead(Le, A.p, T)), Math.abs(ahead(Re, A.p, T)), Math.abs(ahead(Le, B.p, T)), Math.abs(ahead(Re, B.p, T)));
    if (sep > 100 * epsP) stats.warnings.push(`non-coincident two-vertex cycle (sep ${sep.toExponential(2)}) at t=${T}`);
    const na = getNode(A.p), nb = getNode(B.p);
    if (na !== nb) arcs.push({ u: na, v: nb, left: fk(A.eL, A.segL), right: fk(A.eR, A.segR) });
    kill(A, na); kill(B, nb);
    stats.slivers++;
  };

  const cleanup = () => {
    for (let guard = 0; guard < 100000; guard++) {
      let changed = false;
      const out: WV[][] = [];
      for (let C of cycles) {
        C = C.filter((V) => V.alive);
        const c1 = r1(C);
        if (c1) { C = c1; changed = true; }
        const c2 = r2(C);
        if (c2) { C = c2; changed = true; }
        if (C.length === 2) { closeSliver(C); C = []; changed = true; }
        if (C.length === 1) { kill(C[0], getNode(C[0].p)); C = []; changed = true; }
        if (C.length >= 1) out.push(C);
      }
      cycles = out;
      if (!changed) {
        // pass-through: a vertex sitting on a node created at this instant (e.g. the far endpoint of an edge hit by a
        // split exactly at that endpoint) must get a trajectory break there, else the node is a T-junction in a face.
        let broke = false;
        for (const C of cycles)
          for (let i = 0; i < C.length; i++) {
            const V = C[i];
            for (const id of pool) {
              if (id === V.node) continue;
              const q = nodes[id];
              if (Math.abs(q.x - V.p[0]) > 10 * epsP || Math.abs(q.y - V.p[1]) > 10 * epsP) continue;
              kill(V, id);
              const nv = makeVertices(V.eL, V.eR, id);
              C.splice(i, 1, ...nv);
              i += nv.length - 1;
              broke = true;
              break;
            }
          }
        if (!broke) return;
      }
    }
    throw new Error('cleanup did not converge');
  };

  const applySplit = (V: WV, A: WV, B: WV) => {
    const C1 = cycles.find((C) => C.includes(V));
    const C2 = cycles.find((C) => C.includes(A));
    if (!C1 || !C2 || !V.alive || !A.alive || !B.alive) return false;
    const j = C2.indexOf(A);
    if (C2[(j + 1) % C2.length] !== B) return false;
    const f = A.eR;
    const node = getNode(refine(V.p, [V.eL, V.eR, f]));
    kill(V, node);
    const V1s = makeVertices(V.eL, f, node);
    const V2s = makeVertices(f, V.eR, node);
    const i = C1.indexOf(V);
    if (C1 === C2) {
      const n = C1.length;
      const X: WV[] = [...V1s];
      for (let k = (j + 1) % n; k !== i; k = (k + 1) % n) X.push(C1[k]); // B .. P
      const Y: WV[] = [...V2s];
      for (let k = (i + 1) % n; k !== (j + 1) % n; k = (k + 1) % n) Y.push(C1[k]); // N .. A
      cycles = cycles.filter((C) => C !== C1);
      cycles.push(X, Y);
    } else {
      const n1 = C1.length, n2 = C2.length;
      const M: WV[] = [...V1s];
      for (let k = 0; k < n2; k++) M.push(C2[(j + 1 + k) % n2]); // B .. A (around C2)
      M.push(...V2s);
      for (let k = 1; k < n1; k++) M.push(C1[(i + k) % n1]); // N .. P
      cycles = cycles.filter((C) => C !== C1 && C !== C2);
      cycles.push(M);
    }
    stats.splits++;
    return true;
  };

  const applyProfile = () => {
    const tb = breaks[nextBreak++];
    stats.profileEvents++;
    const changed = new Set(E.filter((e) => e.profile.some((s) => s.t0 === tb)).map((e) => e.id));
    for (const id of changed) curSeg[id] = (curSeg[id] ?? 0) + 1;
    cycles = cycles.map((C) => {
      // recreate every vertex adjacent to a changed edge
      const born = new Map<WV, WV[]>();
      for (const V of C) {
        if (!changed.has(V.eL) && !changed.has(V.eR)) continue;
        const node = getNode(V.p);
        kill(V, node);
        born.set(V, makeVertices(V.eL, V.eR, node));
      }
      const out: WV[] = [];
      for (const V of C) out.push(...(born.get(V) ?? [V]));
      // horizontal arcs separating segment k and k+1 of each changed edge
      for (let i = 0; i < out.length; i++) {
        const A = out[i], B = out[(i + 1) % out.length];
        if (!changed.has(A.eR)) continue;
        const e = E[A.eR];
        const k = segAt(e, T);
        if (A.node !== B.node) arcs.push({ u: A.node, v: B.node, left: fk(e.id, k), right: fk(e.id, k - 1) });
      }
      return out;
    });
  };

  const applyCap = () => {
    for (const C of cycles) {
      for (const V of C) kill(V, getNode(V.p));
    }
    for (const C of cycles) {
      for (let i = 0; i < C.length; i++) {
        const A = C[i], B = C[(i + 1) % C.length];
        const ua = getNode(A.p), ub = getNode(B.p);
        if (ua !== ub) arcs.push({ u: ua, v: ub, left: 'cap', right: fk(A.eR, A.segR) });
      }
    }
    cycles = [];
  };

  // ---------- main loop ----------
  cleanup();
  const maxEvents = opts.maxEvents ?? 50 * (nInputEdges + 4) * (nInputEdges + 4);
  while (cycles.length) {
    if (stats.events++ > maxEvents) throw new Error('too many events');
    const ev = findEvent();
    const trace = (globalThis as any).__skTrace as ((m: string) => void) | undefined;
    if (trace && ev) trace(`ev#${stats.events} ${ev.kind} t=${ev.t.toFixed(12)} cycles=${cycles.map((c) => c.length).join(',')}` + (ev.kind === 'collapse' ? ` A(${ev.A.eL}|${ev.A.eR}) B(${ev.B.eL}|${ev.B.eR}) |AB|=${Math.hypot(ev.A.p[0] - ev.B.p[0], ev.A.p[1] - ev.B.p[1]).toExponential(2)}` : ev.kind === 'split' ? ` V(${ev.V.eL}|${ev.V.eR}) f=${ev.A.eR} V=(${ev.V.p.map((x) => x.toFixed(4))})` : ''));
    if (!ev) { applyCap(); break; } // remaining wavefront cannot move (all w = 0): flat cap
    advance(ev.t);
    if (ev.kind === 'cap') { applyCap(); break; }
    if (ev.kind === 'profile') applyProfile();
    else if (ev.kind === 'collapse') {
      const C = cycles.find((X) => X.includes(ev.A));
      if (C && ev.A.alive && ev.B.alive) {
        const i = C.indexOf(ev.A);
        if (C[(i + 1) % C.length] === ev.B) {
          // force exact coincidence, then let R1 merge (it also absorbs other simultaneous collapses)
          const m = mul(add(ev.A.p, ev.B.p), 0.5);
          ev.A.p = [...m] as Vec2; ev.B.p = [...m] as Vec2;
          stats.collapses++;
        }
      }
    } else if (ev.kind === 'split') {
      const key = splitKey(ev.V, ev.A.eR);
      if (appliedSplits.has(key)) { blockedSplits.add(key); stats.skippedRepeatSplits++; } // degenerate ping-pong: skip
      else { appliedSplits.add(key); applySplit(ev.V, ev.A, ev.B); }
    }
    cleanup();
  }

  // ---------- faces ----------
  const faces = assembleFaces(E, nodes, arcs, bottomNode, nInputEdges, rings, stats);
  return { edges: E, nodes, arcs, faces, stats, maxTime: T, poly };
}

/** Chain labelled half-arcs into face loops. */
function assembleFaces(E: SkEdge[], nodes: SkNode[], arcs: SkArc[], bottomNode: number[], nIn: number, rings: Vec2[][], stats: SkeletonStats): SkFace[] {
  const half = new Map<string, [number, number][]>();
  const push = (k: string, u: number, v: number) => {
    if (u === v) return;
    let l = half.get(k);
    if (!l) half.set(k, (l = []));
    l.push([u, v]);
  };
  // bottom edges of every input edge (segment 0)
  {
    let base = 0;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) push(faceKey(base + i, 0), bottomNode[base + i], bottomNode[base + ((i + 1) % r.length)]);
      base += r.length;
    }
  }
  for (const a of arcs) { push(a.left, a.u, a.v); push(a.right, a.v, a.u); }

  const faces: SkFace[] = [];
  for (const [key, hs] of half) {
    // cancel opposite pairs inside the same face (degenerate zero-area spurs)
    const cnt = new Map<string, number>();
    for (const [u, v] of hs) cnt.set(`${u},${v}`, (cnt.get(`${u},${v}`) ?? 0) + 1);
    const list: [number, number][] = [];
    for (const [u, v] of hs) {
      const k = `${u},${v}`, r = `${v},${u}`;
      if ((cnt.get(r) ?? 0) > 0 && (cnt.get(k) ?? 0) > 0) { cnt.set(r, cnt.get(r)! - 1); cnt.set(k, cnt.get(k)! - 1); continue; }
      if ((cnt.get(k) ?? 0) > 0) { list.push([u, v]); cnt.set(k, cnt.get(k)! - 1); }
    }
    const isCap = key === 'cap';
    const [eStr, sStr] = isCap ? ['-1', '0'] : key.split(':');
    const edge = Number(eStr), seg = Number(sStr);
    const e = edge >= 0 ? E[edge] : undefined;
    const w = e ? e.profile[seg].w : NaN;
    const vertical = !!e && w === 0;
    const P2 = (id: number): Vec2 => (vertical ? [dot(e!.d, [nodes[id].x, nodes[id].y]), nodes[id].t] : [nodes[id].x, nodes[id].y]);
    const out = new Map<number, number[]>();
    list.forEach(([u], i) => { let l = out.get(u); if (!l) out.set(u, (l = [])); l.push(i); });
    const used = new Array(list.length).fill(false);
    const loops: number[][] = [];
    for (let s = 0; s < list.length; s++) {
      if (used[s]) continue;
      const loop: number[] = [];
      let h = s;
      for (let guard = 0; guard < 100000; guard++) {
        used[h] = true;
        const [u, v] = list[h];
        loop.push(u);
        if (v === loop[0]) break; // closed
        const cands = (out.get(v) ?? []).filter((i) => !used[i]);
        if (cands.length === 0) { stats.warnings.push(`face ${key}: open chain at node ${v}`); break; }
        if (cands.length === 1) { h = cands[0]; continue; }
        // several continuations (face touches itself at v): take the tightest turn (largest CCW angle from back-direction)
        const pu = P2(u), pv = P2(v);
        const back = Math.atan2(pu[1] - pv[1], pu[0] - pv[0]);
        let bestI = cands[0], bestA = -Infinity;
        for (const i of cands) {
          const pw = P2(list[i][1]);
          let ang = Math.atan2(pw[1] - pv[1], pw[0] - pv[0]) - back;
          while (ang <= 0) ang += 2 * Math.PI;
          while (ang > 2 * Math.PI) ang -= 2 * Math.PI;
          if (ang > bestA) { bestA = ang; bestI = i; }
        }
        h = bestI;
      }
      if (new Set(loop).size >= 3) loops.push(loop);
    }
    if (loops.length) faces.push({ key, edge, seg, w, loops });
  }
  return faces;
}

/** Projected (xy) signed area of a loop. */
export function loopAreaXY(nodes: SkNode[], loop: number[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = nodes[loop[i]], b = nodes[loop[(i + 1) % loop.length]];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ---------------------------------------------------------------- validation and the dominant-axis retry

/** Node bbox margin and face-tiling tolerance of validateSkeleton, relative to the bbox diagonal / footprint area. */
const VALID_BOX_REL = 1e-6;
const VALID_AREA_REL = 1e-6;

/**
 * Upper bound of every node time: a point of the face of edge e in profile segment k (speed w_k > 0) has
 * t = t0_k + (offset since t0_k) / w_k, and that offset cannot exceed the polygon's extent beyond the edge line.
 */
function timeBound(E: SkEdge[], rings: Vec2[][]): number {
  let T = 0;
  for (const e of E) {
    if (e.virtual) continue;
    let D = 0;
    for (const r of rings) for (const p of r) D = Math.max(D, dot(e.n, p) - e.c);
    for (const s of e.profile) {
      T = Math.max(T, s.t0);
      if (s.w > 0) T = Math.max(T, s.t0 + D / s.w);
    }
  }
  return T;
}

/**
 * Sanity checks of a skeleton against the polygon it was computed from (`sk.poly`): every node finite and inside the
 * polygon's bbox (margin 1e-6 x diagonal), node times within [0, eave-extent bound], the plan projections of the
 * sloped and cap faces tiling the polygon (signed and absolute area within 1e-6), no engine warnings.
 * Returns the problems found (empty = valid).
 */
export function validateSkeleton(sk: Skeleton, poly: PolygonM = sk.poly): string[] {
  const issues: string[] = [];
  const rings = [poly.outer, ...(poly.holes ?? [])];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const m = VALID_BOX_REL * Math.max(Math.hypot(x1 - x0, y1 - y0), 1e-9);
  let out = 0, far = 0, tLo = 0, tHi = 0;
  for (const n of sk.nodes) {
    if (!(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.t))) { out++; far = Infinity; continue; }
    const dx = Math.max(x0 - n.x, n.x - x1, 0), dy = Math.max(y0 - n.y, n.y - y1, 0);
    if (dx > m || dy > m) { out++; far = Math.max(far, Math.hypot(dx, dy)); }
    tLo = Math.min(tLo, n.t); tHi = Math.max(tHi, n.t);
  }
  if (out) issues.push(`${out} node(s) outside the footprint bbox (up to ${far.toExponential(2)} m away)`);
  const tMax = timeBound(sk.edges, rings);
  if (tLo < -m) issues.push(`negative node time ${tLo}`);
  if (tHi > tMax * (1 + 1e-9) + m) issues.push(`node time ${tHi} above the eave-extent bound ${tMax}`);
  let sA = 0, sAbs = 0;
  for (const f of sk.faces) {
    if (!(f.key === 'cap' || f.w > 0)) continue; // vertical faces have no plan area
    const a = f.loops.reduce((s, l) => s + loopAreaXY(sk.nodes, l), 0);
    sA += a; sAbs += Math.abs(a);
  }
  const A = polygonArea(poly);
  if (!(Math.abs(sA - A) <= VALID_AREA_REL * A && Math.abs(sAbs - A) <= VALID_AREA_REL * A)) issues.push(`faces do not tile the footprint (plan area ${sA}, |area| ${sAbs}, footprint ${A})`);
  issues.push(...sk.stats.warnings);
  return issues;
}

/**
 * Dominant wall direction of a polygon, radians in [0, pi/2): the best length-supported edge direction modulo 90 deg
 * (edges within 1e-3 rad support it), refined by the length-weighted fourfold circular mean of its supporting edges.
 */
export function dominantAxis(poly: PolygonM): number {
  const Q = Math.PI / 2;
  const segs: { phi: number; len: number }[] = [];
  for (const r of [poly.outer, ...(poly.holes ?? [])])
    for (let i = 0; i < r.length; i++) {
      const d = sub(r[(i + 1) % r.length], r[i]);
      const len = Math.hypot(d[0], d[1]);
      if (len > 0) segs.push({ phi: ((Math.atan2(d[1], d[0]) % Q) + Q) % Q, len });
    }
  const dist = (a: number, b: number) => { const d = Math.abs(a - b) % Q; return Math.min(d, Q - d); };
  let best = 0, bestW = -1;
  for (const s of segs) {
    let w = 0;
    for (const q of segs) if (dist(s.phi, q.phi) <= 1e-3) w += q.len;
    if (w > bestW) { bestW = w; best = s.phi; }
  }
  let cs = 0, sn = 0;
  for (const q of segs) if (dist(best, q.phi) <= 1e-3) { cs += q.len * Math.cos(4 * q.phi); sn += q.len * Math.sin(4 * q.phi); }
  const ax = Math.atan2(sn, cs) / 4;
  return ax < 0 ? ax + Q : ax;
}

/**
 * In an axis-aligned frame, make walls that are within `tol` (end to end) of horizontal / vertical exactly so: each
 * connected run of such walls gets one shared coordinate (the mean of its vertices). Walls shorter than 10 tol keep
 * their direction. Returns a new polygon.
 */
export function snapToAxes(poly: PolygonM, tol: number): PolygonM {
  const rings = [poly.outer, ...(poly.holes ?? [])].map((r) => r.map((p) => [p[0], p[1]] as Vec2));
  const pts = rings.flat();
  const par = [pts.map((_, i) => i), pts.map((_, i) => i)]; // union-find per coordinate (0 = x for vertical walls, 1 = y)
  const find = (k: number, i: number): number => { while (par[k][i] !== i) i = par[k][i] = par[k][par[k][i]]; return i; };
  let base = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const ia = base + i, ib = base + ((i + 1) % r.length);
      const du = Math.abs(pts[ib][0] - pts[ia][0]), dv = Math.abs(pts[ib][1] - pts[ia][1]);
      const k = dv <= tol && du > 10 * tol ? 1 : du <= tol && dv > 10 * tol ? 0 : -1;
      if (k >= 0) par[k][find(k, ia)] = find(k, ib);
    }
    base += r.length;
  }
  for (const k of [0, 1]) {
    const sum = new Map<number, [number, number]>();
    pts.forEach((p, i) => { const g = find(k, i); const s = sum.get(g) ?? [0, 0]; s[0] += p[k]; s[1]++; sum.set(g, s); });
    pts.forEach((p, i) => { const s = sum.get(find(k, i))!; if (s[1] > 1) p[k] = s[0] / s[1]; });
  }
  return { outer: rings[0], holes: rings.slice(1) };
}

/** Skeleton computed in the polygon's dominant-axis frame (near-axis walls snapped within `snap` m), mapped back. */
function alignedSkeleton(poly: PolygonM, opts: SkeletonOptions, snap: number): Skeleton {
  const th = dominantAxis(poly), c = Math.cos(th), s = Math.sin(th);
  const toA = (p: Vec2): Vec2 => [c * p[0] + s * p[1], -s * p[0] + c * p[1]];
  const fromA = (p: Vec2): Vec2 => [c * p[0] - s * p[1], s * p[0] + c * p[1]];
  const mapPoly = (q: PolygonM, f: (p: Vec2) => Vec2): PolygonM => ({ outer: q.outer.map(f), holes: (q.holes ?? []).map((h) => h.map(f)) });
  const aligned = snapToAxes(mapPoly(poly, toA), snap);
  const sk = skeletonOnce(aligned, opts);
  for (const n of sk.nodes) { const [x, y] = fromA([n.x, n.y]); n.x = x; n.y = y; }
  for (const e of sk.edges) { e.a = fromA(e.a); e.b = fromA(e.b); e.d = fromA(e.d); e.n = fromA(e.n); e.c = dot(e.n, e.a); }
  return { ...sk, poly: mapPoly(aligned, fromA) };
}
