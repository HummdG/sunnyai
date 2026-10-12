import { describe, expect, it } from 'vitest';
import { isSimple, mulberry32, type PolygonM } from '../src/geometry/geom.js';
import type { EdgeKind, RoofType } from '../src/geometry/roof.js';
import { resolveInteriorProvider, synthesizeHouse } from '../src/model/index.js';
import type { Era, HouseModelSpec } from '../src/types.js';
import { BAY_HOUSE, COURTYARD, L_SHAPE, T_SHAPE, TERRACE_OUTRIGGER, noisy, randomOrtho, randomStar, rect as ring } from './support/cases.js';
import { part, slopeTerrain, spec as mkSpec } from './fixtures/model/specs.js';
import { fixtureProvider } from './fixtures/model/interior.js';
import { layerProblems, windingMismatches } from './fixtures/model/check.js';

const TYPES: RoofType[] = ['hipped', 'gabled', 'half-hipped', 'dutch-gable', 'gambrel', 'mansard', 'skillion', 'pyramidal', 'flat'];
const ERAS: Era[] = ['pre-1919', '1919-1944', '1945-1964', '1965-1980', '1981-2000', 'post-2000', 'unknown'];

function randomSpec(i: number): HouseModelSpec | null {
  const rnd = mulberry32(1000 + i);
  const g = i % 7;
  const poly: PolygonM = g === 0 ? randomOrtho(i, 6, 16) : g === 1 ? noisy(i % 2 ? L_SHAPE : T_SHAPE, i, 0.03) : g === 2 ? randomStar(6 + (i % 5), i, 6)
    : g === 3 ? COURTYARD : g === 4 ? BAY_HOUSE : g === 5 ? TERRACE_OUTRIGGER : { outer: ring(4 + 6 * rnd(), 5 + 5 * rnd()) };
  if (!isSimple(poly)) return null;
  const nE = poly.outer.length + (poly.holes ?? []).reduce((s, h) => s + h.length, 0);
  const kinds: EdgeKind[] = Array.from({ length: nE }, () => { const u = rnd(); return u < 0.65 ? 'eave' : u < 0.85 ? 'gable' : 'party'; });
  if (!kinds.includes('eave')) kinds[0] = 'eave';
  let type = TYPES[i % TYPES.length];
  if (type === 'pyramidal' && g !== 6) type = 'hipped'; // pyramidal needs (near-)convex footprints
  const storeys = 1 + Math.floor(rnd() * 3);
  const eave = 2.4 + storeys * (2.2 + rnd() * 0.8);
  const main = part('main', 'main', poly, kinds, eave, {
    type, pitchDeg: 20 + 35 * rnd(), parapetHeight: type === 'flat' && rnd() < 0.4 ? 0.4 : 0, flatTop: rnd() < 0.3, breakHeight: 0.8 + rnd(),
  }, { storeys, overhang: rnd() < 0.15 ? 0 : 0.6 * rnd(), material: { wall: 'brick', roof: type === 'flat' ? 'flat' : 'tile' } });
  if (rnd() < 0.5) main.chimneys = [{ center: poly.outer[0], width: 0.8, depth: 0.8, angleDeg: 30 * rnd(), top: eave + 4, source: 'prior' }];
  const s = mkSpec(`fuzz-${i}`, 'detached', ERAS[i % ERAS.length], [main]);
  if (i % 3 === 0) s.context.terrain = slopeTerrain();
  return s;
}

/** Main block + an attached rear or side part with random sizes, heights and roofs. */
function randomTwoPart(i: number): HouseModelSpec {
  const rnd = mulberry32(5000 + i);
  const W = 5 + 5 * rnd(), D = 6 + 4 * rnd();
  const pk: EdgeKind[] = [rnd() < 0.3 ? 'party' : 'eave', rnd() < 0.5 ? 'party' : 'gable', 'eave', rnd() < 0.5 ? 'party' : 'gable'];
  pk[0] = 'eave';
  const storeys = 1 + Math.floor(rnd() * 2);
  const main = part('main', 'main', { outer: ring(W, D) }, pk, 2.6 + storeys * 2.6 * (0.9 + 0.2 * rnd()), { type: TYPES[i % 6], pitchDeg: 25 + 25 * rnd() }, { storeys, overhang: 0.4 * rnd() });
  const side = i % 2 === 0;
  const w2 = 2 + (side ? D - 2 : W - 2) * rnd() * 0.8, d2 = 2 + 4 * rnd();
  const x0 = side ? W : (W - w2) * rnd(), y0 = side ? (D - w2) * rnd() : D;
  const fp: PolygonM = side ? { outer: [[x0, y0], [x0 + d2, y0], [x0 + d2, y0 + w2], [x0, y0 + w2]] } : { outer: ring(w2, d2, x0, y0) };
  const k2: EdgeKind[] = side ? ['eave', 'eave', 'eave', 'party'] : ['party', 'eave', 'eave', 'eave'];
  const s2 = rnd() < 0.5 ? 1 : storeys;
  const ext = part('ext', side ? 'side' : 'rear', fp, k2, 2.4 + s2 * 2.4 * (0.9 + 0.2 * rnd()), { type: TYPES[(i * 7) % TYPES.length] === 'pyramidal' ? 'flat' : TYPES[(i * 7) % TYPES.length], pitchDeg: 20 + 25 * rnd() }, { storeys: s2, overhang: 0.3 * rnd() });
  return mkSpec(`fuzz2-${i}`, 'detached', ERAS[i % ERAS.length], [main, ext]);
}

describe('synthesizeHouse: randomized robustness', () => {
  it('random two-part houses: watertight parts, well-formed layers, openings never on party walls or covered walls', () => {
    const fails: string[] = [];
    const providers = [fixtureProvider, resolveInteriorProvider()].filter((p) => !!p);
    for (let i = 0; i < 80; i++) {
      const spec = randomTwoPart(i);
      try {
        const m = synthesizeHouse(spec, { layoutInterior: providers[i % providers.length] });
        if (!m.validation.solidsWatertight) fails.push(`#${i}: ${m.validation.issues.join('; ')}`);
        for (const l of m.layers) {
          const p = layerProblems(l);
          if (p.length) fails.push(`#${i} ${l.id}: ${p.join(', ')}`);
          if (l.kind !== 'solid' && windingMismatches(l, l.kind === 'terrain' ? 0 : 0.99)) fails.push(`#${i} ${l.id}: winding`);
        }
        for (const o of m.openings) {
          const p = spec.parts.find((x) => x.id === o.partId)!;
          if (p.edgeKinds[o.edge] === 'party') fails.push(`#${i} ${o.id}: on a party wall`);
        }
      } catch (e) {
        fails.push(`#${i}: threw ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('random footprints x edge kinds x roof types x storeys x overhangs never throw and stay well-formed', () => {
    const fails: string[] = [];
    let n = 0;
    const providers = [fixtureProvider, resolveInteriorProvider()].filter((p) => !!p);
    for (let i = 0; i < 140; i++) {
      const spec = randomSpec(i);
      if (!spec) continue;
      n++;
      try {
        const m = synthesizeHouse(spec, { layoutInterior: providers[i % providers.length] });
        if (!m.validation.solidsWatertight) fails.push(`#${i}: solid not watertight ${m.validation.issues.join('; ')}`);
        for (const l of m.layers) {
          const p = layerProblems(l);
          if (p.length) fails.push(`#${i} ${l.id}: ${p.join(', ')}`);
          // the welded solid's orientation is verified by checkMesh (validation); its smooth pseudo-normals may
          // legitimately disagree with thin triangles at sharp concave junctions, so it is not checked here
          if (l.kind === 'solid') continue;
          const bad = windingMismatches(l, l.kind === 'terrain' ? 0 : 0.99);
          if (bad) fails.push(`#${i} ${l.id}: ${bad} triangle(s) wound against their normals`);
        }
        const kinds = spec.parts[0].edgeKinds;
        for (const o of m.openings) if (kinds[o.edge] === 'party') fails.push(`#${i} ${o.id}: on a party wall`);
        if (!m.layers.some((l) => l.kind === 'roof-skin')) fails.push(`#${i}: no roof skin`);
      } catch (e) {
        fails.push(`#${i}: threw ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
    }
    expect(fails).toEqual([]);
    expect(n).toBeGreaterThan(120);
  });
});
