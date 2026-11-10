/**
 * The homeowner's real house as a small 3D model, with the quoted panels on
 * its roof, for the proposal PDF's drawing (see plan-drawing.ts).
 *
 * Rebuilt from the stored assessment's `spec.json` with the same
 * `synthesizeHouse` the viewer uses, and the panels placed by the same
 * `layoutPanels` the widget uses. Everything stays in the spec's local frame
 * (x east, y north, z up, metres): the house's outside walls come from its
 * footprint (`parts[].footprint`), topped by the roof planes; the roof faces
 * and the windows and doors come from the mesh; attached neighbours
 * (`context.neighbours[]` with `attached: true`) become short boxes, gabled
 * where their heights say so, cut a few metres from the party wall so they
 * set the house in its terrace without taking over the drawing. Where a
 * neighbour's heights match the house's, its roof carries on the house's own
 * slopes, so the row has one eave line and one ridge.
 *
 * Never a schematic: when the assessment is not reliable, the spec does not
 * rebuild, or the layout cannot place every quoted panel, there is no plan.
 */
import { layoutPanels, type PanelPlacement } from '@sunny/sunscan-core/layout';
import { synthesizeHouse } from '@sunny/sunscan-core/model';
import type { HouseMesh, HouseModelSpec } from '@sunny/sunscan-core/types';

type P2 = [number, number];
export type V3 = [number, number, number];

const TOL = 0.02; // metres
/** How much of an attached neighbour is drawn, out from the party wall. */
export const NEIGHBOUR_STUB_M = 3;

/** A flat polygon in 3D with its outward unit normal. */
export interface Poly3 {
  pts: V3[];
  normal: V3;
}

export interface RoofPlan {
  /** The house's outside walls, part by part (the fitter's cuts between parts are not walls). */
  parts: { id: string; walls: (Poly3 & { party: boolean })[]; centroid: V3 }[];
  /** Every roof face (the overhanging skin); `panelled` where the quote puts panels. */
  faces: {
    id: number;
    partId: string;
    outline: V3[];
    /** Unit normal, pointing up and out. */
    normal: V3;
    pitchDeg: number;
    azimuthDeg: number;
    panelled: boolean;
  }[];
  /** Windows and doors as rectangles on their wall, a hair proud of it. */
  openings: { partId: string; wall: number; kind: 'window' | 'door'; pts: V3[] }[];
  /** Each panel's corners, on the roof: across then up, from its lower left. */
  panels: { faceId: number; corners: V3[]; portrait: boolean }[];
  /** Attached neighbours, cut short: their walls, roof slopes and the cut end (if cut). */
  neighbours: {
    walls: Poly3[];
    roofs: Poly3[];
    cut: Poly3 | null;
    centroid: V3;
    /** The line on the ground it shares with the house (that wall of the house is hidden). */
    shared: [[number, number], [number, number]];
    /** Unit direction in plan from the shared line into the neighbour, and how far it is drawn. */
    away: [number, number];
    reach: number;
    /** Its roof slopes carry on the house's own (one terrace roof: same eave and ridge lines). */
    joined: boolean;
  }[];
  /** The face holding most panels. */
  mainFace: { id: number; pitchDeg: number; azimuthDeg: number };
  mainFacing: string; // e.g. 'South'
  /** The first line of the address the assessment was made for, if the spec has one. */
  address: string | null;
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

// ---- small vector helpers -------------------------------------------------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mean = (pts: V3[]): V3 => {
  const c: V3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] = c[k]! + p[k]! / pts.length;
  return c;
};

/** Newell's normal of a ring (unnormalised direction, by winding). */
function newell(ring: V3[]): V3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([nx, ny, nz]);
}

/** A polygon with its normal turned to point away from `inside`. */
function outward(pts: V3[], inside: V3): Poly3 {
  let n = newell(pts);
  if (dot(n, sub(mean(pts), inside)) < 0) n = [-n[0], -n[1], -n[2]];
  return { pts, normal: n };
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

/** Distance from p to segment ab, in plan. */
function segDist(p: P2 | V3, a: P2 | V3, b: P2 | V3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Inside the polygon (in plan), or within `tol` of its boundary. */
function insideOrNear(p: P2 | V3, poly: (P2 | V3)[], tol: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (segDist(p, a, b) <= tol) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// ---- The house's parts, from the spec -------------------------------------

interface SpecPart {
  id: string;
  outline: P2[];
  partyEdges: number[];
  baseZ: number;
  eaveZ: number;
}

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

const num = (v: unknown, fallback: number) => (Number.isFinite(v) ? Number(v) : fallback);

/** Every part's outer footprint, counter-clockwise, with its party-wall edges (holes are not drawn). */
function partsOf(spec: HouseModelSpec): SpecPart[] {
  const out: SpecPart[] = [];
  spec.parts.forEach((raw, i) => {
    const p = (raw ?? {}) as {
      id?: unknown;
      footprint?: { outer?: unknown };
      edgeKinds?: unknown;
      baseHeight?: unknown;
      eaveHeight?: unknown;
    };
    let outline = ringOf(p.footprint?.outer);
    if (!outline) return;
    const kinds: unknown[] = Array.isArray(p.edgeKinds) ? p.edgeKinds : [];
    let partyEdges = outline.flatMap((_, k) => (kinds[k] === 'party' ? [k] : []));
    if (signedArea(outline) < 0) {
      // Reverse to counter-clockwise; edge k (k to k+1) becomes edge n-2-k.
      const n = outline.length;
      outline = [...outline].reverse();
      partyEdges = partyEdges.map((k) => (((n - 2 - k) % n) + n) % n);
    }
    const baseZ = num(p.baseHeight, 0);
    out.push({
      id: typeof p.id === 'string' ? p.id : `part-${i}`,
      outline,
      partyEdges,
      baseZ,
      eaveZ: num(p.eaveHeight, baseZ + 3),
    });
  });
  return out;
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

interface Plane {
  ring: V3[];
  normal: V3;
  at: V3;
}

/** The plane of a ring: unit normal pointing up, through the vertex mean. */
function planeOf(ring: V3[]): Plane {
  let n = newell(ring);
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
  return { ring, normal: n, at: mean(ring) };
}

/** Height of the plane over (x, y); NaN for a vertical plane. */
function planeZ(f: Plane, x: number, y: number): number {
  const [nx, ny, nz] = f.normal;
  if (Math.abs(nz) < 1e-6) return NaN;
  return f.at[2] - (nx * (x - f.at[0]) + ny * (y - f.at[1])) / nz;
}

/** The highest of these planes over (x, y) among those whose outline covers it, else NaN. */
function topAt(planes: Plane[], p: P2): number {
  let z = NaN;
  for (const f of planes) {
    if (!insideOrNear(p, f.ring, 0.05)) continue;
    const h = planeZ(f, p[0], p[1]);
    if (Number.isFinite(h) && !(h <= z)) z = h;
  }
  return z;
}

/** Where segment ab meets these rings' edges and vertices, as fractions of ab in (0, 1). */
function breaksAlong(a: P2, b: P2, rings: V3[][]): number[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const out: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i]!;
      const d = ring[(i + 1) % ring.length]!;
      // a vertex on the segment
      if (segDist(c, a, b) < TOL) out.push(((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / len ** 2);
      // a proper crossing
      const ex = d[0] - c[0];
      const ey = d[1] - c[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (u >= 0 && u <= 1) out.push(t);
    }
  }
  return out.filter((t) => t > 1e-4 && t < 1 - 1e-4);
}

/**
 * Each part's outside walls as vertical polygons: from the footprint up to
 * the roof planes over the wall line (so a gable end rises to its ridge).
 * Where another part's footprint shares the wall line (the fitter's cut
 * between parts), only what stands above that part's roof is a wall.
 */
function wallsOf(parts: SpecPart[], planesByPart: Map<string, Plane[]>): RoofPlan['parts'] {
  return parts.map((part, k) => {
    const own = planesByPart.get(part.id) ?? [];
    const walls: (Poly3 & { party: boolean })[] = [];
    const ring = part.outline;
    const centroidZ = (part.baseZ + part.eaveZ) / 2;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) return;
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      const tOf = (p: P2) => ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / len;
      const off = (p: P2) => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
      // stretches of [0, 1] another part's edge covers, and that part's roof planes
      const covered: { lo: number; hi: number; planes: Plane[] }[] = [];
      parts.forEach((other, m) => {
        if (m === k) return;
        const o = other.outline;
        o.forEach((c, j) => {
          const d = o[(j + 1) % o.length]!;
          if (off(c) > TOL || off(d) > TOL) return;
          const lo = Math.max(0, Math.min(tOf(c), tOf(d)));
          const hi = Math.min(1, Math.max(tOf(c), tOf(d)));
          if ((hi - lo) * len > 0.01)
            covered.push({ lo, hi, planes: planesByPart.get(other.id) ?? [] });
        });
      });
      const rings = [...own, ...covered.flatMap((c) => c.planes)].map((f) => f.ring);
      const ts = [0, 1, ...breaksAlong(a, b, rings), ...covered.flatMap((c) => [c.lo, c.hi])].sort(
        (x, y) => x - y,
      );
      const at = (t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const top = (t: number) => {
        const z = topAt(own, at(t));
        return Number.isFinite(z) ? z : part.eaveZ;
      };
      const coverOf = (lo: number, hi: number) =>
        covered.find((s) => (lo + hi) / 2 > s.lo && (lo + hi) / 2 < s.hi) ?? null;
      const bottom = (t: number, c: (typeof covered)[number] | null) => {
        if (!c) return part.baseZ;
        const z = topAt(c.planes, at(t));
        return Number.isFinite(z) ? z : part.baseZ;
      };
      const stops: number[] = [];
      for (const t of ts) {
        if (stops.length > 0 && (t - stops[stops.length - 1]!) * len < 0.01) continue;
        stops.push(t);
      }
      const outN: V3 = [uy, -ux, 0]; // counter-clockwise ring: outward is to the right
      const party = part.partyEdges.includes(i);
      // Runs of stops with the same footing (the ground, or one other part's roof).
      let n = 0;
      while (n < stops.length - 1) {
        const c = coverOf(stops[n]!, stops[n + 1]!);
        let m = n + 1;
        while (m < stops.length - 1 && coverOf(stops[m]!, stops[m + 1]!) === c) m++;
        const run = stops.slice(n, m + 1).map((t) => ({ t, top: top(t), bottom: bottom(t, c) }));
        if (run.some((q) => q.top - q.bottom > 0.05)) {
          const upper = run.map((q) => [...at(q.t), q.top] as V3);
          const lower = run.map((q) => [...at(q.t), Math.min(q.bottom, q.top)] as V3).reverse();
          walls.push({ pts: dropCollinear3([...lower, ...upper]), normal: outN, party });
        }
        n = m;
      }
    });
    const c2 = mean(ring.map((p) => [p[0], p[1], 0] as V3));
    return { id: part.id, walls, centroid: [c2[0], c2[1], centroidZ] };
  });
}

/** Removes vertices of a vertical polygon that lie on the line between their neighbours. */
function dropCollinear3(ring: V3[]): V3[] {
  const out = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]!;
    const b = ring[(i + 1) % ring.length]!;
    const u = sub(b, a);
    const w = sub(p, a);
    const cx = u[1] * w[2] - u[2] * w[1];
    const cy = u[2] * w[0] - u[0] * w[2];
    const cz = u[0] * w[1] - u[1] * w[0];
    return Math.hypot(cx, cy, cz) / (Math.hypot(u[0], u[1], u[2]) || 1) > 1e-3;
  });
  return out.length >= 3 ? out : ring;
}

// ---- Windows and doors, from the mesh --------------------------------------

/**
 * Glass panes and door leaves as rectangles on the wall they sit in: each
 * connected piece of the mesh's opening layers, measured along its nearest
 * wall and in height.
 */
function openingsOf(mesh: HouseMesh, house: RoofPlan['parts']): RoofPlan['openings'] {
  const out: RoofPlan['openings'] = [];
  for (const layer of mesh.layers) {
    if (layer.kind !== 'openings') continue;
    const kind = layer.material === 'glass' ? 'window' : layer.material === 'door' ? 'door' : null;
    if (!kind) continue;
    const part = house.find((p) => p.id === layer.partId);
    if (!part) continue;
    // connected pieces, by shared positions
    const n = layer.positions.length / 3;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const key = (i: number) =>
      [0, 1, 2].map((k) => Math.round(layer.positions[3 * i + k]! * 200)).join(',');
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const k = key(i);
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i);
      else parent[find(i)] = find(j);
    }
    for (let t = 0; t < layer.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => layer.indices[t + k]!) as [number, number, number];
      parent[find(a)] = find(b);
      parent[find(b)] = find(c);
    }
    const groups = new Map<number, V3[]>();
    for (let i = 0; i < n; i++) {
      const p: V3 = [
        layer.positions[3 * i]!,
        layer.positions[3 * i + 1]!,
        layer.positions[3 * i + 2]!,
      ];
      const r = find(i);
      groups.set(r, [...(groups.get(r) ?? []), p]);
    }
    for (const pts of groups.values()) {
      const c = mean(pts);
      // the nearest wall in plan
      let best = -1;
      let bestD = Infinity;
      part.walls.forEach((w, i) => {
        const [a, b] = baseLine(w);
        const d = segDist(c, a, b);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0 || bestD > 0.6) continue;
      const wall = part.walls[best]!;
      const [a, b] = baseLine(wall);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const ts = pts.map((p) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]);
      const zs = pts.map((p) => p[2]);
      const [t0, t1] = [Math.max(0, Math.min(...ts)), Math.min(len, Math.max(...ts))];
      const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
      if (t1 - t0 < 0.1 || z1 - z0 < 0.1) continue;
      const lift = 0.02;
      const at = (t: number, z: number): V3 => [
        a[0] + u[0] * t + wall.normal[0] * lift,
        a[1] + u[1] * t + wall.normal[1] * lift,
        z,
      ];
      out.push({
        partId: part.id,
        wall: best,
        kind,
        pts: [at(t0, z0), at(t1, z0), at(t1, z1), at(t0, z1)],
      });
    }
  }
  return out;
}

/** A wall's line on the ground, in plan, in the footprint's direction. */
function baseLine(w: Poly3): [P2, P2] {
  // The wall runs along the direction at right angles to its normal.
  const u: P2 = [-w.normal[1], w.normal[0]];
  const ts = w.pts.map((p) => p[0] * u[0] + p[1] * u[1]);
  const lo = w.pts[ts.indexOf(Math.min(...ts))]!;
  const hi = w.pts[ts.indexOf(Math.max(...ts))]!;
  return [
    [lo[0], lo[1]],
    [hi[0], hi[1]],
  ];
}

// ---- Panels ------------------------------------------------------------------

/** A placement's four corners as placed (on its rails, just off the roof). */
function panelCorners(p: PanelPlacement): V3[] {
  const hw = p.widthM / 2;
  const hh = p.heightM / 2;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(
    ([s, t]) =>
      [0, 1, 2].map((k) => p.center[k]! + p.across[k]! * s + p.up[k]! * t) as unknown as V3,
  );
}

// ---- Attached neighbours ---------------------------------------------------

/** The part of ring within `depth` of the line through a (direction u), on the side `away`. */
function clipStub(ring: P2[], a: P2, away: P2, depth: number): P2[] {
  const d = (p: P2) => (p[0] - a[0]) * away[0] + (p[1] - a[1]) * away[1];
  const out: P2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const dp = d(p) - depth;
    const dq = d(q) - depth;
    if (dp <= 0) out.push(p);
    if (dp < 0 !== dq < 0 && Math.abs(dq - dp) > 1e-9) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return dropCollinear(out);
}

/**
 * The edge of a neighbour's ring it shares with the house: the most overlap
 * along a house wall line, with that wall's part; failing that, the edge
 * nearest the house.
 */
function sharedEdge(
  ring: P2[],
  houseEdges: { a: P2; b: P2; part: SpecPart }[],
  houseC: V3,
): { edge: [P2, P2]; part: SpecPart | null } {
  let best: { edge: [P2, P2]; part: SpecPart | null } | null = null;
  let most = 0;
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i]!;
    const d = ring[(i + 1) % ring.length]!;
    for (const { a, b, part } of houseEdges) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const offc = Math.abs((c[0] - a[0]) * u[1] - (c[1] - a[1]) * u[0]);
      const offd = Math.abs((d[0] - a[0]) * u[1] - (d[1] - a[1]) * u[0]);
      if (offc > 0.3 || offd > 0.3) continue;
      const tc = (c[0] - a[0]) * u[0] + (c[1] - a[1]) * u[1];
      const td = (d[0] - a[0]) * u[0] + (d[1] - a[1]) * u[1];
      const lap = Math.min(len, Math.max(tc, td)) - Math.max(0, Math.min(tc, td));
      if (lap > most) {
        most = lap;
        best = { edge: [c, d], part };
      }
    }
  }
  if (best) return best;
  let nearest = Infinity;
  let edge: [P2, P2] = [ring[0]!, ring[1]!];
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i]!;
    const d = ring[(i + 1) % ring.length]!;
    const dist = segDist(houseC, c, d);
    if (dist < nearest) {
      nearest = dist;
      edge = [c, d];
    }
  }
  return { edge, part: null };
}

/**
 * Each attached neighbour as a short solid: the stretch of it within
 * NEIGHBOUR_STUB_M of the wall it shares with the house, up to its eave,
 * with a gable roof running away from the house when its ridge stands above
 * the eave and its footprint is a plain four-sided block.
 */
function neighboursOf(
  spec: HouseModelSpec,
  parts: SpecPart[],
  ridgeOf: Map<string, number>,
  faces: RoofPlan['faces'],
): RoofPlan['neighbours'] {
  const list = (spec.context as { neighbours?: unknown }).neighbours;
  if (!Array.isArray(list)) return [];
  const houseEdges = parts.flatMap((p) =>
    p.outline.map((a, i) => ({ a, b: p.outline[(i + 1) % p.outline.length]!, part: p })),
  );
  const houseC = mean(parts.flatMap((p) => p.outline.map((q) => [q[0], q[1], 0] as V3)));
  const out: RoofPlan['neighbours'] = [];
  for (const raw of list as unknown[]) {
    const nb = raw as {
      attached?: unknown;
      footprint?: { outer?: unknown };
      height?: unknown;
      eaveHeight?: unknown;
    } | null;
    if (!nb || nb.attached !== true) continue;
    let ring = ringOf(nb.footprint?.outer);
    if (!ring) continue;
    if (signedArea(ring) < 0) ring = [...ring].reverse();
    const height = num(nb.height, NaN);
    let eave = num(nb.eaveHeight, Number.isFinite(height) ? height : NaN);
    if (!Number.isFinite(eave) || eave <= 0.5) continue;
    let ridge = Number.isFinite(height) && height > eave + 0.3 ? height : eave;

    const { edge, part: own } = sharedEdge(ring, houseEdges, houseC);
    // A terrace shares one roof line; the neighbour's measured heights are
    // rougher than the house's own, so close enough means the same.
    const ownRidge = own ? ridgeOf.get(own.id) : undefined;
    let snapped = false;
    if (own && ownRidge !== undefined) {
      if (Math.abs(eave - own.eaveZ) < 1.2 && Math.abs(ridge - ownRidge) < 1.2) {
        eave = own.eaveZ;
        ridge = ownRidge;
        snapped = true;
      }
    }
    const [s0, s1] = edge;
    const sl = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
    // counter-clockwise ring: the inside is to the left of each edge
    const away: P2 = [-(s1[1] - s0[1]) / sl, (s1[0] - s0[0]) / sl];
    const depthOf = (p: P2) => (p[0] - s0[0]) * away[0] + (p[1] - s0[1]) * away[1];
    const fullDepth = Math.max(...ring.map(depthOf));
    const cut = fullDepth > NEIGHBOUR_STUB_M + 0.2;
    const stub = cut ? clipStub(ring, s0, away, NEIGHBOUR_STUB_M) : ring;
    if (stub.length < 3) continue;

    const inside: V3 = [
      ...mean(stub.map((p) => [p[0], p[1], 0] as V3)).slice(0, 2),
      eave / 2,
    ] as V3;
    const farD = Math.max(...stub.map(depthOf));
    const isNear = (p: P2) => depthOf(p) < 0.05;
    const isFar = (p: P2) => depthOf(p) > farD - 0.05;
    const gable =
      ridge > eave &&
      stub.length === 4 &&
      stub.filter(isNear).length === 2 &&
      stub.filter(isFar).length === 2;

    const walls: Poly3[] = [];
    const roofs: Poly3[] = [];
    let cutFace: Poly3 | null = null;
    // the ridge line, mid-way along the near and far ends
    const midOf = (pred: (p: P2) => boolean): V3 => {
      const e = stub.filter(pred);
      return [(e[0]![0] + e[1]![0]) / 2, (e[0]![1] + e[1]![1]) / 2, ridge];
    };
    const r0 = gable ? midOf(isNear) : null;
    const r1 = gable ? midOf(isFar) : null;
    stub.forEach((a, i) => {
      const b = stub[(i + 1) % stub.length]!;
      const end = (isNear(a) && isNear(b)) || (isFar(a) && isFar(b));
      const base: V3[] = [
        [a[0], a[1], 0],
        [b[0], b[1], 0],
        [b[0], b[1], eave],
      ];
      const pts: V3[] =
        gable && end
          ? [...base, isNear(a) ? r0! : r1!, [a[0], a[1], eave]]
          : [...base, [a[0], a[1], eave]];
      const poly = outward(pts, inside);
      if (cut && isFar(a) && isFar(b)) cutFace = poly;
      else walls.push(poly);
      if (gable && !end) {
        // the roof slope over this side wall
        const near = isNear(a) ? r0! : r1!;
        const far = isNear(b) ? r0! : r1!;
        roofs.push(
          outward([[a[0], a[1], eave], [b[0], b[1], eave], far, near], [inside[0], inside[1], 0]),
        );
      }
    });
    // One terrace roof: the house's slopes that meet the party line carry on
    // into the neighbour, so their eave and ridge lines run straight through.
    const carried =
      gable && snapped && own ? carryOn(faces, own.id, s0, s1, away, farD, inside) : null;
    if (carried) roofs.splice(0, roofs.length, ...carried);
    if (!gable) {
      roofs.push(
        outward(
          stub.map((p) => [p[0], p[1], ridge] as V3),
          [inside[0], inside[1], 0],
        ),
      );
    }
    out.push({
      walls,
      roofs,
      cut: cutFace,
      centroid: [inside[0], inside[1], ridge / 2],
      shared: [s0, s1],
      away,
      reach: farD,
      joined: carried !== null,
    });
  }
  return out;
}

/**
 * The house's roof slopes that meet the party line (an edge of the slope on
 * it, in plan), each carried on `reach` metres into the neighbour; null
 * unless there are two such slopes (a gable on the party wall).
 */
function carryOn(
  faces: RoofPlan['faces'],
  partId: string,
  s0: P2,
  s1: P2,
  away: P2,
  reach: number,
  inside: V3,
): Poly3[] | null {
  const sl = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
  const off = (p: V3) =>
    Math.abs(((p[0] - s0[0]) * (s1[1] - s0[1]) - (p[1] - s0[1]) * (s1[0] - s0[0])) / sl);
  const out: Poly3[] = [];
  for (const f of faces) {
    if (f.partId !== partId) continue;
    const on = f.outline.filter((p) => off(p) < 0.05);
    if (on.length !== 2) continue;
    const [a, b] = on as [V3, V3];
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 0.5) continue;
    const go = (p: V3): V3 => [p[0] + away[0] * reach, p[1] + away[1] * reach, p[2]];
    out.push(outward([a, b, go(b), go(a)], [inside[0], inside[1], 0]));
  }
  return out.length === 2 ? out : null;
}

/** The first line of the spec's address (`address.input`, up to its first comma). */
function addressOf(spec: HouseModelSpec): string | null {
  const a = (spec as { address?: { input?: unknown } }).address;
  const input = typeof a?.input === 'string' ? a.input.trim() : '';
  const first = input.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
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

  // Every roof face: the overhanging skin as drawn, the wall-line roof for the walls' tops.
  const faces: RoofPlan['faces'] = [];
  const planesByPart = new Map<string, Plane[]>();
  for (const info of mesh.roofFaces) {
    const skin = faceTriangles(mesh, info.id, 'roof-skin');
    const line = faceTriangles(mesh, info.id, 'roof');
    const ring = outlineOf(skin.length > 0 ? skin : line);
    if (!ring) {
      // A face holding panels that cannot be drawn means no honest plan.
      if (panelled.has(info.id)) return null;
      continue;
    }
    const lineRing = line.length > 0 ? outlineOf(line) : ring;
    if (lineRing) {
      planesByPart.set(info.partId, [...(planesByPart.get(info.partId) ?? []), planeOf(lineRing)]);
    }
    faces.push({
      id: info.id,
      partId: info.partId,
      outline: ring,
      normal: planeOf(ring).normal,
      pitchDeg: info.pitchDeg,
      azimuthDeg: info.azimuthDeg,
      panelled: panelled.has(info.id),
    });
  }

  const main = held.reduce((best, p) => (p.count > best.count ? p : best));
  const mainFace = faces.find((f) => f.id === main.faceId);
  if (!mainFace) return null;

  const specParts = partsOf(spec);
  const ridgeOf = new Map<string, number>();
  for (const f of faces) {
    const top = Math.max(...f.outline.map((v) => v[2]));
    ridgeOf.set(f.partId, Math.max(ridgeOf.get(f.partId) ?? -Infinity, top));
  }
  const parts = wallsOf(specParts, planesByPart);

  return {
    parts,
    faces,
    openings: openingsOf(mesh, parts),
    panels: layout.placements.map((p) => ({
      faceId: p.faceId,
      corners: panelCorners(p),
      portrait: p.heightM >= p.widthM,
    })),
    neighbours: neighboursOf(spec, specParts, ridgeOf, faces),
    mainFace: { id: mainFace.id, pitchDeg: mainFace.pitchDeg, azimuthDeg: mainFace.azimuthDeg },
    mainFacing: facingWord(mainFace.azimuthDeg),
    address: addressOf(spec),
    sample: opts.sample ?? false,
  };
}
