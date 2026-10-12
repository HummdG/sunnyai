// Chimney stacks from positive residual clusters (research 05 sections 5.6 / 8 R3). At 1 m GSD a stack covers 1-4
// partially filled pixels, so single-pixel residuals understate it; detection therefore works on clusters:
//   candidates = DSM pixels inside the registered footprint (or <= partyReach outside a party wall, where the
//   roof profile continues) standing >= max(lowExcess, 2 sigma*) above the fitted roof, not vegetation
//   (dsm - dsmLast <= 1 m); 8-connected clusters are accepted when the peak excess >= max(minPeak, 3 sigma*),
//   the excess volume >= minVolume, the estimated stack height >= minHeight (0.6 m), area 0.5-6 m2 and compact;
//   the peak pixel must lie >= eaveClearance from the eave lines of the fitted roof
//   (stacks stand on ridges, party and gable walls; residual blobs at the gutter are neighbours / extensions).
import type { ChimneySpec, HeightGrid } from '../types.js';
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';
import { pixelCentre, pixelWindow, sameGeometry } from './raster.js';
import { bboxOfPoly, edgeSegments, pointInPoly, segDist2, toU, toV, type AxisFrame } from './poly.js';
import { valueAtPixel } from './pixels.js';

/** Thresholds of the residual-cluster chimney detector (metres, m2, m3). */
export interface ChimneyOptions {
  lowExcess: number; minPeak: number; minVolume: number; minHeight: number; minArea: number; maxArea: number;
  minFill: number; maxExtent: number; maxCount: number; vegThreshold: number; partyReach: number; stackArea: number; eaveClearance: number;
}
/** Default chimney detector thresholds (research 05 section 5.6, tuned on synthetic stacks). */
export const DEFAULT_CHIMNEYS: ChimneyOptions = {
  lowExcess: 0.25, minPeak: 0.4, minVolume: 0.5, minHeight: 0.6, minArea: 0.5, maxArea: 6, minFill: 0.4, maxExtent: 3.5,
  maxCount: 4, vegThreshold: 1.0, partyReach: 0.6, stackArea: 0.9, eaveClearance: 0.75,
};

/**
 * Detect chimney stacks.
 * @param poly    registered footprint in local metres (planar = local + origin), `kinds` per edge (party walls)
 * @param eaves   per edge of `poly`: true where the fitted roof has an eave (low edge) along it
 * @param surface fitted roof height (absolute) at a local point, or NaN where undefined
 * @param sigma   robust residual scale of the fit (sigma*)
 * @param frame   plan frame of the main part (box orientation)
 */
export function detectChimneys(
  dsm: HeightGrid, poly: PolygonM, kinds: EdgeKind[], eaves: boolean[], origin: Vec2, surface: (x: number, y: number) => number, ground: number, sigma: number,
  frame: AxisFrame, dsmLast?: HeightGrid, opts: ChimneyOptions = DEFAULT_CHIMNEYS,
): ChimneySpec[] {
  const reach = opts.partyReach;
  const [x0, y0, x1, y1] = bboxOfPoly(poly);
  const win = pixelWindow(dsm, x0 + origin[0] - reach, y0 + origin[1] - reach, x1 + origin[0] + reach, y1 + origin[1] + reach);
  if (!win) return [];
  const segs = edgeSegments(poly);
  const party = segs.filter((_, i) => kinds[i] === 'party');
  const eaveSegs = segs.filter((_, i) => eaves[i]);
  const W = win.c1 - win.c0 + 1, H = win.r1 - win.r0 + 1;
  const low = Math.max(opts.lowExcess, 2 * sigma), peakMin = Math.max(opts.minPeak, 3 * sigma);
  const excess = new Float64Array(W * H).fill(NaN);
  const lastSame = dsmLast ? sameGeometry(dsmLast, dsm) : false;
  for (let r = win.r0; r <= win.r1; r++) for (let c = win.c0; c <= win.c1; c++) {
    const [px, py] = pixelCentre(dsm, c, r);
    const x = px - origin[0], y = py - origin[1];
    if (!pointInPoly(x, y, poly) && !party.some((s) => segDist2(x, y, s.ax, s.ay, s.bx, s.by) <= reach * reach)) continue;
    const z = dsm.data[r * dsm.width + c];
    if (!Number.isFinite(z)) continue;
    if (dsmLast) {
      const zl = valueAtPixel(dsmLast, dsm, c, r, lastSame);
      if (Number.isFinite(zl) && z - zl > opts.vegThreshold) continue;
    }
    const h = surface(x, y);
    if (Number.isFinite(h) && z - h >= low) excess[(r - win.r0) * W + (c - win.c0)] = z - h;
  }
  const seen = new Uint8Array(W * H);
  const found: { spec: ChimneySpec; score: number }[] = [];
  const a = dsm.res * dsm.res;
  for (let i0 = 0; i0 < W * H; i0++) {
    if (seen[i0] || !(excess[i0] === excess[i0])) continue;
    const stack = [i0], comp: number[] = [];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const cx = i % W, cy = Math.floor(i / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && excess[j] === excess[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const area = comp.length * a;
    if (area < opts.minArea - 1e-9 || area > opts.maxArea + 1e-9) continue;
    let vol = 0, mx = 0, my = 0, peak = 0, px0 = 0, py0 = 0, u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const i of comp) {
      const [px, py] = pixelCentre(dsm, win.c0 + (i % W), win.r0 + Math.floor(i / W));
      const x = px - origin[0], y = py - origin[1], e = excess[i];
      vol += e * a; mx += e * x; my += e * y;
      if (e > peak) { peak = e; px0 = x; py0 = y; }
      const u = toU(frame, x, y), v = toV(frame, x, y);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const extU = u1 - u0 + dsm.res, extV = v1 - v0 + dsm.res;
    if (Math.max(extU, extV) > opts.maxExtent + 1e-9 || area / (extU * extV) < opts.minFill) continue;
    // stack height above the roof: the peak pixel bounds it from below; volume / typical stack area otherwise
    const height = Math.min(3, Math.max(peak, vol / opts.stackArea));
    if (peak < peakMin || vol < opts.minVolume || height < opts.minHeight) continue;
    const ec = opts.eaveClearance;
    if (eaveSegs.some((s) => segDist2(px0, py0, s.ax, s.ay, s.bx, s.by) < ec * ec)) continue;
    const cx = mx / (vol / a), cy = my / (vol / a);
    const plan = Math.min(2.5, Math.max(0.4, vol / height));
    const side = Math.sqrt(plan);
    found.push({
      spec: {
        center: [cx + origin[0], cy + origin[1]], width: side, depth: side, angleDeg: (frame.angle * 180) / Math.PI,
        top: surface(cx, cy) + height - ground, source: 'lidar',
      },
      score: vol,
    });
  }
  return found.sort((p, q) => q.score - p.score).slice(0, opts.maxCount).map((f) => f.spec);
}
