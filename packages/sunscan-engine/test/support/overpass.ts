// Test support: parse a recorded Overpass `out geom` response into the provider contract (BuildingsResult).
// Ways and simple multipolygon relations (stitched member ways, holes assigned by containment); address nodes,
// entrance nodes and highway ways become addressNodes / entrances / roads.
import type { BuildingFeature, BuildingsResult, LonLat } from '../../src/contracts.js';

/** Overpass JSON element (subset). */
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; ref: number; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}

const eq = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

/** Join member ways into closed rings by matching end coordinates. */
export function stitchRings(ways: LonLat[][]): { rings: LonLat[][]; unclosed: number } {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings: LonLat[][] = [];
  let unclosed = 0;
  while (pool.length) {
    let cur = pool.shift()!;
    for (let guard = 0; !eq(cur[0], cur[cur.length - 1]) && guard < 10_000; guard++) {
      const end = cur[cur.length - 1];
      const i = pool.findIndex((w) => eq(w[0], end) || eq(w[w.length - 1], end));
      if (i < 0) break;
      const w = pool.splice(i, 1)[0];
      cur = cur.concat((eq(w[0], end) ? w : w.slice().reverse()).slice(1));
    }
    if (eq(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(cur.slice(0, -1));
    else unclosed++;
  }
  return { rings, unclosed };
}

function ringContains(ring: LonLat[], p: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const absArea = (r: LonLat[]) => Math.abs(r.reduce((s, a, i) => s + a[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * a[1], 0) / 2);

const coords = (g: ({ lat: number; lon: number } | null)[] | undefined): LonLat[] =>
  (g ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p) => [p.lon, p.lat]);

/** Options of {@link parseOverpass}: request centre and the recorded target choice. */
export interface ParseOptions {
  center: { lat: number; lon: number };
  target?: string;
  ambiguous?: boolean;
  candidates?: { osm: string; score: number; reasons: string[] }[];
  source?: string;
}

/** Convert Overpass elements into a BuildingsResult. */
export function parseOverpass(elements: OsmElement[], opts: ParseOptions): BuildingsResult {
  const buildings: BuildingFeature[] = [];
  const addressNodes: BuildingsResult['addressNodes'] = [];
  const entrances: BuildingsResult['entrances'] = [];
  const roads: BuildingsResult['roads'] = [];
  const warnings: string[] = [];
  const scores = new Map((opts.candidates ?? []).map((c) => [`osm:${c.osm}`, c]));
  const kindOf = (t: Record<string, string>) => (t.building && t.building !== 'no' ? 'building' : t['building:part'] && t['building:part'] !== 'no' ? 'part' : undefined);
  const push = (ref: string, outer: LonLat[], holes: LonLat[][], tags: Record<string, string>, isPart: boolean) => {
    const c = scores.get(ref);
    buildings.push({ ref, source: 'osm', outer, holes, tags, isPart, ...(c ? { score: c.score, reasons: c.reasons } : {}) });
  };
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === 'node') {
      if (el.lat === undefined || el.lon === undefined) continue;
      if (tags['addr:housenumber'] || tags['addr:housename']) addressNodes.push({ lon: el.lon, lat: el.lat, tags });
      if (tags.entrance) entrances.push({ lon: el.lon, lat: el.lat, tags });
      continue;
    }
    if (el.type === 'way') {
      const c = coords(el.geometry);
      if (tags.highway) {
        if (c.length >= 2) roads.push({ ...(tags.name ? { name: tags.name } : {}), kind: tags.highway, coords: c });
        continue;
      }
      const kind = kindOf(tags);
      if (!kind) continue;
      if (c.length < 4 || !eq(c[0], c[c.length - 1])) {
        warnings.push(`way/${el.id}: unclosed or clipped geometry ignored`);
        continue;
      }
      push(`osm:way/${el.id}`, c.slice(0, -1), [], tags, kind === 'part');
      continue;
    }
    if (el.type === 'relation' && tags.type === 'multipolygon') {
      const kind = kindOf(tags);
      if (!kind) continue;
      const outerWays: LonLat[][] = [];
      const innerWays: LonLat[][] = [];
      for (const m of el.members ?? []) {
        if (m.type !== 'way') continue;
        (m.role === 'inner' ? innerWays : outerWays).push(coords(m.geometry));
      }
      const o = stitchRings(outerWays);
      const i = stitchRings(innerWays);
      if (o.unclosed || i.unclosed) warnings.push(`relation/${el.id}: ${o.unclosed + i.unclosed} member chain(s) could not be closed`);
      if (!o.rings.length) continue;
      const outers = o.rings.sort((a, b) => absArea(b) - absArea(a)).map((r) => ({ outer: r, holes: [] as LonLat[][] }));
      for (const h of i.rings) outers.find((p) => ringContains(p.outer, h[0]))?.holes.push(h);
      if (outers.length > 1) warnings.push(`relation/${el.id}: ${outers.length - 1} extra outer ring(s) ignored`);
      push(`osm:relation/${el.id}`, outers[0].outer, outers[0].holes, tags, kind === 'part');
    }
  }
  return {
    center: opts.center,
    ...(opts.target ? { target: `osm:${opts.target.replace(/^osm:/, '')}` } : {}),
    ambiguous: opts.ambiguous ?? false,
    buildings,
    addressNodes,
    entrances,
    roads,
    sources: [opts.source ?? 'overpass:fixture'],
    warnings,
  };
}
