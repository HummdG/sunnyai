// Regenerates regularized-outlines.json: every real OSM outline (outlines.ts) through core/footprint's regularizer, i.e.
// the near-orthogonal plans (walls parallel to ~1e-16 rad in a rotated frame) that the product feeds to buildRoof.
// Run from the repo root:  npx tsx packages/core/test/fixtures/geometry/make-regularized.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapEdgeKinds, regularizeFootprintDetailed } from '../../../src/footprint/regularize.js';
import { isSimple } from '../../../src/geometry/geom.js';
import type { EdgeKind } from '../../../src/geometry/roof.js';
import { loadRealOutlines, type RegularizedOutline } from './outlines.js';

const out: RegularizedOutline[] = [];
for (const o of loadRealOutlines()) {
  if (o.source === 'summary-neighbour') continue; // the same buildings as the overpass ways, rounded to mm
  const r = regularizeFootprintDetailed(o.poly);
  if (!r.orthogonalized || !isSimple(r.polygon)) continue;
  const kinds = o.party ? mapEdgeKinds(r, o.party, o.poly) : r.polygon.outer.concat(...(r.polygon.holes ?? [])).map((): EdgeKind => 'eave');
  out.push({ id: o.id, poly: r.polygon, kinds, axisDeg: r.axisDeg });
}
writeFileSync(fileURLToPath(new URL('./regularized-outlines.json', import.meta.url)), JSON.stringify(out));
console.log(`wrote ${out.length} regularized outlines`);
