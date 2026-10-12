// Validation / normalisation of InteriorInput (defensive: the planner never throws on bad data).
import type { EdgeKind } from '../geometry/roof.js';
import { ringArea, type Ring, type Vec2 } from '../geometry/geom.js';
import type { BuildingPartSpec, BuiltForm, Era, InteriorInput } from '../types.js';

/** InteriorInput after validation: outer ring CCW (kinds/front remapped), holes CW, levels complete. */
export interface NormInput {
  partId: string;
  outer: Ring;
  holes: Ring[];
  kinds: EdgeKind[];
  frontEdge?: number;
  storeys: number;
  levels: { floorZ: number; ceilingZ: number }[];
  t: number;
  era: Era;
  builtForm: BuiltForm;
  role: BuildingPartSpec['role'];
  rear?: { partId: string; outer: Ring; holes: Ring[]; storeys: number };
}

const finitePt = (p: unknown): p is Vec2 =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Copies a ring, dropping non-finite points and a repeated closing vertex. */
function readRing(r: unknown): Ring {
  if (!Array.isArray(r)) return [];
  const out: Ring = r.filter(finitePt).map((p) => [p[0], p[1]]);
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}

/** Outer ring CCW (with edge-kind / front-edge index remapping when it had to be reversed). */
function orientOuter(outer: Ring, kinds: EdgeKind[], front?: number): { outer: Ring; kinds: EdgeKind[]; front?: number } {
  if (ringArea(outer) >= 0) return { outer, kinds, front };
  const n = outer.length;
  // reversed ring r_j = v_{n-1-j}; edge j (r_j -> r_{j+1}) is the original edge n-2-j traversed backwards
  const map = (j: number) => (((n - 2 - j) % n) + n) % n;
  return {
    outer: outer.slice().reverse(),
    kinds: Array.from({ length: n }, (_, j) => kinds[map(j)]),
    front: front === undefined || !Number.isInteger(front) || front < 0 || front >= n ? undefined : map(front),
  };
}

const orientHole = (h: Ring): Ring => (ringArea(h) > 0 ? h.slice().reverse() : h);

/** Validates and normalises the planner input; returns null (with a warning) when nothing can be planned. */
export function normalizeInput(input: InteriorInput, warnings: string[]): NormInput | null {
  const fp = input?.footprint;
  const outer0 = readRing(fp?.outer);
  if (outer0.length < 3 || !(Math.abs(ringArea(outer0)) > 0.5)) {
    warnings.push('interior: footprint is missing, degenerate or smaller than 0.5 m2; no layout generated');
    return null;
  }
  const kinds0: EdgeKind[] = outer0.map((_, i) => {
    const k = input.edgeKinds?.[i];
    return k === 'party' || k === 'gable' || k === 'eave' ? k : 'eave';
  });
  const o = orientOuter(outer0, kinds0, input.frontEdge);
  const holes = (fp.holes ?? []).map(readRing).filter((h) => h.length >= 3 && Math.abs(ringArea(h)) > 1e-6).map(orientHole);
  let storeys = Number.isFinite(input.storeys) ? Math.round(input.storeys) : 1;
  if (storeys < 1 || storeys > 10) {
    warnings.push(`interior: storeys = ${input.storeys} clamped to [1, 10]`);
    storeys = Math.min(10, Math.max(1, storeys));
  }
  const levels: { floorZ: number; ceilingZ: number }[] = [];
  for (let s = 0; s < storeys; s++) {
    const l = input.levels?.[s];
    if (l && Number.isFinite(l.floorZ) && Number.isFinite(l.ceilingZ) && l.ceilingZ > l.floorZ) {
      levels.push({ floorZ: l.floorZ, ceilingZ: l.ceilingZ });
      continue;
    }
    const prev = levels[s - 1];
    const floorZ = prev ? prev.floorZ + Math.max(2.4, prev.ceilingZ - prev.floorZ + 0.25) : 0.15;
    levels.push({ floorZ, ceilingZ: floorZ + 2.4 });
    warnings.push(`interior: storey ${s} has no valid level; assumed floor ${floorZ.toFixed(2)} m, ceiling height 2.4 m`);
  }
  let t = Number.isFinite(input.wallThickness) ? input.wallThickness : 0.25;
  if (!Number.isFinite(input.wallThickness)) warnings.push('interior: wallThickness missing; 0.25 m assumed');
  t = Math.min(1, Math.max(0, t));
  let rear: NormInput['rear'];
  if (input.rearPart) {
    const ro = readRing(input.rearPart.footprint?.outer);
    if (ro.length >= 3 && Math.abs(ringArea(ro)) > 0.5) {
      const rs = Number.isFinite(input.rearPart.storeys) ? Math.round(input.rearPart.storeys) : 1;
      if (rs > storeys) warnings.push(`interior: rear part has ${rs} storeys; clamped to the ${storeys} of the main part`);
      rear = {
        partId: String(input.rearPart.partId ?? 'rear'),
        outer: ringArea(ro) < 0 ? ro.reverse() : ro,
        holes: (input.rearPart.footprint.holes ?? []).map(readRing).filter((h) => h.length >= 3).map(orientHole),
        storeys: Math.min(storeys, Math.max(1, rs)),
      };
    } else warnings.push('interior: rear part footprint is degenerate; ignored');
  }
  return {
    partId: String(input.partId ?? 'main'),
    outer: o.outer,
    holes,
    kinds: o.kinds,
    frontEdge: o.front,
    storeys,
    levels,
    t,
    era: input.era,
    builtForm: input.builtForm,
    role: input.role ?? 'main',
    rear,
  };
}
