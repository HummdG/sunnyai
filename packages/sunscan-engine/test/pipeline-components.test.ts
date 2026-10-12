import { describe, expect, it } from 'vitest';
import type { RoofSpec } from '@sunny/sunscan-core';
import { mapRoofComponents } from '../src/pipeline/geometry.js';

describe('mapRoofComponents', () => {
  const roof: RoofSpec = {
    type: 'gabled', pitchDeg: 40, components: [
      { role: 'main', footprint: { outer: [[0, 0], [6, 0], [6, 7], [0, 7]] }, edgeKinds: ['gable', 'eave', 'gable', 'eave'], pitchDeg: 40 },
      { role: 'cross', footprint: { outer: [[3, 0], [10, 0], [10, 7], [3, 7]] }, edgeKinds: ['eave', 'gable', 'eave', 'gable'], pitchDeg: 38 },
    ],
  };
  it('maps every component footprint with the part transform (BNG-local -> ENU)', () => {
    const r = mapRoofComponents(roof, ([x, y]) => [x + 100, y - 5]);
    expect(r.components!.map((c) => c.footprint.outer[0])).toEqual([[100, -5], [103, -5]]);
    expect(r.components![1].pitchDeg).toBe(38);
    expect(roof.components![0].footprint.outer[0]).toEqual([0, 0]); // input untouched
  });
  it('returns roofs without components unchanged', () => {
    const plain: RoofSpec = { type: 'hipped', pitchDeg: 35 };
    expect(mapRoofComponents(plain, ([x, y]) => [x + 1, y])).toEqual(plain);
  });
});

describe('fitPartReports: compound roofs', () => {
  it('reports the cross-gable pitch next to the main pitch', async () => {
    const { fitPartReports } = await import('../src/pipeline/parts.js');
    const part = {
      id: 'main', role: 'main' as const, footprint: { outer: [[0, 0], [10, 0], [10, 7], [0, 7]] as [number, number][] }, edgeKinds: ['gable', 'gable', 'gable', 'eave'] as const,
      roof: { type: 'gabled' as const, pitchDeg: 40, components: [
        { role: 'main' as const, footprint: { outer: [[0, 0], [6, 0], [6, 7], [0, 7]] as [number, number][] }, edgeKinds: ['gable', 'eave', 'gable', 'eave'] as ('gable' | 'eave')[], pitchDeg: 40 },
        { role: 'cross' as const, footprint: { outer: [[3, 0], [10, 0], [10, 7], [3, 7]] as [number, number][] }, edgeKinds: ['eave', 'gable', 'eave', 'gable'] as ('gable' | 'eave')[], pitchDeg: 37.456 },
      ] },
      eaveHeight: 5, ridgeHeight: 7.5, family: 'cross-gable-L-u-lo',
    };
    const [r] = fitPartReports([{ ...part, edgeKinds: [...part.edgeKinds] }], []);
    expect(r.family).toBe('cross-gable-L-u-lo');
    expect(r.crossPitchDeg).toBe(37.46);
  });
});
