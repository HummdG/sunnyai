// Real OSM outlines (every building in fixtures/sunscan/raw/*/overpass.json and footprint-summary.json, in local metres), their
// regularized versions (the product path: walls at exact right angles in a rotated frame), the same with storage
// quantization (walls parallel only to 1e-10 .. 1e-6 rad) and the I-API replay outlines of fixtures/fit: every roof must
// pass the invariants of fixtures/geometry/invariants.ts, i.e. no runaway nodes, no silent garbage.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRealOutlines, loadRegularizedOutlines } from './fixtures/geometry/outlines.js';
import { maxInscribedRadius, roofInvariants, rot } from './fixtures/geometry/invariants.js';
import { autoGableKinds, type EdgeKind } from '../src/geometry/roof.js';
import { mulberry32, type PolygonM, type Vec2 } from '../src/geometry/geom.js';

const PITCH = 37;
const W = 1 / Math.tan((PITCH * Math.PI) / 180);
const TOL = { relTol: 1e-7, pitchTol: 1e-4 };
const allEave = (p: PolygonM): EdgeKind[] => [p.outer, ...(p.holes ?? [])].flat().map(() => 'eave');
const mapPoly = (p: PolygonM, f: (q: Vec2) => Vec2): PolygonM => ({ outer: p.outer.map(f), holes: (p.holes ?? []).map((h) => h.map(f)) });

/** Hipped (all eaves: t <= max inscribed radius / w) and, when given, the party-wall kinds of the footprint summary. */
function check(label: string, poly: PolygonM, fails: string[], party?: EdgeKind[]) {
  const r = roofInvariants(poly, allEave(poly), { type: 'hipped', eaveHeight: 5.5, pitchDeg: PITCH }, { ...TOL, tMax: maxInscribedRadius(poly) / W });
  if (r.errors.length) fails.push(`${label} hipped: ${r.errors.join('; ')}`);
  if (party) {
    const s = roofInvariants(poly, party, { type: 'hipped', eaveHeight: 5.5, pitchDeg: PITCH }, TOL);
    if (s.errors.length) fails.push(`${label} party ${party.join(',')}: ${s.errors.join('; ')}`);
  }
}

describe('real OSM outlines', () => {
  const raw = loadRealOutlines();
  const reg = loadRegularizedOutlines();

  // Sunny vendors the raw research data of three of SunScanV2's nine addresses (20 Forthlin Road, Mendips and the
  // Dylan Thomas birthplace), so the
  // counts are those of the subset; the full nine-address sweep (> 600 outlines, the multipolygon courtyard) stays in
  // SunScanV2's own suite.
  it('fixtures: every overpass building, summary target and neighbour is loaded (vendored subset)', () => {
    expect(raw.length).toBeGreaterThan(70);
    expect(raw.filter((o) => o.party).length).toBeGreaterThanOrEqual(2);
    expect(reg.length).toBeGreaterThan(300);
  });

  it('raw outlines (overpass at full precision, summaries rounded to mm): hipped and party-wall roofs', () => {
    const fails: string[] = [];
    for (const o of raw) check(o.id, o.poly, fails, o.party);
    expect(fails.slice(0, 10)).toEqual([]);
  });

  it('regularized outlines (exact right angles in a rotated frame): hipped, party walls and auto cross-gables', () => {
    const fails: string[] = [];
    for (const o of reg) {
      check(`${o.id} reg`, o.poly, fails, o.kinds.includes('party') ? o.kinds : undefined);
      let kinds: EdgeKind[];
      try { kinds = autoGableKinds(o.poly, o.kinds); } catch (e) { fails.push(`${o.id} autoGableKinds threw ${(e as Error).message}`); continue; }
      if (!kinds.includes('gable')) continue;
      const g = roofInvariants(o.poly, kinds, { type: 'gabled', eaveHeight: 5.5, pitchDeg: PITCH }, TOL);
      if (g.errors.length) fails.push(`${o.id} reg cross-gabled: ${g.errors.join('; ')}`);
    }
    expect(fails.slice(0, 10)).toEqual([]);
  });

  for (const q of [1e-9, 1e-7, 1e-5]) {
    it(`regularized outlines re-quantized to ${q} m in a random frame (near-parallel walls): hipped and party walls`, () => {
      const fails: string[] = [];
      const rnd = mulberry32(Math.round(-Math.log10(q)));
      for (const o of reg) {
        const a = rnd() * 2 * Math.PI;
        const poly = mapPoly(o.poly, (p) => { const [x, y] = rot([p], a)[0]; return [Math.round(x / q) * q, Math.round(y / q) * q]; });
        check(`${o.id} q${q}`, poly, fails, o.kinds.includes('party') ? o.kinds : undefined);
      }
      expect(fails.slice(0, 10)).toEqual([]);
    });
  }
});

describe('I-API replay outlines (fixtures/fit/complex-outlines.json)', () => {
  const fx: Record<string, { footprint: PolygonM; edgeKinds: EdgeKind[] }> = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/fit/complex-outlines.json', import.meta.url)), 'utf8'));
  for (const [slug, c] of Object.entries(fx)) {
    it(`${slug}: hipped, gabled (auto gables), mansard and skillion roofs are valid`, () => {
      const fails: string[] = [];
      check(slug, c.footprint, fails);
      const kinds = autoGableKinds(c.footprint, c.edgeKinds);
      for (const [type, k] of [['gabled', kinds], ['mansard', c.edgeKinds], ['skillion', c.edgeKinds], ['half-hipped', kinds]] as const) {
        const r = roofInvariants(c.footprint, [...k], { type, eaveHeight: 5.5, pitchDeg: PITCH }, TOL);
        if (r.errors.length) fails.push(`${slug} ${type}: ${r.errors.join('; ')}`);
      }
      expect(fails).toEqual([]);
    });
  }
});
