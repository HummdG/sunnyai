import { writeArrayBuffer } from 'geotiff';
import jpeg from 'jpeg-js';
import proj4 from 'proj4';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoogleSolarBuildingInsights } from '@sunny/quote-engine';

import {
  clearRoofPictureCache,
  pictureFromGeoTiff,
  roofPicture,
  utmDefinition,
} from '../src/homedata/roof-image.js';
import {
  httpSolarClient,
  roofViewOf,
  type GoogleRoof,
  type RoofView,
  type SolarClient,
} from '../src/homedata/solar.js';

/**
 * The roof faces marked on the photo: a visitor is shown their house from
 * above with each face in its own colour, and asked whether it is theirs.
 * The faces come from Google's height model and the plane of each face.
 */

const CENTRE = { lat: 52.62, lng: 1.25 }; // Norwich: UTM zone 31N
const UTM31 = utmDefinition(32631)!;
const RES = 0.1;
const SIZE = 400; // 40 m square
const [E0, N0] = proj4<[number, number]>('WGS84', UTM31, [CENTRE.lng, CENTRE.lat]);

function offset(eastM: number, northM: number) {
  const [lng, lat] = proj4<[number, number]>(UTM31, 'WGS84', [E0 + eastM, N0 + northM]);
  return { lat, lng };
}

const GEO = {
  width: SIZE,
  height: SIZE,
  ModelPixelScale: [RES, RES, 0],
  ModelTiepoint: [0, 0, 0, E0 - 20, N0 + 20, 0],
  GTModelTypeGeoKey: 1,
  GTRasterTypeGeoKey: 1,
  ProjectedCSTypeGeoKey: 32631,
};

/** A flat grey photo, 40 m square, centred on the house. */
function photo(): ArrayBuffer {
  return writeArrayBuffer(new Uint8Array(SIZE * SIZE * 3).fill(120), {
    ...GEO,
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    PhotometricInterpretation: 2,
  });
}

const EAVES_M = 5;
const PITCH = 35;
const RISE = Math.tan((PITCH * Math.PI) / 180);

/** Metres east and north of the centre, for each pixel of the 40 m square. */
function eachPixel(fn: (east: number, north: number) => number): number[] {
  const out: number[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) out.push(fn((x + 0.5) * RES - 20, 20 - (y + 0.5) * RES));
  }
  return out;
}

const onHouse = (e: number, n: number) => Math.abs(e) <= 5 && Math.abs(n) <= 4;

/**
 * A 10 m by 8 m house with a ridge running east to west: one face falls to
 * the south, the other to the north. `datum` lifts every height, as Google's
 * height model can sit a constant away from the heights of its planes.
 */
function heightModel(datum = 0): ArrayBuffer {
  const values = eachPixel((e, n) =>
    onHouse(e, n) ? datum + EAVES_M + RISE * (4 - Math.abs(n)) : datum,
  );
  return writeArrayBuffer(new Float32Array(values), { ...GEO });
}

function buildingMask(): ArrayBuffer {
  return writeArrayBuffer(new Uint8Array(eachPixel((e, n) => (onHouse(e, n) ? 1 : 0))), {
    ...GEO,
  });
}

/** The same house as Google describes it: two planes, and panels on the south one. */
function view(planes = true): RoofView {
  const face = (azimuthDeg: number, northM: number) => {
    const centre = offset(0, northM);
    const sw = offset(-5, Math.min(0, northM * 2));
    const ne = offset(5, Math.max(0, northM * 2));
    return {
      pitchDeg: PITCH,
      azimuthDeg,
      areaM2: 49,
      ...(planes
        ? {
            centre: [centre.lat, centre.lng] as [number, number],
            heightM: EAVES_M + RISE * 2,
            box: [sw.lat, sw.lng, ne.lat, ne.lng] as [number, number, number, number],
          }
        : {}),
    };
  };
  const panel = offset(0, -2);
  return {
    centre: CENTRE,
    box: { sw: offset(-5, -4), ne: offset(5, 4) },
    panelWidthM: 1.045,
    panelHeightM: 1.879,
    faces: [face(180, -2), face(0, 2)],
    panels: [[panel.lat, panel.lng, 0, 1]],
  };
}

/** The colour of the photo at a point, in metres east and north of the centre. */
function colourAt(picture: { image: string; width: number; height: number }, e: number, n: number) {
  const decoded = jpeg.decode(Buffer.from(picture.image.split(',')[1]!, 'base64'));
  const x = Math.round(picture.width / 2 + e / RES);
  const y = Math.round(picture.height / 2 - n / RES);
  const at = (y * decoded.width + x) * 4;
  return [decoded.data[at]!, decoded.data[at + 1]!, decoded.data[at + 2]!];
}

const isGrey = ([r, g, b]: number[]) =>
  Math.abs(r! - 120) < 12 && Math.abs(g! - 120) < 12 && Math.abs(b! - 120) < 12;
/** Orange: the first face colour. Blue: the second. */
const isOrange = ([r, , b]: number[]) => r! - b! > 40;
const isBlue = ([r, , b]: number[]) => b! - r! > 20;

describe('the roof faces on the photo', () => {
  beforeEach(() => clearRoofPictureCache());

  it('washes each face in its own colour and leaves the garden alone', async () => {
    const picture = (await pictureFromGeoTiff(photo(), view(), 2023, {
      dsm: heightModel(),
      mask: buildingMask(),
    }))!;
    expect(picture.facesMarked).toBe(true);
    expect(isOrange(colourAt(picture, 0, -2))).toBe(true); // the south face
    expect(isOrange(colourAt(picture, -4, -3))).toBe(true);
    expect(isBlue(colourAt(picture, 0, 2))).toBe(true); // the north face
    expect(isBlue(colourAt(picture, 4, 3))).toBe(true);
    expect(isGrey(colourAt(picture, 0, -6))).toBe(true); // the garden
    expect(isGrey(colourAt(picture, -7, 0))).toBe(true);
    // The south face's panels, for the dashboard, are in the south face's colour.
    expect(picture.faces).toHaveLength(1);
    expect(picture.faces[0]!.colour).toBe('#f2a93b');
  });

  it('still finds the faces when the height model sits a constant away, and without a mask', async () => {
    const picture = (await pictureFromGeoTiff(photo(), view(), 2023, {
      dsm: heightModel(47.3),
      mask: null,
    }))!;
    expect(picture.facesMarked).toBe(true);
    expect(isOrange(colourAt(picture, 2, -2))).toBe(true);
    expect(isBlue(colourAt(picture, -2, 2))).toBe(true);
    expect(isGrey(colourAt(picture, 0, 6))).toBe(true);
  });

  it('shows the plain photo when the faces cannot be told apart', async () => {
    // No height model.
    const plain = (await pictureFromGeoTiff(photo(), view(), 2023))!;
    expect(plain.facesMarked).toBe(false);
    expect(isGrey(colourAt(plain, 0, -2))).toBe(true);
    // A roof saved before its planes were kept.
    const old = (await pictureFromGeoTiff(photo(), view(false), 2023, {
      dsm: heightModel(),
      mask: buildingMask(),
    }))!;
    expect(old.facesMarked).toBe(false);
    // A height model that is nothing like the planes (flat ground).
    const flat = writeArrayBuffer(new Float32Array(SIZE * SIZE).fill(3), { ...GEO });
    const unfit = (await pictureFromGeoTiff(photo(), view(), 2023, { dsm: flat, mask: null }))!;
    expect(unfit.facesMarked).toBe(false);
    expect(isGrey(colourAt(unfit, 0, -2))).toBe(true);
  });

  it('asks Google for the heights with the photo, and shows the photo when they fail', async () => {
    const roof = { source: 'google', imageryYear: 2023, view: view() } as unknown as GoogleRoof;
    const client: SolarClient = {
      geocode: vi.fn(),
      buildingInsights: vi.fn(),
      aerialImage: vi.fn(() => Promise.resolve(photo())),
      roofHeights: vi.fn(() => Promise.resolve({ dsm: heightModel(), mask: buildingMask() })),
    };
    expect((await roofPicture(client, roof))?.facesMarked).toBe(true);
    clearRoofPictureCache();
    const failing: SolarClient = {
      ...client,
      roofHeights: vi.fn(() => Promise.reject(new Error('down'))),
    };
    expect((await roofPicture(failing, roof))?.facesMarked).toBe(false);
  });

  it("keeps each face's plane with the roof", () => {
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
          {
            pitchDegrees: 35.04,
            azimuthDegrees: 179.6,
            stats: { areaMeters2: 40.12 },
            center: { latitude: 52.61998, longitude: 1.25 },
            boundingBox: {
              sw: { latitude: 52.61995, longitude: 1.24992 },
              ne: { latitude: 52.62, longitude: 1.25008 },
            },
            planeHeightAtCenterMeters: 31.337,
          },
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
    expect(roofViewOf(insights)?.faces).toEqual([
      {
        pitchDeg: 35,
        azimuthDeg: 179.6,
        areaM2: 40.1,
        centre: [52.61998, 1.25],
        heightM: 31.34,
        box: [52.61995, 1.24992, 52.62, 1.25008],
      },
    ]);
  });
});

describe("Google's imagery over HTTP", () => {
  it('fetches the photo and the heights from one layers request', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn((input: string | URL) => {
      const url = String(input);
      calls.push(url.split('?')[0]!);
      if (url.includes('dataLayers:get')) {
        return Promise.resolve(
          Response.json({
            rgbUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=rgb',
            dsmUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=dsm',
            maskUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=mask',
          }),
        );
      }
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
    }) as unknown as typeof fetch;
    const client = httpSolarClient('key', fetchFn);
    const image = await client.aerialImage!(CENTRE, 20);
    expect(image?.byteLength).toBe(3);
    const heights = await client.roofHeights!(CENTRE, 20);
    expect(heights?.dsm.byteLength).toBe(3);
    expect(heights?.mask?.byteLength).toBe(3);
    // One billed layers request, three downloads.
    expect(calls.filter((u) => u.endsWith('dataLayers:get'))).toHaveLength(1);
    expect(calls.filter((u) => u.endsWith('geoTiff:get'))).toHaveLength(3);
  });
});
