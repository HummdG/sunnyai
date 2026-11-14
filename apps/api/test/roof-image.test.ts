import { writeArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoogleSolarBuildingInsights } from '@sunny/quote-engine';

import {
  clearRoofPictureCache,
  facingWords,
  imageRadius,
  pictureFromGeoTiff,
  roofPicture,
  utmDefinition,
} from '../src/homedata/roof-image.js';
import {
  roofViewOf,
  type GoogleRoof,
  type RoofView,
  type SolarClient,
} from '../src/homedata/solar.js';

const CENTRE = { lat: 52.62, lng: 1.25 }; // Norwich: UTM zone 31N
const UTM31 = utmDefinition(32631)!;
const RES = 0.1;
const SIZE = 400; // 40 m square

/** Metres east and north of the centre, as a lat/lng. */
function offset(eastM: number, northM: number) {
  const [e, n] = proj4<[number, number]>('WGS84', UTM31, [CENTRE.lng, CENTRE.lat]);
  const [lng, lat] = proj4<[number, number]>(UTM31, 'WGS84', [e + eastM, n + northM]);
  return { lat, lng };
}

/**
 * A 40 m square RGB GeoTIFF centred on the house, in UTM 31N, georeferenced
 * by a tiepoint and pixel scale, or by a transformation matrix. With the
 * matrix, geotiff.js reports a positive y resolution: the case Google's
 * real files hit, which once put every house off the top of the photo.
 */
function tiff(epsg = 32631, georef: 'tiepoint' | 'matrix' = 'tiepoint'): ArrayBuffer {
  const [e, n] = proj4<[number, number]>('WGS84', UTM31, [CENTRE.lng, CENTRE.lat]);
  const pixels = new Uint8Array(SIZE * SIZE * 3).fill(120);
  return writeArrayBuffer(pixels, {
    width: SIZE,
    height: SIZE,
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    PhotometricInterpretation: 2,
    ...(georef === 'tiepoint'
      ? { ModelPixelScale: [RES, RES, 0], ModelTiepoint: [0, 0, 0, e - 20, n + 20, 0] }
      : {
          ModelTransformation: [RES, 0, 0, e - 20, 0, -RES, 0, n + 20, 0, 0, 0, 0, 0, 0, 0, 1],
        }),
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: epsg,
  });
}

/**
 * A 10 m by 8 m house: a west face with one panel, a south face with three,
 * and a north face with five that Sunny does not count.
 */
function view(): RoofView {
  const sw = offset(-5, -4);
  const ne = offset(5, 4);
  const at = (e: number, n: number, face: number): [number, number, number, 0 | 1] => {
    const p = offset(e, n);
    return [p.lat, p.lng, face, 1];
  };
  return {
    centre: CENTRE,
    box: { sw, ne },
    panelWidthM: 1.045,
    panelHeightM: 1.879,
    faces: [
      { pitchDeg: 30, azimuthDeg: 270, areaM2: 20 },
      { pitchDeg: 35, azimuthDeg: 180, areaM2: 40 },
      { pitchDeg: 35, azimuthDeg: 0, areaM2: 40 },
    ],
    panels: [
      at(-3, 1, 0),
      at(-1.2, -2, 1),
      at(0, -2, 1),
      at(1.2, -2, 1),
      ...[-2.4, -1.2, 0, 1.2, 2.4].map((e) => at(e, 2, 2)),
    ],
  };
}

describe('the house from above', () => {
  beforeEach(() => clearRoofPictureCache());

  it.each(['tiepoint', 'matrix'] as const)(
    'crops the photo to the building and puts each panel where it is (%s)',
    async (georef) => {
      const picture = (await pictureFromGeoTiff(tiff(32631, georef), view(), 2023))!;
      // 10 m by 8 m, with 4 m all round, at 10 cm a pixel: a few pixels more,
      // as a lat/lng box sits a degree or so turned on the UTM grid.
      expect(picture.width).toBeGreaterThanOrEqual(178);
      expect(picture.width).toBeLessThanOrEqual(190);
      expect(picture.height).toBeGreaterThanOrEqual(158);
      expect(picture.height).toBeLessThanOrEqual(170);
      expect(picture.image.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(picture.imageryYear).toBe(2023);

      // Sunniest first, and the north face (five panels) left out.
      expect(picture.faces).toHaveLength(2);
      const [south, west] = picture.faces;
      expect(south).toMatchObject({ facing: 'south', pitchDeg: 35, panelCount: 3 });
      expect(west).toMatchObject({ facing: 'west', pitchDeg: 30, panelCount: 1 });
      expect(south!.colour).not.toBe(west!.colour);

      // The middle south panel: 2 m south of the centre, so 20 px below it.
      const [x, y, w, h, deg] = south!.panels[1]!;
      expect(x).toBeCloseTo(picture.width / 2, -1);
      expect(y).toBeCloseTo(picture.height / 2 + 20, -1);
      // Portrait: 1.045 m across, 1.879 m up a 35° slope seen from above.
      expect(w).toBeCloseTo(10.5, 0);
      expect(h).toBeCloseTo(18.79 * Math.cos((35 * Math.PI) / 180), 0);
      // Turned to face south, give or take UTM's grid convergence.
      expect(Math.abs(deg - 180)).toBeLessThan(3);
    },
  );

  it('shows nothing for a projection it does not know', async () => {
    expect(await pictureFromGeoTiff(tiff(27700), view(), null)).toBeNull();
  });

  it('fetches imagery once per house, and nothing for a roof saved without its view', async () => {
    const aerialImage = vi.fn(() => Promise.resolve(tiff()));
    const client: SolarClient = {
      geocode: vi.fn(),
      buildingInsights: vi.fn(),
      aerialImage,
    };
    const roof = { source: 'google', imageryYear: 2023, view: view() } as unknown as GoogleRoof;
    expect(await roofPicture(client, roof)).not.toBeNull();
    expect(await roofPicture(client, roof)).not.toBeNull();
    expect(aerialImage).toHaveBeenCalledTimes(1);
    expect(await roofPicture(client, { ...roof, view: undefined })).toBeNull();
    expect(await roofPicture(null, roof)).toBeNull();
  });

  it('asks for enough imagery to hold the building and its margin', () => {
    const r = imageRadius(view());
    expect(r).toBeGreaterThanOrEqual(12);
    expect(r).toBeLessThanOrEqual(20);
  });

  it('names directions in plain compass words', () => {
    expect(facingWords(180)).toBe('south');
    expect(facingWords(225)).toBe('south-west');
    expect(facingWords(359)).toBe('north');
    expect(utmDefinition(32730)).toContain('+south');
    expect(utmDefinition(27700)).toBeNull();
  });

  it("keeps Google's faces and panel positions with the roof", () => {
    const insights = {
      center: { latitude: CENTRE.lat, longitude: CENTRE.lng },
      boundingBox: {
        sw: { latitude: 52.61995, longitude: 1.24992 },
        ne: { latitude: 52.62005, longitude: 1.25008 },
      },
      solarPotential: {
        panelWidthMeters: 1.045,
        panelHeightMeters: 1.879,
        roofSegmentStats: [
          { pitchDegrees: 35.04, azimuthDegrees: 179.6, stats: { areaMeters2: 40.12 } },
        ],
        solarPanels: [
          {
            center: { latitude: 52.61999, longitude: 1.25 },
            orientation: 'PORTRAIT',
            segmentIndex: 0,
            yearlyEnergyDcKwh: 400,
          },
        ],
      },
    } as unknown as GoogleSolarBuildingInsights;
    expect(roofViewOf(insights)).toEqual({
      centre: CENTRE,
      box: { sw: { lat: 52.61995, lng: 1.24992 }, ne: { lat: 52.62005, lng: 1.25008 } },
      panelWidthM: 1.045,
      panelHeightM: 1.879,
      faces: [{ pitchDeg: 35, azimuthDeg: 179.6, areaM2: 40.1 }],
      panels: [[52.61999, 1.25, 0, 1]],
    });
    const none = { ...insights, solarPotential: { ...insights.solarPotential, solarPanels: [] } };
    expect(roofViewOf(none as GoogleSolarBuildingInsights)).toBeUndefined();
  });
});
