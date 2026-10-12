// Deterministic UK facade rules (research 05 §7.1-7.2): which wall faces the street, where the front door goes,
// windows on a 2.6 m module per storey, vertically aligned, era-dependent sizes, >= 0.45 m piers, nothing on
// party walls or on wall portions covered by another part, landing windows on short side walls.
import { bearing } from '../geometry/roof.js';
import type { Era, HouseModelSpec, OpeningInfo, Vec2 } from '../types.js';
import type { StoreyLevel } from './levels.js';
import { type PartGeometry, type WallInfo, wallTop } from './part.js';
import { raySegment, segmentInsideIntervals, subtractIntervals } from './polyops.js';

/** Minimum masonry pier at corners, party walls and between openings (m). */
export const PIER = 0.45;
/** Window bay module along a facade (m). */
export const MODULE = 2.6;
const LINTEL = 0.15;

/** Principal window of an era: width, height, ground / upper sill heights, upper-storey height factor, sash style. */
export interface WindowSize { w: number; h: number; sill: number; upperSill: number; upperScale: number; sash: boolean }
/** Window sizes by era (research 05 §7.2, roofit ERA_WINDOW; modern sizes snapped to stock casements). */
export const ERA_WINDOW: Record<Era, WindowSize> = {
  'pre-1919': { w: 0.95, h: 1.75, sill: 0.75, upperSill: 0.8, upperScale: 0.85, sash: true },
  '1919-1944': { w: 1.8, h: 1.35, sill: 0.85, upperSill: 0.9, upperScale: 1, sash: false },
  '1945-1964': { w: 1.5, h: 1.2, sill: 0.9, upperSill: 0.9, upperScale: 1, sash: false },
  '1965-1980': { w: 1.5, h: 1.2, sill: 0.9, upperSill: 0.9, upperScale: 1, sash: false },
  '1981-2000': { w: 1.2, h: 1.2, sill: 0.9, upperSill: 0.9, upperScale: 1, sash: false },
  'post-2000': { w: 1.2, h: 1.2, sill: 0.9, upperSill: 0.9, upperScale: 1, sash: false },
  unknown: { w: 1.2, h: 1.2, sill: 0.9, upperSill: 0.9, upperScale: 1, sash: false },
};
/** Front door frame (w x h incl. fanlight) by era. */
export const ERA_DOOR: Record<Era, { w: number; h: number; fanlight: number }> = {
  'pre-1919': { w: 0.95, h: 2.45, fanlight: 0.4 }, '1919-1944': { w: 0.9, h: 2.05, fanlight: 0 },
  '1945-1964': { w: 0.9, h: 2.05, fanlight: 0 }, '1965-1980': { w: 0.9, h: 2.05, fanlight: 0 },
  '1981-2000': { w: 0.9, h: 2.05, fanlight: 0 }, 'post-2000': { w: 0.9, h: 2.05, fanlight: 0 }, unknown: { w: 0.9, h: 2.05, fanlight: 0 },
};

/** Geometry style of an opening (glazing bars / panels). */
export type OpeningStyle = 'casement' | 'sash' | 'door' | 'garage';

/** An opening with its wall frame, used for meshing and for the public OpeningInfo. */
export interface PlannedOpening {
  info: OpeningInfo;
  part: PartGeometry;
  wall: WallInfo;
  /** Extent along the wall from wall.a (m) and absolute bottom/top heights. */
  s0: number;
  s1: number;
  z0: number;
  z1: number;
  style: OpeningStyle;
  /** Glazed fanlight height at the top of a door (m). */
  fanlight: number;
}

/** The street-facing wall of the house. */
export interface FrontRef { part: PartGeometry; wall: WallInfo }

/** Everything the facade rules need. */
export interface FacadeInput {
  spec: HouseModelSpec;
  parts: PartGeometry[];
  levels: StoreyLevel[][]; // by position in `parts`
  main: number; // position of the main part in `parts`
  front: FrontRef | null;
  /** Along-front-wall extent of the ground-floor hall (from the interior layout), if known. */
  hall?: [number, number];
}

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/** Pick the street-facing wall: facade hint, entrance node, road ray-cast, then the longest non-party wall. */
export function findFront(spec: HouseModelSpec, parts: PartGeometry[], main: number): FrontRef | null {
  const hint = spec.facade?.front;
  if (hint) {
    const pg = parts.find((p) => p.part.id === hint.partId);
    const w = pg?.walls.find((x) => x.srcEdges.includes(hint.edge) && x.kind !== 'party');
    if (pg && w) return { part: pg, wall: w };
  }
  const mp = parts[main];
  if (!mp) return null;
  const cands = mp.walls.filter((w) => w.kind !== 'party' && w.length >= 1.5);
  if (!cands.length) return null;
  const ent = spec.facade?.entrance;
  if (ent && Number.isFinite(ent[0]) && Number.isFinite(ent[1])) {
    let best: WallInfo | undefined, bd = 3;
    for (const w of cands) {
      const t = Math.max(0, Math.min(w.length, dot([ent[0] - w.a[0], ent[1] - w.a[1]], w.d)));
      const dd = Math.hypot(ent[0] - w.a[0] - w.d[0] * t, ent[1] - w.a[1] - w.d[1] * t);
      if (dd < bd) { bd = dd; best = w; }
    }
    if (best) return { part: mp, wall: best };
  }
  const roads = spec.context?.roads ?? [];
  if (roads.length) {
    let best: WallInfo | undefined, bs = 0;
    for (const w of cands) {
      if (w.length < 2) continue;
      const o: Vec2 = [w.a[0] + w.d[0] * w.length / 2, w.a[1] + w.d[1] * w.length / 2];
      let s = 0;
      for (const r of roads) {
        for (let i = 0; i + 1 < r.line.length; i++) {
          const t = raySegment(o, w.n, r.line[i], r.line[i + 1]);
          if (t === null || t > 60) continue;
          let sc = 1 / Math.max(t, 1);
          if (spec.facade?.streetName && r.name === spec.facade.streetName) sc *= 2;
          if (/service|footway|path|track|cycleway/.test(r.kind)) sc *= 0.5;
          s = Math.max(s, sc);
        }
      }
      if (s > bs) { bs = s; best = w; }
    }
    if (best) return { part: mp, wall: best };
  }
  // fallback: longest non-party wall; with party walls prefer walls perpendicular to them (front/back of a terrace)
  const party = mp.walls.filter((w) => w.kind === 'party' && w.length > 1);
  const perp = party.length ? cands.filter((w) => party.some((p) => Math.abs(dot(p.d, w.d)) < 0.35)) : [];
  const pool = perp.length ? perp : cands;
  return { part: mp, wall: pool.reduce((b, w) => (w.length > b.length + 1e-9 ? w : b), pool[0]) };
}

/** Intervals of the wall (along-wall metres) not covered by another part, shrunk by the corner piers. */
export function freeIntervals(pg: PartGeometry, w: WallInfo, parts: PartGeometry[]): [number, number][] {
  const cut: [number, number][] = [];
  const a: Vec2 = [w.a[0] + w.n[0] * 0.05, w.a[1] + w.n[1] * 0.05];
  const b: Vec2 = [w.b[0] + w.n[0] * 0.05, w.b[1] + w.n[1] * 0.05];
  for (const q of parts) {
    if (q === pg) continue;
    const rings = [q.roof.prepared.poly.outer, ...(q.roof.prepared.poly.holes ?? [])];
    for (const [t0, t1] of segmentInsideIntervals(a, b, rings)) cut.push([t0 * w.length - PIER, t1 * w.length + PIER]);
  }
  return subtractIntervals(PIER, w.length - PIER, cut);
}

interface Bay { c: number; w: number }

/** Windows centred in 2.6 m bays over [lo, hi]; width = min(preferred, bay - pier). */
function bays(lo: number, hi: number, preferred: number): Bay[] {
  const span = hi - lo;
  if (span < 0.6) return [];
  const n = Math.max(1, Math.floor(span / MODULE));
  const B = span / n;
  const width = Math.min(preferred, B - PIER, span);
  if (width < 0.45) return [];
  return Array.from({ length: n }, (_, i) => ({ c: lo + (i + 0.5) * B, w: width }));
}

type Role = 'front' | 'back' | 'side';

/** True if another part's footprint touches the outside of wall w (5 cm out). */
function wallOverlaps(w: WallInfo, q: PartGeometry): boolean {
  const a: Vec2 = [w.a[0] + w.n[0] * 0.05, w.a[1] + w.n[1] * 0.05];
  const b: Vec2 = [w.b[0] + w.n[0] * 0.05, w.b[1] + w.n[1] * 0.05];
  return segmentInsideIntervals(a, b, [q.roof.prepared.poly.outer, ...(q.roof.prepared.poly.holes ?? [])]).length > 0;
}

/** Plan all openings of the house. Pure function of the inputs (deterministic). */
export function planOpenings(inp: FacadeInput): PlannedOpening[] {
  const { spec, parts, levels, main, front } = inp;
  const era: Era = spec.era in ERA_WINDOW ? spec.era : 'unknown';
  const win = ERA_WINDOW[era];
  const out: PlannedOpening[] = [];
  const counters = new Map<string, number>();
  const nF: Vec2 = front ? front.wall.n : [0, -1];
  const mainPg = parts[main];
  const roleOf = (w: WallInfo): Role => (dot(w.n, nF) > 0.7 ? 'front' : dot(w.n, nF) < -0.7 ? 'back' : 'side');
  const freeLen = (pg: PartGeometry, w: WallInfo) => freeIntervals(pg, w, parts).reduce((s, [x, y]) => s + y - x, 0);
  const principal = (pg: PartGeometry, want: Role) => {
    let best: WallInfo | undefined, bl = 0;
    for (const w of pg.walls) {
      if (w.kind === 'party' || roleOf(w) !== want) continue;
      const L = freeLen(pg, w);
      if (L > bl + 1e-9) { bl = L; best = w; }
    }
    return best;
  };
  // back door: on the main block unless another part (outrigger / rear extension) covers its back wall
  const mainBack = mainPg ? principal(mainPg, 'back') : undefined;
  const rearParts = mainPg && mainBack ? parts.filter((q) => q !== mainPg && q.part.role !== 'garage' && wallOverlaps(mainBack, q)) : [];
  // front door first: its position decides the hall side, which the back door follows
  const frontDoor = front ? doorCentre(front.wall, freeIntervals(front.part, front.wall, parts), ERA_DOOR[era].w, inp.hall, frontSide(front.part, front.wall, parts, main)) : null;
  const hallPoint: Vec2 | null = front && frontDoor !== null ? [front.wall.a[0] + front.wall.d[0] * frontDoor, front.wall.a[1] + front.wall.d[1] * frontDoor] : null;
  const hallCentral = !!front && frontDoor !== null && Math.abs(frontDoor - front.wall.length / 2) < 0.75;

  const add = (pg: PartGeometry, w: WallInfo, storey: number, type: 'window' | 'door', c: number, width: number, z0: number, h: number, style: OpeningStyle, fanlight = 0, ceiling = Infinity) => {
    // fit under the wall top (eave / gable rake) with a lintel, and windows under the storey ceiling
    const s0 = c - width / 2, s1 = c + width / 2;
    const top = Math.min(wallTop(pg, w, s0), wallTop(pg, w, s1), wallTop(pg, w, c)) - LINTEL;
    const z1 = Math.min(z0 + h, type === 'window' ? Math.min(top, ceiling) : top);
    if (z1 - z0 < (type === 'door' ? 1.9 : 0.6)) return;
    const n = (counters.get(pg.part.id) ?? 0) + 1;
    counters.set(pg.part.id, n);
    const mid: Vec2 = [w.a[0] + w.d[0] * c, w.a[1] + w.d[1] * c];
    const info: OpeningInfo = {
      id: `${pg.part.id}/${type}-${n}`, partId: pg.part.id, type, storey, edge: srcEdgeAt(pg, w, mid),
      center: [mid[0], mid[1], (z0 + z1) / 2], width, height: z1 - z0, facingDeg: bearing(w.n), estimated: true,
    };
    out.push({ info, part: pg, wall: w, s0, s1, z0, z1, style, fanlight: type === 'door' ? Math.min(fanlight, Math.max(0, z1 - z0 - 1.95)) : 0 });
  };

  parts.forEach((pg, pi) => {
    const lv = levels[pi] ?? [];
    if (!lv.length) return;
    const isMain = pi === main;
    const isFrontPart = !!front && front.part === pg;
    if (pg.part.role === 'garage') {
      const w = principal(pg, 'front') ?? pg.walls.filter((x) => x.kind !== 'party').reduce<WallInfo | undefined>((b, x) => (!b || freeLen(pg, x) > freeLen(pg, b) + 1e-9 ? x : b), undefined);
      const zones = w ? freeIntervals(pg, w, parts) : [];
      if (!w || !zones.length) return;
      const [lo, hi] = zones.reduce((b, z) => (z[1] - z[0] > b[1] - b[0] ? z : b), zones[0]);
      const width = Math.min(2.4, hi - lo);
      if (width >= 1.8) add(pg, w, 0, 'door', (lo + hi) / 2, width, pg.base, 2.1, 'garage');
      return;
    }
    const backWall = isMain ? (rearParts.length ? undefined : mainBack) : rearParts.includes(pg) ? principal(pg, 'back') : undefined;
    for (const w of pg.walls) {
      if (w.kind === 'party' || w.length < 2 * PIER + 0.45) continue;
      const zones = freeIntervals(pg, w, parts);
      if (!zones.length) continue;
      const r = roleOf(w);
      const isFront = isFrontPart && w === front!.wall;
      // ground-floor door (front door at the hall side; back door at the hall end of the back wall)
      let door: { c: number; w: number; h: number; fan: number } | undefined;
      if (isFront || w === backWall) {
        const d = isFront ? ERA_DOOR[era] : { w: isMain ? 0.85 : 0.8, h: 2.05, fanlight: 0 };
        const c = isFront ? frontDoor : doorCentre(w, zones, d.w, undefined, hallCentral ? 'centre' : backSide(w, hallPoint));
        if (c !== null) door = { c, w: d.w, h: d.h, fan: d.fanlight };
      }
      const winZones = door ? zones.flatMap(([lo, hi]) => subtractIntervals(lo, hi, [[door!.c - door!.w / 2 - PIER, door!.c + door!.w / 2 + PIER]])) : zones;
      const shortMainSide = r === 'side' && w.length < 9 && (isMain || isFrontPart);
      const pref = r === 'front' ? win.w : r === 'back' ? Math.min(win.w, 1.2) : isMain || isFrontPart ? win.w : Math.min(win.w, 1.0);
      const wallBays = shortMainSide ? [] : winZones.flatMap(([lo, hi]) => bays(lo, hi, pref));
      const style: OpeningStyle = win.sash ? 'sash' : 'casement';
      const groundHead = win.sill + win.h;
      lv.forEach((L, k) => {
        if (k === 0 && door) add(pg, w, 0, 'door', door.c, door.w, L.floorZ, door.h, 'door', door.fan);
        const upper = k > 0;
        const sill = upper ? win.upperSill : r === 'back' ? Math.max(win.sill, 1.05) : win.sill; // kitchen sill at the back
        const h = upper ? win.h * win.upperScale : groundHead - sill;
        for (const b of wallBays) add(pg, w, k, 'window', b.c, b.w, L.floorZ + sill, h, style, 0, L.ceilingZ);
        if (upper && door) add(pg, w, k, 'window', door.c, Math.min(0.6, door.w), L.floorZ + Math.max(sill, 1.0), Math.min(h, 1.05), style, 0, L.ceilingZ);
        if (shortMainSide && upper) {
          // short side walls of the main block: one small landing window per upper storey (research 05 §7.2)
          const z = winZones.reduce((b, q) => (q[1] - q[0] > b[1] - b[0] ? q : b), winZones[0]);
          if (z && z[1] - z[0] >= 0.6) add(pg, w, k, 'window', (z[0] + z[1]) / 2, 0.6, L.floorZ + 1.0, 1.0, style, 0, L.ceilingZ);
        }
      });
    }
  });
  return out;
}

/** Original footprint edge (spec numbering) of the part containing a point on a prepared wall. */
export function srcEdgeAt(pg: PartGeometry, w: WallInfo, p: Vec2): number {
  if (w.srcEdges.length <= 1) return w.srcEdges[0] ?? w.edge;
  const rings = [pg.part.footprint.outer, ...(pg.part.footprint.holes ?? [])];
  const flat: [Vec2, Vec2][] = [];
  for (const r of rings) r.forEach((a, i) => flat.push([a, r[(i + 1) % r.length]]));
  let best = w.srcEdges[0], bd = Infinity;
  for (const e of w.srcEdges) {
    const seg = flat[e];
    if (!seg) continue;
    const [a, b] = seg;
    const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2));
    const d = Math.hypot(p[0] - a[0] - (b[0] - a[0]) * t, p[1] - a[1] - (b[1] - a[1]) * t);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Hall side of the front wall: 'a' / 'b' end (seen from the street a is on the left) or 'centre'. */
function frontSide(pg: PartGeometry, w: WallInfo, parts: PartGeometry[], main: number): 'a' | 'b' | 'centre' {
  const ring = pg.walls.filter((x) => x.ring === w.ring);
  const i = ring.indexOf(w);
  const prev = ring[(i - 1 + ring.length) % ring.length], next = ring[(i + 1) % ring.length];
  const pa = prev.kind === 'party', pb = next.kind === 'party';
  if (pa && !pb) return 'a';
  if (pb && !pa) return 'b';
  if (pa && pb) {
    // terrace: hall on the outrigger side (research 05 §7.4)
    const rear = parts.find((q, k) => k !== main && q.part.role === 'rear');
    if (rear) {
      const c = rear.walls.reduce<Vec2>((s, x) => [s[0] + x.a[0] / rear.walls.length, s[1] + x.a[1] / rear.walls.length], [0, 0]);
      return dot([c[0] - w.a[0], c[1] - w.a[1]], w.d) < w.length / 2 ? 'a' : 'b';
    }
    return 'a';
  }
  return w.length >= 8.5 ? 'centre' : 'a';
}

/** Back door at the end of the back wall nearer the front door (the hall runs front to back on that side). */
function backSide(w: WallInfo, hallPoint: Vec2 | null): 'a' | 'b' {
  if (!hallPoint) return 'b';
  return dot([hallPoint[0] - w.a[0], hallPoint[1] - w.a[1]], w.d) < w.length / 2 ? 'a' : 'b';
}

function doorCentre(w: WallInfo, zones: [number, number][], dw: number, hall: [number, number] | undefined, side: 'a' | 'b' | 'centre'): number | null {
  const fits = (c: number) => zones.some(([lo, hi]) => c - dw / 2 >= lo - 1e-9 && c + dw / 2 <= hi + 1e-9);
  if (hall) {
    const lo = Math.max(hall[0] + 0.05, PIER), hi = Math.min(hall[1] - 0.05, w.length - PIER);
    if (hi - lo >= dw) {
      const c = Math.min(Math.max((hall[0] + hall[1]) / 2, lo + dw / 2), hi - dw / 2);
      if (fits(c)) return c;
    }
  }
  const cands = side === 'a' ? [PIER + dw / 2, w.length / 2, w.length - PIER - dw / 2]
    : side === 'b' ? [w.length - PIER - dw / 2, w.length / 2, PIER + dw / 2] : [w.length / 2, PIER + dw / 2, w.length - PIER - dw / 2];
  for (const c of cands) if (fits(c)) return c;
  // any zone wide enough
  for (const [lo, hi] of zones) if (hi - lo >= dw) return side === 'b' ? hi - dw / 2 : lo + dw / 2;
  return null;
}
