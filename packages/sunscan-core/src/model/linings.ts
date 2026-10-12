// Inner faces of the external walls ("linings") per storey, so a walk-through sees plastered walls instead of the
// back faces of the outside walls. Linings follow the inset footprint (wall thickness), are clipped under the
// roof, have holes at windows / notches at doors, and reveals (jambs, head, window board) through the wall
// thickness - looking through a reveal shows the outside, because the external wall faces point outwards.
import type { Vec2, Vec3 } from '../types.js';
import type { LayerSet } from './builder.js';
import type { PlannedOpening } from './facade.js';
import type { InsetInfo } from './floors.js';
import { WALL_THICKNESS, type StoreyLevel } from './levels.js';
import type { PartGeometry } from './part.js';
import { type RoofTopFn, clipProfile, topProfile } from './interior-mesh.js';

/** Emit the linings of one part for every storey. */
export function emitLinings(set: LayerSet, pg: PartGeometry, levels: StoreyLevel[], inset: InsetInfo, openings: PlannedOpening[], roofTop: RoofTopFn, clearance: number): void {
  const pid = pg.part.id;
  const T = WALL_THICKNESS;
  for (const L of levels) {
    const b = set.get({ id: `${pid}/storey-${L.storey}/linings`, kind: 'interior', material: 'interior-wall', partId: pid, storey: L.storey });
    for (const arc of inset.arcs) {
      const len = Math.hypot(arc.b[0] - arc.a[0], arc.b[1] - arc.a[1]);
      if (len < 0.05) continue;
      const d: Vec2 = [(arc.b[0] - arc.a[0]) / len, (arc.b[1] - arc.a[1]) / len];
      const m: Vec2 = [-d[1], d[0]]; // into the room
      const P = (s: number, z: number, off = 0): Vec3 => [arc.a[0] + d[0] * s + m[0] * off, arc.a[1] + d[1] * s + m[1] * off, z];
      const holes: [number, number, number, number][] = [];
      const notches: [number, number, number][] = [];
      // attic storeys: the lining exists only where the roof leaves height above the floor
      for (const top of clipProfile(topProfile(arc.a, d, 0, len, L.ceilingZ, roofTop, clearance), L.floorZ)) {
        const sa = top[0][0], sb = top[top.length - 1][0];
        const topAt = (s: number) => {
          for (let i = 0; i + 1 < top.length; i++) {
            const [s0, z0] = top[i], [s1, z1] = top[i + 1];
            if (s <= s1 + 1e-9) return s1 > s0 ? z0 + ((z1 - z0) * (s - s0)) / (s1 - s0) : z0;
          }
          return top[top.length - 1][1];
        };
        const minTop = (s0: number, s1: number) => Math.min(topAt(s0), topAt(s1), ...top.filter(([s]) => s > s0 && s < s1).map(([, z]) => z));
        const pieceHoles: [number, number, number, number][] = [];
        const pieceNotches: [number, number, number][] = [];
        for (const op of openings) {
          if (op.info.storey !== L.storey || op.wall.edge !== arc.edge || arc.edge < 0) continue;
          const map = (sw: number) => (op.wall.a[0] + op.wall.d[0] * sw - arc.a[0]) * d[0] + (op.wall.a[1] + op.wall.d[1] * sw - arc.a[1]) * d[1];
          const S0 = map(op.s0), S1 = map(op.s1);
          if (S0 < sa + 0.03 || S1 > sb - 0.03 || S1 - S0 < 0.3) continue;
          const z1 = Math.min(op.z1, minTop(S0, S1) - 0.03);
          if (op.z0 <= L.floorZ + 0.02) { if (z1 - L.floorZ >= 1.5) pieceNotches.push([S0, S1, z1]); }
          else if (z1 - op.z0 >= 0.3) pieceHoles.push([S0, S1, op.z0, z1]);
        }
        // outer loop: clockwise in (s, z) == counter-clockwise seen from the room (s grows to the left)
        const outer: Vec3[] = [P(sa, L.floorZ), ...top.map(([s, z]) => P(s, z)), P(sb, L.floorZ)];
        for (const [S0, S1, z1] of [...pieceNotches].sort((x, y) => y[0] - x[0])) outer.push(P(S1, L.floorZ), P(S1, z1), P(S0, z1), P(S0, L.floorZ));
        b.polygon([outer, ...pieceHoles.map(([S0, S1, z0, z1]) => [P(S0, z0), P(S1, z0), P(S1, z1), P(S0, z1)])], [m[0], m[1], 0]);
        holes.push(...pieceHoles);
        notches.push(...pieceNotches);
      }
      // reveals through the wall thickness (off from 0 at the lining to -T at the outer wall plane)
      const reveal = (S0: number, S1: number, z0: number, z1: number, board: boolean) => {
        b.quad(P(S0, z0, -T), P(S0, z0, 0), P(S0, z1, 0), P(S0, z1, -T), [d[0], d[1], 0]);
        b.quad(P(S1, z0, 0), P(S1, z0, -T), P(S1, z1, -T), P(S1, z1, 0), [-d[0], -d[1], 0]);
        b.quad(P(S0, z1, 0), P(S1, z1, 0), P(S1, z1, -T), P(S0, z1, -T), [0, 0, -1]);
        if (board) b.quad(P(S0, z0, -T), P(S1, z0, -T), P(S1, z0, 0), P(S0, z0, 0), [0, 0, 1]);
      };
      for (const [S0, S1, z0, z1] of holes) reveal(S0, S1, z0, z1, true);
      for (const [S0, S1, z1] of notches) reveal(S0, S1, L.floorZ, z1, false);
    }
  }
}
