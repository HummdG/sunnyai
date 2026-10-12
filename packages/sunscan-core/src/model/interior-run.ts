// Runs the interior layout (core/interior, developed separately against the InteriorInput / InteriorLayout
// contract) for the house: the main part with its attached rear part, then every other habitable part not covered.
// The provider is resolved defensively (missing export / throwing / malformed output -> warnings, never a crash).
import * as interiorModule from '../interior/index.js';
import { pointInPolygon, ringArea, type Ring } from '../geometry/geom.js';
import type { HouseModelSpec, InteriorInput, InteriorLayout, InteriorWall, RoomInfo, StairFlight, Vec2 } from '../types.js';
import { type FrontRef, srcEdgeAt } from './facade.js';
import { WALL_THICKNESS, type StoreyLevel } from './levels.js';
import type { PartGeometry } from './part.js';
import { ringCentroid, finite } from './polyops.js';
import { flightRect, stairwellRect } from './interior-mesh.js';

/** Signature of core/interior's layoutInterior. */
export type LayoutInteriorFn = (input: InteriorInput) => InteriorLayout;

/** The interior module's `layoutInterior` if it is exported (it is implemented separately), else undefined. */
export function resolveInteriorProvider(mod: unknown = interiorModule): LayoutInteriorFn | undefined {
  const f = mod && typeof mod === 'object' ? (mod as Record<string, unknown>)['layoutInterior'] : undefined;
  return typeof f === 'function' ? (f as LayoutInteriorFn) : undefined;
}

/** One successful layout call: the part it was called for, the levels it was given, the sanitised result. */
export interface LayoutRun {
  pg: PartGeometry;
  levels: StoreyLevel[];
  layout: InteriorLayout;
}

const okPt = (p: unknown): p is Vec2 => Array.isArray(p) && p.length >= 2 && finite(p[0] as number, p[1] as number);

/** Keep only well-formed rooms / walls / stairs; report what was dropped. */
export function sanitizeLayout(raw: unknown, pg: PartGeometry, levels: StoreyLevel[], parts: PartGeometry[], issues: string[]): InteriorLayout {
  const r = (raw ?? {}) as Partial<InteriorLayout>;
  const pid = pg.part.id;
  const ids = new Set(parts.map((p) => p.part.id));
  const rooms: RoomInfo[] = [];
  let dropped = 0, outside = 0;
  // anything whose plan centre is outside every part footprint is a layout bug: drop it rather than draw it
  const inHouse = (p: Vec2) => parts.some((q) => pointInPolygon(p, q.roof.prepared.poly));
  for (const x of Array.isArray(r.rooms) ? r.rooms : []) {
    if (!x || !Array.isArray(x.polygon) || x.polygon.length < 3 || !x.polygon.every(okPt) || !(Number.isInteger(x.storey) && x.storey >= 0)) { dropped++; continue; }
    if (!inHouse(ringCentroid(x.polygon))) { outside++; continue; }
    const L = levels[x.storey];
    const polygon = x.polygon.map((p) => [p[0], p[1]] as Vec2);
    const floorZ = finite(x.floorZ) ? x.floorZ : L?.floorZ;
    const ceilingZ = finite(x.ceilingZ) ? x.ceilingZ : L?.ceilingZ;
    if (floorZ === undefined || ceilingZ === undefined) { dropped++; continue; }
    rooms.push({
      id: String(x.id ?? `${pid}/room-${rooms.length + 1}`), partId: ids.has(x.partId) ? x.partId : pid, storey: x.storey,
      label: String(x.label ?? 'room'), polygon: ringArea(polygon) < 0 ? polygon.reverse() : polygon,
      area: finite(x.area) && x.area > 0 ? x.area : Math.abs(ringArea(polygon)), floorZ, ceilingZ, estimated: true,
    });
  }
  const walls: InteriorWall[] = (Array.isArray(r.walls) ? r.walls : []).filter((w) => {
    const ok = !!w && okPt(w.a) && okPt(w.b) && Number.isInteger(w.storey) && w.storey >= 0;
    if (!ok) dropped++;
    else if (!inHouse([(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2])) { outside++; return false; }
    return ok;
  }).map((w) => ({ ...w, doors: Array.isArray(w.doors) ? w.doors : [] }));
  const stairs: StairFlight[] = (Array.isArray(r.stairs) ? r.stairs : []).filter((s) => {
    const ok = !!s && okPt(s.start) && okPt(s.direction) && Number.isInteger(s.storey) && finite(s.width, s.risers, s.riserHeight, s.going);
    if (!ok) dropped++;
    else if (!inHouse(ringCentroid(flightRect(s)))) { outside++; return false; }
    return ok;
  });
  if (dropped) issues.push(`interior ${pid}: ${dropped} malformed item(s) ignored`);
  if (outside) issues.push(`interior ${pid}: ${outside} item(s) outside the footprint ignored`);
  const warnings = Array.isArray(r.warnings) ? r.warnings.map(String) : [];
  for (const w of warnings) issues.push(`interior ${pid}: ${w}`);
  return { rooms, walls, stairs, warnings };
}

/** True if some vertex of `a` lies within 0.3 m of b's boundary or inside it (attached parts). */
export function attached(a: PartGeometry, b: PartGeometry): boolean {
  const near = (p: Vec2, q: PartGeometry) => pointInPolygon(p, q.roof.prepared.poly) || q.walls.some((w) => {
    const t = Math.max(0, Math.min(w.length, (p[0] - w.a[0]) * w.d[0] + (p[1] - w.a[1]) * w.d[1]));
    return Math.hypot(p[0] - w.a[0] - w.d[0] * t, p[1] - w.a[1] - w.d[1] * t) < 0.3;
  });
  return a.walls.some((w) => near(w.a, b)) || b.walls.some((w) => near(w.a, a));
}

/** Call the provider for the main part (+ rear part) and for every other non-garage part it did not cover. */
export function runInterior(spec: HouseModelSpec, parts: PartGeometry[], levels: StoreyLevel[][], main: number, front: FrontRef | null, provider: LayoutInteriorFn, issues: string[]): LayoutRun[] {
  const runs: LayoutRun[] = [];
  const covered = new Set<string>();
  const order = [main, ...parts.map((_, i) => i).filter((i) => i !== main)];
  for (const pi of order) {
    const pg = parts[pi];
    if (!pg || covered.has(pg.part.id) || pg.part.role === 'garage' || !levels[pi]?.length) continue;
    const rear = pi === main ? parts.find((q, k) => k !== main && (q.part.role === 'rear' || q.part.role === 'extension') && q.base < pg.base + 0.3 && attached(q, pg)) : undefined;
    const input: InteriorInput = {
      partId: pg.part.id,
      footprint: pg.part.footprint,
      edgeKinds: pg.part.edgeKinds,
      frontEdge: front && front.part === pg ? srcEdgeAt(pg, front.wall, [(front.wall.a[0] + front.wall.b[0]) / 2, (front.wall.a[1] + front.wall.b[1]) / 2]) : undefined,
      storeys: levels[pi].length,
      levels: levels[pi].map((L) => ({ floorZ: L.floorZ, ceilingZ: L.ceilingZ })),
      wallThickness: WALL_THICKNESS,
      era: spec.era,
      builtForm: spec.builtForm,
      role: pg.part.role,
      rearPart: rear ? { partId: rear.part.id, footprint: rear.part.footprint, storeys: levels[parts.indexOf(rear)]?.length ?? rear.part.storeys } : undefined,
    };
    let raw: unknown;
    try {
      raw = provider(input);
    } catch (e) {
      issues.push(`interior ${pg.part.id}: layout failed (${(e as Error)?.message ?? String(e)}); interior skipped`);
      continue;
    }
    const layout = sanitizeLayout(raw, pg, levels[pi], parts, issues);
    covered.add(pg.part.id);
    for (const room of layout.rooms) covered.add(room.partId);
    runs.push({ pg, levels: levels[pi], layout });
  }
  return runs;
}

/** Along-wall extent of the ground-floor hall on the front wall (from the layout), if any. */
export function hallInterval(runs: LayoutRun[], front: FrontRef | null): [number, number] | undefined {
  if (!front) return undefined;
  const w = front.wall;
  for (const run of runs) {
    for (const room of run.layout.rooms) {
      if (room.storey !== 0 || room.partId !== front.part.part.id || !/hall/i.test(room.label)) continue;
      const near = room.polygon.filter((p) => -((p[0] - w.a[0]) * w.n[0] + (p[1] - w.a[1]) * w.n[1]) <= WALL_THICKNESS + 0.25);
      if (near.length < 2) continue;
      const s = near.map((p) => (p[0] - w.a[0]) * w.d[0] + (p[1] - w.a[1]) * w.d[1]);
      const lo = Math.max(0, Math.min(...s)), hi = Math.min(w.length, Math.max(...s));
      if (hi - lo >= 0.6) return [lo, hi];
    }
  }
  return undefined;
}

/** Stairwell openings: each flight on storey k opens the slab (and room floors) of storey k + 1 of its part. */
export function stairwellHoles(runs: LayoutRun[], parts: PartGeometry[]): Map<string, Ring[]> {
  const holes = new Map<string, Ring[]>();
  for (const run of runs) {
    for (const f of run.layout.stairs) {
      const rect = stairwellRect(f);
      const c = ringCentroid(flightRect(f));
      const pg = parts.find((q) => pointInPolygon(c, q.roof.prepared.poly)) ?? run.pg;
      const key = `${pg.part.id}|${f.storey + 1}`;
      const l = holes.get(key) ?? [];
      l.push(rect);
      holes.set(key, l);
    }
  }
  return holes;
}
