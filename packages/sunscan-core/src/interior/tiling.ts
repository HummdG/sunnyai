// Tiling a usable region with rooms: seed rectangles claim the slab pieces inside them, leftover pieces
// either seed extra rooms (when a big enough rectangle fits) or are absorbed by the neighbouring room
// with the longest shared boundary. Rooms therefore tile the region exactly (up to fragments that touch
// no room, which are reported).
import type { Ring, Vec2 } from '../geometry/geom.js';
import { INTERIOR_RULES as RULES } from './constants.js';
import { bandsOf, largestRect, rectArea, rectH, rectW, type Rect } from './lir.js';
import { bridgeHoles } from './polygon.js';
import { ringArea } from '../geometry/geom.js';
import {
  components, contacts, decompose, outlineRings, pieceArea, pieceMid, TOL,
  type Contact, type Decomposition, type Piece,
} from './trapezoids.js';

/** A decomposition of a region with each piece's owner: room index, -1 unassigned, -2 excluded. */
export interface Tiling {
  d: Decomposition;
  cs: Contact[];
  adj: number[][];
  owner: Int32Array;
}

const inside = (p: Vec2, r: Rect) => p[0] > r.x0 && p[0] < r.x1 && p[1] > r.y0 && p[1] < r.y1;

/**
 * Decomposes `rings` with cuts at every seed side and assigns the pieces inside each seed rectangle
 * (seeds must be disjoint and inside the region). `exclude` marks pieces that must stay untiled.
 */
export function tile(rings: Ring[], seeds: Rect[], exclude?: (P: Piece) => boolean): Tiling {
  const d = decompose(rings, seeds.flatMap((s) => [s.x0, s.x1]), seeds.flatMap((s) => [s.y0, s.y1]));
  const cs = contacts(d);
  const adj: number[][] = d.pieces.map(() => []);
  cs.forEach((c, i) => {
    adj[c.a].push(i);
    adj[c.b].push(i);
  });
  const owner = new Int32Array(d.pieces.length).fill(-1);
  d.pieces.forEach((P, id) => {
    if (exclude?.(P)) { owner[id] = -2; return; }
    const m = pieceMid(P);
    for (let s = 0; s < seeds.length; s++) if (inside(m, seeds[s])) { owner[id] = s; break; }
  });
  return { d, cs, adj, owner };
}

/**
 * Grows rooms over unassigned pieces in rounds: each unassigned piece touching assigned pieces joins the
 * room with the longest shared boundary (ties -> lower room index). Rooms stay connected by construction.
 */
export function distribute(t: Tiling): void {
  for (;;) {
    const snap = Int32Array.from(t.owner);
    let changed = false;
    for (let id = 0; id < snap.length; id++) {
      if (snap[id] !== -1) continue;
      let best = -1, bestL = 0;
      const score = new Map<number, number>();
      for (const ci of t.adj[id]) {
        const c = t.cs[ci];
        const o = snap[c.a === id ? c.b : c.a];
        if (o >= 0) score.set(o, (score.get(o) ?? 0) + c.len);
      }
      for (const [o, L] of score) if (L > bestL + 1e-12 || (Math.abs(L - bestL) <= 1e-12 && o < best)) { best = o; bestL = L; }
      if (best >= 0) { t.owner[id] = best; changed = true; }
    }
    if (!changed) return;
  }
}

/** Area of the pieces left unassigned (-1) after distribution (fragments touching no room). */
export function untiledArea(t: Tiling): number {
  let a = 0;
  t.d.pieces.forEach((P, id) => { if (t.owner[id] === -1) a += pieceArea(P); });
  return a;
}

/**
 * Largest inscribed rectangle of each connected component of unassigned pieces that could contain a
 * minSide x minSide square of at least minArea (components failing the area / bounding-box bounds are
 * skipped without searching).
 */
export function leftoverRects(t: Tiling, minSide: number, minArea: number): Rect[] {
  const comps = components(t.d, t.adj, t.cs, (id) => t.owner[id] === -1);
  const out: Rect[] = [];
  for (const comp of comps) {
    let area = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const id of comp) {
      const P = t.d.pieces[id];
      area += pieceArea(P);
      x0 = Math.min(x0, P.xlb, P.xlt); x1 = Math.max(x1, P.xrb, P.xrt);
      y0 = Math.min(y0, P.yb); y1 = Math.max(y1, P.yt);
    }
    if (area < minArea || x1 - x0 < minSide || y1 - y0 < minSide) continue;
    const r = largestRect(bandsOf(t.d, comp));
    if (r && Math.min(rectW(r), rectH(r)) >= minSide && rectArea(r) >= minArea) out.push(r);
  }
  return out;
}

/**
 * Extra room rectangles in the region outside `base` seeds: repeatedly takes the largest inscribed
 * rectangle of each leftover component while it is at least 1.5 m wide and 3 m2 (max 8 rounds).
 */
export function extraRects(rings: Ring[], base: Rect[], exclude?: (P: Piece) => boolean): Rect[] {
  const extras: Rect[] = [];
  for (let round = 0; round < 8; round++) {
    const t = tile(rings, [...base, ...extras], exclude);
    const add = leftoverRects(t, RULES.extraRoomMinWidth, RULES.extraRoomMinArea);
    if (!add.length) break;
    extras.push(...add);
  }
  return extras;
}

/**
 * Implicit outrigger of a single-polygon footprint: the largest leftover rectangle behind the main
 * rectangle (overlapping it in x by >= 1 m) that is >= 1.8 m wide and >= 2 m deep, or null.
 */
export function detectWing(rings: Ring[], R: Rect): Rect | null {
  const t = tile(rings, [R]);
  let best: Rect | null = null;
  for (const q of leftoverRects(t, Math.min(RULES.wingMinWidth, RULES.wingMinDepth), RULES.wingMinWidth * RULES.wingMinDepth)) {
    const overlap = Math.min(q.x1, R.x1) - Math.max(q.x0, R.x0);
    if (q.y0 < R.y1 - 1e-6 || overlap < RULES.wingMinOverlap || rectW(q) < RULES.wingMinWidth || rectH(q) < RULES.wingMinDepth) continue;
    if (!best || rectArea(q) > rectArea(best) + 1e-9) best = q;
  }
  return best;
}

/** Outline of room `room` as one CCW ring (holes bridged); the largest ring if it is disconnected. */
export function roomRing(t: Tiling, room: number): { ring: Ring | null; parts: number } {
  const rings = outlineRings(t.d, t.owner, room);
  const outers = rings.filter((r) => ringArea(r) > 0).sort((a, b) => ringArea(b) - ringArea(a));
  if (!outers.length) return { ring: null, parts: 0 };
  const holes = rings.filter((r) => ringArea(r) < 0);
  return { ring: holes.length ? bridgeHoles(outers[0], holes) : outers[0], parts: outers.length };
}

/** Internal partition between two rooms of one tiling (plan coordinates, axis-parallel, a < b). */
export interface Partition {
  rooms: [number, number];
  a: Vec2;
  b: Vec2;
}

/** Shared boundaries between pieces of different rooms, merged into maximal collinear segments. */
export function partitions(t: Tiling): Partition[] {
  const groups = new Map<string, { rooms: [number, number]; vertical: boolean; line: number; segs: [number, number][] }>();
  for (const c of t.cs) {
    const oa = t.owner[c.a], ob = t.owner[c.b];
    if (oa < 0 || ob < 0 || oa === ob) continue;
    const rooms: [number, number] = oa < ob ? [oa, ob] : [ob, oa];
    const line = c.vertical ? c.p[0] : c.p[1];
    const key = `${rooms[0]}|${rooms[1]}|${c.vertical ? 'v' : 'h'}|${line}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { rooms, vertical: c.vertical, line, segs: [] }));
    g.segs.push(c.vertical ? [c.p[1], c.q[1]] : [c.p[0], c.q[0]]);
  }
  const out: Partition[] = [];
  for (const g of groups.values()) {
    g.segs.sort((p, q) => p[0] - q[0]);
    let cur: [number, number] | null = null;
    const flush = () => {
      if (cur && cur[1] - cur[0] > TOL)
        out.push({ rooms: g.rooms, a: g.vertical ? [g.line, cur[0]] : [cur[0], g.line], b: g.vertical ? [g.line, cur[1]] : [cur[1], g.line] });
    };
    for (const s of g.segs) {
      if (cur && s[0] <= cur[1] + 1e-9) cur[1] = Math.max(cur[1], s[1]);
      else { flush(); cur = [s[0], s[1]]; }
    }
    flush();
  }
  return out;
}
