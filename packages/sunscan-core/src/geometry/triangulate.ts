// Ear-clipping triangulation of a planar polygon with holes, in 2D.
// Unlike earcut, it KEEPS collinear boundary vertices (earcut filters them out), which is required so that
// roof faces and walls share every skeleton node and the assembled solid has no T-junctions.
import type { Vec2 } from './geom.js';

const area2 = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function ringArea2(pts: Vec2[], idx: number[]): number {
  let s = 0;
  for (let i = 0; i < idx.length; i++) {
    const a = pts[idx[i]], b = pts[idx[(i + 1) % idx.length]];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s;
}

/**
 * Triangulate. `loops` are index loops into `pts`: any CCW loop is an outer boundary, any CW loop a hole
 * (assigned to the smallest containing outer). Returns CCW triangles (index triples into `pts`).
 */
export function triangulateLoops(pts: Vec2[], loops: number[][]): [number, number, number][] {
  const outers: number[][] = [];
  const holes: number[][] = [];
  for (const l of loops) {
    if (l.length < 3) continue;
    (ringArea2(pts, l) >= 0 ? outers : holes).push(l);
  }
  const tris: [number, number, number][] = [];
  const holesOf: number[][][] = outers.map(() => []);
  for (const h of holes) {
    // assign hole to the containing outer with the smallest area
    let best = -1, bestA = Infinity;
    const probe = holeProbePoint(pts, h);
    outers.forEach((o, k) => {
      if (pointInLoop(probe, pts, o)) {
        const a = Math.abs(ringArea2(pts, o));
        if (a < bestA) { bestA = a; best = k; }
      }
    });
    if (best >= 0) holesOf[best].push(h);
  }
  outers.forEach((o, k) => tris.push(...earClip(pts, bridgeHoles(pts, o, holesOf[k]))));
  return tris;
}

function holeProbePoint(pts: Vec2[], h: number[]): Vec2 {
  // midpoint of the first edge, nudged slightly to the left of a CW hole edge (= outside the hole)... we want
  // a point ON the hole boundary for containment against the outer; the midpoint works for disjoint rings.
  const a = pts[h[0]], b = pts[h[1]];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function pointInLoop(p: Vec2, pts: Vec2[], loop: number[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = pts[loop[i]], b = pts[loop[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Eberly-style hole bridging: connect each hole's rightmost vertex to a visible outer vertex. */
function bridgeHoles(pts: Vec2[], outer: number[], holes: number[][]): number[] {
  let ring = [...outer];
  const sorted = holes
    .map((h) => {
      let m = 0;
      for (let i = 1; i < h.length; i++) if (pts[h[i]][0] > pts[h[m]][0]) m = i;
      return { h, m };
    })
    .sort((a, b) => pts[b.h[b.m]][0] - pts[a.h[a.m]][0]);
  for (const { h, m } of sorted) {
    const M = pts[h[m]];
    // ray to +x: find closest edge intersection
    let bestX = Infinity, bestI = -1;
    for (let i = 0; i < ring.length; i++) {
      const a = pts[ring[i]], b = pts[ring[(i + 1) % ring.length]];
      if ((a[1] - M[1]) * (b[1] - M[1]) > 0) continue;
      if (a[1] === b[1]) {
        if (a[1] !== M[1]) continue;
        const x = Math.min(a[0], b[0]);
        if (x >= M[0] && x < bestX) { bestX = x; bestI = a[0] < b[0] ? i : (i + 1) % ring.length; }
        continue;
      }
      const x = a[0] + ((M[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x >= M[0] && x < bestX) { bestX = x; bestI = a[0] > b[0] ? i : (i + 1) % ring.length; }
    }
    if (bestI < 0) throw new Error('bridgeHoles: no visible edge');
    // candidate P = endpoint with max x; check reflex vertices inside triangle (M, I, P) and pick the best
    let P = bestI;
    const I: Vec2 = [bestX, M[1]];
    const Pp = pts[ring[P]];
    let bestAngle = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const q = pts[ring[i]];
      if (i === P) continue;
      if (q[0] < M[0]) continue;
      const inTri =
        area2(M, I, q) * area2(M, I, Pp) >= 0 && area2(I, Pp, q) * area2(I, Pp, M) >= 0 && area2(Pp, M, q) * area2(Pp, M, I) >= 0;
      if (!inTri) continue;
      const prev = pts[ring[(i - 1 + ring.length) % ring.length]], next = pts[ring[(i + 1) % ring.length]];
      if (area2(prev, q, next) >= 0) continue; // only reflex vertices can block
      const ang = Math.abs(Math.atan2(q[1] - M[1], q[0] - M[0]));
      if (ang < bestAngle || (ang === bestAngle && q[0] < pts[ring[P]][0])) { bestAngle = ang; P = i; }
    }
    const holeSeq: number[] = [];
    for (let k = 0; k <= h.length; k++) holeSeq.push(h[(m + k) % h.length]);
    ring = [...ring.slice(0, P + 1), ...holeSeq, ring[P], ...ring.slice(P + 1)];
  }
  return ring;
}

function earClip(pts: Vec2[], ring: number[]): [number, number, number][] {
  const tris: [number, number, number][] = [];
  const idx = [...ring];
  // scale-aware collinearity tolerance, as a HEIGHT (m): skeleton nodes carry ~1e-12 .. 1e-9 x S of noise (more on
  // rotated plans), so points within epsH of a line count as on it, for the ear test and the blocking test alike;
  // otherwise three nearly collinear ridge nodes end up as a zero-area remainder triangle
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of idx) {
    minX = Math.min(minX, pts[i][0]); maxX = Math.max(maxX, pts[i][0]);
    minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1]);
  }
  const S = Math.max(maxX - minX, maxY - minY, 1e-12);
  const epsH = 1e-9 * S;
  const len = (p: Vec2, q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    const n = idx.length;
    let clipped = false;
    let bestK = -1, bestQ = -Infinity;
    for (let k = 0; k < n; k++) {
      const ia = idx[(k - 1 + n) % n], ib = idx[k], ic = idx[(k + 1) % n];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      const ar = area2(a, b, c);
      const lca = len(c, a);
      if (ar <= epsH * lca) continue; // reflex, or b (nearly) on the diagonal a-c: not an ear
      const tab = -epsH * len(a, b), tbc = -epsH * len(b, c), tca = -epsH * lca;
      let blocked = false;
      for (let j = 0; j < n && !blocked; j++) {
        const ij = idx[j];
        if (ij === ia || ij === ib || ij === ic) continue;
        const p = pts[ij];
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        // inside or on the boundary (closed triangle, within epsH) blocks the ear
        const d1 = area2(a, b, p), d2 = area2(b, c, p), d3 = area2(c, a, p);
        if (d1 >= tab && d2 >= tbc && d3 >= tca) blocked = true;
      }
      if (blocked) continue;
      // quality: prefer ears with larger min angle-ish measure (area / longest edge^2)
      const l = Math.max((a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2, (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2);
      const q = ar / l;
      if (q > bestQ) { bestQ = q; bestK = k; }
    }
    if (bestK >= 0) {
      const k = bestK;
      tris.push([idx[(k - 1 + n) % n], idx[k], idx[(k + 1) % n]]);
      idx.splice(k, 1);
      clipped = true;
    }
    if (!clipped) {
      // remove a collinear/degenerate vertex if any (keeps progress), else give up on the remainder
      let removed = false;
      for (let k = 0; k < n; k++) {
        const a = pts[idx[(k - 1 + n) % n]], b = pts[idx[k]], c = pts[idx[(k + 1) % n]];
        if (Math.abs(area2(a, b, c)) <= epsH * len(a, c) && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0) {
          idx.splice(k, 1); removed = true; break; // spike (back-tracking) vertex
        }
      }
      if (!removed) throw new Error(`earClip: no ear found (n=${n})`);
    }
  }
  if (idx.length === 3) {
    const [ia, ib, ic] = idx;
    if (area2(pts[ia], pts[ib], pts[ic]) > epsH * Math.max(len(pts[ia], pts[ib]), len(pts[ib], pts[ic]), len(pts[ic], pts[ia]))) tris.push([ia, ib, ic]);
  }
  return tris;
}
