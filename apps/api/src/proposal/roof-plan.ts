/**
 * The homeowner's real roof in plan view, with the quoted panels on it, for the
 * proposal PDF.
 *
 * Rebuilt from the stored assessment's `spec.json` with the same
 * `synthesizeHouse` the viewer uses, and the panels placed by the same
 * `layoutPanels` the widget uses, then flattened onto the ground plane (x east,
 * y north, metres). Never a schematic: when the assessment is not reliable, the
 * spec does not rebuild, or the layout cannot place every quoted panel, there is
 * no plan.
 */
import { layoutPanels, PANEL_LAYOUT, type PanelPlacement } from '@sunny/sunscan-core/layout';
import { synthesizeHouse } from '@sunny/sunscan-core/model';
import type { HouseMesh, HouseModelSpec } from '@sunny/sunscan-core/types';

type P2 = [number, number];
type V3 = [number, number, number];

export interface RoofPlan {
  faces: { id: number; outline: [number, number][]; pitchDeg: number; azimuthDeg: number }[]; // plan view metres, x east, y north
  panels: [number, number][][]; // each panel's four corners in plan view
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  dimensions: { widthM: number; depthM: number };
  mainFacing: string; // e.g. 'South'
  sample: boolean;
}

const COMPASS = [
  'North',
  'North-east',
  'East',
  'South-east',
  'South',
  'South-west',
  'West',
  'North-west',
] as const;

/** The compass word for a downslope bearing; 'Flat' for a flat roof (no bearing). */
export function facingWord(azimuthDeg: number): string {
  if (!Number.isFinite(azimuthDeg)) return 'Flat';
  const a = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS[Math.round(a / 45) % 8]!;
}

function looksLikeSpec(spec: unknown): spec is HouseModelSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Partial<HouseModelSpec>;
  return (
    s.schema === 'sunscan.house/1' &&
    Array.isArray(s.parts) &&
    s.parts.length > 0 &&
    !!s.origin &&
    !!s.context
  );
}

/** Upward-facing roof-skin triangles tagged with this face, in plan view. */
function faceTriangles(mesh: HouseMesh, faceId: number): [P2, P2, P2][] {
  const out: [P2, P2, P2][] = [];
  for (const layer of mesh.layers) {
    if (layer.kind !== 'roof-skin' || !layer.triangleTags) continue;
    const pos = layer.positions;
    for (let t = 0; t < layer.triangleTags.length; t++) {
      if (layer.triangleTags[t] !== faceId) continue;
      const v = [0, 1, 2].map((k) => {
        const i = layer.indices[3 * t + k]!;
        return [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!] as V3;
      }) as [V3, V3, V3];
      // The skin's underside carries the same tag; keep the top surface only
      // (its triangles wind counter-clockwise seen from above).
      const [a, b, c] = v;
      const z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (z <= 1e-9) continue;
      out.push([
        [a[0], a[1]],
        [b[0], b[1]],
        [c[0], c[1]],
      ]);
    }
  }
  return out;
}

const signedArea = (ring: P2[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

/**
 * The face's outline: the edges used by exactly one of its triangles, chained
 * into rings; the largest ring is the outline (a hole, e.g. round a chimney,
 * is not drawn). Works for non-convex faces, unlike a hull.
 */
function outlineOf(tris: [P2, P2, P2][]): P2[] | null {
  const key = (p: P2) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const point = new Map<string, P2>();
  const directed: [string, string][] = [];
  for (const tri of tris) {
    for (let k = 0; k < 3; k++) {
      const a = tri[k]!;
      const b = tri[(k + 1) % 3]!;
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      point.set(ka, a);
      point.set(kb, b);
      directed.push([ka, kb]);
    }
  }
  const count = new Map<string, number>();
  const undirected = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [a, b] of directed)
    count.set(undirected(a, b), (count.get(undirected(a, b)) ?? 0) + 1);
  const next = new Map<string, string[]>();
  for (const [a, b] of directed) {
    if (count.get(undirected(a, b)) !== 1) continue;
    next.set(a, [...(next.get(a) ?? []), b]);
  }

  const rings: P2[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: P2[] = [];
      let at = start;
      for (let guard = 0; guard <= directed.length; guard++) {
        const outs = next.get(at);
        if (!outs || outs.length === 0) break;
        const to = outs.shift()!;
        ring.push(point.get(at)!);
        at = to;
        if (at === start) break;
      }
      if (at === start && ring.length >= 3) rings.push(ring);
    }
  }
  if (rings.length === 0) return null;
  const outer = rings.reduce((best, r) =>
    Math.abs(signedArea(r)) > Math.abs(signedArea(best)) ? r : best,
  );
  return dropCollinear(outer);
}

/** Removes vertices that lie on the straight line between their neighbours. */
function dropCollinear(ring: P2[]): P2[] {
  const out = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]!;
    const b = ring[(i + 1) % ring.length]!;
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return Math.abs(cross) / len > 1e-4;
  });
  return out.length >= 3 ? out : ring;
}

/** A placement's four corners, on the roof surface (rail lift removed), in plan. */
function panelCorners(p: PanelPlacement): P2[] {
  const hw = p.widthM / 2;
  const hh = p.heightM / 2;
  // The layout lifts each panel off the roof by its rails; the plan draws it on the roof.
  const lift = PANEL_LAYOUT.liftM;
  const c: P2 = [p.center[0] - p.normal[0] * lift, p.center[1] - p.normal[1] * lift];
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([s, t]) => [c[0] + p.across[0] * s + p.up[0] * t, c[1] + p.across[1] * s + p.up[1] * t]);
}

export function roofPlanFor(
  spec: unknown,
  opts: { panelCount: number; planeIds?: number[]; reliable: boolean; sample?: boolean },
): RoofPlan | null {
  if (!opts.reliable) return null;
  const count = Math.floor(opts.panelCount);
  if (!Number.isFinite(count) || count < 1) return null;
  if (!looksLikeSpec(spec)) return null;

  let mesh: HouseMesh;
  try {
    mesh = synthesizeHouse(spec);
  } catch {
    return null;
  }

  const layout = layoutPanels(mesh, {
    count,
    ...(opts.planeIds && opts.planeIds.length > 0 ? { planeIds: opts.planeIds } : {}),
  });
  if (layout.unplaced > 0 || layout.placements.length !== count) return null;

  const held = layout.perPlane.filter((p) => p.count > 0);
  const faces: RoofPlan['faces'] = [];
  for (const { faceId } of held) {
    const info = mesh.roofFaces.find((f) => f.id === faceId);
    const outline = info ? outlineOf(faceTriangles(mesh, faceId)) : null;
    // A face holding panels that cannot be drawn means no honest plan.
    if (!info || !outline) return null;
    faces.push({ id: faceId, outline, pitchDeg: info.pitchDeg, azimuthDeg: info.azimuthDeg });
  }

  const panels = layout.placements.map(panelCorners);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [...faces.flatMap((f) => f.outline), ...panels.flat()]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const main = held.reduce((best, p) => (p.count > best.count ? p : best));
  const mainFace = faces.find((f) => f.id === main.faceId)!;

  return {
    faces,
    panels,
    bounds: { minX, minY, maxX, maxY },
    dimensions: { widthM: maxX - minX, depthM: maxY - minY },
    mainFacing: facingWord(mainFace.azimuthDeg),
    sample: opts.sample ?? false,
  };
}
