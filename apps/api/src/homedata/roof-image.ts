/**
 * The visitor's house from above: Google Solar's aerial photo, cropped to the
 * building, with each roof face washed in its own colour. The visitor is
 * shown it to say whether it is their house; the installer's dashboard also
 * draws the panels Google fits on it.
 *
 * A face is found from Google's height model (`dsm`): each roof face is a
 * plane (a centre, its height there, a pitch and a direction), and a pixel of
 * the building belongs to the face whose plane passes through its height.
 * Without the height model, or when it does not fit the planes, the photo is
 * shown plain.
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

import type { GoogleRoof, LatLngPoint, RoofHeights, RoofView, SolarClient } from './solar.js';
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
  /** South, east and west faces with panels on them, the sunniest first. */
  faces: PictureFace[];
  /** Whether the roof faces are marked on the photo (else it is the plain photo). */
  facesMarked: boolean;
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
  heights: RoofHeights | null = null,
): Promise<RoofPicture | null> {
  const tiff = await fromArrayBuffer(bytes);
  const image = await tiff.getImage();
  const epsg = Number(image.getGeoKeys()?.ProjectedCSTypeGeoKey);
  const definition = utmDefinition(epsg);
  if (!definition) return null;
  const fullW = image.getWidth();
  const fullH = image.getHeight();
  // From the image's bounds, not its resolution's sign: geotiff.js reports a
  // positive y resolution for Google's north-up files, which would put every
  // point above the image. Pixels run east from the west edge and south from
  // the north edge.
  const [minE, , maxE, maxN] = image.getBoundingBox() as [number, number, number, number];
  const metresPerPx = (maxE - minE) / fullW;

  const project = (p: LatLngPoint): [number, number] => {
    const [e, n] = proj4<[number, number]>('WGS84', definition, [p.lng, p.lat]);
    return [(e - minE) / metresPerPx, (maxN - n) / metresPerPx];
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
  // True north on the grid: UTM's grid north is a degree or two off it.
  const [cx, cy] = project(view.centre);
  const [nx, ny] = project({ lat: view.centre.lat + 0.0001, lng: view.centre.lng });
  const gridTurn = (Math.atan2(nx - cx, cy - ny) * 180) / Math.PI;

  // The faces Sunny counts and has panels for take the first colours, the
  // sunniest first (the dashboard's panels are drawn in them); the rest follow.
  const withPanels = new Map<number, number>();
  for (const [, , faceIndex] of view.panels) {
    const face = view.faces[faceIndex];
    if (!face || fromSouth(face.azimuthDeg) > USABLE_FROM_SOUTH_DEG) continue;
    withPanels.set(faceIndex, (withPanels.get(faceIndex) ?? 0) + 1);
  }
  const order = [
    ...[...withPanels.entries()]
      .sort(
        (a, b) =>
          fromSouth(view.faces[a[0]]!.azimuthDeg) - fromSouth(view.faces[b[0]]!.azimuthDeg) ||
          b[1] - a[1],
      )
      .map(([index]) => index),
    ...view.faces.map((_, index) => index).filter((index) => !withPanels.has(index)),
  ];
  const colourOf = new Map(
    order.map((index, i) => [index, FACE_COLOURS[i % FACE_COLOURS.length]!]),
  );

  const labels = heights
    ? await labelFaces(heights, view, {
        epsg,
        definition,
        gridTurn,
        width,
        height,
        // The grid position of the middle of the crop's top-left pixel.
        east: minE + (left + 0.5) * metresPerPx,
        north: maxN - (top + 0.5) * metresPerPx,
        metresPerPx,
      }).catch(() => null)
    : null;
  if (labels) washFaces(rgba, labels, width, height, colourOf);
  const encoded = jpeg.encode({ data: rgba, width, height }, 84);

  const byFace = new Map<number, PictureFace['panels']>();
  for (const [lat, lng, faceIndex, portrait] of view.panels) {
    const face = view.faces[faceIndex];
    // Only the faces Sunny counts (south, east and west: `usablePanels`), so
    // the photo agrees with the panel count the visitor was just told.
    if (!face || fromSouth(face.azimuthDeg) > USABLE_FROM_SOUTH_DEG) continue;
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
    .sort(
      (a, b) =>
        fromSouth(view.faces[a[0]]!.azimuthDeg) - fromSouth(view.faces[b[0]]!.azimuthDeg) ||
        b[1].length - a[1].length,
    )
    .map(([index, panels]): PictureFace => {
      const face = view.faces[index]!;
      return {
        facing: facingWords(face.azimuthDeg),
        pitchDeg: Math.round(face.pitchDeg),
        areaM2: Math.round(face.areaM2),
        panelCount: panels.length,
        colour: colourOf.get(index)!,
        panels,
      };
    });

  return {
    width,
    height,
    image: `data:image/jpeg;base64,${Buffer.from(encoded.data).toString('base64')}`,
    imageryYear,
    faces,
    facesMarked: labels !== null,
  };
}

/** The crop, on the photo's grid: its size, and where its first pixel sits. */
interface Crop {
  epsg: number;
  definition: string;
  gridTurn: number;
  width: number;
  height: number;
  east: number;
  north: number;
  metresPerPx: number;
}

/** One band of a GeoTIFF on the photo's grid, read by position; null off its edge. */
async function layerOn(
  bytes: ArrayBuffer,
  epsg: number,
): Promise<((east: number, north: number) => number | null) | null> {
  const image = await (await fromArrayBuffer(bytes)).getImage();
  if (Number(image.getGeoKeys()?.ProjectedCSTypeGeoKey) !== epsg) return null;
  const w = image.getWidth();
  const h = image.getHeight();
  const [minE, , maxE, maxN] = image.getBoundingBox() as [number, number, number, number];
  const perPx = (maxE - minE) / w;
  const data = (await image.readRasters({
    samples: [0],
    interleave: true,
  })) as unknown as ArrayLike<number>;
  return (east, north) => {
    const x = Math.floor((east - minE) / perPx);
    const y = Math.floor((maxN - north) / perPx);
    return x < 0 || y < 0 || x >= w || y >= h ? null : data[y * w + x]!;
  };
}

/** How far a pixel's height may sit from a face's plane and still be that face. */
const PLANE_TOLERANCE_M = 0.45;
/** Metres a face may reach beyond the box Google gives it. */
const BOX_SLACK_M = 0.6;
/** Under this share of the building on some face, the planes do not fit: no marking. */
const MIN_MARKED_SHARE = 0.35;

/**
 * Which roof face each pixel of the crop belongs to (an index into
 * `view.faces`, or -1), or null when the faces cannot be told apart: no
 * planes saved with the roof, a height model on another grid, or one the
 * planes do not fit.
 */
export async function labelFaces(
  heights: RoofHeights,
  view: RoofView,
  crop: Crop,
): Promise<Int16Array | null> {
  const toGrid = (lat: number, lng: number) =>
    proj4<[number, number]>('WGS84', crop.definition, [lng, lat]);
  const planes = view.faces.flatMap((face, index) => {
    if (!face.centre || !face.box || typeof face.heightM !== 'number') return [];
    const [e, n] = toGrid(face.centre[0], face.centre[1]);
    const corners = [
      toGrid(face.box[0], face.box[1]),
      toGrid(face.box[2], face.box[3]),
      toGrid(face.box[0], face.box[3]),
      toGrid(face.box[2], face.box[1]),
    ];
    // Downhill is the way the face points; on the grid, turned by its convergence.
    const turn = ((face.azimuthDeg + crop.gridTurn) * Math.PI) / 180;
    const fall = Math.tan((face.pitchDeg * Math.PI) / 180);
    return [
      {
        index,
        e,
        n,
        heightM: face.heightM,
        fallE: Math.sin(turn) * fall,
        fallN: Math.cos(turn) * fall,
        minE: Math.min(...corners.map((c) => c[0])) - BOX_SLACK_M,
        maxE: Math.max(...corners.map((c) => c[0])) + BOX_SLACK_M,
        minN: Math.min(...corners.map((c) => c[1])) - BOX_SLACK_M,
        maxN: Math.max(...corners.map((c) => c[1])) + BOX_SLACK_M,
      },
    ];
  });
  if (planes.length === 0) return null;
  const dsm = await layerOn(heights.dsm, crop.epsg);
  if (!dsm) return null;
  const mask = heights.mask ? await layerOn(heights.mask, crop.epsg).catch(() => null) : null;

  // Google's plane heights and its height model can sit a constant apart: the
  // middle of the differences at the faces' centres puts them together.
  const gaps = planes
    .map((p) => {
      const z = dsm(p.e, p.n);
      return z === null || !Number.isFinite(z) ? null : z - p.heightM;
    })
    .filter((g): g is number => g !== null)
    .sort((a, b) => a - b);
  if (gaps.length === 0) return null;
  const offset = gaps[Math.floor(gaps.length / 2)]!;

  const { width, height } = crop;
  const labels = new Int16Array(width * height).fill(-1);
  let building = 0;
  let marked = 0;
  for (let y = 0; y < height; y++) {
    const north = crop.north - y * crop.metresPerPx;
    for (let x = 0; x < width; x++) {
      const east = crop.east + x * crop.metresPerPx;
      let inside = false;
      let best = -1;
      let bestGap = PLANE_TOLERANCE_M;
      let z: number | null | undefined;
      for (const p of planes) {
        if (east < p.minE || east > p.maxE || north < p.minN || north > p.maxN) continue;
        if (!inside) {
          inside = true;
          if (mask && !mask(east, north)) break;
          z = dsm(east, north);
          if (z === null || !Number.isFinite(z)) break;
          building += 1;
        }
        const plane = p.heightM + offset - (east - p.e) * p.fallE - (north - p.n) * p.fallN;
        const gap = Math.abs((z as number) - plane);
        if (gap < bestGap) {
          bestGap = gap;
          best = p.index;
        }
      }
      if (best >= 0) {
        labels[y * width + x] = best;
        marked += 1;
      }
    }
  }
  if (building === 0 || marked / building < MIN_MARKED_SHARE) return null;
  return tidied(tidied(labels, width, height), width, height);
}

/**
 * Each pixel takes the label most of its neighbours have (a 5 by 5 square):
 * the speckle where two planes cross, or a chimney pokes through, goes.
 */
function tidied(labels: Int16Array, width: number, height: number): Int16Array {
  const out = new Int16Array(labels.length);
  const counts = new Map<number, number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      counts.clear();
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const label = labels[yy * width + xx]!;
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
      }
      let best = -1;
      let most = 0;
      for (const [label, count] of counts) {
        if (count > most) {
          most = count;
          best = label;
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

/** How strongly a face's colour lies over the photo, and its outline. */
const WASH = 0.42;
const OUTLINE = 0.9;

/** Wash each face in its colour, with a pale line where one face meets another or the edge. */
function washFaces(
  rgba: Buffer,
  labels: Int16Array,
  width: number,
  height: number,
  colourOf: ReadonlyMap<number, string>,
): void {
  const rgb = new Map(
    [...colourOf].map(([index, hex]) => [
      index,
      [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number],
    ]),
  );
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const label = labels[at]!;
      const right = x + 1 < width ? labels[at + 1]! : label;
      const below = y + 1 < height ? labels[at + width]! : label;
      const edge = right !== label || below !== label;
      if (label < 0 && !edge) continue;
      const colour = edge ? ([255, 255, 255] as const) : rgb.get(label);
      if (!colour) continue;
      const weight = edge ? OUTLINE : WASH;
      for (let c = 0; c < 3; c++) {
        rgba[at * 4 + c] = Math.round(rgba[at * 4 + c]! * (1 - weight) + colour[c]! * weight);
      }
    }
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Degrees a face turns away from due south (the MCS orientation). */
const fromSouth = (azimuthDeg: number) => Math.abs((((azimuthDeg % 360) + 360) % 360) - 180);
/** The quote engine's limit for a usable face (`usableGoogleSolarPanelCount`). */
const USABLE_FROM_SOUTH_DEG = 112.5;

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
  const radius = imageRadius(view);
  const bytes = await client.aerialImage(view.centre, radius);
  // The heights only mark the faces: without them the photo is still shown.
  const heights =
    bytes && client.roofHeights
      ? await client.roofHeights(view.centre, radius).catch(() => null)
      : null;
  const value = bytes ? await pictureFromGeoTiff(bytes, view, roof.imageryYear, heights) : null;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now, value });
  return value;
}
