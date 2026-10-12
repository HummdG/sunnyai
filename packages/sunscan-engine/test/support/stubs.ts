// Test support: canned reconstruct outputs and stub providers for branch / route tests.
import type { ChimneySpec, PolygonM, ReconstructInput, ReconstructOutput, Vec2 } from '@sunny/sunscan-core';
import type { BuildingsResult, GeocodeResult, NoCoverage, Providers, Suggestion } from '../../src/contracts.js';

/** Options of {@link cannedReconstruct}. */
export interface CannedFit {
  ok?: boolean;
  unreliable?: boolean;
  sigma?: number;
  shift?: Vec2;
  flag?: string;
  eave?: number;
  pitch?: number;
  chimneyAtCentroid?: boolean;
  /** Ground (absolute m ODN); default: DTM value at the target centroid. */
  ground?: number;
}

const centroid = (p: PolygonM): Vec2 => {
  let a = 0, cx = 0, cy = 0;
  const r = p.outer;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  return [cx / (3 * a), cy / (3 * a)];
};

/**
 * A reconstruct stub with a predictable output: the target footprint shifted by `shift` as one hipped part,
 * the ground taken from the DTM at the centroid, optional chimney at the centroid; records its last input.
 */
export function cannedReconstruct(o: CannedFit = {}) {
  const calls: ReconstructInput[] = [];
  const fn = (input: ReconstructInput): ReconstructOutput => {
    calls.push(input);
    const s = o.shift ?? [0, 0];
    const fp: PolygonM = {
      outer: input.target.footprint.outer.map(([x, y]) => [x + s[0], y + s[1]]),
      holes: (input.target.footprint.holes ?? []).map((h) => h.map(([x, y]) => [x + s[0], y + s[1]] as Vec2)),
    };
    const c = centroid(fp);
    const d = input.dtm;
    const col = Math.max(0, Math.min(d.width - 1, Math.floor((c[0] - d.originX) / d.res)));
    const row = Math.max(0, Math.min(d.height - 1, Math.floor((d.originY - c[1]) / d.res)));
    const ground = o.ground ?? d.data[row * d.width + col];
    const eave = o.eave ?? 5.2;
    const chimneys: ChimneySpec[] = o.chimneyAtCentroid ? [{ center: c, width: 0.8, depth: 1.2, angleDeg: 0, top: eave + 4, source: 'lidar' }] : [];
    return {
      ok: o.ok ?? true,
      ground,
      groundCheck: null,
      registration: { shift: s, sigmaMajor: 0.3, sigmaMinor: 0.2, method: 'edge-neighbourhood', ...(o.flag ? { flag: o.flag } : {}) },
      parts: [{ id: 'main', role: 'main', footprint: fp, edgeKinds: input.target.edgeKinds, roof: { type: 'hipped', pitchDeg: o.pitch ?? 40 }, eaveHeight: eave, ridgeHeight: eave + 3, family: 'hip', eaveSE: 0.1, pitchSE: 1.5 }],
      chimneys,
      neighbourHeights: input.neighbours.slice(0, 3).map((n) => ({ id: n.id, height: 7.5 })),
      report: { sigma: o.sigma ?? 0.2, rmse: 0.18, inlierFraction: 0.95, nPixels: 60, pModel: 0.97, unreliable: o.unreliable ?? false, selected: 'hip', alternatives: [{ label: 'gable-u', deltaCriterion: 12.3 }] },
      samples: [
        { x: c[0], y: c[1], z: eave + 2, residual: 0.05 },
        { x: c[0] + 1, y: c[1], z: eave + 1.5, residual: -0.1 },
      ],
      flags: [],
    };
  };
  return { fn, calls };
}

/** A NoCoverage elevation provider (e.g. Northern Ireland). */
export const noLidar = (reason: NoCoverage['reason'] = 'no-open-lidar') => async (): Promise<NoCoverage> => ({ coverage: 0, reason });

/** A minimal BuildingsResult around (lat, lon) with one square house and a semi-detached partner. */
export function syntheticBuildings(lat: number, lon: number, opts: { overture?: boolean } = {}): BuildingsResult {
  const m = 1 / 111_320;
  const k = m / Math.cos((lat * Math.PI) / 180);
  const sq = (x0: number, y0: number, w: number, h: number): [number, number][] => [
    [lon + x0 * k, lat + y0 * m],
    [lon + (x0 + w) * k, lat + y0 * m],
    [lon + (x0 + w) * k, lat + (y0 + h) * m],
    [lon + x0 * k, lat + (y0 + h) * m],
  ];
  return {
    center: { lat, lon },
    target: opts.overture ? 'overture:abc' : 'osm:way/1',
    ambiguous: false,
    buildings: [
      { ref: opts.overture ? 'overture:abc' : 'osm:way/1', source: opts.overture ? 'overture' : 'osm', outer: sq(-4, -4, 8, 8), holes: [], tags: { building: 'house' }, isPart: false, score: 150, reasons: ['contains point'] },
      { ref: 'osm:way/2', source: 'osm', outer: sq(4, -4, 8, 8), holes: [], tags: { building: 'house' }, isPart: false, score: 10, reasons: [] },
    ],
    addressNodes: [],
    entrances: [],
    roads: [{ name: 'Test Road', kind: 'residential', coords: [[lon - 40 * k, lat - 15 * m], [lon + 40 * k, lat - 15 * m]] }],
    sources: [opts.overture ? 'overture:2026-09-23.1' : 'overpass:test'],
    warnings: [],
  };
}

/** Stub providers for route tests (no LiDAR, synthetic buildings, canned geocoder). */
export function stubProviders(over: Partial<Providers> = {}): Providers {
  const geocode: GeocodeResult = {
    query: '1 Test Road, Liverpool L1 1AA',
    parsed: { raw: '1 Test Road, Liverpool L1 1AA', postcode: 'L1 1AA', houseNumber: '1', street: 'Test Road', localities: ['Liverpool'], nationHint: 'England' },
    confidence: 'high',
    best: { label: '1 Test Road, Liverpool', lat: 53.4, lon: -2.98, level: 'building', osmRef: 'way/1', score: 100, reasons: ['test'], sources: ['nominatim-free'] },
    candidates: [],
    postcode: { postcode: 'L1 1AA', lat: 53.4001, lon: -2.9801, nation: 'England' },
  };
  const suggestions: Suggestion[] = [{ label: '1 Test Road, Liverpool', kind: 'address', lat: 53.4, lon: -2.98 }];
  return {
    geocodeUk: async () => structuredClone(geocode),
    suggestUk: async () => suggestions,
    nationAt: async () => 'England',
    fetchBuildings: async (req) => syntheticBuildings(req.lat, req.lon),
    getSurfaceRasters: noLidar(),
    getOstn15: async () => linearOstn,
    ...over,
  };
}

/** An invertible stand-in for OSTN15 (equirectangular about 54°N; not geodetically accurate). */
export const linearOstn = {
  toBng: (lon: number, lat: number): [number, number] => [400000 + (lon + 2) * 65_500, (lat - 49) * 111_320 - 100000],
  toWgs84: (e: number, n: number): [number, number] => [(e - 400000) / 65_500 - 2, (n + 100000) / 111_320 + 49],
};
