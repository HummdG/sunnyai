// Adapters between the pipeline's injectable stage functions (./types.ts) and @sunscan/core:
//   core/fit       reconstruct(ReconstructInput) -> ReconstructOutput; priorsFallback({...PriorContext, footprint, edgeKinds})
//   core/footprint analyseFootprint, regularizeFootprintDetailed + mapEdgeKinds, frontEdge
// Each stage can be replaced through BuildModelDeps (tests inject deterministic stubs).
import { FIT_METHOD, priorsFallback, reconstruct } from '@sunny/sunscan-core/fit';
import { analyseFootprint, frontEdge, mapEdgeKinds, regularizeFootprintDetailed } from '@sunny/sunscan-core/footprint';
import { distPointSeg } from '@sunny/sunscan-core/geometry';
import type { EdgeKind, PolygonM, ReconstructedPart, Vec2 } from '@sunny/sunscan-core';
import type {
  AnalyseFootprintFn,
  BuildModelDeps,
  FrontEdgeFn,
  FrontEdgeInput,
  PriorsFallbackFn,
  PriorsFallbackResult,
  ReconstructFn,
  RegularizeFootprintFn,
} from './types.js';

/** Party walls + built form via core/footprint `analyseFootprint` (address points feed its multi-dwelling test). */
export const coreAnalyseFootprint: AnalyseFootprintFn = (ctx) => {
  const neighbours = ctx.others.filter((o) => !o.isPart).map((o) => ({ id: o.id, footprint: o.footprint, tags: o.tags }));
  const a = analyseFootprint(ctx.target.footprint, neighbours, { targetTags: ctx.target.tags, addressPoints: ctx.addressNodes });
  return {
    edgeKinds: a.edgeKinds,
    partyEdges: a.edgeKinds.flatMap((k, i) => (k === 'party' ? [i] : [])),
    builtForm: a.builtForm,
    attached: [...a.attached, ...a.ancillaryAttached],
    terraceBlock: a.multiDwelling,
    reasons: a.reasons,
  };
};

/** The entrance node closest to a free outer edge of the footprint (<= 1.5 m), preferring entrance=main. */
export function pickEntrance(inp: FrontEdgeInput): { xy: Vec2; tags: Record<string, string> } | undefined {
  const ring = inp.footprint.outer;
  const rank = (t: Record<string, string>) => (t.entrance === 'main' ? 0 : t.entrance === 'service' || t.entrance === 'emergency' ? 2 : 1);
  let best: { e: (typeof inp.entrances)[number]; d: number; r: number } | undefined;
  for (const e of inp.entrances) {
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) if (inp.edgeKinds[i] !== 'party') d = Math.min(d, distPointSeg(e.xy, ring[i], ring[(i + 1) % ring.length]));
    if (d > 1.5) continue;
    const r = rank(e.tags);
    if (!best || r < best.r || (r === best.r && d < best.d)) best = { e, d, r };
  }
  return best?.e;
}

/** Street-facing edge via core/footprint `frontEdge`. */
export const coreFrontEdge: FrontEdgeFn = (inp) => {
  const ent = pickEntrance(inp);
  const r = frontEdge(inp.footprint, inp.edgeKinds, inp.roads, ent?.xy, inp.street, { entranceTol: 1.5 });
  if (!r) return undefined;
  const named = r.road && inp.roads.some((x) => x.name === r.road) ? r.road : undefined;
  return {
    edge: r.edge,
    method: r.method,
    ...(r.method === 'entrance' && ent ? { entrance: ent.xy } : {}),
    ...((named ?? inp.street) ? { streetName: named ?? inp.street } : {}),
    reasons: r.reasons,
  };
};

/** Regularisation via core/footprint, carrying edge kinds onto the regularised edges. */
export const coreRegularize: RegularizeFootprintFn = (footprint, edgeKinds) => {
  const r = regularizeFootprintDetailed(footprint);
  return { footprint: r.polygon, edgeKinds: mapEdgeKinds<EdgeKind>(r, edgeKinds, footprint) };
};

/** core/fit `priorsFallback` behind the (ctx, footprint, edgeKinds) signature. */
export const corePriors: PriorsFallbackFn = (ctx, footprint, edgeKinds) => priorsFallback({ ...ctx, footprint, edgeKinds });

/** The reconstruct function and its FitReport.method label (injected > core/fit). */
export function resolveReconstruct(deps: BuildModelDeps): { fn: ReconstructFn; label: string } {
  if (deps.reconstruct) return { fn: deps.reconstruct, label: deps.reconstructLabel ?? 'injected' };
  return { fn: reconstruct, label: FIT_METHOD };
}

/** The priors fallback (injected > core/fit). */
export function resolvePriors(deps: BuildModelDeps): { fn: PriorsFallbackFn; label: string } {
  return deps.priorsFallback ? { fn: deps.priorsFallback, label: 'injected' } : { fn: corePriors, label: 'core/fit' };
}

/** Party walls + built form (injected > core/footprint). */
export const resolveAnalyse = (deps: BuildModelDeps): AnalyseFootprintFn => deps.analyseFootprint ?? coreAnalyseFootprint;

/** Street-facing edge (injected > core/footprint). */
export const resolveFrontEdge = (deps: BuildModelDeps): FrontEdgeFn => deps.frontEdge ?? coreFrontEdge;

/** Footprint regularisation (injected > core/footprint). */
export const resolveRegularize = (deps: BuildModelDeps): RegularizeFootprintFn => deps.regularizeFootprint ?? coreRegularize;

const isPart = (x: unknown): x is ReconstructedPart =>
  !!x && typeof x === 'object' && 'footprint' in x && 'eaveHeight' in x && 'roof' in x && Number.isFinite((x as ReconstructedPart).eaveHeight);

/** Normalise whatever a priors fallback returns into parts (+ notes, storeys); undefined if unrecognised. */
export function normalisePriors(result: PriorsFallbackResult | unknown): { parts: ReconstructedPart[]; notes: string[]; storeys?: number } | undefined {
  if (Array.isArray(result)) return result.length && result.every(isPart) ? { parts: result, notes: [] } : undefined;
  if (isPart(result)) return { parts: [result], notes: [] };
  if (result && typeof result === 'object' && 'parts' in result) {
    const r = result as { parts: unknown; notes?: unknown; storeys?: unknown };
    if (Array.isArray(r.parts) && r.parts.length && r.parts.every(isPart)) {
      return {
        parts: r.parts as ReconstructedPart[],
        notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
        ...(typeof r.storeys === 'number' && r.storeys >= 1 ? { storeys: r.storeys } : {}),
      };
    }
  }
  return undefined;
}

/**
 * Last-resort block model when every priors fallback failed: a flat-roofed prism (LoD1) at a two-storey height,
 * or at the given height hint.
 */
export function lod1Fallback(footprint: PolygonM, edgeKinds: EdgeKind[], height?: number): ReconstructedPart {
  const h = height !== undefined && Number.isFinite(height) && height > 2 ? height : 5.3;
  return {
    id: 'main',
    role: 'main',
    footprint,
    edgeKinds: edgeKinds.map((k) => (k === 'party' ? 'party' : 'eave')),
    roof: { type: 'flat' },
    eaveHeight: h,
    ridgeHeight: h,
    family: 'flat',
  };
}
