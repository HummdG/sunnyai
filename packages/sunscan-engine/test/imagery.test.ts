// Aerial ground texture (optional live layer, never exported): Web Mercator tile maths, stitching of z19 tiles into a
// north-up image of the ENU square around a point (synthetic PNG / JPEG tiles with known colours), the cached
// service, GET /api/imagery/ortho, and spec.context.imagery from the pipeline.
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { makeFrame } from '@sunny/sunscan-core/geo';
import type { Providers } from '../src/contracts.js';
import {
  buildOrthoImage, createOrthoService, decodeTile, ESRI_IMAGERY_ATTRIBUTION, groundResolution, imageryAvailable, imageryRef,
  ORTHO_MAX_TILES, ORTHO_ZOOM, tileBounds, tileInImageryBounds, tilesForSquare, worldPx,
} from '../src/imagery/ortho.js';
import { buildModel } from '../src/pipeline/index.js';
import { createFixtureProviders, fixture } from './support/fixture-providers.js';
import { stubReconstruct } from './support/stub-fit/reconstruct.js';
import { stubProviders } from './support/stubs.js';
import { IMAGERY_TILE } from './support-data/expectations.js';

const LAT = 53.3697111, LON = -2.8978967; // 20 Forthlin Road
type Rgb = [number, number, number];
const colourOf = (x: number, y: number): Rgb => [((x * 67) % 200) + 30, ((y * 41) % 200) + 30, (((x + y) * 23) % 200) + 30];

function solidTile(c: Rgb, format: 'png' | 'jpeg'): Uint8Array {
  const data = Buffer.alloc(256 * 256 * 4);
  for (let i = 0; i < data.length; i += 4) (data[i] = c[0]), (data[i + 1] = c[1]), (data[i + 2] = c[2]), (data[i + 3] = 255);
  if (format === 'jpeg') return new Uint8Array(jpeg.encode({ data, width: 256, height: 256 }, 95).data);
  const png = new PNG({ width: 256, height: 256 });
  data.copy(png.data);
  return new Uint8Array(PNG.sync.write(png));
}

/** Tile source with known solid colours (PNG and JPEG alternating), counting calls; `missing` tiles answer null. */
function syntheticTiles(missing: (x: number, y: number) => boolean = () => false) {
  const calls: string[] = [];
  const get = async (z: number, x: number, y: number) => {
    calls.push(`${z}/${x}/${y}`);
    if (missing(x, y)) return null;
    const format = (x + y) % 2 ? 'jpeg' : 'png';
    return { body: solidTile(colourOf(x, y), format), contentType: `image/${format}` };
  };
  return { get, calls };
}

const decode = (body: Uint8Array) => jpeg.decode(body, { useTArray: true, formatAsRGBA: true });

describe('Web Mercator tile maths', () => {
  it('finds the recorded z18 tile containing Mendips and the native z19 ground resolution', () => {
    const f = fixture('uk-mendips').geocode.best!;
    const [px, py] = worldPx(f.lon, f.lat, IMAGERY_TILE.z);
    expect([Math.floor(px / 256), Math.floor(py / 256)]).toEqual([IMAGERY_TILE.x, IMAGERY_TILE.y]);
    expect(groundResolution(0, 0)).toBeCloseTo(156_543.034, 3);
    expect(groundResolution(LAT, ORTHO_ZOOM)).toBeCloseTo(0.178, 3);
  });

  it('lists a contiguous block of tiles covering the square', () => {
    const t = tilesForSquare(LAT, LON, 60);
    const xs = [...new Set(t.map((q) => q.x))], ys = [...new Set(t.map((q) => q.y))];
    expect(t).toHaveLength(xs.length * ys.length);
    expect(xs.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(xs.length);
    const f = makeFrame(LAT, LON);
    for (const [x, y] of [[-60, -60], [60, 60], [-60, 60], [60, -60]] as const) {
      const [lo, la] = f.toLonLat([x, y]);
      const [px, py] = worldPx(lo, la, ORTHO_ZOOM);
      expect(t.some((q) => q.x === Math.floor(px / 256) && q.y === Math.floor(py / 256))).toBe(true);
    }
  });

  it('decodes JPEG and PNG tiles and rejects anything else', () => {
    expect(decodeTile(solidTile([10, 200, 30], 'png'))!.data.slice(0, 4)).toEqual(new Uint8Array([10, 200, 30, 255]));
    const j = decodeTile(solidTile([10, 200, 30], 'jpeg'))!;
    expect(j.width).toBe(256);
    expect(Math.abs(j.data[1] - 200)).toBeLessThan(6);
    expect(decodeTile(new TextEncoder().encode('<html>'))).toBeNull();
    expect(decodeTile(new Uint8Array([0xff, 0xd8, 0, 1]))).toBeNull();
  });
});

describe('buildOrthoImage: north-up ENU ground image', () => {
  it('places every tile where it belongs (colour check away from tile edges)', async () => {
    const half = 60;
    const src = syntheticTiles();
    const img = (await buildOrthoImage(src.get, LAT, LON, half))!;
    expect(img.contentType).toBe('image/jpeg');
    expect(img.bounds).toEqual([-half, -half, half, half]);
    expect(img.missingTiles).toBe(0);
    expect(img.size).toBe(Math.round((2 * half) / groundResolution(LAT, ORTHO_ZOOM)));
    expect(img.resolution * img.size).toBeCloseTo(2 * half, 9);
    const out = decode(img.body);
    expect([out.width, out.height]).toEqual([img.size, img.size]);
    const f = makeFrame(LAT, LON);
    let checked = 0;
    for (let x = -57; x <= 57; x += 6) {
      for (let y = -57; y <= 57; y += 6) {
        const [lo, la] = f.toLonLat([x, y]);
        const [px, py] = worldPx(lo, la, ORTHO_ZOOM);
        const ex = px % 256, ey = py % 256;
        if (ex < 14 || ex > 242 || ey < 14 || ey > 242) continue; // JPEG chroma bleeds a little across tile edges
        const want = colourOf(Math.floor(px / 256), Math.floor(py / 256));
        const i = Math.floor((x + half) / img.resolution), j = Math.floor((half - y) / img.resolution); // row 0 = north
        const o = (j * out.width + i) * 4;
        for (let c = 0; c < 3; c++) expect(Math.abs(out.data[o + c] - want[c]), `(${x}, ${y}) channel ${c}`).toBeLessThan(14);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(src.calls).toHaveLength(tilesForSquare(LAT, LON, half).length);
  });

  it('fills missing tiles, and is unavailable without any tile', async () => {
    const all = tilesForSquare(LAT, LON, 30);
    const gone = all[0];
    const partial = (await buildOrthoImage(syntheticTiles((x, y) => x === gone.x && y === gone.y).get, LAT, LON, 30))!;
    expect(partial.missingTiles).toBe(1);
    expect(await buildOrthoImage(syntheticTiles(() => true).get, LAT, LON, 30)).toBeNull();
    expect(await buildOrthoImage(async () => { throw new Error('offline'); }, LAT, LON, 30)).toBeNull();
  });

  it('caches finished images and shares in-flight requests', async () => {
    const src = syntheticTiles();
    const svc = createOrthoService(src.get);
    const [a, b] = await Promise.all([svc.get(LAT, LON, 20), svc.get(LAT, LON, 20)]);
    expect(a).toBe(b);
    const n = src.calls.length;
    expect(await svc.get(LAT, LON, 20)).toBe(a);
    expect(src.calls).toHaveLength(n);
    await svc.get(LAT, LON, 25);
    expect(src.calls.length).toBeGreaterThan(n);
    const none = createOrthoService(syntheticTiles(() => true).get);
    expect(await none.get(LAT, LON)).toBeNull();
  });
});

describe('pipeline: spec.context.imagery (live ground texture, never exportable)', () => {
  const run = (providers: Providers, options = {}) => {
    const f = fixture('uk-forthlin-road');
    return buildModel(
      { lat: f.geocode.best!.lat, lon: f.geocode.best!.lon, address: f.input, geocode: f.geocode, options },
      { providers, reconstruct: stubReconstruct, reconstructLabel: 'stub-fit', log: () => undefined },
    );
  };

  it('references the ortho image around the spec origin when the tile under the house exists', async () => {
    const { spec } = await run(createFixtureProviders({ getImageryTile: syntheticTiles().get }));
    expect(spec.context.imagery).toEqual({
      url: `/api/imagery/ortho?lat=${spec.origin.lat}&lon=${spec.origin.lon}&half=60`,
      bounds: [-60, -60, 60, 60],
      attribution: ESRI_IMAGERY_ATTRIBUTION,
      exportable: false,
    });
    expect(ESRI_IMAGERY_ATTRIBUTION).toBe('Powered by Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community');
    const smaller = await run(createFixtureProviders({ getImageryTile: syntheticTiles().get }), { imageryHalfSize: 40 });
    expect(smaller.spec.context.imagery!.bounds).toEqual([-40, -40, 40, 40]);
  });

  it('leaves it out without imagery, when switched off, or when the tile is unavailable', async () => {
    expect((await run(createFixtureProviders())).spec.context.imagery).toBeUndefined();
    expect((await run(createFixtureProviders({ getImageryTile: syntheticTiles().get }), { imagery: false })).spec.context.imagery).toBeUndefined();
    expect((await run(createFixtureProviders({ getImageryTile: async () => null }))).spec.context.imagery).toBeUndefined();
    expect((await run(createFixtureProviders({ getImageryTile: async () => { throw new Error('esri down'); } }))).spec.context.imagery).toBeUndefined();
  });

  it('imageryAvailable / imageryRef helpers', async () => {
    expect(await imageryAvailable(stubProviders(), LAT, LON)).toBe(false);
    expect(await imageryAvailable(stubProviders({ getImageryTile: syntheticTiles().get }), LAT, LON)).toBe(true);
    expect(imageryRef(1.5, -2.25, 30)).toMatchObject({ url: '/api/imagery/ortho?lat=1.5&lon=-2.25&half=30', bounds: [-30, -30, 30, 30], exportable: false });
  });
});
