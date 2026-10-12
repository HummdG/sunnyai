// Coordinate frames used by the pipeline:
//  - WGS84 lon/lat (everything from the providers),
//  - local ENU metres about the HouseModelSpec origin (core/geo makeFrame),
//  - a local British National Grid frame (EPSG:27700 via OSTN15 minus a rounded origin) used only for LiDAR fitting.
import type { HeightGrid, Vec2 } from '@sunny/sunscan-core';
import type { LocalFrame } from '@sunny/sunscan-core/geo';
import type { BngGrid, LonLat, Ostn15 } from '../contracts.js';

/** Local BNG frame: x = E - e0, y = N - n0 (metres), with conversions to and from WGS84 through OSTN15. */
export interface BngLocalFrame {
  e0: number;
  n0: number;
  /** WGS84 lon/lat -> local BNG metres. Throws if the point is outside the OSTN15 grid. */
  fromLL(ll: LonLat): Vec2;
  /** Local BNG metres -> WGS84 lon/lat. */
  toLL(p: Vec2): LonLat;
}

/** True if both components are finite numbers. */
export function isFinitePair(p: readonly number[]): boolean {
  return p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Create a local BNG frame with origin (e0, n0). Use whole metres so that LiDAR pixel edges stay on round
 * coordinates (all UK sources are 1 m / 0.5 m lattices on integer metres).
 */
export function makeBngLocalFrame(ostn: Ostn15, e0: number, n0: number): BngLocalFrame {
  return {
    e0,
    n0,
    fromLL([lon, lat]) {
      const [e, n] = ostn.toBng(lon, lat);
      if (!Number.isFinite(e) || !Number.isFinite(n)) throw new Error(`OSTN15: point ${lon},${lat} outside the grid`);
      return [e - e0, n - n0];
    },
    toLL([x, y]) {
      const ll = ostn.toWgs84(x + e0, y + n0);
      if (!isFinitePair(ll)) throw new Error(`OSTN15: BNG ${x + e0},${y + n0} outside the grid`);
      return [ll[0], ll[1]];
    },
  };
}

/** View a provider raster (absolute BNG) as a core HeightGrid in the local BNG frame (shares the data array). */
export function bngToHeightGrid(g: BngGrid, e0: number, n0: number): HeightGrid {
  return { width: g.width, height: g.height, originX: g.originE - e0, originY: g.originN - n0, res: g.res, data: g.data };
}

/** Bilinear sample between pixel centres of a BNG raster at (e, n); NaN outside or next to nodata. */
export function sampleBng(g: BngGrid, e: number, n: number): number {
  const fx = (e - g.originE) / g.res - 0.5;
  const fy = (g.originN - n) / g.res - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const tx = fx - c0;
  const ty = fy - r0;
  // allow sampling in the outer half-pixel by clamping to the edge pixels
  const cA = Math.max(0, Math.min(g.width - 1, c0));
  const cB = Math.max(0, Math.min(g.width - 1, c0 + 1));
  const rA = Math.max(0, Math.min(g.height - 1, r0));
  const rB = Math.max(0, Math.min(g.height - 1, r0 + 1));
  if (fx < -0.5 || fy < -0.5 || fx > g.width - 0.5 || fy > g.height - 0.5) return NaN;
  const d = g.data;
  const w = g.width;
  const v00 = d[rA * w + cA];
  const v10 = d[rA * w + cB];
  const v01 = d[rB * w + cA];
  const v11 = d[rB * w + cB];
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

/** BNG bbox (min/max E/N) of a raster. */
export function bngGridBounds(g: BngGrid): { minE: number; minN: number; maxE: number; maxN: number } {
  return { minE: g.originE, maxE: g.originE + g.width * g.res, maxN: g.originN, minN: g.originN - g.height * g.res };
}

/** Composite transform local BNG -> local ENU (through WGS84). */
export function bngToEnu(bng: BngLocalFrame, enu: LocalFrame): (p: Vec2) => Vec2 {
  return (p) => {
    const q = enu.toLocal(bng.toLL(p));
    return [q[0], q[1]];
  };
}

/**
 * Convert a direction angle measured in the local BNG frame (degrees counter-clockwise from grid east) at point p
 * into the ENU frame (degrees counter-clockwise from true east). Accounts for grid convergence (~±3° in GB).
 */
export function bngAngleToEnu(toEnu: (p: Vec2) => Vec2, p: Vec2, angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180;
  const q0 = toEnu(p);
  const q1 = toEnu([p[0] + 10 * Math.cos(a), p[1] + 10 * Math.sin(a)]);
  return (Math.atan2(q1[1] - q0[1], q1[0] - q0[0]) * 180) / Math.PI;
}
