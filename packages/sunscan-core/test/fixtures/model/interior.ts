// Hand-made InteriorLayout fixtures (stand-ins for core/interior while it is developed in parallel).
import type { InteriorInput, InteriorLayout, RoomInfo, Vec2 } from '../../../src/types.js';

const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function room(id: string, storey: number, label: string, poly: Vec2[], input: InteriorInput): RoomInfo {
  const L = input.levels[storey];
  const area = Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  return { id, partId: input.partId, storey, label, polygon: poly, area, floorZ: L.floorZ, ceilingZ: L.ceilingZ, estimated: true };
}

/**
 * Two-up two-down side-hall plan for a rectangular part [0, W] x [0, D] (front at y = 0, hall on the west),
 * laid out inside the wall thickness. Works for any storey count >= 1 (upper storeys repeat storey 1).
 */
export function sideHallLayout(input: InteriorInput): InteriorLayout {
  const xs = input.footprint.outer.map((p) => p[0]), ys = input.footprint.outer.map((p) => p[1]);
  const t = input.wallThickness;
  const x0 = Math.min(...xs) + t, x1 = Math.max(...xs) - t, y0 = Math.min(...ys) + t, y1 = Math.max(...ys) - t;
  const ym = (y0 + y1) / 2;
  const rooms: RoomInfo[] = [];
  const walls: InteriorLayout['walls'] = [];
  const stairs: InteriorLayout['stairs'] = [];
  for (let s = 0; s < input.storeys; s++) {
    const L = input.levels[s];
    if (s === 0) {
      const hx = x0 + 1.0;
      rooms.push(room(`r${s}-hall`, s, 'hall', box(x0, y0, hx, y1), input));
      rooms.push(room(`r${s}-front`, s, 'front room / living', box(hx, y0, x1, ym), input));
      rooms.push(room(`r${s}-back`, s, 'kitchen / diner', box(hx, ym, x1, y1), input));
      walls.push({ storey: s, a: [hx, y0], b: [hx, y1], thickness: 0.1, doors: [{ at: 0.9, width: 0.76, height: 2.0 }, { at: ym - y0 + 0.9, width: 0.76, height: 2.0 }] });
      walls.push({ storey: s, a: [hx, ym], b: [x1, ym], thickness: 0.1, doors: [] });
    } else {
      const lx = x0 + 1.75;
      const yb = y1 - 2.2;
      rooms.push(room(`r${s}-landing`, s, 'landing', box(x0, y0, lx, y1), input));
      rooms.push(room(`r${s}-bed1`, s, 'bedroom 1', box(lx, y0, x1, ym), input));
      rooms.push(room(`r${s}-bed2`, s, 'bedroom 2', box(lx, ym, x1, yb), input));
      rooms.push(room(`r${s}-bath`, s, 'bathroom', box(lx, yb, x1, y1), input));
      walls.push({ storey: s, a: [lx, y0], b: [lx, y1], thickness: 0.1, doors: [{ at: 0.6, width: 0.76, height: 2.0 }, { at: ym - y0 + 0.6, width: 0.76, height: 2.0 }, { at: yb - y0 + 0.6, width: 0.76, height: 2.0 }] });
      walls.push({ storey: s, a: [lx, ym], b: [x1, ym], thickness: 0.1, doors: [] });
      walls.push({ storey: s, a: [lx, yb], b: [x1, yb], thickness: 0.1, doors: [] });
    }
    if (s + 1 < input.storeys) {
      const ff = input.levels[s + 1].floorZ - L.floorZ;
      const risers = Math.ceil(ff / 0.2);
      const going = 0.225, w = 0.85, sy = y0 + 1.2, run = (risers - 1) * going;
      stairs.push({ storey: s, start: [x0 + w / 2, sy], direction: [0, 1], width: w, risers, riserHeight: ff / risers, going, polygon: box(x0, sy, x0 + w, sy + run) });
    }
  }
  return { rooms, walls, stairs, warnings: [] };
}

/** Provider for tests: the side-hall plan for rectangular parts (rear part not covered), nothing otherwise. */
export const fixtureProvider = (input: InteriorInput): InteriorLayout =>
  input.footprint.outer.length === 4 ? sideHallLayout(input) : { rooms: [], walls: [], stairs: [], warnings: ['fixture: rectangles only'] };
