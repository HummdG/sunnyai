// Joints between the main block and a separate rear part, and internal door placement.
import type { Ring, Vec2 } from '../geometry/geom.js';
import { INTERIOR_RULES as RULES } from './constants.js';
import { orderEnds, type RoomBuild, type WallBuild } from './build.js';
import type { Rect } from './lir.js';
import { distToRings } from './polygon.js';

const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Walls joining rooms of the main block (`mainIdx`) to rooms of a separate rear part (`rearIdx`):
 * anti-parallel room edges facing each other across at most `gapMax` (the two wall insets), whose
 * mid-line lies on both parts' external wall lines. The wall runs along that mid-line with the gap as
 * its thickness (>= the partition thickness).
 */
export function junctionWalls(rooms: RoomBuild[], mainIdx: number[], rearIdx: number[], gapMax: number, fpMain: Ring[], fpRear: Ring[]): WallBuild[] {
  const out: WallBuild[] = [];
  for (const i of mainIdx) {
    const A = rooms[i].ring;
    for (let e = 0; e < A.length; e++) {
      const p1 = A[e], p2 = A[(e + 1) % A.length];
      const L1 = dist(p1, p2);
      if (L1 < 0.3) continue;
      const d1: Vec2 = [(p2[0] - p1[0]) / L1, (p2[1] - p1[1]) / L1];
      const n1: Vec2 = [-d1[1], d1[0]]; // into room i
      for (const j of rearIdx) {
        const B = rooms[j].ring;
        for (let f = 0; f < B.length; f++) {
          const q1 = B[f], q2 = B[(f + 1) % B.length];
          const L2 = dist(q1, q2);
          if (L2 < 0.3 || ((q2[0] - q1[0]) * d1[0] + (q2[1] - q1[1]) * d1[1]) / L2 > -0.998) continue;
          const s1 = n1[0] * (q1[0] - p1[0]) + n1[1] * (q1[1] - p1[1]);
          const s2 = n1[0] * (q2[0] - p1[0]) + n1[1] * (q2[1] - p1[1]);
          if (s1 > 1e-6 || s2 > 1e-6 || s1 < -gapMax || s2 < -gapMax) continue;
          const u1 = d1[0] * (q1[0] - p1[0]) + d1[1] * (q1[1] - p1[1]);
          const u2 = d1[0] * (q2[0] - p1[0]) + d1[1] * (q2[1] - p1[1]);
          const lo = Math.max(0, Math.min(u1, u2)), hi = Math.min(L1, Math.max(u1, u2));
          if (hi - lo < 0.3) continue;
          const gAt = (u: number) => -(s1 + ((s2 - s1) * (u - u1)) / (u2 - u1));
          const at = (u: number): Vec2 => {
            const g = gAt(u) / 2;
            return [p1[0] + d1[0] * u - n1[0] * g, p1[1] + d1[1] * u - n1[1] * g];
          };
          const a = at(lo), b = at(hi);
          const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (distToRings(mid, fpMain) > 0.1 || distToRings(mid, fpRear) > 0.1) continue;
          const [wa, wb] = orderEnds(a, b);
          const thickness = Math.max(RULES.partitionThickness, (gAt(lo) + gAt(hi)) / 2);
          out.push({ rooms: [i, j], a: wa, b: wb, thickness, junction: true, doors: [] });
        }
      }
    }
  }
  return out;
}

/** Overlap area of a door's clear zone (opening x +-clearance across the wall) with a keep-out rectangle. */
function zoneOverlap(w: WallBuild, at: number, width: number, k: Rect): number {
  const L = dist(w.a, w.b);
  const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
  const n: Vec2 = [-d[1], d[0]];
  const c = RULES.doorClearance + w.thickness / 2;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of [at - width / 2, at + width / 2])
    for (const o of [-c, c]) {
      const x = w.a[0] + d[0] * s + n[0] * o, y = w.a[1] + d[1] * s + n[1] * o;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  return Math.max(0, Math.min(x1, k.x1) - Math.max(x0, k.x0)) * Math.max(0, Math.min(y1, k.y1) - Math.max(y0, k.y0));
}

/**
 * Hangs one leaf on wall w: 0.1 m from the a-end, else from the b-end, else the first position (5 cm
 * steps) whose clear zone avoids every keep-out (stair flights and stairwells); else the a-end.
 */
function hangDoor(w: WallBuild, keepouts: Rect[], width: number): void {
  const L = dist(w.a, w.b);
  const e = RULES.doorEndOffset, half = width / 2;
  const cands: number[] = [];
  if (L >= width + 2 * e - 1e-9) {
    cands.push(e + half, L - e - half);
    for (let s = e + half + 0.05; s < L - e - half; s += 0.05) cands.push(s);
  } else cands.push(L / 2);
  const free = (at: number) => keepouts.every((k) => zoneOverlap(w, at, width, k) <= 1e-4);
  const at = cands.find(free) ?? cands[0];
  w.doors.push({ at, width, height: RULES.doorHeight });
}

/**
 * One 0.76 m door per room (research 05 §7.4 step 8), assigned breadth-first from the circulation
 * (hall / landing; else the largest room): a room opens onto an adjacent circulation space when it shares
 * a wall >= 0.96 m with one (longest such wall), else onto the largest already-connected neighbour. Rooms
 * left over get a narrower leaf on their longest wall >= 0.6 m, else a warning.
 */
export function placeDoors(rooms: RoomBuild[], walls: WallBuild[], keepouts: Rect[], warnings: string[]): void {
  const n = rooms.length;
  if (!n) return;
  const connected = rooms.map((r) => r.kind === 'circulation');
  if (!connected.some(Boolean)) {
    let root = 0;
    rooms.forEach((r, i) => { if (r.area > rooms[root].area + 1e-9) root = i; });
    connected[root] = true;
  }
  const len = walls.map((w) => dist(w.a, w.b));
  const minLen = RULES.doorWidth + 2 * RULES.doorEndOffset;
  const other = (w: WallBuild, i: number) => (w.rooms[0] === i ? w.rooms[1] : w.rooms[1] === i ? w.rooms[0] : -1);
  for (;;) {
    const snap = connected.slice();
    let progress = false;
    for (let i = 0; i < n; i++) {
      if (snap[i]) continue;
      let pick = -1;
      let key: number[] = [];
      walls.forEach((w, wi) => {
        const j = other(w, i);
        if (j < 0 || !snap[j] || len[wi] < minLen - 1e-9) return;
        const k = rooms[j].kind === 'circulation' ? [1, len[wi], 0] : [0, rooms[j].area, len[wi]];
        if (pick < 0 || k[0] > key[0] || (k[0] === key[0] && (k[1] > key[1] + 1e-9 || (Math.abs(k[1] - key[1]) <= 1e-9 && k[2] > key[2] + 1e-9)))) {
          pick = wi;
          key = k;
        }
      });
      if (pick >= 0) {
        hangDoor(walls[pick], keepouts, RULES.doorWidth);
        connected[i] = true;
        progress = true;
      }
    }
    if (!progress) break;
  }
  for (let i = 0; i < n; i++) {
    if (connected[i]) continue;
    let pick = -1;
    walls.forEach((w, wi) => { if (other(w, i) >= 0 && len[wi] >= 0.6 && (pick < 0 || len[wi] > len[pick] + 1e-9)) pick = wi; });
    if (pick >= 0) {
      hangDoor(walls[pick], keepouts, Math.min(RULES.doorWidth, len[pick] - 2 * 0.05));
      connected[i] = true;
      if (!connected[other(walls[pick], i)]) warnings.push(`storey ${rooms[i].storey}: ${rooms[i].label} is not reachable from the circulation`);
    } else if (rooms.length > 1) warnings.push(`storey ${rooms[i].storey}: no door could be placed for ${rooms[i].label}`);
  }
}
