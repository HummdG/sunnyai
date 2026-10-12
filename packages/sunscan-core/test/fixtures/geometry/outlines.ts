// Real OSM building outlines from fixtures/sunscan/raw/<slug>/{overpass,footprint-summary}.json in local metres (the summary's
// equirectangular frame: x = N cos(phi0) (lon - lon0), y = M (lat - lat0)), for the engine robustness suites.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSimple, polygonArea, type PolygonM, type Vec2 } from '../../../src/geometry/geom.js';
import type { EdgeKind } from '../../../src/geometry/roof.js';

export interface RealOutline {
  /** `<slug>/<source>/<osm id>` */
  id: string;
  slug: string;
  source: 'overpass' | 'summary-target' | 'summary-neighbour';
  poly: PolygonM;
  /** Edge kinds from the footprint summary's party-wall analysis (targets only), else undefined. */
  party?: EdgeKind[];
}

export const RAW_DIR = fileURLToPath(new URL('../../../../../fixtures/sunscan/raw/', import.meta.url));

const open = (r: Vec2[]): Vec2[] => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

/** Every building outline of every fixture (overpass ways + multipolygons, summary target and neighbours). */
export function loadRealOutlines(): RealOutline[] {
  const out: RealOutline[] = [];
  if (!existsSync(RAW_DIR)) return out;
  for (const slug of readdirSync(RAW_DIR).sort()) {
    const sumPath = `${RAW_DIR}${slug}/footprint-summary.json`, ovPath = `${RAW_DIR}${slug}/overpass.json`;
    if (!existsSync(sumPath)) continue;
    const s = JSON.parse(readFileSync(sumPath, 'utf8'));
    const f = s.frame;
    const lat0 = (f.origin.lat * Math.PI) / 180, lon0 = (f.origin.lon * Math.PI) / 180;
    const local = (g: { lat: number; lon: number }): Vec2 => [f.N_m * Math.cos(lat0) * ((g.lon * Math.PI) / 180 - lon0), f.M_m * ((g.lat * Math.PI) / 180 - lat0)];
    const push = (o: RealOutline) => {
      const rings = [o.poly.outer, ...(o.poly.holes ?? [])];
      if (rings.some((r) => r.length < 3) || !(polygonArea(o.poly) > 1) || !isSimple(o.poly)) return;
      out.push(o);
    };
    if (existsSync(ovPath)) {
      const els: any[] = JSON.parse(readFileSync(ovPath, 'utf8')).response?.elements ?? [];
      for (const e of els) {
        if (!e.tags || !(e.tags.building || e.tags['building:part'])) continue;
        if (e.type === 'way' && e.geometry) push({ id: `${slug}/overpass/way${e.id}`, slug, source: 'overpass', poly: { outer: open(e.geometry.map(local)) } });
        if (e.type === 'relation' && e.members) {
          const ring = (role: string) => e.members.filter((m: any) => m.type === 'way' && m.role === role && m.geometry).map((m: any) => open(m.geometry.map(local)));
          const outers = ring('outer');
          if (outers.length === 1) push({ id: `${slug}/overpass/rel${e.id}`, slug, source: 'overpass', poly: { outer: outers[0], holes: ring('inner') } });
        }
      }
    }
    const t = s.target;
    const ring: Vec2[] = open(t.ringLocal);
    const party: EdgeKind[] = ring.map((_, i) => (t.edges?.[i]?.partyWall ? 'party' : 'eave'));
    push({ id: `${slug}/summary-target/${t.osm}`, slug, source: 'summary-target', poly: { outer: ring, holes: (t.holesLocal ?? []).map(open) }, party: party.includes('party') ? party : undefined });
    for (const nb of s.neighbours ?? []) push({ id: `${slug}/summary-neighbour/${nb.osm}`, slug, source: 'summary-neighbour', poly: { outer: open(nb.ringLocal) } });
  }
  return out;
}

export interface RegularizedOutline { id: string; poly: PolygonM; kinds: EdgeKind[]; axisDeg: number }

/** Snapshot of core/footprint's regularizer output for every real outline (regenerate with make-regularized.ts). */
export function loadRegularizedOutlines(): RegularizedOutline[] {
  const p = fileURLToPath(new URL('./regularized-outlines.json', import.meta.url));
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
}
