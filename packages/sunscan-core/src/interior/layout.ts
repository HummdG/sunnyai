// layoutInterior: indicative UK-archetype floor plans per storey ("circulation strip + front/back bands",
// research 05 §7.4, prototype research/methods/roofit/layout.py) on the real (inset) footprint.
//
// Pipeline (main part): plan frame from the front edge -> usable area = footprint inset by the wall
// thickness -> largest inscribed rectangle touching the front (main plan rectangle) -> archetype room
// seeds per storey (+ rear part / implicit back wing programme, + extra rooms in big leftovers) ->
// exact slab tiling: leftover slivers join the neighbouring room -> outlines, partitions, junction walls,
// doors (breadth-first from the circulation), straight flights -> NDSS relabelling, bedroom numbering.
import type { Ring, Vec2 } from '../geometry/geom.js';
import { ringArea } from '../geometry/geom.js';
import type { InteriorInput, InteriorLayout, InteriorWall, RoomInfo, StairFlight } from '../types.js';
import { INTERIOR_RULES as RULES } from './constants.js';
import {
  chooseArchetype, chooseSide, compactSeeds, extraSeed, mainSeeds, rearSeeds, rearViable, stairX,
  type MainPlan, type Seed,
} from './archetype.js';
import { orderEnds, type RoomBuild, type WallBuild } from './build.js';
import { junctionWalls, placeDoors } from './doors.js';
import { chooseFrontEdge, makePlanFrame, partySides, quarterTurn, toPlan, toWorld, type PlanFrame } from './frame.js';
import { normalizeInput, type NormInput } from './input.js';
import { bandsOf, largestRect, rectH, rectW, type Rect } from './lir.js';
import { cleanRings, insetRings, pointInRings } from './polygon.js';
import { flightSpecs, placeFlights, type FlightSpec } from './stairs.js';
import { detectWing, distribute, extraRects, partitions, roomRing, tile, untiledArea } from './tiling.js';
import { decompose, pieceMid, type Piece } from './trapezoids.js';

/** A tiled zone (main block or rear part) in its own axis-aligned sub-frame (k quarter turns from plan). */
interface Zone {
  partId: string;
  k: number;
  fpPlan: Ring[];
  U: Ring[];
  R: Rect;
  storeys: number;
  extras: Rect[];
  exclude?: (P: Piece) => boolean;
}

const offset = (s: Seed, r: Rect): Seed => ({
  ...s,
  rect: { x0: r.x0 + s.rect.x0, x1: r.x0 + s.rect.x1, y0: r.y0 + s.rect.y0, y1: r.y0 + s.rect.y1 },
});

/** Usable area: footprint rings (plan) inset by the wall thickness; falls back to the shrunken main rectangle. */
function usable(fp: Ring[], t: number, what: string, warnings: string[]): Ring[] {
  const res = insetRings(fp, t);
  if (res.rings.length) return res.rings;
  const R = largestRect(bandsOf(decompose(fp, []), null));
  if (res.method === 'failed' && R && rectW(R) > 2 * t + 0.5 && rectH(R) > 2 * t + 0.5) {
    warnings.push(`interior: ${what} wall inset failed; usable area approximated by its inscribed rectangle`);
    return [[[R.x0 + t, R.y0 + t], [R.x1 - t, R.y0 + t], [R.x1 - t, R.y1 - t], [R.x0 + t, R.y1 - t]]];
  }
  warnings.push(`interior: ${what} footprint has no usable area inside ${t.toFixed(2)} m walls`);
  return [];
}

/** Largest inscribed rectangle of a zone's usable area (pieces excluded by `exclude` are ignored). */
function zoneRect(U: Ring[], accept?: (r: Rect) => boolean, exclude?: (P: Piece) => boolean): Rect | null {
  const d = decompose(U, []);
  const ids = d.pieces.map((P, i) => (exclude?.(P) ? -1 : i)).filter((i) => i >= 0);
  const bands = bandsOf(d, ids);
  return (accept ? largestRect(bands, accept) : null) ?? largestRect(bands);
}

/** Quarter turns that bring a part attached to the main footprint "behind" it (+y): from the longest
 *  shared edge's outward normal, else from the centroid offset. */
function attachTurns(mainOuter: Ring, rearOuter: Ring): number {
  let best = 0, dir: Vec2 | null = null;
  for (let i = 0; i < mainOuter.length; i++) {
    const a = mainOuter[i], b = mainOuter[(i + 1) % mainOuter.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    for (let j = 0; j < rearOuter.length; j++) {
      const c = rearOuter[j], e = rearOuter[(j + 1) % rearOuter.length];
      const M = Math.hypot(e[0] - c[0], e[1] - c[1]);
      if (M < 1e-6 || ((e[0] - c[0]) * d[0] + (e[1] - c[1]) * d[1]) / M > -0.995) continue;
      const off = (p: Vec2) => Math.abs(d[1] * (p[0] - a[0]) - d[0] * (p[1] - a[1]));
      if (off(c) > 0.1 || off(e) > 0.1) continue;
      const u1 = d[0] * (c[0] - a[0]) + d[1] * (c[1] - a[1]), u2 = d[0] * (e[0] - a[0]) + d[1] * (e[1] - a[1]);
      const ov = Math.min(L, Math.max(u1, u2)) - Math.max(0, Math.min(u1, u2));
      if (ov > Math.max(best, 0.3)) { best = ov; dir = [d[1], -d[0]]; }
    }
  }
  if (!dir) {
    const cm = mean(mainOuter), cr = mean(rearOuter);
    dir = [cr[0] - cm[0], cr[1] - cm[1]];
  }
  return Math.abs(dir[1]) >= Math.abs(dir[0]) ? (dir[1] >= 0 ? 0 : 2) : dir[0] > 0 ? 1 : 3;
}

const mean = (r: Ring): Vec2 => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];

/** Rear part zone in its sub-frame (junction side at the low-y side of its rectangle), or null. */
function rearZone(n: NormInput, frame: PlanFrame, fpMain: Ring[], warnings: string[]): Zone | null {
  const r = n.rear!;
  const fpPlan = cleanRings([r.outer, ...r.holes].map((ring) => ring.map((p) => toPlan(frame, p))));
  if (!fpPlan.length) return null;
  const k = attachTurns(fpMain[0], fpPlan[0]);
  const U = usable(fpPlan.map((ring) => ring.map((q) => quarterTurn(q, k))), n.t, 'rear part', warnings);
  if (!U.length) return null;
  const exclude = (P: Piece) => pointInRings(quarterTurn(pieceMid(P), -k), fpMain);
  const R = zoneRect(U, undefined, exclude);
  if (!R) return null;
  return { partId: r.partId, k, fpPlan, U, R, storeys: r.storeys, extras: extraRects(U, [R], exclude), exclude };
}

/** Tiles one zone for one storey; appends its rooms (plan coordinates) and partitions. */
function tileZone(z: Zone, seeds: Seed[], storey: number, rooms: RoomBuild[], walls: WallBuild[], warnings: string[]): number[] {
  const t = tile(z.U, seeds.map((s) => s.rect), z.exclude);
  distribute(t);
  const lost = untiledArea(t);
  if (lost > 1e-6) warnings.push(`storey ${storey}: ${lost.toFixed(3)} m2 of usable area in ${z.partId} touches no room and is not tiled`);
  const index = new Map<number, number>();
  seeds.forEach((s, i) => {
    const { ring, parts } = roomRing(t, i);
    if (!ring) return;
    if (parts > 1) warnings.push(`storey ${storey}: ${s.label} is not connected; only its largest part is kept`);
    const plan = ring.map((q) => quarterTurn(q, -z.k));
    index.set(i, rooms.length);
    rooms.push({
      storey, partId: z.partId, label: s.label, kind: s.kind, slot: s.slot, order: s.order,
      seedW: rectW(s.rect), seedH: rectH(s.rect), ring: plan, area: ringArea(plan),
    });
  });
  for (const p of partitions(t)) {
    const i = index.get(p.rooms[0]), j = index.get(p.rooms[1]);
    if (i === undefined || j === undefined) continue;
    const [a, b] = orderEnds(quarterTurn(p.a, -z.k), quarterTurn(p.b, -z.k));
    walls.push({ rooms: [i, j], a, b, thickness: RULES.partitionThickness, junction: false, doors: [] });
  }
  return [...index.values()];
}

/** Applies the NDSS bedroom check and numbers the bedrooms (storey by storey, front to back, main first). */
function ndssAndNumbering(rooms: RoomBuild[]): void {
  for (const r of rooms)
    if (r.kind === 'bedroom' && (r.area < RULES.ndssSingleArea || Math.min(r.seedW, r.seedH) < RULES.ndssMinWidth)) {
      r.label = 'study / box room';
      r.kind = 'habitable';
    }
  const beds = rooms.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'bedroom');
  beds.sort((p, q) => p.r.storey - q.r.storey || p.r.order - q.r.order || p.i - q.i);
  beds.forEach(({ r }, k) => { r.label = `bedroom ${k + 1}`; });
}

/** Converts plan-frame records to the public InteriorLayout (local ENU). */
function emit(n: NormInput, frame: PlanFrame, storeyRooms: RoomBuild[][], storeyWalls: WallBuild[][], stairs: StairFlight[], warnings: string[]): InteriorLayout {
  const rooms: RoomInfo[] = [];
  const walls: InteriorWall[] = [];
  storeyRooms.forEach((list, s) => {
    const used = new Set<string>();
    for (const r of list) {
      let id = `${r.partId}/s${s}/${r.slot}`;
      for (let k = 2; used.has(id); k++) id = `${r.partId}/s${s}/${r.slot}-${k}`;
      used.add(id);
      const polygon = r.ring.map((q) => toWorld(frame, q));
      rooms.push({
        id, partId: r.partId, storey: s, label: r.label, polygon, area: Math.abs(ringArea(polygon)),
        floorZ: n.levels[s].floorZ, ceilingZ: n.levels[s].ceilingZ, estimated: true,
      });
    }
    for (const w of storeyWalls[s])
      walls.push({ storey: s, a: toWorld(frame, w.a), b: toWorld(frame, w.b), thickness: w.thickness, doors: w.doors.map((d) => ({ ...d })) });
  });
  return { rooms, walls, stairs, warnings };
}

/** Main part: archetype plan (+ rear part or implicit back wing). */
function layoutMain(n: NormInput, warnings: string[]): InteriorLayout {
  const front = chooseFrontEdge(n.outer, n.kinds, n.frontEdge);
  const frame = makePlanFrame(n.outer, front);
  const outerP = n.outer.map((p) => toPlan(frame, p));
  const fp = cleanRings([outerP, ...n.holes.map((h) => h.map((p) => toPlan(frame, p)))]);
  const empty = { rooms: [], walls: [], stairs: [], warnings };
  if (!fp.length) return empty;
  const U = usable(fp, n.t, n.partId, warnings);
  if (!U.length) return empty;
  const fa = outerP[front], fb = outerP[(front + 1) % outerP.length];
  const yF = Math.min(fa[1], fb[1]) + n.t;
  const frontLen = Math.max(0, Math.hypot(fb[0] - fa[0], fb[1] - fa[1]) - 2 * n.t);
  const R = zoneRect(U, (r) => r.y0 <= yF + 0.5 && rectW(r) >= 0.8 * frontLen);
  if (!R) return empty;
  const rear = n.rear ? rearZone(n, frame, fp, warnings) : null;
  const wing = rear ? null : detectWing(U, R);
  const party = partySides(outerP, n.kinds);
  const W = rectW(R), D = rectH(R);
  const compact = W < RULES.compactMaxWidth || D < RULES.compactMaxDepth;
  if (compact) warnings.push(`interior: plan ${W.toFixed(2)} x ${D.toFixed(2)} m is too small for the archetype; compact plan used`);
  const arch = chooseArchetype(n.builtForm, n.storeys, party);
  if (n.builtForm === 'block') warnings.push('interior: built form "block": the plan shows a single indicative dwelling');
  const rearX: [number, number] | undefined =
    rear && rear.k === 0 ? xRange(rear.U, R) : wing ? [wing.x0 - R.x0, wing.x1 - R.x0] : undefined;
  const side = chooseSide(arch, W, party, rearX);
  const rearOk = rear ? rearViable(rectW(rear.R), rectH(rear.R)) : false;
  const flights = flightSpecs(n.levels, n.storeys, warnings);
  // two-storey houses only: in taller houses the box room would sit on the start of the next flight
  const boxRoom = !compact && (arch === 'semi' || arch === 'detached') && side !== 'C' && W >= RULES.boxRoomMinWidth && n.storeys === 2;
  const { yS0, yTop } = placeFlights(D, flights, boxRoom, warnings);
  const plan: MainPlan = {
    W, D, storeys: n.storeys, arch, side, boxRoom, yS0, yTop,
    rearStoreys: rear ? (rearOk ? rear.storeys : 0) : wing ? n.storeys : 0,
  };
  const sx = R.x0 + (compact ? 0 : stairX(plan));
  const flightRect = (f: FlightSpec): Rect => ({ x0: sx, x1: sx + RULES.stairWidth, y0: R.y0 + yS0, y1: R.y0 + yS0 + f.length });
  const main: Zone = { partId: n.partId, k: 0, fpPlan: fp, U, R, storeys: n.storeys, extras: extraRects(U, wing ? [R, wing] : [R]) };
  const storeyRooms: RoomBuild[][] = [];
  const storeyWalls: WallBuild[][] = [];
  for (let s = 0; s < n.storeys; s++) {
    const rooms: RoomBuild[] = [];
    const walls: WallBuild[] = [];
    const seeds = (compact ? compactSeeds(W, D, s, n.storeys) : mainSeeds(plan, s)).map((x) => offset(x, R));
    if (wing) seeds.push(...rearSeeds(rectW(wing), rectH(wing), s, 'wing').map((x) => offset(x, wing)));
    main.extras.forEach((r, i) => seeds.push(extraSeed(r, s === 0, `x${i}`)));
    const mainIdx = tileZone(main, seeds, s, rooms, walls, warnings);
    if (rear && s < rear.storeys) {
      const rs = rearSeeds(rectW(rear.R), rectH(rear.R), s).map((x) => offset(x, rear.R));
      rear.extras.forEach((r, i) => rs.push(extraSeed(r, s === 0, `x${i}`)));
      const rearIdx = tileZone(rear, rs, s, rooms, walls, warnings);
      const joints = junctionWalls(rooms, mainIdx, rearIdx, 2 * n.t + 0.1, fp, rear.fpPlan);
      if (!joints.length) warnings.push(`storey ${s}: rear part ${rear.partId} does not adjoin the main part; no connecting door`);
      walls.push(...joints);
    }
    if ((s === 1 || (n.storeys === 1 && s === 0)) && !rooms.some((r) => r.kind === 'bathroom'))
      warnings.push(`storey ${s}: no bathroom fits the plan`);
    const keepouts = flights.filter((f) => f.storey === s || f.storey === s - 1).map(flightRect);
    placeDoors(rooms, walls, keepouts, warnings);
    storeyRooms.push(rooms);
    storeyWalls.push(walls);
  }
  ndssAndNumbering(storeyRooms.flat());
  const stairs: StairFlight[] = flights.map((f) => {
    const r = flightRect(f);
    const poly: Vec2[] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
    return {
      storey: f.storey,
      start: toWorld(frame, [(r.x0 + r.x1) / 2, r.y0]),
      direction: [frame.uy[0], frame.uy[1]],
      width: RULES.stairWidth,
      risers: f.risers,
      riserHeight: f.rise,
      going: f.going,
      polygon: poly.map((q) => toWorld(frame, q)),
    };
  });
  return emit(n, frame, storeyRooms, storeyWalls, stairs, warnings);
}

/** x-range of a zone's usable area relative to the main rectangle's left side. */
function xRange(U: Ring[], R: Rect): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const r of U) for (const p of r) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
  return [lo - R.x0, hi - R.x0];
}

/**
 * Non-main parts laid out on their own (no stairs; their connecting door belongs to the main part):
 * garage -> 'garage' (store above); rear / extension -> outrigger programme along the part's long axis;
 * side / other -> one room per storey. Big leftovers become extra rooms as for the main part.
 */
function layoutPart(n: NormInput, warnings: string[]): InteriorLayout {
  const frame = makePlanFrame(n.outer, chooseFrontEdge(n.outer, n.kinds, n.frontEdge));
  const fp = cleanRings([n.outer, ...n.holes].map((r) => r.map((p) => toPlan(frame, p))));
  const empty = { rooms: [], walls: [], stairs: [], warnings };
  if (!fp.length) return empty;
  const U0 = usable(fp, n.t, n.partId, warnings);
  const R0 = U0.length ? zoneRect(U0) : null;
  if (!R0) return empty;
  const k = rectW(R0) > rectH(R0) ? 1 : 0; // long axis along +y
  const U = U0.map((r) => r.map((q) => quarterTurn(q, k)));
  const R = zoneRect(U)!;
  const zone: Zone = { partId: n.partId, k, fpPlan: fp, U, R, storeys: n.storeys, extras: extraRects(U, [R]) };
  const storeyRooms: RoomBuild[][] = [];
  const storeyWalls: WallBuild[][] = [];
  for (let s = 0; s < n.storeys; s++) {
    const w = rectW(R), h = rectH(R);
    const one = (label: string, kind: Seed['kind']): Seed[] => [{ rect: { x0: 0, x1: w, y0: 0, y1: h }, label, kind, slot: 'p0', order: 0 }];
    const base = n.role === 'garage' ? (s === 0 ? one('garage', 'service') : one('store', 'service'))
      : n.role === 'rear' || n.role === 'extension' ? rearSeeds(w, h, s)
        : one('other', 'habitable');
    const seeds = base.map((x) => offset(x, R));
    zone.extras.forEach((r, i) => seeds.push(extraSeed(r, s === 0, `x${i}`)));
    const rooms: RoomBuild[] = [];
    const walls: WallBuild[] = [];
    tileZone(zone, seeds, s, rooms, walls, warnings);
    placeDoors(rooms, walls, [], warnings);
    storeyRooms.push(rooms);
    storeyWalls.push(walls);
  }
  ndssAndNumbering(storeyRooms.flat());
  return emit(n, frame, storeyRooms, storeyWalls, [], warnings);
}

/**
 * Generates an indicative interior layout for one building part (see module header): rooms tiling each
 * storey's usable area (footprint inset by `wallThickness`), internal walls (0.1 m) with one 0.76 x 2.0 m
 * door per room, straight stair flights per storey transition, and warnings for anything approximated.
 * Pure and deterministic; never throws on malformed input (returns an empty layout with a warning).
 * Main parts get the archetype plan (an attached `rearPart` is planned as an outrigger and connected by a
 * door); other roles get a simple programme. All rooms carry `estimated: true`.
 */
export function layoutInterior(input: InteriorInput): InteriorLayout {
  const warnings: string[] = [];
  const n = normalizeInput(input, warnings);
  if (!n) return { rooms: [], walls: [], stairs: [], warnings };
  return n.role === 'main' ? layoutMain(n, warnings) : layoutPart(n, warnings);
}

