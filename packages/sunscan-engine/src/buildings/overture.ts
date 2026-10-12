// Overture buildings from the public PMTiles archive (keyless; one z14 MVT tile per lookup, research 01 §4.1).
// All byte ranges go through fetchCached (provider 'overture'), so lookups are cached, recorded and replayable.
import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from 'node:zlib';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { Compression, PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { bodyArrayBuffer, fetchCached } from '../http/index.js';
import type { LonLat } from '../contracts.js';

/** Overture release used for the PMTiles archive (versioned URL => immutable content). */
export const OVERTURE_RELEASE = '2026-09-23.1';
/** Public Overture buildings PMTiles archive. */
export const OVERTURE_BUILDINGS_URL = `https://tiles.overturemaps.org/${OVERTURE_RELEASE}/buildings.pmtiles`;
/** Zoom of the full-detail building tiles. */
export const OVERTURE_ZOOM = 14;

/** An Overture building outline (largest polygon of the feature). */
export interface OvertureBuilding {
  id: string;
  outer: LonLat[]; // open ring
  holes: LonLat[][];
  /** OSM-style tags derived from Overture properties (building, height, building:levels, roof:shape, overture:*). */
  tags: Record<string, string>;
  /** Source datasets, e.g. ['OpenStreetMap'] or ['Microsoft ML Buildings']. */
  datasets: string[];
  /** OSM element behind an OpenStreetMap-sourced feature ('way/516128867'), when known. */
  osmRef?: string;
}

/** PMTiles Source reading byte ranges through the cached/recorded HTTP layer. */
export class CachedPmtilesSource implements Source {
  constructor(private readonly url: string, private readonly provider = 'overture') {}

  getKey(): string {
    return this.url;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const res = await fetchCached({ url: this.url, provider: this.provider, range: [offset, offset + length - 1] });
    if (res.status !== 206 && res.status !== 200) throw new Error(`PMTiles range ${offset}+${length}: HTTP ${res.status}`);
    // no etag: the archive URL is release-versioned, and cached ranges must never trigger EtagMismatch retries
    return { data: bodyArrayBuffer(res) };
  }
}

const toAb = (b: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
};

/** zlib-based decompression for PMTiles directories and tiles. */
export async function decompressPmtiles(buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf);
  switch (compression) {
    case Compression.None:
    case Compression.Unknown:
      return buf;
    case Compression.Gzip:
      return toAb(gunzipSync(u));
    case Compression.Brotli:
      return toAb(brotliDecompressSync(u));
    case Compression.Zstd:
      return toAb(zstdDecompressSync(u));
    default:
      throw new Error(`unsupported PMTiles compression ${compression}`);
  }
}

/** Web-Mercator tile containing a point. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n))),
    y: Math.min(n - 1, Math.max(0, Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n))),
  };
}

/** z14 tiles intersecting the box of +-radius metres around a point (1 tile usually, at most 4 for small radii). */
export function tilesAround(lat: number, lon: number, radiusM: number, z = OVERTURE_ZOOM): { x: number; y: number }[] {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const a = lonLatToTile(lon - dLon, lat + dLat, z);
  const b = lonLatToTile(lon + dLon, lat - dLat, z);
  const out: { x: number; y: number }[] = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ x, y });
  return out;
}

function ringAreaDeg(r: LonLat[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

const open = (r: number[][]): LonLat[] => {
  const ring = r.map((c) => [c[0], c[1]] as LonLat);
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  return ring;
};

function parseSources(v: unknown): { datasets: string[]; osmRef?: string } {
  let arr: { dataset?: string; record_id?: string }[] = [];
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v);
      if (Array.isArray(j)) arr = j;
    } catch {
      /* not JSON */
    }
  } else if (Array.isArray(v)) arr = v as typeof arr;
  const datasets = [...new Set(arr.map((s) => s.dataset).filter((d): d is string => !!d))];
  const osm = arr.find((s) => /openstreetmap/i.test(s.dataset ?? '') && s.record_id);
  const m = osm ? /^([nwr])(\d+)/i.exec(osm.record_id ?? '') : null;
  const t = m ? ({ n: 'node', w: 'way', r: 'relation' } as const)[m[1].toLowerCase() as 'n' | 'w' | 'r'] : undefined;
  return { datasets, ...(m && t ? { osmRef: `${t}/${m[2]}` } : {}) };
}

function toTags(p: Record<string, unknown>, id: string, datasets: string[]): Record<string, string> {
  const tags: Record<string, string> = { building: typeof p.class === 'string' && p.class ? p.class : 'yes', 'overture:id': id };
  const num = (k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? String(p[k]) : undefined);
  const h = num('height');
  if (h) tags.height = h;
  const f = num('num_floors');
  if (f) tags['building:levels'] = f;
  if (typeof p.roof_shape === 'string' && p.roof_shape) tags['roof:shape'] = p.roof_shape;
  if (typeof p.subtype === 'string' && p.subtype) tags['overture:subtype'] = p.subtype;
  if (datasets.length) tags['overture:sources'] = datasets.join(';');
  return tags;
}

/** Decodes the `building` layer of one MVT tile into outlines (largest polygon per feature). */
export function decodeBuildingTile(data: ArrayBuffer | Uint8Array, x: number, y: number, z: number): OvertureBuilding[] {
  const vt = new VectorTile(new PbfReader(data instanceof Uint8Array ? data : new Uint8Array(data)));
  const layer = vt.layers.building;
  const out: OvertureBuilding[] = [];
  if (!layer) return out;
  for (let i = 0; i < layer.length; i++) {
    const fe = layer.feature(i);
    const gj = fe.toGeoJSON(x, y, z);
    const g = gj.geometry;
    const polys: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polys.length) continue;
    const best = polys.map((p) => p.map(open)).sort((a, b) => ringAreaDeg(b[0]) - ringAreaDeg(a[0]))[0];
    if (!best || best[0].length < 3) continue;
    const props = fe.properties as Record<string, unknown>;
    const id = String(props.id ?? props['@id'] ?? fe.id ?? `${z}/${x}/${y}/${i}`);
    const { datasets, osmRef } = parseSources(props.sources ?? props['@sources']);
    out.push({ id, outer: best[0], holes: best.slice(1).filter((h) => h.length >= 3), tags: toTags(props, id, datasets), datasets, ...(osmRef ? { osmRef } : {}) });
  }
  return out;
}

/** Overture buildings in the z14 tiles around a point (features split across tiles keep their largest piece). */
export async function fetchOvertureBuildings(lat: number, lon: number, radiusM: number, url = OVERTURE_BUILDINGS_URL): Promise<OvertureBuilding[]> {
  const pm = new PMTiles(new CachedPmtilesSource(url), undefined, decompressPmtiles);
  const byId = new Map<string, OvertureBuilding>();
  for (const { x, y } of tilesAround(lat, lon, radiusM)) {
    const tile = await pm.getZxy(OVERTURE_ZOOM, x, y);
    if (!tile?.data) continue;
    for (const b of decodeBuildingTile(tile.data, x, y, OVERTURE_ZOOM)) {
      const prev = byId.get(b.id);
      if (!prev || ringAreaDeg(b.outer) > ringAreaDeg(prev.outer)) byId.set(b.id, b);
    }
  }
  return [...byId.values()];
}
