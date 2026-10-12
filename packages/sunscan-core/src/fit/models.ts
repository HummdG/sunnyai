// Roof model library. Every model is  h(p) = e + s t_M(p)  (two-pitch: e + s1 min(t, b) + s2 max(t - b, 0)),
// linear in (e, s[, s2]) for a fixed nonlinear parameter g (half-hip delta or two-pitch break b).
//  - rectLibrary: research 05 closed forms on an axis-aligned rectangle (Python `rect_candidates`, used for the
//    oracle parity test and for the near-rectangle half-hip / pyramid families).
//  - partLibrary: general polygons via the weighted-skeleton time field (flat, gables per axis, hip, auto
//    cross-gable, skillions) + near-rectangle closed forms + two-pitch over the hip / gable skeletons.
import { autoGableKinds, type EdgeKind, type RoofType } from '../geometry/roof.js';
import type { PolygonM } from '../geometry/geom.js';
import { arange } from './robust.js';
import { compoundModels, isConvexPart, type CompoundRects } from './compound.js';
import { alignPolygon, makeTimeField, type TimeField } from './timefield.js';
import {
  type AxisFrame, type EdgeAttr, type EdgeInfo, type Side, SIDES, classifyEdges, partFrame, polyArea, polyCentroid, rectangularity, toU, toV,
} from './poly.js';

/** Roof model family (two-pitch mansard / gambrel models share the family `mansard`). */
export type Family = 'flat' | 'gable' | 'hip' | 'halfhip' | 'skillion' | 'pyramid' | 'mansard' | 'crossgable' | 'compound';

/** One roof hypothesis for one part: time features, nonlinear grid, variant count and output mapping. */
export interface ModelDef {
  family: Family;
  /** Hypothesis label, e.g. 'gable-u', 'hip', 'skillion-S', 'half-hip-v', 'mansard', 'gambrel-u'. */
  label: string;
  twoPitch: boolean;
  /** Gable only: negative slope allowed (butterfly / London roof). */
  allowNeg: boolean;
  /** Asymmetric gable: input edges whose slope is 2^g times the fitted slope s (the other eaves rise at s). */
  steepEdges?: number[];
  /** Nonlinear parameters encoded in g (structural count k_H; default 1 when the model has a grid). */
  nNonlinear?: number;
  /** Coarse-to-fine: finer grid values around g (evaluated by fitModel around its best coarse values). */
  refine?: (g: number) => number[];
  /** Compound (cross-gable): component rectangles in the part's (u, v) frame for grid value g. */
  components?: (g: number) => CompoundRects;
  /** Candidate values of the nonlinear parameter ([] = none). */
  grid: number[];
  /** Number of sibling variants of the family (structural prior 2 ln V). */
  nVariants: number;
  /** True when times depend on the nonlinear parameter. */
  gDependent: boolean;
  /** Unit skeleton times at interleaved (x, y) points. */
  times(pts: Float64Array, g: number): Float64Array;
  /** Largest unit time over the part for nonlinear value g. */
  tmax(g: number): number;
  /** Geometry-engine roof type and per-edge kinds on the part polygon (for the output RoofSpec). */
  roofType: RoofType;
  kinds: EdgeKind[];
  /** Half-hip: half-width across the ridge (m). Pyramid: half-extents along u / v (m). */
  halfWidth?: number;
  hu?: number;
  hv?: number;
}

/** Linear + nonlinear parameter count (k_H contribution). */
export const nParams = (m: ModelDef): number => (m.family === 'flat' ? 1 : m.twoPitch ? 3 : 2) + (m.grid.length ? (m.nNonlinear ?? 1) : 0);

/** Slope columns that must stay >= 0 (gables may go negative only when allowNeg). */
export function nonnegCols(m: ModelDef, offset = 0): number[] {
  if (m.family === 'flat') return [];
  if (m.family === 'gable') return m.allowNeg ? [] : [offset + 1];
  return m.twoPitch ? [offset + 1, offset + 2] : [offset + 1];
}

// ------------------------------------------------------------------------------------------------ rectangles

/** Axis-aligned rectangle in its own (u, v) frame with per-side party flags (closed forms). */
export interface RectSpec { u0: number; u1: number; v0: number; v1: number; party: Record<Side, boolean> }

function sideDist(r: RectSpec, u: number, v: number, s: Side): number {
  switch (s) {
    case 'S': return v - r.v0;
    case 'N': return r.v1 - v;
    case 'W': return u - r.u0;
    default: return r.u1 - u;
  }
}

/** Closed-form skeleton time on a rectangle (research 05 table 3.2). */
export function rectTime(fam: Family, eaves: Side[], ends: Side[], r: RectSpec, u: number, v: number, g: number): number {
  if (fam === 'flat') return 0;
  if (fam === 'pyramid') {
    const uc = 0.5 * (r.u0 + r.u1), vc = 0.5 * (r.v0 + r.v1);
    const hu = 0.5 * (r.u1 - r.u0), hv = 0.5 * (r.v1 - r.v0);
    return hu * (1 - Math.max(Math.abs(u - uc) / hu, Math.abs(v - vc) / hv));
  }
  let t = Infinity;
  for (const s of eaves) t = Math.min(t, sideDist(r, u, v, s));
  if (fam === 'halfhip') for (const s of ends) t = Math.min(t, sideDist(r, u, v, s) + g);
  return t;
}

/** Numeric max of the rectangle time on a 5 cm lattice (exactly as fit.py `rect_tmax`). */
function rectTmaxNumeric(fam: Family, eaves: Side[], ends: Side[], r: RectSpec, g = 0, step = 0.05): number {
  let best = -Infinity;
  const us = arange(r.u0, r.u1 + 1e-9, step), vs = arange(r.v0, r.v1 + 1e-9, step);
  for (const v of vs) for (const u of us) best = Math.max(best, rectTime(fam, eaves, ends, r, u, v, g));
  return best;
}

const pyLabel = (family: Family, eaves: Side[]): string => {
  const ax = eaves.includes('S') && eaves.includes('N') ? 'u' : 'v';
  if (family === 'gable' || family === 'halfhip' || (family === 'mansard' && eaves.length === 2)) return `${family}-${ax}`;
  if (family === 'skillion') return `skillion-${eaves[0]}`;
  return family;
};

/**
 * Rectangle model library in the rectangle's own (u, v) frame (points are already (u, v)). Same enumeration,
 * margins and labels as research/methods/roofit/models.py `rect_candidates`.
 */
export function rectLibrary(r: RectSpec, opts: { erode?: number; butterfly?: boolean; twoPitch?: boolean; halfhip?: boolean; pyramid?: boolean } = {}): ModelDef[] {
  const erode = opts.erode ?? 0.5;
  const free = SIDES.filter((s) => !r.party[s]);
  const fs = new Set(free);
  const mk = (family: Family, eaves: Side[], extra: Partial<ModelDef> & { ends?: Side[] } = {}): ModelDef => {
    const ends = extra.ends ?? [];
    const m: ModelDef = {
      family, label: pyLabel(family, eaves), twoPitch: false, allowNeg: false, grid: [], nVariants: 1, gDependent: family === 'halfhip',
      times(pts, g) {
        const n = pts.length >> 1, out = new Float64Array(n);
        for (let k = 0; k < n; k++) out[k] = rectTime(family, eaves, ends, r, pts[2 * k], pts[2 * k + 1], g);
        return out;
      },
      tmax: (g) => rectTmaxNumeric(family, eaves, ends, r, g),
      roofType: 'flat', kinds: [],
      ...extra,
    };
    return m;
  };
  const out: ModelDef[] = [mk('flat', [])];
  const gables: Side[][] = [];
  if (fs.has('S') && fs.has('N')) gables.push(['S', 'N']);
  if (fs.has('W') && fs.has('E')) gables.push(['W', 'E']);
  for (const gs of gables) out.push(mk('gable', gs, { nVariants: gables.length, allowNeg: opts.butterfly ?? true }));
  if (free.length >= 3) out.push(mk('hip', free));
  if (opts.halfhip ?? true) {
    const hh: ModelDef[] = [];
    for (const gs of gables) {
      const ends = SIDES.filter((s) => !gs.includes(s) && fs.has(s));
      const half = 0.5 * (gs[0] === 'S' ? r.v1 - r.v0 : r.u1 - r.u0);
      if (ends.length && half >= 2.0) {
        const grid = arange(1.0, half - 0.99, 0.25);
        if (grid.length) hh.push(mk('halfhip', gs, { ends, grid }));
      }
    }
    for (const m of hh) { m.nVariants = hh.length; out.push(m); }
  }
  for (const s of free) out.push(mk('skillion', [s], { nVariants: free.length }));
  if ((opts.pyramid ?? true) && free.length === 4) {
    const lu = r.u1 - r.u0, lv = r.v1 - r.v0;
    if (Math.max(lu, lv) / Math.min(lu, lv) > 1.15) out.push(mk('pyramid', []));
  }
  if (opts.twoPitch ?? true) {
    const tp: { eaves: Side[]; m: ModelDef }[] = [];
    if (free.length >= 3) tp.push({ eaves: free, m: mk('mansard', free, { twoPitch: true }) });
    for (const gs of gables) tp.push({ eaves: gs, m: mk('mansard', gs, { twoPitch: true }) });
    for (const { eaves, m } of tp) {
      const tmax = rectTmaxNumeric('mansard', eaves, [], r);
      m.grid = arange(erode + 0.75, tmax - 0.74, 0.25);
      m.nVariants = tp.length;
      if (m.grid.length) out.push(m);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ polygons

/** A roof part: polygon in local metres (outer CCW) with per-edge attributes and its plan frame. */
export interface PartGeom {
  poly: PolygonM;
  attrs: EdgeAttr[];
  frame: AxisFrame;
  /** Bounding box in the frame (u = long axis). */
  u0: number; u1: number; v0: number; v1: number;
  area: number;
  centroid: [number, number];
  rectangularity: number;
  edges: EdgeInfo[];
}

/** Wrap a local-frame polygon and per-edge attributes into a part (frame, bbox, area, edge classes). */
export function makePartGeom(poly: PolygonM, attrs: EdgeAttr[]): PartGeom {
  const pf = partFrame(poly);
  return {
    poly, attrs, frame: pf.frame, u0: pf.u0, u1: pf.u1, v0: pf.v0, v1: pf.v1,
    area: polyArea(poly), centroid: polyCentroid(poly), rectangularity: rectangularity(poly),
    edges: classifyEdges(poly, attrs, pf.frame),
  };
}

/** Which families the part library offers (and their margins). */
export interface LibraryOptions {
  erode: number;
  /** Allow negative gable slopes (whole-footprint fits only). */
  butterfly: boolean;
  /** Offer the near-rectangle closed forms (half-hip, pyramid). */
  closedForms: boolean;
  /** Offer two-pitch (mansard / gambrel) models on near-rectangles. */
  twoPitch: boolean;
  /** Minimum skillion eave length (m). */
  minSkillionEdge: number;
  /** Rectangularity threshold for the near-rectangle families. */
  nearRect: number;
  /** Offer asymmetric (off-centre ridge) gables (whole-footprint fits only). */
  asymGable?: boolean;
  /** Offer compound cross-gable roofs (L / T) on convex near-rectangles. */
  crossGable?: boolean;
}

/** Whole-footprint library: butterfly gables allowed, near-rectangle closed forms and two-pitch roofs on. */
export const DEFAULT_LIBRARY: LibraryOptions = { erode: 0.5, butterfly: true, closedForms: true, twoPitch: true, minSkillionEdge: 2, nearRect: 0.9, asymGable: true, crossGable: true };

/**
 * Asymmetric gable grid: g = log2 of the slope ratio between the two eave sides (|g| <= 2.5, ratio up to ~5.7);
 * g = 0 is the symmetric gable and is left to the plain gable model.
 */
export const ASYM_GABLE_GRID = [0.5, 0.75, 1, 1.5, 2, 2.5];

const compass = (nx: number, ny: number): string => {
  const b = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
  return b < 45 || b >= 315 ? 'N' : b < 135 ? 'E' : b < 225 ? 'S' : 'W';
};

/** Model library for one part (see module header). Hypotheses that coincide after party walls are dropped. */
export function partLibrary(part: PartGeom, opts: LibraryOptions = DEFAULT_LIBRARY): ModelDef[] {
  let degenerate = 0;
  const E = part.edges;
  const isFree = (e: EdgeInfo) => e.attr.kind !== 'party';
  const base: EdgeKind[] = E.map((e) => (isFree(e) ? 'eave' : 'party'));
  // time fields per kinds vector; null when the engine's skeleton is degenerate (hypothesis dropped)
  const fields = new Map<string, TimeField | null>();
  const field = (kinds: EdgeKind[]): TimeField | null => {
    const key = kinds.join(',');
    if (!fields.has(key)) {
      let f: TimeField | null = null;
      try { f = makeTimeField(part.poly, kinds, part.frame); } catch { f = null; }
      fields.set(key, f);
    }
    return fields.get(key)!;
  };
  const skelModel = (family: Family, label: string, kinds: EdgeKind[], roofType: RoofType, extra: Partial<ModelDef> = {}): ModelDef | null => {
    const tf = field(kinds);
    if (!tf) { degenerate++; return null; }
    const cache = new WeakMap<Float64Array, Float64Array>();
    return {
      family, label, twoPitch: false, allowNeg: false, grid: [], nVariants: 1, gDependent: false, roofType, kinds,
      times(pts) {
        let t = cache.get(pts);
        if (!t) cache.set(pts, (t = tf.fill(pts)));
        return t;
      },
      tmax: () => tf.tmax,
      ...extra,
    };
  };
  const eaveSides = (kinds: EdgeKind[]) => new Set(E.filter((_, i) => kinds[i] === 'eave').map((e) => e.side));
  const out: ModelDef[] = [];
  const seen = new Set<string>();
  const add = (key: string, m: ModelDef | null): m is ModelDef => {
    if (!m || seen.has(key)) return false;
    seen.add(key);
    out.push(m);
    return true;
  };
  add('flat', {
    family: 'flat', label: 'flat', twoPitch: false, allowNeg: false, grid: [], nVariants: 1, gDependent: false, roofType: 'flat', kinds: base,
    times: (pts) => new Float64Array(pts.length >> 1), tmax: () => 0,
  });
  // gabled variants: edges roughly perpendicular to the ridge axis become gables
  const gableModels: ModelDef[] = [];
  const gableKinds: { axis: 'u' | 'v'; kinds: EdgeKind[] }[] = [];
  for (const axis of ['u', 'v'] as const) {
    const perp = axis === 'u' ? 'v' : 'u';
    const kinds: EdgeKind[] = E.map((e) => (!isFree(e) ? 'party' : e.dir === perp ? 'gable' : 'eave'));
    const sides = eaveSides(kinds);
    if (!(axis === 'u' ? sides.has('S') && sides.has('N') : sides.has('W') && sides.has('E'))) continue;
    const m = skelModel('gable', `gable-${axis}`, kinds, 'gabled', { allowNeg: opts.butterfly });
    if (add(`p:${kinds.join(',')}`, m)) { gableModels.push(m); gableKinds.push({ axis, kinds }); }
  }
  const hipValid = eaveSides(base).size >= 3;
  if (hipValid) {
    add(`p:${base.join(',')}`, skelModel('hip', 'hip', base, 'hipped'));
    try {
      const ag = autoGableKinds(alignPolygon(part.poly, part.frame), base);
      if (ag.filter((k) => k === 'eave').length >= 2) {
        const m = skelModel('crossgable', 'cross-gable', ag, 'gabled');
        if (add(`p:${ag.join(',')}`, m)) gableModels.push(m);
      }
    } catch { /* heuristic only */ }
  }
  // asymmetric gables: the eaves of one side rise 2^g times as fast, so the ridge moves towards that side
  // (their own variant count, so the structural prior of the symmetric gables is unchanged)
  const asym: ModelDef[] = [];
  if (opts.asymGable) {
    for (const { axis, kinds } of gableKinds) {
      for (const steepSide of (axis === 'u' ? ['S', 'N'] : ['W', 'E']) as Side[]) {
        const steepEdges = E.filter((e, i) => kinds[i] === 'eave' && e.side === steepSide).map((e) => e.i);
        if (!steepEdges.length) continue;
        const tf = new Map<number, TimeField | null>();
        const fieldAt = (g: number): TimeField | null => {
          if (!tf.has(g)) {
            const w = kinds.map((_, i) => (steepEdges.includes(i) ? 2 ** -g : undefined));
            let f: TimeField | null = null;
            try { f = makeTimeField(part.poly, kinds, part.frame, w); } catch { f = null; }
            tf.set(g, f);
          }
          return tf.get(g)!;
        };
        const grid = ASYM_GABLE_GRID.filter((g) => fieldAt(g));
        if (!grid.length) { degenerate++; continue; }
        const cache = new Map<number, WeakMap<Float64Array, Float64Array>>();
        asym.push({
          family: 'gable', label: `gable-${axis}-steep-${steepSide}`, twoPitch: false, allowNeg: false, grid, nVariants: 1, gDependent: true,
          roofType: 'gabled', kinds, steepEdges,
          times(pts, g) {
            if (!cache.has(g)) cache.set(g, new WeakMap());
            const c = cache.get(g)!;
            let t = c.get(pts);
            if (!t) c.set(pts, (t = fieldAt(g)!.fill(pts)));
            return t;
          },
          tmax: (g) => fieldAt(g)?.tmax ?? 0,
        });
      }
    }
  }
  for (const m of gableModels) m.nVariants = gableModels.length;
  for (const m of asym) { m.nVariants = asym.length; out.push(m); }
  // skillions: one eave (longest free edge >= minSkillionEdge per dominant direction)
  const sk: ModelDef[] = [];
  const used = new Set<string>();
  for (const s of SIDES) {
    const cands = E.filter((e) => isFree(e) && e.side === s && e.len >= opts.minSkillionEdge);
    if (!cands.length) continue;
    const e = cands.reduce((a, b) => (b.len > a.len ? b : a));
    const kinds: EdgeKind[] = E.map((x) => (!isFree(x) ? 'party' : x.i === e.i ? 'eave' : 'gable'));
    let label = `skillion-${compass(e.nx, e.ny)}`;
    if (used.has(label)) label += `${sk.length + 1}`;
    used.add(label);
    const m = skelModel('skillion', label, kinds, 'skillion');
    if (add(`p:${kinds.join(',')}`, m)) sk.push(m);
  }
  for (const m of sk) m.nVariants = sk.length;
  // near-rectangle closed forms and two-pitch families
  const nearRect = part.rectangularity >= opts.nearRect && !(part.poly.holes ?? []).length;
  if (nearRect && opts.closedForms) {
    const f = part.frame;
    const rect: RectSpec = { u0: part.u0, u1: part.u1, v0: part.v0, v1: part.v1, party: { S: false, N: false, W: false, E: false } };
    for (const s of SIDES) {
      const sideLen = s === 'S' || s === 'N' ? part.u1 - part.u0 : part.v1 - part.v0;
      const partyLen = E.filter((e) => !isFree(e) && e.side === s).reduce((a, e) => a + e.len, 0);
      rect.party[s] = partyLen >= 0.5 * sideLen;
    }
    const closed = (family: Family, label: string, eaves: Side[], ends: Side[], kinds: EdgeKind[], roofType: RoofType, extra: Partial<ModelDef>): ModelDef => ({
      family, label, twoPitch: false, allowNeg: false, grid: [], nVariants: 1, gDependent: family === 'halfhip', roofType, kinds,
      times(pts, g) {
        const n = pts.length >> 1, o = new Float64Array(n);
        for (let k = 0; k < n; k++) {
          const x = pts[2 * k], y = pts[2 * k + 1];
          o[k] = rectTime(family, eaves, ends, rect, toU(f, x, y), toV(f, x, y), g);
        }
        return o;
      },
      tmax: (g) => {
        if (family === 'pyramid') return 0.5 * (rect.u1 - rect.u0);
        const across = 0.5 * (eaves[0] === 'S' ? rect.v1 - rect.v0 : rect.u1 - rect.u0);
        const along = eaves[0] === 'S' ? rect.u1 - rect.u0 : rect.v1 - rect.v0;
        return Math.min(across, (ends.length >= 2 ? along / 2 : along) + g);
      },
      ...extra,
    });
    const free = SIDES.filter((s) => !rect.party[s]);
    const fs = new Set(free);
    const hh: ModelDef[] = [];
    for (const gs of [['S', 'N'], ['W', 'E']] as Side[][]) {
      if (!(fs.has(gs[0]) && fs.has(gs[1]))) continue;
      const ends = SIDES.filter((s) => !gs.includes(s) && fs.has(s));
      const half = 0.5 * (gs[0] === 'S' ? rect.v1 - rect.v0 : rect.u1 - rect.u0);
      if (!ends.length || half < 2.0) continue;
      const grid = arange(1.0, half - 0.99, 0.25);
      if (!grid.length) continue;
      const axis = gs[0] === 'S' ? 'u' : 'v';
      const gk = gableKinds.find((x) => x.axis === axis)?.kinds
        ?? E.map((e) => (!isFree(e) ? 'party' : e.dir === (axis === 'u' ? 'v' : 'u') ? 'gable' : 'eave'));
      hh.push(closed('halfhip', `half-hip-${axis}`, gs, ends, gk, 'half-hipped', { grid, halfWidth: half }));
    }
    for (const m of hh) { m.nVariants = hh.length; out.push(m); }
    const lu = rect.u1 - rect.u0, lv = rect.v1 - rect.v0;
    if (free.length === 4 && Math.max(lu, lv) / Math.min(lu, lv) > 1.15) {
      out.push(closed('pyramid', 'pyramid', [], [], base, 'pyramidal', { hu: lu / 2, hv: lv / 2 }));
    }
  }
  if (nearRect && opts.twoPitch) {
    const tp: ModelDef[] = [];
    const twoPitch = (label: string, kinds: EdgeKind[], roofType: RoofType) => {
      const m = skelModel('mansard', label, kinds, roofType, { twoPitch: true });
      if (!m) return;
      m.grid = arange(opts.erode + 0.75, m.tmax(0) - 0.74, 0.25);
      if (m.grid.length && add(`tp:${kinds.join(',')}`, m)) tp.push(m);
    };
    if (hipValid) twoPitch('mansard', base, 'mansard');
    for (const { axis, kinds } of gableKinds) {
      const terrace = !kinds.includes('gable');
      twoPitch(terrace ? `mansard-${axis}` : `gambrel-${axis}`, kinds, terrace ? 'mansard' : 'gambrel');
    }
    for (const m of tp) m.nVariants = tp.length;
  }
  if (opts.crossGable && nearRect && isConvexPart(part)) out.push(...compoundModels(part));
  libraryStats.set(out, { degenerate });
  return out;
}

/** Diagnostics of a library returned by `partLibrary`: number of hypotheses dropped for degenerate skeletons. */
export const libraryStats = new WeakMap<ModelDef[], { degenerate: number }>();
