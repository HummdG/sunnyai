/**
 * The visitor's house from above: Google Solar's aerial photo, cropped to the
 * building, with each roof face's panels drawn on it in that face's colour.
 *
 * The photo is the RGB layer of Google's `dataLayers` (a GeoTIFF in the
 * local UTM zone, 10 cm a pixel). Panels and faces come from the roof saved
 * with the session (`RoofView`), so drawing them costs no second insights
 * call. The panels are returned as pixel rectangles for the widget to draw
 * over the photo as SVG, which keeps them crisp at any size and lets the key
 * under the photo match their colours.
 */

import { fromArrayBuffer } from 'geotiff';
import jpeg from 'jpeg-js';
import proj4 from 'proj4';

import type { GoogleRoof, LatLngPoint, RoofView, SolarClient } from './solar.js';
import { metresBetween } from './solar.js';

/** One roof face on the photo. */
export interface PictureFace {
  /** Compass words for where the face points ("south-west"). */
  facing: string;
  pitchDeg: number;
  areaM2: number;
  /** Panels Google fits on it, in its largest layout. */
  panelCount: number;
  colour: string;
  /** Panels as [centre x, centre y, width, height, clockwise degrees], in image pixels. */
  panels: Array<[number, number, number, number, number]>;
}

export interface RoofPicture {
  width: number;
  height: number;
  /** The cropped photo, as a JPEG data URL. */
  image: string;
  imageryYear: number | null;
  /** Faces with panels on them, the most panels first. */
  faces: PictureFace[];
}

/** Warm, distinct and readable on a roof photo; the first is the sunniest face's. */
const FACE_COLOURS = ['#f2a93b', '#4f86c6', '#6bbf59', '#d9534f', '#9b6fcf', '#3bb3a6'];

const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

export function facingWords(azimuthDeg: number): string {
  return COMPASS[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8]!;
}

/** The proj4 definition of a WGS 84 UTM zone, from its EPSG code (326zz north, 327zz south). */
export function utmDefinition(epsg: number): string | null {
  const north = epsg >= 32601 && epsg <= 32660;
  const south = epsg >= 32701 && epsg <= 32760;
  if (!north && !south) return null;
  const zone = epsg % 100;
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
}

/** Metres of photo kept round the building's box. */
const MARGIN_M = 4;

/** How far round the building to ask Google for imagery. */
export function imageRadius(view: RoofView): number {
  const corner = metresBetween(view.centre, view.box.ne);
  const other = metresBetween(view.centre, view.box.sw);
  return Math.min(60, Math.max(15, Math.ceil(Math.max(corner, other) + MARGIN_M + 2)));
}

/**
 * Crop the photo to the building and place its panels on it. Null when the
 * GeoTIFF is not in a projection this understands (Google's are UTM).
 */
export async function pictureFromGeoTiff(
  bytes: ArrayBuffer,
  view: RoofView,
  imageryYear: number | null,
): Promise<RoofPicture | null> {
  const tiff = await fromArrayBuffer(bytes);
  const image = await tiff.getImage();
  const epsg = Number(image.getGeoKeys()?.ProjectedCSTypeGeoKey);
  const definition = utmDefinition(epsg);
  if (!definition) return null;
  const [originE, originN] = image.getOrigin() as [number, number];
  const [resX, resY] = image.getResolution() as [number, number];
  const fullW = image.getWidth();
  const fullH = image.getHeight();
  const metresPerPx = Math.abs(resX);

  const project = (p: LatLngPoint): [number, number] => {
    const [e, n] = proj4<[number, number]>('WGS84', definition, [p.lng, p.lat]);
    return [(e - originE) / resX, (n - originN) / resY];
  };

  // The building's box, its four corners in pixels, with the margin round it.
  const corners = [
    view.box.sw,
    view.box.ne,
    { lat: view.box.sw.lat, lng: view.box.ne.lng },
    { lat: view.box.ne.lat, lng: view.box.sw.lng },
  ].map(project);
  const margin = MARGIN_M / metresPerPx;
  const left = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) - margin));
  const top = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) - margin));
  const right = Math.min(fullW, Math.ceil(Math.max(...corners.map((c) => c[0])) + margin));
  const bottom = Math.min(fullH, Math.ceil(Math.max(...corners.map((c) => c[1])) + margin));
  const width = right - left;
  const height = bottom - top;
  if (width < 8 || height < 8) return null;

  const raster = (await image.readRasters({
    interleave: true,
    window: [left, top, right, bottom],
  })) as unknown as ArrayLike<number>;
  const bands = image.getSamplesPerPixel();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += bands) {
    rgba[i * 4] = raster[j]!;
    rgba[i * 4 + 1] = raster[j + (bands > 1 ? 1 : 0)]!;
    rgba[i * 4 + 2] = raster[j + (bands > 2 ? 2 : 0)]!;
    rgba[i * 4 + 3] = 255;
  }
  const encoded = jpeg.encode({ data: rgba, width, height }, 84);

  // True north on the grid: UTM's grid north is a degree or two off it.
  const [cx, cy] = project(view.centre);
  const [nx, ny] = project({ lat: view.centre.lat + 0.0001, lng: view.centre.lng });
  const gridTurn = (Math.atan2(nx - cx, cy - ny) * 180) / Math.PI;

  const byFace = new Map<number, PictureFace['panels']>();
  for (const [lat, lng, faceIndex, portrait] of view.panels) {
    const face = view.faces[faceIndex];
    if (!face) continue;
    const [x, y] = project({ lat, lng });
    // Seen from above, a panel's length up the slope shrinks by the pitch.
    const slope = Math.cos((face.pitchDeg * Math.PI) / 180);
    const across = portrait ? view.panelWidthM : view.panelHeightM;
    const up = (portrait ? view.panelHeightM : view.panelWidthM) * slope;
    const list = byFace.get(faceIndex) ?? [];
    list.push([
      round1(x - left),
      round1(y - top),
      round1(across / metresPerPx),
      round1(up / metresPerPx),
      round1(face.azimuthDeg + gridTurn),
    ]);
    byFace.set(faceIndex, list);
  }

  const faces = [...byFace.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([index, panels], i): PictureFace => {
      const face = view.faces[index]!;
      return {
        facing: facingWords(face.azimuthDeg),
        pitchDeg: Math.round(face.pitchDeg),
        areaM2: Math.round(face.areaM2),
        panelCount: panels.length,
        colour: FACE_COLOURS[i % FACE_COLOURS.length]!,
        panels,
      };
    });

  return {
    width,
    height,
    image: `data:image/jpeg;base64,${Buffer.from(encoded.data).toString('base64')}`,
    imageryYear,
    faces,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Recent pictures, so a reopened chat or a second instance's retry is not another paid call. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 100;
const cache = new Map<string, { at: number; value: RoofPicture | null }>();

/** For tests. */
export function clearRoofPictureCache(): void {
  cache.clear();
}

/**
 * The picture of a saved Google roof, or null when there is nothing to show:
 * no client that can fetch imagery, a roof saved without its view, or no
 * imagery from Google.
 */
export async function roofPicture(
  client: SolarClient | null | undefined,
  roof: GoogleRoof | null,
  now: number = Date.now(),
): Promise<RoofPicture | null> {
  const view = roof?.view;
  if (!client?.aerialImage || !roof || !view) return null;
  const key = `${view.centre.lat},${view.centre.lng}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const bytes = await client.aerialImage(view.centre, imageRadius(view));
  const value = bytes ? await pictureFromGeoTiff(bytes, view, roof.imageryYear) : null;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now, value });
  return value;
}
