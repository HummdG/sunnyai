import { describe, expect, it } from 'vitest';
import type { HouseMesh } from '@sunny/sunscan-core/types';
import { storeyLevels, storeyName } from '../src/storeys';
import { forthlinSpec } from './fixtures';

const empty: Pick<HouseMesh, 'rooms' | 'layers' | 'levels'> = { rooms: [], layers: [] };

describe('storeyLevels (cutaway heights)', () => {
  it('uses HouseMesh.levels when core provides them, merging parts per storey', () => {
    const levels = storeyLevels(forthlinSpec, {
      ...empty,
      levels: [
        { partId: 'main', storey: 0, floorZ: 0.2, ceilingZ: 2.52, inRoof: false },
        { partId: 'rear', storey: 0, floorZ: 0.1, ceilingZ: 2.4, inRoof: false },
        { partId: 'main', storey: 1, floorZ: 2.72, ceilingZ: 5.0, inRoof: false },
        { partId: 'main', storey: 2, floorZ: 5.24, ceilingZ: 7.2, inRoof: true },
      ],
    });
    expect(levels.map((l) => l.storey)).toEqual([0, 1, 2]);
    expect(levels[0]).toMatchObject({ floorZ: 0.1, topZ: 2.54 });
    expect(levels[1].inRoof).toBeUndefined();
    expect(levels[2]).toMatchObject({ floorZ: 5.24, inRoof: true });
    expect(storeyName(2, true)).toBe('Roof space');
    expect(storeyName(1)).toBe('First floor');
  });

  it('falls back to the rooms, then an even split of the eave height', () => {
    const fromRooms = storeyLevels(forthlinSpec, {
      ...empty,
      rooms: [
        { id: 'r0', partId: 'main', storey: 0, label: 'living room', polygon: [], area: 12, floorZ: 0.2, ceilingZ: 2.5, estimated: true },
        { id: 'r1', partId: 'main', storey: 1, label: 'bedroom 1', polygon: [], area: 10, floorZ: 2.72, ceilingZ: 5.0, estimated: true },
      ],
    });
    expect(fromRooms.map((l) => [l.floorZ, +l.topZ.toFixed(2)])).toEqual([[0.2, 2.52], [2.72, 5.02]]);
    const even = storeyLevels(forthlinSpec, empty);
    expect(even).toHaveLength(2);
    expect(even[0].floorZ).toBeCloseTo(0.15, 6);
    expect(even[1].topZ).toBeCloseTo(5.13, 6);
  });
});
