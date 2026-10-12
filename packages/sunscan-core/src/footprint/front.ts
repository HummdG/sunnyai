// Which facade faces the street (research 05 §7.1):
//  1. an entrance node on (within 1 m of) a non-party outer edge fixes the front;
//  2. otherwise every non-party outer edge >= 2 m casts rays (25/50/75 % along the edge) along its outward normal;
//     score = 1 / distance to a highway hit within 60 m, x2 if the highway's name equals addr:street,
//     x0.5 for service/footway/path-like ways; front = argmax, except that any hit on the addr:street road outranks
//     hits on other ways (a mapped garden path must not beat the addressed street);
//  3. no hit: the road nearest in front of an edge; no roads: the longest non-party edge.
//  back = the non-party edge facing most opposite to the front.
import type { EdgeKind } from '../types.js';
import { ringArea, type PolygonM, type Vec2 } from '../geometry/geom.js';
import { normaliseStreetName } from './tags.js';

/** A road centre line in the same local frame. */
export interface FrontRoad { kind: string; name?: string; line: Vec2[] }

/** Options of {@link frontEdge}. */
export interface FrontEdgeOptions {
  /** Ray length (default 60 m). */
  maxDistance?: number;
  /** Minimum candidate edge length (default 2 m; relaxed when no edge qualifies). */
  minEdge?: number;
  /** Max distance of an entrance node from an edge (default 1 m). */
  entranceTol?: number;
}

/** Result of {@link frontEdge}; edge indices are outer-ring edge indices of the given polygon. */
export interface FrontEdgeResult {
  edge: number;
  back: number | null;
  method: 'entrance' | 'road' | 'nearest-road' | 'longest-edge';
  score: number;
  road?: string;
  reasons: string[];
}

const MINOR = new Set(['service', 'footway', 'path', 'cycleway', 'track', 'steps', 'bridleway', 'corridor']);

function segDist(p: Vec2, a: Vec2, b: Vec2): { d: number; q: Vec2 } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

/** Distance t > 0 along the ray p + t*n to segment a-b, or null. */
function raySeg(p: Vec2, n: Vec2, a: Vec2, b: Vec2): number | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const den = n[0] * ey - n[1] * ex;
  if (Math.abs(den) < 1e-12) return null;
  const wx = a[0] - p[0];
  const wy = a[1] - p[1];
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * n[1] - wy * n[0]) / den;
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/**
 * Street-facing outer edge of a footprint. `edgeKinds` follows the polygon's edge order (outer edges first);
 * party edges are never front or back. Returns null when every outer edge is a party wall.
 */
export function frontEdge(
  poly: PolygonM, edgeKinds: EdgeKind[], roads: FrontRoad[], entrance?: Vec2, streetName?: string, opts: FrontEdgeOptions = {},
): FrontEdgeResult | null {
  const ring = poly.outer;
  const n = ring.length;
  const maxD = opts.maxDistance ?? 60;
  const ccw = ringArea(ring) >= 0;
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = len > 0 ? (b[0] - a[0]) / len : 0;
    const uy = len > 0 ? (b[1] - a[1]) / len : 0;
    const normal: Vec2 = ccw ? [uy, -ux] : [-uy, ux]; // outward
    return { i, a, b, len, u: [ux, uy] as Vec2, normal, party: edgeKinds[i] === 'party' };
  });
  const open = edges.filter((e) => !e.party && e.len > 1e-6);
  if (!open.length) return null;
  let candidates = open.filter((e) => e.len >= (opts.minEdge ?? 2));
  if (!candidates.length) candidates = open;
  const want = normaliseStreetName(streetName);
  const mult = (r: FrontRoad) => (want && r.name && normaliseStreetName(r.name) === want ? 2 : 1) * (MINOR.has(r.kind) ? 0.5 : 1);
  const backOf = (front: number) => {
    const f = edges[front];
    let best: number | null = null;
    let bestDot = 0;
    for (const e of candidates) {
      if (e.i === front) continue;
      const d = e.normal[0] * f.normal[0] + e.normal[1] * f.normal[1];
      if (d < bestDot - 1e-9) (bestDot = d), (best = e.i);
    }
    return best;
  };

  if (entrance) {
    let best: { i: number; d: number } | null = null;
    for (const e of open) {
      const d = segDist(entrance, e.a, e.b).d;
      if (!best || d < best.d) best = { i: e.i, d };
    }
    if (best && best.d <= (opts.entranceTol ?? 1)) {
      return { edge: best.i, back: backOf(best.i), method: 'entrance', score: 1, reasons: [`entrance node ${best.d.toFixed(2)} m from edge ${best.i}`] };
    }
  }

  // a hit on the addressed street (addr:street) outranks any unnamed/minor way (garden paths, service roads)
  let top: { i: number; score: number; road?: string; d: number; named: boolean } | null = null;
  for (const e of candidates) {
    for (const f of [0.25, 0.5, 0.75]) {
      const p: Vec2 = [e.a[0] + (e.b[0] - e.a[0]) * f + e.normal[0] * 0.05, e.a[1] + (e.b[1] - e.a[1]) * f + e.normal[1] * 0.05];
      for (const r of roads) {
        for (let k = 0; k + 1 < r.line.length; k++) {
          const t = raySeg(p, e.normal, r.line[k], r.line[k + 1]);
          if (t == null || t > maxD) continue;
          const s = mult(r) / Math.max(t, 0.5);
          const named = !!want && !!r.name && normaliseStreetName(r.name) === want;
          if (!top || (named && !top.named) || (named === top.named && s > top.score)) top = { i: e.i, score: s, road: r.name ?? r.kind, d: t, named };
        }
      }
    }
  }
  if (top) {
    const why = `ray from edge ${top.i} hits ${top.road} after ${top.d.toFixed(1)} m${top.named ? ' (addr:street)' : ''}`;
    return { edge: top.i, back: backOf(top.i), method: 'road', score: top.score, road: top.road, reasons: [why] };
  }

  let near: { i: number; score: number; road?: string; d: number } | null = null;
  for (const e of candidates) {
    const m: Vec2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    for (const r of roads) {
      for (let k = 0; k + 1 < r.line.length; k++) {
        const { d, q } = segDist(m, r.line[k], r.line[k + 1]);
        if (d < 1e-6 || d > 150) continue;
        const cos = ((q[0] - m[0]) * e.normal[0] + (q[1] - m[1]) * e.normal[1]) / d;
        if (cos <= 0) continue;
        const s = (cos * mult(r)) / d;
        if (!near || s > near.score) near = { i: e.i, score: s, road: r.name ?? r.kind, d };
      }
    }
  }
  if (near) {
    return { edge: near.i, back: backOf(near.i), method: 'nearest-road', score: near.score, road: near.road, reasons: [`edge ${near.i} faces ${near.road} ${near.d.toFixed(1)} m away (no ray hit)`] };
  }
  const longest = candidates.reduce((x, y) => (y.len > x.len ? y : x));
  return { edge: longest.i, back: backOf(longest.i), method: 'longest-edge', score: 0, reasons: ['no roads nearby: longest external edge'] };
}
