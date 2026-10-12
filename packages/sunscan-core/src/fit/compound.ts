// Cross-gable (compound) roof models on convex near-rectangular parts: a main gable over R1 plus a perpendicular
// cross gable over R2 reaching the main ridge, both at one eave height. With the pitch ratio rho = tan p2 / tan p1
// on the nonlinear grid the roof is  h = e + s * max(t1, rho * t2)  (t_i = unit gable time over R_i), i.e. one
// slope column like every library model, so it fits through fitModel and inside partitions unchanged.
//   L (end gable): R1 = [A0, a] x [B0, B1] (ridge along B), R2 = [mid(A0, a), A1] x [B0, B1] (ridge along A); mirrored.
//   T (front gable): R1 = whole rectangle (ridge along A), R2 = [c - w/2, c + w/2] x [eave side -> ridge], rho = 1.
// Grid values g index a per-model geometry table; `refine(g)` adds finer neighbours (coarse-to-fine for T).
import type { EdgeKind } from '../geometry/roof.js';
import type { ModelDef, PartGeom } from './models.js';
import { arange } from './robust.js';
import { type Side, toU, toV } from './poly.js';

/** Pitch-ratio grid (tan cross / tan main) of L cross gables. T front gables use the main pitch (rho = 1): their
 *  visible triangle (~w^2/4, about 10 pixels at 1 m) does not identify a second pitch (one rho step = 4-6 deg). */
export const RHO_GRID = [0.7, 0.85, 1, 1.18, 1.43];

/** Rectangle [a0, a1] x [b0, b1] in (A, B) coordinates with its ridge direction. */
interface Box { a0: number; a1: number; b0: number; b1: number; ridge: 'A' | 'B' }
/** One compound geometry: main and cross boxes and the pitch ratio. */
export interface CompoundGeom { r1: Box; r2: Box; rho: number; key: string }

/** Component rectangles of a compound model in the part's (u, v) frame (for the output RoofSpec). */
export interface CompoundRects { main: [number, number, number, number]; cross: [number, number, number, number]; mainRidge: 'u' | 'v'; crossRidge: 'u' | 'v'; rho: number }

/** Unit gable time over a box (min distance to its two eave sides); -Infinity outside. */
function boxTime(b: Box, A: number, B: number, outside: number): number {
  if (A < b.a0 - 1e-9 || A > b.a1 + 1e-9 || B < b.b0 - 1e-9 || B > b.b1 + 1e-9) return outside;
  return b.ridge === 'A' ? Math.min(B - b.b0, b.b1 - B) : Math.min(A - b.a0, b.a1 - A);
}
const boxTmax = (b: Box) => (b.ridge === 'A' ? b.b1 - b.b0 : b.a1 - b.a0) / 2;

/** Is the part's outer ring convex (no holes)? */
export function isConvexPart(part: PartGeom): boolean {
  if ((part.poly.holes ?? []).length) return false;
  const r = part.poly.outer;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], c = r[(i + 2) % r.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) return false;
  }
  return true;
}

/**
 * Compound cross-gable models of a part: L (span axis u / v, main block at the low / high end) and T (main ridge
 * along u / v, cross gable on the low / high slope). Variants whose eaves would lie on a party wall are skipped.
 * Callers offer them only on convex near-rectangles.
 */
export function compoundModels(part: PartGeom): ModelDef[] {
  const f = part.frame;
  const out: ModelDef[] = [];
  const partySides = new Set(part.edges.filter((e) => e.attr.kind === 'party').map((e) => e.side));
  for (const axis of ['u', 'v'] as const) {
    // (A, B) = (u, v) or (v, u)
    const [A0, A1, B0, B1] = axis === 'u' ? [part.u0, part.u1, part.v0, part.v1] : [part.v0, part.v1, part.u0, part.u1];
    const sideA: [Side, Side] = axis === 'u' ? ['W', 'E'] : ['S', 'N'];
    const sideB: [Side, Side] = axis === 'u' ? ['S', 'N'] : ['W', 'E'];
    const toAB = (x: number, y: number): [number, number] => (axis === 'u' ? [toU(f, x, y), toV(f, x, y)] : [toV(f, x, y), toU(f, x, y)]);
    const kindsFor = (gableSides: Side[]): EdgeKind[] =>
      part.edges.map((e) => (e.attr.kind === 'party' ? 'party' : gableSides.includes(e.side) ? 'gable' : 'eave'));
    const make = (label: string, nNonlinear: number, geoms: CompoundGeom[], kinds: EdgeKind[], refine?: (g: CompoundGeom) => CompoundGeom[]): ModelDef | null => {
      if (!geoms.length) return null;
      const table = geoms.slice();
      const index = new Map(table.map((g, i) => [g.key, i]));
      const add = (g: CompoundGeom) => {
        let i = index.get(g.key);
        if (i === undefined) { i = table.length; table.push(g); index.set(g.key, i); }
        return i;
      };
      const m: ModelDef = {
        family: 'compound', label, twoPitch: false, allowNeg: false, grid: table.map((_, i) => i), nVariants: 1, gDependent: true,
        roofType: 'gabled', kinds, nNonlinear,
        times(pts, g) {
          const G = table[g], n = pts.length >> 1, o = new Float64Array(n);
          for (let k = 0; k < n; k++) {
            const [a, b] = toAB(pts[2 * k], pts[2 * k + 1]);
            const t1 = boxTime(G.r1, a, b, -Infinity), t2 = boxTime(G.r2, a, b, -Infinity);
            // outside both boxes (sub-samples beyond the wall line): extend the main gable linearly
            o[k] = t1 === -Infinity && t2 === -Infinity ? (G.r1.ridge === 'A' ? Math.min(b - G.r1.b0, G.r1.b1 - b) : Math.min(a - G.r1.a0, G.r1.a1 - a)) : Math.max(t1, G.rho * t2);
          }
          return o;
        },
        tmax: (g) => boxTmax(table[g].r1),
        components(g) {
          const G = table[g];
          const rect = (b: Box): [number, number, number, number] => (axis === 'u' ? [b.a0, b.a1, b.b0, b.b1] : [b.b0, b.b1, b.a0, b.a1]);
          const dir = (r: 'A' | 'B'): 'u' | 'v' => ((r === 'A') === (axis === 'u') ? 'u' : 'v');
          return { main: rect(G.r1), cross: rect(G.r2), mainRidge: dir(G.r1.ridge), crossRidge: dir(G.r2.ridge), rho: G.rho };
        },
        ...(refine ? { refine: (g: number) => refine(table[g]).map(add) } : {}),
      };
      return m;
    };
    // L: main block at the low (A0) or high (A1) end; eave sides of the main block: the A side at that end
    for (const end of ['lo', 'hi'] as const) {
      if (partySides.has(end === 'lo' ? sideA[0] : sideA[1])) continue; // main-block eave on a party wall
      if (partySides.has(sideB[0]) && partySides.has(sideB[1])) continue; // cross eaves on party walls
      const geoms: CompoundGeom[] = [];
      for (const a of arange(A0 + 4, A1 - 2.5 + 1e-9, 0.5)) for (const rho of RHO_GRID) {
        const w1 = a - A0; // main block width along A
        const r1: Box = end === 'lo' ? { a0: A0, a1: a, b0: B0, b1: B1, ridge: 'B' } : { a0: A1 - w1, a1: A1, b0: B0, b1: B1, ridge: 'B' };
        const mid = (r1.a0 + r1.a1) / 2;
        const r2: Box = end === 'lo' ? { a0: mid, a1: A1, b0: B0, b1: B1, ridge: 'A' } : { a0: A0, a1: mid, b0: B0, b1: B1, ridge: 'A' };
        if (rho * boxTmax(r2) > boxTmax(r1) + 1e-9) continue;
        geoms.push({ r1, r2, rho, key: `${end}|${w1.toFixed(2)}|${rho}` });
      }
      const gableSides = [sideB[0], sideB[1], end === 'lo' ? sideA[1] : sideA[0]];
      const m = make(`cross-gable-L-${axis}-${end}`, 2, geoms, kindsFor(gableSides));
      if (m) out.push(m);
    }
    // T: main ridge along A over the whole rectangle; cross gable on the low (B0) or high (B1) slope
    if (!(partySides.has(sideB[0]) || partySides.has(sideB[1]))) {
      const Bm = (B0 + B1) / 2;
      for (const side of ['lo', 'hi'] as const) {
        const r1: Box = { a0: A0, a1: A1, b0: B0, b1: B1, ridge: 'A' };
        const geom = (c: number, w: number, rho: number): CompoundGeom | null => {
          if (w < 2.5 || w > 6 || c - w / 2 < A0 + 0.5 - 1e-9 || c + w / 2 > A1 - 0.5 + 1e-9) return null;
          const r2: Box = side === 'lo' ? { a0: c - w / 2, a1: c + w / 2, b0: B0, b1: Bm, ridge: 'B' } : { a0: c - w / 2, a1: c + w / 2, b0: Bm, b1: B1, ridge: 'B' };
          if (rho * boxTmax(r2) > boxTmax(r1) + 1e-9) return null;
          return { r1, r2, rho, key: `${side}|${c.toFixed(2)}|${w.toFixed(2)}|${rho}` };
        };
        const coarse: CompoundGeom[] = [];
        for (const w of [3, 4, 5]) for (const c of arange(A0 + w / 2 + 0.5, A1 - w / 2 - 0.5 + 1e-9, 1)) {
          const g = geom(c, w, 1);
          if (g) coarse.push(g);
        }
        const refine = (g: CompoundGeom): CompoundGeom[] => {
          const c = (g.r2.a0 + g.r2.a1) / 2, w = g.r2.a1 - g.r2.a0, res: CompoundGeom[] = [];
          for (const dc of [-0.5, 0, 0.5]) for (const dw of [-0.5, 0, 0.5]) {
            const q = geom(c + dc, w + dw, 1);
            if (q) res.push(q);
          }
          return res;
        };
        const gableSides = [sideA[0], sideA[1], side === 'lo' ? sideB[0] : sideB[1]];
        const m = make(`cross-gable-T-${axis}-${side}`, 2, coarse, kindsFor(gableSides), refine);
        if (m) out.push(m);
      }
    }
  }
  for (const m of out) m.nVariants = out.length;
  return out;
}
