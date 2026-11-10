/**
 * The homeowner's real roof as an architect's roof plan, with the quoted panels
 * on it, for the proposal PDF.
 *
 * Rebuilt from the stored assessment's `spec.json` with the same
 * `synthesizeHouse` the viewer uses, and the panels placed by the same
 * `layoutPanels` the widget uses, then flattened onto the ground plane. The
 * house's own footprint (`parts[].footprint`) and its attached neighbours come
 * straight from the spec: they are in the same local frame as the mesh (x east,
 * y north, metres from the spec origin), so they need no transform. Everything
 * is then turned so the main face's eave runs level along the bottom of that
 * face; `rotationDeg` says by how much, for the north arrow.
 *
 * Never a schematic: when the assessment is not reliable, the spec does not
 * rebuild, or the layout cannot place every quoted panel, there is no plan.
 */
import { layoutPanels, PANEL_LAYOUT, type PanelPlacement } from '@sunny/sunscan-core/layout';
import { synthesizeHouse } from '@sunny/sunscan-core/model';
import type { HouseMesh, HouseModelSpec } from '@sunny/sunscan-core/types';

type P2 = [number, number];
type V3 = [number, number, number];

export type RoofLineKind = 'ridge' | 'hip' | 'valley';

export interface RoofPlan {
  /** The house's own polygon: every spec part's outer footprint; partyEdges = indices of party-wall edges. */
  footprints: { outline: [number, number][]; partyEdges: number[] }[];
  /** Attached neighbours' outer rings, for context; they never extend `bounds`. */
  neighbours: [number, number][][];
  /** Every roof face; `panelled` where the quote puts panels. */
  faces: {
    id: number;
    outline: [number, number][];
    pitchDeg: number;
    azimuthDeg: number;
    panelled: boolean;
  }[];
  /** Edges shared by two faces, classified. */
  lines: { kind: RoofLineKind; from: [number, number]; to: [number, number] }[];
  /** Each panel's four corners. */
  panels: [number, number][][];
  /** Covers the footprints, faces and panels (not the neighbours). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Counter-clockwise turn applied to the plan, in degrees: plan north now points this way. */
  rotationDeg: number;
  /** The face holding most panels: its eave (lowest edge, now level) and rafter (true slope length). */
  mainFace: {
    id: number;
    eaveM: number;
    rafterM: number;
    eave: [[number, number], [number, number]];
  };
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

// ---- The house and its neighbours, from the spec ------------------------

/** A ring of finite [x, y] points (at least three), else null. */
function ringOf(raw: unknown): P2[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const out: P2[] = [];
  for (const q of raw as unknown[]) {
    if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) return null;
    out.push([Number(q[0]), Number(q[1])]);
  }
  return out;
}

/** Every part's outer footprint with its party-wall edges (holes are not drawn). */
function footprintsOf(spec: HouseModelSpec): RoofPlan['footprints'] {
  const out: RoofPlan['footprints'] = [];
  for (const part of spec.parts) {
    const p = (part ?? {}) as { footprint?: { outer?: unknown }; edgeKinds?: unknown };
    const outline = ringOf(p.footprint?.outer);
    if (!outline) continue;
    const kinds: unknown[] = Array.isArray(p.edgeKinds) ? p.edgeKinds : [];
    const partyEdges = outline.flatMap((_, i) => (kinds[i] === 'party' ? [i] : []));
    out.push({ outline, partyEdges });
  }
  return out;
}

/** The attached neighbours' outer rings. */
function attachedNeighbours(spec: HouseModelSpec): P2[][] {
  const list = (spec.context as { neighbours?: unknown }).neighbours;
  if (!Array.isArray(list)) return [];
  return list.flatMap((n: unknown) => {
    const nb = n as { attached?: unknown; footprint?: { outer?: unknown } } | null;
    if (!nb || nb.attached !== true) return [];
    const ring = ringOf(nb.footprint?.outer);
    return ring ? [ring] : [];
  });
}

// ---- Roof faces, from the mesh --------------------------------------------

/** Upward-facing triangles of `kind` layers tagged with this face. */
function faceTriangles(mesh: HouseMesh, faceId: number, kind: string): [V3, V3, V3][] {
  const out: [V3, V3, V3][] = [];
  for (const layer of mesh.layers) {
    if (layer.kind !== kind || !layer.triangleTags) continue;
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
      out.push(v);
    }
  }
  return out;
}

const signedArea = (ring: (P2 | V3)[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

/**
 * The face's outline, with heights: the edges used by exactly one of its
 * triangles, chained into rings; the largest ring is the outline (a hole, e.g.
 * round a chimney, is not drawn). Works for non-convex faces, unlike a hull.
 */
function outlineOf(tris: [V3, V3, V3][]): V3[] | null {
  const key = (p: V3) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const point = new Map<string, V3>();
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

  const rings: V3[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: V3[] = [];
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

/** Removes vertices that lie on the straight line between their neighbours (in plan). */
function dropCollinear<T extends P2 | V3>(ring: T[]): T[] {
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

// ---- Ridges, hips and valleys ---------------------------------------------

interface Face3 {
  id: number;
  ring: V3[];
  /** The face's plane: unit normal pointing up, and a point on it. */
  normal: V3;
  at: V3;
}

/** The plane of a ring (Newell's normal, pointing up, through the vertex mean). */
function planeOf(ring: V3[]): { normal: V3; at: V3 } {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const at: V3 = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
    for (let k = 0; k < 3; k++) at[k] = at[k]! + a[k]! / ring.length;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  const sign = nz < 0 ? -1 : 1;
  return { normal: [(sign * nx) / len, (sign * ny) / len, (sign * nz) / len], at };
}

/** Height of the face's plane over (x, y); NaN for a vertical plane. */
function planeZ(f: Face3, x: number, y: number): number {
  const [nx, ny, nz] = f.normal;
  if (Math.abs(nz) < 1e-6) return NaN;
  return f.at[2] - (nx * (x - f.at[0]) + ny * (y - f.at[1])) / nz;
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const TOL = 0.02; // metres

/** The stretch of edge a0-a1 that edge b0-b1 also covers, in plan and in height, if any. */
function overlap(a0: V3, a1: V3, b0: V3, b1: V3): [V3, V3] | null {
  const dx = a1[0] - a0[0];
  const dy = a1[1] - a0[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.05) return null;
  const ux = dx / len;
  const uy = dy / len;
  const off = (p: V3) => Math.abs((p[0] - a0[0]) * uy - (p[1] - a0[1]) * ux);
  if (off(b0) > TOL || off(b1) > TOL) return null;
  const t = (p: V3) => ((p[0] - a0[0]) * ux + (p[1] - a0[1]) * uy) / len;
  const tb0 = t(b0);
  const tb1 = t(b1);
  const lo = Math.max(0, Math.min(tb0, tb1));
  const hi = Math.min(1, Math.max(tb0, tb1));
  if ((hi - lo) * len < 0.05) return null;
  const from = lerp3(a0, a1, lo);
  const to = lerp3(a0, a1, hi);
  // The same heights on b at those plan points: a real shared edge, not a step.
  const onB = (p: V3) => b0[2] + ((b1[2] - b0[2]) * (t(p) - tb0)) / (tb1 - tb0 || 1);
  if (Math.abs(onB(from) - from[2]) > 0.03 || Math.abs(onB(to) - to[2]) > 0.03) return null;
  return [from, to];
}

/**
 * Edges shared by two faces. Convex (the second face falls away below the
 * first face's plane): a ridge when level, a hip when it slopes. Concave (the
 * second face rises above it): a valley.
 */
function sharedLines(faces: Face3[]): { kind: RoofLineKind; seg: [V3, V3] }[] {
  const out: { kind: RoofLineKind; seg: [V3, V3] }[] = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const A = faces[i]!;
      const B = faces[j]!;
      for (let m = 0; m < A.ring.length; m++) {
        const a0 = A.ring[m]!;
        const a1 = A.ring[(m + 1) % A.ring.length]!;
        for (let n = 0; n < B.ring.length; n++) {
          const seg = overlap(a0, a1, B.ring[n]!, B.ring[(n + 1) % B.ring.length]!);
          if (!seg) continue;
          const [s0, s1] = seg;
          const ex = s1[0] - s0[0];
          const ey = s1[1] - s0[1];
          const el = Math.hypot(ex, ey) || 1;
          const dist = (p: V3) => Math.abs((p[0] - s0[0]) * ey - (p[1] - s0[1]) * ex) / el;
          const far = B.ring.reduce((best, p) => (dist(p) > dist(best) ? p : best));
          const convex = !(far[2] - planeZ(A, far[0], far[1]) > TOL);
          const level = Math.abs(s1[2] - s0[2]) / el < Math.tan((5 * Math.PI) / 180);
          out.push({ kind: !convex ? 'valley' : level ? 'ridge' : 'hip', seg });
        }
      }
    }
  }
  return out;
}

// ---- Turning the plan -----------------------------------------------------

/** The face's lowest edge: the longest edge with both ends at its lowest height. */
function eaveOf(ring: V3[]): [V3, V3] {
  const minZ = Math.min(...ring.map((v) => v[2]));
  let best: [V3, V3] = [ring[0]!, ring[1]!];
  let bestLen = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a[2] - minZ > TOL || b[2] - minZ > TOL) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) {
      best = [a, b];
      bestLen = len;
    }
  }
  return best;
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
    ...(opts.planeIds ? { planeIds: opts.planeIds } : {}),
  });
  if (layout.unplaced > 0 || layout.placements.length !== count) return null;

  const held = layout.perPlane.filter((p) => p.count > 0);
  if (held.length === 0) return null;
  const panelled = new Set(held.map((p) => p.faceId));

  // Every roof face: the overhanging skin seen from above, else the wall-line roof.
  const faces3: (Face3 & { pitchDeg: number; azimuthDeg: number })[] = [];
  for (const info of mesh.roofFaces) {
    const skin = faceTriangles(mesh, info.id, 'roof-skin');
    const ring = outlineOf(skin.length > 0 ? skin : faceTriangles(mesh, info.id, 'roof'));
    if (!ring) {
      // A face holding panels that cannot be drawn means no honest plan.
      if (panelled.has(info.id)) return null;
      continue;
    }
    faces3.push({
      id: info.id,
      ring,
      ...planeOf(ring),
      pitchDeg: info.pitchDeg,
      azimuthDeg: info.azimuthDeg,
    });
  }

  const main = held.reduce((best, p) => (p.count > best.count ? p : best));
  const mainFace = faces3.find((f) => f.id === main.faceId);
  if (!mainFace) return null;

  // Turn the plan so the main eave is level, with its face above it.
  const [e0, e1] = eaveOf(mainFace.ring);
  let theta = -Math.atan2(e1[1] - e0[1], e1[0] - e0[0]);
  const turnY = (p: P2 | V3, a: number) => p[0] * Math.sin(a) + p[1] * Math.cos(a);
  const meanY = mainFace.ring.reduce((sum, v) => sum + turnY(v, theta), 0) / mainFace.ring.length;
  if (meanY < turnY(e0, theta)) theta += Math.PI;
  theta = Math.atan2(Math.sin(theta), Math.cos(theta));
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rot = (p: P2 | V3): P2 => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];

  const faces: RoofPlan['faces'] = faces3.map((f) => ({
    id: f.id,
    outline: f.ring.map(rot),
    pitchDeg: f.pitchDeg,
    azimuthDeg: f.azimuthDeg,
    panelled: panelled.has(f.id),
  }));
  const lines: RoofPlan['lines'] = sharedLines(faces3).map(({ kind, seg }) => ({
    kind,
    from: rot(seg[0]),
    to: rot(seg[1]),
  }));
  const panels = layout.placements.map((p) => panelCorners(p).map(rot));
  const footprints = footprintsOf(spec).map((f) => ({ ...f, outline: f.outline.map(rot) }));
  const neighbours = attachedNeighbours(spec).map((r) => r.map(rot));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [
    ...footprints.flatMap((f) => f.outline),
    ...faces.flatMap((f) => f.outline),
    ...panels.flat(),
  ]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // The rafter: the true slope length up the face from the eave (plan run and rise).
  const eave: [P2, P2] = [rot(e0), rot(e1)];
  const eaveY = (eave[0][1] + eave[1][1]) / 2;
  const eaveZ = (e0[2] + e1[2]) / 2;
  let run = 0;
  let rise = 0;
  for (const v of mainFace.ring) {
    run = Math.max(run, rot(v)[1] - eaveY);
    rise = Math.max(rise, v[2] - eaveZ);
  }

  return {
    footprints,
    neighbours,
    faces,
    lines,
    panels,
    bounds: { minX, minY, maxX, maxY },
    rotationDeg: (theta * 180) / Math.PI,
    mainFace: {
      id: mainFace.id,
      eaveM: Math.hypot(e1[0] - e0[0], e1[1] - e0[1]),
      rafterM: Math.hypot(run, rise),
      eave,
    },
    mainFacing: facingWord(mainFace.azimuthDeg),
    sample: opts.sample ?? false,
  };
}
