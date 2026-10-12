// Overpass JSON (`out geom`) -> building polygons (ways + stitched multipolygons), address/entrance nodes, roads.
import type { LonLat } from '../contracts.js';

/** One element of an Overpass `out geom` response. */
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: 'node' | 'way' | 'relation'; ref: number; role: string; geometry?: ({ lat: number; lon: number } | null)[]; lat?: number; lon?: number }[];
}

/** A closed polygon built from a way or (one outer ring of) a multipolygon relation. */
export interface OsmPolygon {
  /** 'way/123', 'relation/45', or 'relation/45#2' for additional outer rings of a multi-outer relation. */
  ref: string;
  tags: Record<string, string>;
  kind: 'building' | 'building:part' | 'other';
  outer: LonLat[]; // open ring (no closing duplicate)
  holes: LonLat[][];
  warnings: string[];
}

/** Point features with tags (address points, entrances). */
export interface OsmPoint { lon: number; lat: number; tags: Record<string, string>; ref: string }

/** A highway centre line. */
export interface OsmRoad { name?: string; kind: string; coords: LonLat[]; ref: string }

const eq = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

const coordsOf = (g: ({ lat: number; lon: number } | null)[] | undefined): LonLat[] =>
  (g ?? []).filter((x): x is { lat: number; lon: number } => x != null && Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => [x.lon, x.lat]);

/**
 * Stitches member ways into closed rings by matching end coordinates (shared OSM nodes have identical coordinates),
 * reversing members as needed. Chains that cannot be closed are returned in `unclosed` (a data error).
 */
export function stitchRings(ways: LonLat[][]): { rings: LonLat[][]; unclosed: LonLat[][] } {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings: LonLat[][] = [];
  const unclosed: LonLat[][] = [];
  while (pool.length) {
    let cur = pool.shift()!;
    let guard = 0;
    while (!eq(cur[0], cur[cur.length - 1]) && guard++ < 100_000) {
      const end = cur[cur.length - 1];
      let idx = pool.findIndex((w) => eq(w[0], end) || eq(w[w.length - 1], end));
      if (idx >= 0) {
        const w = pool.splice(idx, 1)[0];
        cur = cur.concat((eq(w[0], end) ? w : w.slice().reverse()).slice(1));
        continue;
      }
      const start = cur[0];
      idx = pool.findIndex((w) => eq(w[0], start) || eq(w[w.length - 1], start));
      if (idx < 0) break;
      const w = pool.splice(idx, 1)[0];
      cur = (eq(w[w.length - 1], start) ? w : w.slice().reverse()).slice(0, -1).concat(cur);
    }
    if (eq(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(cur.slice(0, -1));
    else unclosed.push(cur);
  }
  return { rings, unclosed };
}

/** Even-odd point-in-ring test in lon/lat (fine for building-sized rings). */
export function ringContainsLonLat(ring: LonLat[], p: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function absAreaDeg(r: LonLat[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

function kindOf(tags: Record<string, string>): OsmPolygon['kind'] {
  if (tags.building && tags.building !== 'no') return 'building';
  if (tags['building:part'] && tags['building:part'] !== 'no') return 'building:part';
  return 'other';
}

/** Converts a way or multipolygon relation into polygons (one per outer ring, largest first); [] if not an area. */
export function elementToPolygons(el: OsmElement): OsmPolygon[] {
  const tags = el.tags ?? {};
  const kind = kindOf(tags);
  if (el.type === 'way') {
    const coords = coordsOf(el.geometry);
    if (coords.length < 4) return [];
    const warnings: string[] = [];
    if ((el.geometry ?? []).some((g) => g == null)) warnings.push('geometry partially clipped (null coordinates)');
    const closed = el.nodes && el.nodes.length > 1 ? el.nodes[0] === el.nodes[el.nodes.length - 1] : eq(coords[0], coords[coords.length - 1]);
    if (!closed || !eq(coords[0], coords[coords.length - 1])) return [];
    return [{ ref: `way/${el.id}`, tags, kind, outer: coords.slice(0, -1), holes: [], warnings }];
  }
  if (el.type !== 'relation' || (tags.type !== 'multipolygon' && tags.type !== 'building')) return [];
  const warnings: string[] = [];
  const outerWays: LonLat[][] = [];
  const innerWays: LonLat[][] = [];
  for (const m of el.members ?? []) {
    if (m.type !== 'way' || !m.geometry) continue;
    const line = coordsOf(m.geometry);
    if (m.role === 'inner') innerWays.push(line);
    else if (m.role === 'outer' || m.role === '') {
      if (m.role === '') warnings.push(`member way/${m.ref} has an empty role: treated as outer`);
      outerWays.push(line);
    }
  }
  const o = stitchRings(outerWays);
  const i = stitchRings(innerWays);
  if (o.unclosed.length || i.unclosed.length) warnings.push(`${o.unclosed.length + i.unclosed.length} member chain(s) could not be closed`);
  if (!o.rings.length) return [];
  const outers = o.rings.sort((a, b) => absAreaDeg(b) - absAreaDeg(a)).map((r) => ({ outer: r, holes: [] as LonLat[][] }));
  for (const h of i.rings) {
    const host = outers.find((p) => ringContainsLonLat(p.outer, h[0]));
    if (host) host.holes.push(h);
    else warnings.push('inner ring outside all outer rings: dropped');
  }
  return outers.map((p, k) => ({
    ref: k === 0 ? `relation/${el.id}` : `relation/${el.id}#${k + 1}`,
    tags, kind, outer: p.outer, holes: p.holes, warnings: k === 0 ? warnings : [...warnings, 'additional outer ring of a multi-outer relation'],
  }));
}

/** Parsed content of an Overpass footprint query. */
export interface ParsedOsm {
  polygons: OsmPolygon[];
  addressNodes: OsmPoint[];
  entrances: OsmPoint[];
  roads: OsmRoad[];
  /** Every tagged node by ref ('node/1'), e.g. to resolve a geocoder POI node. */
  nodes: Map<string, OsmPoint>;
  /** Non-building areas by ref (e.g. a geocoded site such as a museum grounds way). */
  areas: Map<string, OsmPolygon>;
}

/** Splits Overpass elements into building polygons, address points, entrances, roads and other areas. */
export function parseOsmElements(elements: OsmElement[]): ParsedOsm {
  const out: ParsedOsm = { polygons: [], addressNodes: [], entrances: [], roads: [], nodes: new Map(), areas: new Map() };
  const seen = new Set<string>();
  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = el.tags ?? {};
    if (el.type === 'node') {
      if (el.lat == null || el.lon == null) continue;
      const pt: OsmPoint = { lon: el.lon, lat: el.lat, tags, ref: key };
      out.nodes.set(key, pt);
      if (tags['addr:housenumber'] || tags['addr:housename']) out.addressNodes.push(pt);
      if (tags.entrance && tags.entrance !== 'no') out.entrances.push(pt);
      continue;
    }
    if (el.type === 'way' && tags.highway && !tags.building) {
      const coords = coordsOf(el.geometry);
      if (coords.length >= 2) out.roads.push({ ...(tags.name || tags.ref ? { name: tags.name ?? tags.ref } : {}), kind: tags.highway, coords, ref: key });
      continue;
    }
    for (const poly of elementToPolygons(el)) {
      if (poly.kind === 'other') out.areas.set(poly.ref, poly);
      else out.polygons.push(poly);
    }
  }
  return out;
}
