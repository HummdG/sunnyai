// Facade hints: map the street-facing edge found on the OSM outline onto the edges of the final parts.
import type { BuildingPartSpec, FacadeHints, Vec2 } from '@sunny/sunscan-core';
import { distPointSeg } from '@sunny/sunscan-core/geometry';
import { roundVec } from './geometry.js';

/**
 * Find the part edge that best matches segment a-b (same direction within 20°, closest to its midpoint, <= 3 m away).
 * Main parts are preferred on ties; party edges are never chosen.
 */
export function matchPartEdge(a: Vec2, b: Vec2, parts: BuildingPartSpec[]): { partId: string; edge: number } | undefined {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return undefined;
  const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let best: { partId: string; edge: number; score: number } | undefined;
  for (const p of parts) {
    const r = p.footprint.outer;
    for (let i = 0; i < r.length; i++) {
      if (p.edgeKinds[i] === 'party') continue;
      const q0 = r[i];
      const q1 = r[(i + 1) % r.length];
      const Lq = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
      if (Lq < 1e-6) continue;
      const cos = ((q1[0] - q0[0]) * d[0] + (q1[1] - q0[1]) * d[1]) / Lq;
      if (cos < Math.cos((20 * Math.PI) / 180)) continue;
      const dist = distPointSeg(mid, q0, q1);
      if (dist > 3) continue;
      const score = dist + (p.role === 'main' ? 0 : 0.5);
      if (!best || score < best.score) best = { partId: p.id, edge: i, score };
    }
  }
  return best ? { partId: best.partId, edge: best.edge } : undefined;
}

/** Assemble FacadeHints from the matched front edge, the entrance and the street name. */
export function facadeHints(front: { partId: string; edge: number } | undefined, entrance: Vec2 | undefined, streetName: string | undefined): FacadeHints {
  return {
    ...(front ? { front } : {}),
    ...(entrance ? { entrance: roundVec(entrance) } : {}),
    ...(streetName ? { streetName } : {}),
  };
}
