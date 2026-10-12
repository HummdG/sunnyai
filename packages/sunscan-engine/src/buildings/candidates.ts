// Target-candidate scoring (research 01 §3.3): which building outline is the requested house?
//   +100 geocoder's OSM object | +90 geocoder NODE inside | +30 inside the geocoded (non-building) site
//   +50 contains the point | +40 house number (+10 street) | -10 number matches, street differs
//   -30 same street, other numbers | +40 name | +5 postcode | -25 ancillary | -min(30, distance m)
import { expandHouseNumbers, ANCILLARY_BUILDINGS } from '@sunny/sunscan-core/footprint';
import { ensureCCW, makeFrame, pointInPolygon, pointPolygonDistance, polygonCentroid, signedArea, type XY } from '@sunny/sunscan-core/geo';
import type { LonLat, ParsedUkAddress } from '../contracts.js';
import { nameSimilar, normText, sameHouseNumber } from '../geocode/candidates.js';
import type { OsmPoint, OsmPolygon } from './osm.js';

/** A building outline from any source, ready for scoring. */
export interface BuildingInput {
  ref: string; // 'osm:way/1' | 'overture:<id>'
  osmRef?: string; // 'way/1' (OSM only)
  source: 'osm' | 'overture';
  tags: Record<string, string>;
  outer: LonLat[];
  holes: LonLat[][];
  isPart: boolean;
}

/** Score of one candidate. */
export interface ScoredCandidate { ref: string; score: number; reasons: string[]; distance: number; area: number }

/** Context evidence for scoring. */
export interface ScoringContext {
  osmRef?: string;
  parsed?: ParsedUkAddress;
  addressNodes: OsmPoint[];
  nodes: Map<string, OsmPoint>;
  areas: Map<string, OsmPolygon>;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const pcEq = (a?: string, b?: string) => !!a && !!b && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase();

/** Ranks building outlines (parts excluded) as candidates for the house at (lat, lon). */
export function scoreTargets(lat: number, lon: number, buildings: BuildingInput[], ctx: ScoringContext): { ranked: ScoredCandidate[]; ambiguous: boolean } {
  const frame = makeFrame(lat, lon);
  const toXY = (r: LonLat[]): XY[] => r.map((c) => frame.toLocal(c));
  const pt: XY = [0, 0];
  const geo = ctx.osmRef?.replace(/^osm:/, '');
  const geoNode = geo?.startsWith('node/') ? ctx.nodes.get(geo) : undefined;
  const geoArea = geo ? ctx.areas.get(geo) : undefined;
  const geoAreaXY = geoArea ? { outer: toXY(geoArea.outer), holes: geoArea.holes.map(toXY) } : undefined;
  const a = ctx.parsed ?? { raw: '', localities: [] };
  const addr = ctx.addressNodes.map((n) => ({ n, xy: frame.toLocal([n.lon, n.lat]) }));
  const ranked: ScoredCandidate[] = [];
  for (const b of buildings) {
    if (b.isPart) continue;
    const outer = ensureCCW(toXY(b.outer));
    const holes = b.holes.map(toXY);
    const area = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    const d = pointPolygonDistance(pt, outer, holes);
    const reasons: string[] = [];
    let s = 0;
    if (geo && b.osmRef === geo) (s += 100), reasons.push('geocoder returned this building');
    if (geoNode && pointInPolygon(frame.toLocal([geoNode.lon, geoNode.lat]), outer, holes)) (s += 90), reasons.push(`geocoder node ${geo} lies inside`);
    if (geoAreaXY && pointInPolygon(polygonCentroid(outer, holes), geoAreaXY.outer, geoAreaXY.holes)) (s += 30), reasons.push(`inside the geocoded site ${geo}`);
    if (d === 0) (s += 50), reasons.push('contains the geocoded point');
    const t = b.tags;
    const nums = [t['addr:housenumber']];
    const names = [t['addr:housename'], t.name, t['name:en'], t.alt_name, t.old_name];
    const streets = [t['addr:street']];
    const pcs = [t['addr:postcode']];
    const inside = addr.filter((x) => pointInPolygon(x.xy, outer, holes));
    for (const { n } of inside) {
      nums.push(n.tags['addr:housenumber']);
      names.push(n.tags['addr:housename'], n.tags.name);
      streets.push(n.tags['addr:street']);
      pcs.push(n.tags['addr:postcode']);
    }
    const distinct = new Set(nums.filter((x): x is string => !!x).flatMap((x) => expandHouseNumbers(x)));
    const known = streets.filter((x): x is string => !!x);
    const streetAgrees = !a.street || !known.length || known.some((x) => normText(x) === normText(a.street));
    const numHit = !!a.houseNumber && nums.some((x) => sameHouseNumber(a.houseNumber, x));
    if (numHit && !streetAgrees) {
      s -= 10;
      reasons.push(`addr:housenumber ${a.houseNumber} matches but addr:street differs (${known.join('/')})`);
    } else if (numHit) {
      s += 40;
      reasons.push(`addr:housenumber ${a.houseNumber} matches${inside.length ? ' (incl. address nodes inside)' : ''}`);
      if (a.street && known.some((x) => normText(x) === normText(a.street))) (s += 10), reasons.push('addr:street matches');
    } else if (a.houseNumber && distinct.size && a.street && known.some((x) => normText(x) === normText(a.street))) {
      s -= 30;
      reasons.push(`same street but other number(s): ${[...distinct].join(',')}`);
    }
    if (a.houseName && names.some((x) => nameSimilar(a.houseName, x))) (s += 40), reasons.push('name/housename matches');
    if (a.postcode && pcs.some((x) => pcEq(a.postcode, x))) (s += 5), reasons.push('addr:postcode matches');
    if (distinct.size > 1) reasons.push(`house numbers on/inside the outline: ${[...distinct].join(',')}`);
    const bt = t.building ?? 'yes';
    if (ANCILLARY_BUILDINGS.has(bt)) (s -= 25), reasons.push(`ancillary building=${bt}`);
    if (b.source === 'overture') (s -= 5), reasons.push('Overture outline (OSM preferred)');
    s -= Math.min(30, d);
    if (d > 0) reasons.push(`${round1(d)} m from the geocoded point`);
    ranked.push({ ref: b.ref, score: round1(s), reasons, distance: Math.round(d * 100) / 100, area: round1(area) });
  }
  ranked.sort((x, y) => y.score - x.score || x.distance - y.distance || x.ref.localeCompare(y.ref));
  const [top, second] = ranked;
  const strong = !!top && top.reasons.some((r) => /geocoder|matches|contains/.test(r));
  const ambiguous = !top || !strong || (!!second && top.score - second.score < 15);
  return { ranked, ambiguous };
}
