// Context of the house in the final ENU frame: neighbours, roads, terrain grid (from the DTM) and LiDAR evidence.
import type { LidarEvidence, NeighbourSpec, PolygonM, ReconstructOutput, RoadSpec, TerrainGrid, Vec2 } from '@sunny/sunscan-core';
import type { LocalFrame } from '@sunny/sunscan-core/geo';
import type { BngGrid, LonLat, Ostn15 } from '../contracts.js';
import { isAncillaryTags } from '@sunny/sunscan-core/footprint';
import { numericTag } from './archetype.js';
import { sampleBng } from './frames.js';
import { orientWithKinds, roundTo, roundVec } from './geometry.js';

/** A context building already registered and projected into the final ENU frame. */
export interface ContextBuilding {
  id: string;
  source: 'osm' | 'overture' | 'drawn';
  tags: Record<string, string>;
  footprint: PolygonM;
}

/**
 * Representative top height of a neighbour above the ground datum: LiDAR p90 (if measured), else OSM `height`,
 * else `building:levels` × 2.8 m + 1.5 m roof allowance, else a prior (2.6 m ancillary, 7 m house).
 */
export function neighbourHeight(b: ContextBuilding, lidar?: { height: number; eaveHeight?: number }): { height: number; eaveHeight?: number } {
  if (lidar && Number.isFinite(lidar.height) && lidar.height > 1) return { height: lidar.height, ...(lidar.eaveHeight !== undefined ? { eaveHeight: lidar.eaveHeight } : {}) };
  const h = numericTag(b.tags.height);
  if (h !== undefined && h > 1 && h < 300) return { height: h };
  const levels = numericTag(b.tags['building:levels'] ?? b.tags.num_floors);
  if (levels !== undefined && levels >= 1 && levels < 80) return { height: levels * 2.8 + 1.5, eaveHeight: levels * 2.8 };
  return isAncillaryTags(b.tags) ? { height: 2.6 } : { height: 7 };
}

/** NeighbourSpec list (rounded), with attachment flags and LiDAR heights where available. */
export function neighbourSpecs(buildings: ContextBuilding[], attached: Set<string>, lidarHeights: ReconstructOutput['neighbourHeights']): NeighbourSpec[] {
  const byId = new Map(lidarHeights.map((h) => [h.id, h]));
  return buildings.map((b) => {
    const { height, eaveHeight } = neighbourHeight(b, byId.get(b.id));
    const poly = orientWithKinds(b.footprint).poly;
    return {
      id: b.id,
      footprint: { outer: poly.outer.map((p) => roundVec(p)), holes: (poly.holes ?? []).map((h) => h.map((p) => roundVec(p))) },
      height: roundTo(height, 2),
      ...(eaveHeight !== undefined ? { eaveHeight: roundTo(eaveHeight, 2) } : {}),
      attached: attached.has(b.id),
      source: b.source === 'overture' ? 'overture' : 'osm',
    };
  });
}

/** Liang–Barsky clip of segment a-b to the square [-R, R]²; undefined if outside. */
function clipSegment(a: Vec2, b: Vec2, R: number): [Vec2, Vec2] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const checks: [number, number][] = [[-dx, a[0] + R], [dx, R - a[0]], [-dy, a[1] + R], [dy, R - a[1]]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return undefined;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return undefined;
    }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

/** Roads clipped to a square of half-size R around the origin, as connected ENU polylines. */
export function roadSpecs(roads: { name?: string; kind: string; line: Vec2[] }[], R = 100): RoadSpec[] {
  const out: RoadSpec[] = [];
  for (const r of roads) {
    let cur: Vec2[] = [];
    const flush = () => {
      if (cur.length >= 2) out.push({ ...(r.name ? { name: r.name } : {}), kind: r.kind, line: cur.map((p) => roundVec(p, 2)) });
      cur = [];
    };
    for (let i = 0; i + 1 < r.line.length; i++) {
      const c = clipSegment(r.line[i], r.line[i + 1], R);
      if (!c) {
        flush();
        continue;
      }
      const last = cur[cur.length - 1];
      if (last && Math.hypot(last[0] - c[0][0], last[1] - c[0][1]) < 1e-6) cur.push(c[1]);
      else {
        flush();
        cur = [c[0], c[1]];
      }
      if (c[1][0] !== r.line[i + 1][0] || c[1][1] !== r.line[i + 1][1]) flush();
    }
    flush();
  }
  return out;
}

/**
 * Terrain grid (heights relative to the ground datum) sampled from the DTM at ENU cell centres, north-up,
 * `cell` metres, cropped to the square of half-size `half` around the origin and to the DTM's extent.
 */
export function terrainGrid(
  dtm: BngGrid,
  ground: number,
  enu: LocalFrame,
  ostn: Ostn15,
  opts: { half: number; cell: number; source: string },
): TerrainGrid | undefined {
  const { half, cell } = opts;
  const n = Math.round((2 * half) / cell);
  const sample = (x: number, y: number): number | null => {
    const [lon, lat] = enu.toLonLat([x, y]);
    const [e, nn] = ostn.toBng(lon, lat);
    const v = sampleBng(dtm, e, nn);
    return Number.isFinite(v) ? roundTo(v - ground, 2) : null;
  };
  const full: (number | null)[][] = [];
  for (let r = 0; r < n; r++) {
    const row: (number | null)[] = [];
    for (let c = 0; c < n; c++) row.push(sample(-half + (c + 0.5) * cell, half - (r + 0.5) * cell));
    full.push(row);
  }
  // crop to rows/cols that contain data
  let r0 = 0, r1 = n - 1, c0 = 0, c1 = n - 1;
  const rowHas = (r: number) => full[r].slice(c0, c1 + 1).some((v) => v !== null);
  const colHas = (c: number) => full.slice(r0, r1 + 1).some((row) => row[c] !== null);
  while (r0 <= r1 && !rowHas(r0)) r0++;
  while (r1 >= r0 && !rowHas(r1)) r1--;
  while (c0 <= c1 && !colHas(c0)) c0++;
  while (c1 >= c0 && !colHas(c1)) c1--;
  if (r0 > r1 || c0 > c1) return undefined;
  const heights: (number | null)[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) heights.push(full[r][c]);
  return {
    originX: -half + c0 * cell,
    originY: half - r0 * cell,
    cellSize: cell,
    width: c1 - c0 + 1,
    height: r1 - r0 + 1,
    heights,
    source: opts.source,
  };
}

/**
 * LiDAR evidence: fit samples (planar frame) mapped to ENU through `toEnu`, deterministically decimated to at most
 * `max` samples (uniform stride), with residuals.
 */
export function evidenceFrom(
  samples: ReconstructOutput['samples'],
  toEnu: (p: Vec2) => Vec2,
  meta: { max: number; resolution: number; source: string; surveyDate?: string },
): LidarEvidence | undefined {
  if (!samples.length) return undefined;
  const stride = Math.max(1, Math.ceil(samples.length / meta.max));
  const points: number[] = [];
  const residuals: number[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    const s = samples[i];
    if (!Number.isFinite(s.z)) continue;
    const p = toEnu([s.x, s.y]);
    points.push(roundTo(p[0], 3), roundTo(p[1], 3), roundTo(s.z, 3));
    residuals.push(roundTo(s.residual, 3));
  }
  return {
    points,
    residuals,
    resolution: meta.resolution,
    source: meta.source,
    ...(meta.surveyDate ? { surveyDate: meta.surveyDate } : {}),
  };
}

/** Project lon/lat rings with an ENU frame. */
export function llPolygonToEnu(enu: LocalFrame, outer: LonLat[], holes: LonLat[][]): PolygonM {
  return { outer: outer.map((p) => enu.toLocal(p) as Vec2), holes: holes.map((h) => h.map((p) => enu.toLocal(p) as Vec2)) };
}
