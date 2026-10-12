// Intermediate (plan-frame) room / wall records shared by the interior planner stages.
import type { Ring, Vec2 } from '../geometry/geom.js';
import type { RoomKind } from './archetype.js';

/** A room of one storey in plan coordinates (main plan frame), before conversion to RoomInfo. */
export interface RoomBuild {
  storey: number;
  partId: string;
  label: string;
  kind: RoomKind;
  slot: string;
  order: number;
  /** Size of the seed rectangle (the room's core), used for the NDSS width check. */
  seedW: number;
  seedH: number;
  /** CCW ring in plan coordinates. */
  ring: Ring;
  area: number;
}

/** An internal wall of one storey between rooms `rooms` (indices into that storey's room list). */
export interface WallBuild {
  rooms: [number, number];
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** True for the joint between the main block and a separate rear part (thickness = gap between them). */
  junction: boolean;
  doors: { at: number; width: number; height: number }[];
}

/** Orders a wall's end points: a has the smaller x for walls closer to x-parallel, else the smaller y. */
export function orderEnds(a: Vec2, b: Vec2): [Vec2, Vec2] {
  const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const swap = horizontal ? b[0] < a[0] : b[1] < a[1];
  return swap ? [b, a] : [a, b];
}
