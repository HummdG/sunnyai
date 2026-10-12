// Meshing of an InteriorLayout (pure 2D plan from core/interior): partition walls as boxes from floor to ceiling
// split around door openings (2.0 m door head with wall above), thin room-floor polygons, stepped stair flights.
// Tops are clipped under the roof so nothing pokes through the roof skin in attic storeys.
import type { InteriorWall, RoomInfo, StairFlight, Vec2, Vec3 } from '../types.js';
import type { LayerBuilder, LayerSet } from './builder.js';
import { polygonMinusHoles } from './floors.js';
import { SLAB_THICKNESS, type StoreyLevel } from './levels.js';
import { ccw, finite, isConvexCCW } from './polyops.js';

/** Absolute roof height at a plan point over the whole house (null outside every roof). */
export type RoofTopFn = (p: Vec2) => number | null;

const DOOR_HEAD = 2.0;
const STEP = 0.25;

/** (s, z) samples of min(ceiling, roof - clearance) along a + d * s for s in [s0, s1], collinear points removed. */
export function topProfile(a: Vec2, d: Vec2, s0: number, s1: number, ceiling: number, roofTop: RoofTopFn, clearance: number): [number, number][] {
  const n = Math.max(1, Math.ceil((s1 - s0) / STEP));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const r = roofTop([a[0] + d[0] * s, a[1] + d[1] * s]);
    pts.push([s, r === null ? ceiling : Math.min(ceiling, r - clearance)]);
  }
  return simplify(pts);
}

function simplify(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i + 1 < pts.length; i++) {
    const p = out[out.length - 1], q = pts[i], r = pts[i + 1];
    if (Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) > 1e-9) out.push(q);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Parts of a top profile at least `minH` above zBot (split at the crossings; piecewise linear). */
export function clipProfile(top: [number, number][], zBot: number, minH = 0.05): [number, number][][] {
  const lim = zBot + minH;
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < top.length; i++) {
    const [s, z] = top[i];
    if (i > 0) {
      const [sp, zp] = top[i - 1];
      if ((zp - lim) * (z - lim) < 0) cur.push([sp + ((s - sp) * (lim - zp)) / (z - zp), lim]);
    }
    if (z >= lim - 1e-12) cur.push([s, z]);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.filter((p) => p.length >= 2 && p[p.length - 1][0] - p[0][0] > 0.02).map(simplify);
}

/**
 * Vertical slab (wall piece) along a + d*s, s in [s0, s1], thickness t centred on the line, from zBot to the
 * top profile. `bottom` adds the underside (lintels over doors).
 */
export function extrudeWall(b: LayerBuilder, a: Vec2, d: Vec2, t: number, top: [number, number][], zBot: number, bottom: boolean, tag?: number): void {
  if (top.length < 2) return;
  const m: Vec2 = [-d[1], d[0]];
  const P = (s: number, off: number, z: number): Vec3 => [a[0] + d[0] * s + m[0] * off, a[1] + d[1] * s + m[1] * off, z];
  const s0 = top[0][0], s1 = top[top.length - 1][0];
  const h = t / 2;
  // +m face: seen from +m, s grows to the left
  b.polygon([[P(s0, h, zBot), ...top.map(([s, z]) => P(s, h, z)), P(s1, h, zBot)]], [m[0], m[1], 0], undefined, tag);
  // -m face
  b.polygon([[P(s0, -h, zBot), P(s1, -h, zBot), ...[...top].reverse().map(([s, z]) => P(s, -h, z))]], [-m[0], -m[1], 0], undefined, tag);
  for (let i = 0; i + 1 < top.length; i++) {
    const [sa, za] = top[i], [sb, zb] = top[i + 1];
    b.quad(P(sa, -h, za), P(sb, -h, zb), P(sb, h, zb), P(sa, h, za), undefined, undefined, tag);
  }
  b.quad(P(s1, -h, zBot), P(s1, h, zBot), P(s1, h, top[top.length - 1][1]), P(s1, -h, top[top.length - 1][1]), [d[0], d[1], 0], undefined, tag);
  b.quad(P(s0, h, zBot), P(s0, -h, zBot), P(s0, -h, top[0][1]), P(s0, h, top[0][1]), [-d[0], -d[1], 0], undefined, tag);
  if (bottom) b.quad(P(s0, h, zBot), P(s1, h, zBot), P(s1, -h, zBot), P(s0, -h, zBot), [0, 0, -1], undefined, tag);
}

/** Interior partition walls of one layout, one layer per storey. */
export function emitInteriorWalls(set: LayerSet, partId: string, walls: InteriorWall[], level: (storey: number) => StoreyLevel | undefined, roofTop: RoofTopFn, clearance: number): number {
  let skipped = 0;
  for (const w of walls) {
    const L = level(w.storey);
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (!L || !finite(w.a[0], w.a[1], w.b[0], w.b[1]) || len < 0.05) { skipped++; continue; }
    const d: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const t = finite(w.thickness) && w.thickness > 0.01 ? Math.min(w.thickness, 0.5) : 0.1;
    const b = set.get({ id: `${partId}/storey-${w.storey}/interior-walls`, kind: 'interior', material: 'interior-wall', partId, storey: w.storey });
    // solid pieces between doors, lintels over doors
    const doors = (w.doors ?? []).filter((x) => finite(x.at, x.width) && x.width > 0.2)
      .map((x) => [Math.max(0, x.at - x.width / 2), Math.min(len, x.at + x.width / 2), finite(x.height) && x.height > 1.5 ? x.height : DOOR_HEAD] as [number, number, number])
      .filter(([s0, s1]) => s1 - s0 > 0.2).sort((p, q) => p[0] - q[0]);
    let cur = 0;
    const pieces: [number, number, number][] = []; // s0, s1, bottom
    for (const [s0, s1, hd] of doors) {
      if (s0 > cur + 1e-6) pieces.push([cur, s0, L.floorZ]);
      const from = Math.max(s0, cur);
      if (s1 > from + 1e-6) pieces.push([from, s1, L.floorZ + hd]);
      cur = Math.max(cur, s1);
    }
    if (len > cur + 1e-6) pieces.push([cur, len, L.floorZ]);
    for (const [s0, s1, zb] of pieces) {
      for (const top of clipProfile(topProfile(w.a, d, s0, s1, L.ceilingZ, roofTop, clearance), zb)) extrudeWall(b, w.a, d, t, top, zb, zb > L.floorZ + 1e-6);
    }
  }
  return skipped;
}

/** Room floors as thin polygons 1 cm above the slab, tagged with the room index; stairwell holes removed. */
export function emitRoomFloors(set: LayerSet, rooms: { room: RoomInfo; index: number }[], holes: (partId: string, storey: number) => Vec2[][]): void {
  for (const { room, index } of rooms) {
    if (!room.polygon || room.polygon.length < 3 || !room.polygon.every((p) => finite(p[0], p[1])) || !finite(room.floorZ)) continue;
    const b = set.get({ id: `${room.partId}/storey-${room.storey}/room-floors`, kind: 'interior', material: 'room-floor', partId: room.partId, storey: room.storey });
    const z = room.floorZ + 0.01;
    for (const piece of polygonMinusHoles([ccw(room.polygon)], holes(room.partId, room.storey))) {
      b.convex(piece.map((p): Vec3 => [p[0], p[1], z]), [0, 0, 1], undefined, index);
    }
  }
}

/** Plan rectangle of a flight as a convex CCW ring (its polygon if convex, else the rectangle from its axes). */
export function flightRect(f: StairFlight): Vec2[] {
  if (f.polygon && f.polygon.length >= 3 && f.polygon.every((p) => finite(p[0], p[1]))) {
    const r = ccw(f.polygon);
    if (isConvexCCW(r)) return r;
  }
  const l = Math.hypot(f.direction[0], f.direction[1]) || 1;
  const d: Vec2 = [f.direction[0] / l, f.direction[1] / l], m: Vec2 = [-d[1], d[0]];
  const run = Math.max(0, f.risers - 1) * f.going, h = f.width / 2;
  const P = (s: number, o: number): Vec2 => [f.start[0] + d[0] * s + m[0] * o, f.start[1] + d[1] * s + m[1] * o];
  return [P(0, -h), P(run, -h), P(run, h), P(0, h)];
}

/**
 * Floor opening above a flight: the flight's plan rectangle without its first treads, which keep >= 2.0 m headroom
 * under the upper slab (Approved Document K), so a box room / landing can still cover them.
 */
export function stairwellRect(f: StairFlight): Vec2[] {
  const l = Math.hypot(f.direction?.[0] ?? 0, f.direction?.[1] ?? 0);
  const n = Math.round(f.risers);
  if (!(l > 0) || !finite(f.start[0], f.start[1], f.width, f.riserHeight, f.going) || n < 2 || f.riserHeight <= 0 || f.going <= 0) return flightRect(f);
  const d: Vec2 = [f.direction[0] / l, f.direction[1] / l], m: Vec2 = [-d[1], d[0]];
  const run = (n - 1) * f.going, h = f.width / 2;
  const clear = Math.max(0, Math.floor((n * f.riserHeight - SLAB_THICKNESS - 2.0) / f.riserHeight + 1e-9));
  const s0 = Math.min(clear * f.going, Math.max(0, run - f.going));
  const P = (s: number, o: number): Vec2 => [f.start[0] + d[0] * s + m[0] * o, f.start[1] + d[1] * s + m[1] * o];
  return [P(s0, -h), P(run, -h), P(run, h), P(s0, h)];
}

/** Straight flights as closed stepped solids (treads, risers, side stringers, back). */
export function emitStairs(set: LayerSet, partId: string, flights: StairFlight[], level: (storey: number) => StoreyLevel | undefined): void {
  for (const f of flights) {
    const L = level(f.storey);
    const l = Math.hypot(f.direction?.[0] ?? 0, f.direction?.[1] ?? 0);
    if (!L || !(l > 0) || !finite(f.start[0], f.start[1], f.width, f.riserHeight, f.going) || !(f.risers >= 2) || f.width <= 0 || f.going <= 0 || f.riserHeight <= 0) continue;
    const d: Vec2 = [f.direction[0] / l, f.direction[1] / l], m: Vec2 = [-d[1], d[0]];
    const b = set.get({ id: `${partId}/storey-${f.storey}/stairs`, kind: 'stairs', material: 'stair', partId, storey: f.storey });
    const z0 = L.floorZ, R = f.riserHeight, g = f.going, n = Math.round(f.risers), h = f.width / 2;
    const P = (s: number, o: number, z: number): Vec3 => [f.start[0] + d[0] * s + m[0] * o, f.start[1] + d[1] * s + m[1] * o, z];
    const prof: [number, number][] = [[0, z0]];
    for (let i = 1; i < n; i++) prof.push([(i - 1) * g, z0 + i * R], [i * g, z0 + i * R]);
    const end = (n - 1) * g;
    prof.push([end, z0]);
    // side stringers: the profile runs clockwise in (s, z); seen from +m s grows to the left, so it is CCW there
    b.polygon([prof.map(([s, z]) => P(s, h, z))], [m[0], m[1], 0]);
    b.polygon([[...prof].reverse().map(([s, z]) => P(s, -h, z))], [-m[0], -m[1], 0]);
    for (let i = 1; i < n; i++) {
      const s0 = (i - 1) * g, zt = z0 + i * R;
      b.quad(P(s0, h, zt - R), P(s0, -h, zt - R), P(s0, -h, zt), P(s0, h, zt), [-d[0], -d[1], 0]); // riser
      b.quad(P(s0, -h, zt), P(s0 + g, -h, zt), P(s0 + g, h, zt), P(s0, h, zt), [0, 0, 1]); // tread
    }
    const zTop = z0 + (n - 1) * R;
    b.quad(P(end, -h, z0), P(end, h, z0), P(end, h, zTop), P(end, -h, zTop), [d[0], d[1], 0]); // back
  }
}
