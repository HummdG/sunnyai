// core/interior validity over seeded random UK houses (research 05 §7.4 batch test, extended to real
// footprints): random widths/depths/storey heights in UK ranges, wall insets, random rotation and
// translation, slight non-orthogonality (skewed party walls, tilted back wall, skewed outriggers),
// OSM-style shared nodes at outrigger corners, and missing front edges.
//
// Checked for every plan (see fixtures/interior/plans.ts, independent geometry):
//  - rooms tile each storey's usable area: area sum = inset footprint(s) (rel. 1e-6, i.e. far inside 1 %),
//    pairwise overlap <= 1e-6 m2 (exact union area), nothing outside the usable area
//  - every room has a door, and every room is reachable from the hall / landing through doors
//  - no room narrower than 0.9 m (inscribed circle); NDSS-sized 'bedroom N' labels, numbered 1..N
//  - walls lie between two rooms (never on the external wall line), no duplicates; doors inside walls
//  - one straight flight per storey transition, stacked, inside the main block, starting in the hall/landing,
//    Approved Document K (rise <= 220 mm, going >= 220 mm, pitch <= 42 deg), rises sum to floor-to-floor
//  - a bathroom on storey 1 (on the ground floor of bungalows); finite coordinates; CCW polygons; unique ids
import { describe, it, expect } from 'vitest';
import { layoutInterior } from '../src/interior/index.js';
import { checkPlan, PLAN_KINDS, randomPlan, randomShape, SHAPE_KINDS, type PlanKind, type ShapeKind } from './fixtures/interior/plans.js';

const PER_KIND = 400; // 5 kinds -> 2 000 plans
const PER_SHAPE = 250; // 2 single-polygon kinds -> 500 plans

describe('interior layout validity on seeded random plans', () => {
  for (const kind of PLAN_KINDS) {
    it(`${kind}: ${PER_KIND} random plans are all valid`, () => {
      const failures: string[] = [];
      let bedrooms = 0, warned = 0;
      for (let i = 0; i < PER_KIND; i++) {
        const plan = randomPlan(i, kind as PlanKind);
        const L = layoutInterior(plan.input);
        const issues = checkPlan(plan, L);
        if (issues.length) failures.push(`#${i}: ${issues.slice(0, 3).join(' | ')}`);
        bedrooms += L.rooms.filter((r) => /^bedroom \d+$/.test(r.label)).length;
        if (L.warnings.length) warned++;
      }
      console.info(`[interior validity] ${kind}: ${PER_KIND - failures.length}/${PER_KIND} valid, mean full bedrooms ${(bedrooms / PER_KIND).toFixed(2)}, ${warned} with warnings`);
      expect(failures).toEqual([]);
    });
  }

  for (const kind of SHAPE_KINDS) {
    it(`${kind}: ${PER_SHAPE} single-polygon plans are all valid`, () => {
      const failures: string[] = [];
      for (let i = 0; i < PER_SHAPE; i++) {
        const plan = randomShape(i, kind as ShapeKind);
        const issues = checkPlan(plan, layoutInterior(plan.input));
        if (issues.length) failures.push(`#${i}: ${issues.slice(0, 3).join(' | ')}`);
      }
      console.info(`[interior validity] ${kind}: ${PER_SHAPE - failures.length}/${PER_SHAPE} valid`);
      expect(failures).toEqual([]);
    });
  }
});
