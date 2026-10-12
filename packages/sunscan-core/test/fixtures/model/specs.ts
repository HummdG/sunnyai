// Hand-made HouseModelSpec fixtures for the model tests (local ENU metres, x east, y north; front at y = 0).
import type {
  BuildingPartSpec, BuiltForm, EdgeKind, Era, HouseModelSpec, NeighbourSpec, PolygonM, RoofSpec, TerrainGrid,
} from '../../../src/types.js';

export const rect = (x0: number, y0: number, w: number, d: number): PolygonM => ({ outer: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]] });

export function part(id: string, role: BuildingPartSpec['role'], footprint: PolygonM, edgeKinds: EdgeKind[], eaveHeight: number, roof: RoofSpec, extra: Partial<BuildingPartSpec> = {}): BuildingPartSpec {
  return {
    id, role, footprint, edgeKinds, baseHeight: 0, eaveHeight, roof, storeys: 2, overhang: 0.3,
    material: { wall: 'brick', roof: 'tile' }, chimneys: [], source: { heights: 'lidar', roof: 'lidar' }, ...extra,
  };
}

export function spec(id: string, builtForm: BuiltForm, era: Era, parts: BuildingPartSpec[], extra: Partial<HouseModelSpec> = {}): HouseModelSpec {
  return {
    schema: 'sunscan.house/1', id, address: { display: `${id} test house`, postcode: 'AB1 2CD', nation: 'England' },
    origin: { lat: 53.4, lon: -2.9 }, groundElevation: 30, builtForm, era, parts, facade: {}, context: { neighbours: [] },
    quality: { geocode: 'high', footprint: 'measured', heights: 'measured', roof: 'measured', openings: 'procedural', interior: 'procedural', flags: [], notes: [] },
    provenance: [
      { id: 'osm', title: 'OpenStreetMap', licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors (ODbL)' },
      { id: 'ea-lidar-composite-2022', title: 'EA LIDAR Composite 2022', licence: 'OGL-UK-3.0', attribution: '© Environment Agency copyright and/or database right 2022 (OGL v3)' },
    ],
    generatedAt: '2026-10-08T12:00:00Z', generator: 'test', ...extra,
  };
}

const neighbour = (id: string, fp: PolygonM, height: number, attached: boolean, roof?: RoofSpec, edgeKinds?: EdgeKind[], eaveHeight?: number): NeighbourSpec =>
  ({ id, footprint: fp, height, attached, source: 'osm', ...(roof ? { roof } : {}), ...(edgeKinds ? { edgeKinds } : {}), ...(eaveHeight !== undefined ? { eaveHeight } : {}) });

/** Gently sloping terrain grid (falls 1 m per 20 m to the north-east), 1 m cells, a few unknown cells. */
export function slopeTerrain(): TerrainGrid {
  const width = 40, height = 40, originX = -12, originY = 25;
  const heights: (number | null)[] = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const x = originX + c + 0.5, y = originY - r - 0.5;
    heights.push(r === 3 && c > 30 ? null : -(x + y) / 20);
  }
  return { originX, originY, cellSize: 1, width, height, heights, source: 'test DTM' };
}

/** Victorian mid-terrace: 5.5 x 8.5 m, party walls east and west, gabled slate roof parallel to the street. */
export function midTerrace(): HouseModelSpec {
  const main = part('main', 'main', rect(0, 0, 5.5, 8.5), ['eave', 'party', 'eave', 'party'], 6.0, { type: 'gabled', pitchDeg: 38 }, {
    material: { wall: 'brick', roof: 'slate' }, overhang: 0.25,
    chimneys: [{ center: [0.35, 4.25], width: 0.7, depth: 1.2, angleDeg: 0, top: 10.2, source: 'lidar' }, { center: [5.15, 4.25], width: 0.7, depth: 1.2, angleDeg: 0, top: 10.2, source: 'prior' }],
  });
  return spec('mid-terrace', 'mid-terrace', 'pre-1919', [main], {
    facade: { front: { partId: 'main', edge: 0 }, streetName: 'Test Street' },
    context: {
      neighbours: [
        neighbour('osm:way/1', rect(-5.5, 0, 5.5, 8.5), 9.6, true, { type: 'gabled', pitchDeg: 38 }, ['eave', 'party', 'eave', 'party'], 6.0),
        neighbour('osm:way/2', rect(5.5, 0, 5.5, 8.5), 9.6, true, { type: 'gabled', pitchDeg: 38 }, ['eave', 'party', 'eave', 'party']),
        neighbour('osm:way/3', rect(-3, 20, 12, 8), 7.5, false),
      ],
      terrain: slopeTerrain(),
      roads: [{ name: 'Test Street', kind: 'residential', line: [[-30, -6], [30, -6]] }],
    },
  });
}

/** Inter-war semi: 7.6 x 8.4 m, party wall on the west, hipped tile roof (vertical at the party wall). */
export function semi(): HouseModelSpec {
  const main = part('main', 'main', rect(0, 0, 7.6, 8.4), ['eave', 'eave', 'eave', 'party'], 5.4, { type: 'hipped', pitchDeg: 42 }, {
    overhang: 0.35, material: { wall: 'render', roof: 'tile', wallColour: '#efe6d2' },
    chimneys: [{ center: [0.4, 5.2], width: 0.8, depth: 1.4, angleDeg: 0, top: 9.6, source: 'prior' }],
  });
  return spec('semi', 'semi-detached', '1919-1944', [main], {
    context: {
      neighbours: [neighbour('osm:way/10', rect(-7.6, 0, 7.6, 8.4), 9.0, true, { type: 'hipped', pitchDeg: 42 }, ['eave', 'party', 'eave', 'eave'], 5.4)],
      roads: [{ name: 'Menlove Avenue', kind: 'primary', line: [[-40, -12], [40, -12]] }],
    },
    facade: { streetName: 'Menlove Avenue' },
  });
}

/** Modern detached L-shape (hipped), front facing south, wing to the rear east. */
export function detachedL(): HouseModelSpec {
  const L: PolygonM = { outer: [[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]] };
  const main = part('main', 'main', L, ['eave', 'eave', 'eave', 'eave', 'eave', 'eave'], 5.2, { type: 'hipped', pitchDeg: 35 }, { overhang: 0.4 });
  return spec('detached-l', 'detached', 'post-2000', [main], { facade: { entrance: [4.0, -0.05] } });
}

/** Mid-terrace with a two-storey rear outrigger (two parts, lower outrigger eave). */
export function terraceOutrigger(): HouseModelSpec {
  const main = part('main', 'main', rect(0, 0, 5.0, 8.0), ['eave', 'party', 'eave', 'party'], 5.6, { type: 'gabled', pitchDeg: 40 }, {
    material: { wall: 'brick', roof: 'slate' },
  });
  // outrigger behind the east half; west side faces the yard, east side is the party wall with the neighbour's outrigger
  const rear = part('rear-1', 'rear', rect(2.1, 8.0, 2.9, 4.5), ['party', 'party', 'eave', 'eave'], 4.7, { type: 'gabled', pitchDeg: 25 }, {
    material: { wall: 'brick', roof: 'slate' }, overhang: 0.2,
  });
  // outrigger roof: ridge along y (eave on the west side and gable at the back end)
  rear.edgeKinds = ['party', 'party', 'gable', 'eave'];
  return spec('terrace-outrigger', 'mid-terrace', '1945-1964', [main, rear]);
}

/** Post-war detached house with a flat-roofed single-storey rear extension and a flat-roofed garage (parapet). */
export function flatRoofParts(): HouseModelSpec {
  const main = part('main', 'main', rect(0, 0, 9.0, 7.0), ['eave', 'gable', 'eave', 'gable'], 5.1, { type: 'gabled', pitchDeg: 32 }, { material: { wall: 'pebbledash', roof: 'tile' } });
  const ext = part('ext', 'extension', rect(1.0, 7.0, 5.0, 3.5), ['party', 'eave', 'eave', 'eave'], 2.9, { type: 'flat' }, { storeys: 1, overhang: 0.15, material: { wall: 'brick', roof: 'flat' } });
  const garage = part('garage', 'garage', rect(9.0, 0.5, 3.0, 6.0), ['eave', 'eave', 'eave', 'party'], 2.6, { type: 'flat', parapetHeight: 0.3, parapetThickness: 0.2 }, { storeys: 1, overhang: 0, material: { wall: 'brick', roof: 'flat' } });
  return spec('flat-parts', 'detached', '1945-1964', [main, ext, garage]);
}

/** Detached house with an L cross-gable roof over one rectangle (3 Siskin Close shape): main N-S gable over the west
 * 8.6 m, E-W cross gable from the main ridge to the east wall. */
export function crossGableL(): HouseModelSpec {
  const main = part('main', 'main', rect(0, 0, 12, 8), ['gable', 'gable', 'gable', 'eave'], 5.2, {
    type: 'gabled', pitchDeg: 45, components: [
      { role: 'main', footprint: rect(0, 0, 8.6, 8), edgeKinds: ['gable', 'eave', 'gable', 'eave'], pitchDeg: 45 },
      { role: 'cross', footprint: rect(4.3, 0, 7.7, 8), edgeKinds: ['eave', 'gable', 'eave', 'gable'], pitchDeg: 45 },
    ],
  });
  return spec('cross-gable-l', 'detached', '1981-2000', [main], { facade: { entrance: [3.0, -0.05] } });
}

/** Detached house with a T cross-gable: main E-W gable, 4 m front gable from the south wall to the ridge. */
export function crossGableT(): HouseModelSpec {
  const main = part('main', 'main', rect(0, 0, 11, 8), ['gable', 'gable', 'eave', 'gable'], 5.0, {
    type: 'gabled', pitchDeg: 38, components: [
      { role: 'main', footprint: rect(0, 0, 11, 8), edgeKinds: ['eave', 'gable', 'eave', 'gable'], pitchDeg: 38 },
      { role: 'cross', footprint: rect(5, 0, 4, 4), edgeKinds: ['gable', 'eave', 'gable', 'eave'], pitchDeg: 38 },
    ],
  });
  return spec('cross-gable-t', 'detached', '1981-2000', [main], { facade: { entrance: [2.0, -0.05] } });
}

export const ALL_SPECS = { midTerrace, semi, detachedL, terraceOutrigger, flatRoofParts, crossGableL, crossGableT };
