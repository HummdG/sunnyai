import { crc32, deflateSync } from 'node:zlib';

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import {
  cropAndFit,
  decodePng,
  encodePng,
  extractMask,
  LogoImageError,
  maskToPng,
  suggestColors,
  type Raster,
} from '../src/branding/image.js';

const LIME: [number, number, number] = [170, 230, 40];

function blank(w: number, h: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

function set(r: Raster, x: number, y: number, rgba: number[]): void {
  r.data.set(rgba, (y * r.width + x) * 4);
}

function disc(): Raster {
  const r = blank(64, 64, [0, 0, 0, 0]);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      if ((x - 32) ** 2 + (y - 32) ** 2 <= 20 ** 2) set(r, x, y, [...LIME, 255]);
  return r;
}

/** Opaque dark tile with a lime bar in the middle. */
function tile(): Raster {
  const r = blank(80, 80, [20, 24, 40, 255]);
  for (let y = 30; y < 50; y++) for (let x = 15; x < 65; x++) set(r, x, y, [...LIME, 255]);
  return r;
}

/** A dark tile with a 6 px transparent margin and a lime bar: an app icon exported with padding. */
function marginTile(): Raster {
  const r = blank(100, 100, [0, 0, 0, 0]);
  for (let y = 6; y < 94; y++) for (let x = 6; x < 94; x++) set(r, x, y, [20, 24, 40, 255]);
  for (let y = 40; y < 60; y++) for (let x = 20; x < 80; x++) set(r, x, y, [...LIME, 255]);
  return r;
}

function chunk(type: string, body: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0);
  return Buffer.concat([len, t, body, crc]);
}

function rawPng(
  w: number,
  h: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
  scan: Buffer,
  plte?: Buffer,
): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      ...(plte ? [chunk('PLTE', plte)] : []),
      chunk('IDAT', deflateSync(scan)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** Few-colour image, so a palette can hold it. */
function fixture(): Raster {
  const r = blank(9, 7, [0, 0, 0, 255]);
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 9; x++)
      set(r, x, y, [(x % 3) * 100, (y % 2) * 120, ((x + y) % 4) * 60, 255]);
  return r;
}

function palettePng(r: Raster): Uint8Array {
  const index = new Map<string, number>();
  const entries: number[] = [];
  const rows: Buffer[] = [];
  for (let y = 0; y < r.height; y++) {
    const row = Buffer.alloc(1 + r.width);
    for (let x = 0; x < r.width; x++) {
      const o = (y * r.width + x) * 4;
      const rgb = Array.from(r.data.subarray(o, o + 3));
      const key = rgb.join(',');
      if (!index.has(key)) {
        index.set(key, index.size);
        entries.push(...rgb);
      }
      row[1 + x] = index.get(key) ?? 0;
    }
    rows.push(row);
  }
  return rawPng(r.width, r.height, 8, 3, 0, Buffer.concat(rows), Buffer.from(entries));
}

function png16(r: Raster): Uint8Array {
  const rows: Buffer[] = [];
  for (let y = 0; y < r.height; y++) {
    const row = Buffer.alloc(1 + r.width * 8);
    for (let i = 0; i < r.width * 4; i++)
      row.writeUInt16BE(r.data[y * r.width * 4 + i]! * 257, 1 + i * 2);
    rows.push(row);
  }
  return rawPng(r.width, r.height, 16, 6, 0, Buffer.concat(rows));
}

function interlacedPng(r: Raster): Uint8Array {
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ] as const;
  const parts: Buffer[] = [];
  for (const [x0, y0, dx, dy] of passes) {
    for (let y = y0; y < r.height; y += dy) {
      const xs: number[] = [];
      for (let x = x0; x < r.width; x += dx) xs.push(x);
      if (xs.length === 0) continue;
      const row = Buffer.alloc(1 + xs.length * 4);
      xs.forEach((x, i) => {
        const o = (y * r.width + x) * 4;
        Buffer.from(r.data.subarray(o, o + 4)).copy(row, 1 + i * 4);
      });
      parts.push(row);
    }
  }
  return rawPng(r.width, r.height, 8, 6, 1, Buffer.concat(parts));
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof LogoImageError) return e.code;
    throw e;
  }
  return 'none';
}

describe('decodePng', () => {
  it('reads palette, 16-bit and interlaced PNGs to the same RGBA', () => {
    const src = fixture();
    const plain = decodePng(encodePng(src));
    expect(Array.from(plain.data)).toEqual(Array.from(src.data));
    for (const bytes of [palettePng(src), png16(src), interlacedPng(src)]) {
      const r = decodePng(bytes);
      expect([r.width, r.height]).toEqual([9, 7]);
      expect(Array.from(r.data)).toEqual(Array.from(src.data));
    }
  });

  it('rejects oversize, non-PNG and fully transparent input', () => {
    const wide = PNG.sync.write(new PNG({ width: 2049, height: 1 }));
    expect(codeOf(() => decodePng(wide))).toBe('too_large');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
    expect(codeOf(() => decodePng(jpeg))).toBe('not_png');
    expect(codeOf(() => decodePng(encodePng(blank(8, 8, [10, 10, 10, 0]))))).toBe('empty');
  });
});

describe('decodePng size cap', () => {
  it('takes a real 2048 px image and refuses a real 2049 px one', () => {
    const edge = new PNG({ width: 2048, height: 4 });
    edge.data.fill(255);
    expect(decodePng(new Uint8Array(PNG.sync.write(edge))).width).toBe(2048);
    const wide = new PNG({ width: 2049, height: 4 });
    wide.data.fill(255);
    expect(codeOf(() => decodePng(new Uint8Array(PNG.sync.write(wide))))).toBe('too_large');
  });
});

describe('extractMask', () => {
  it('uses alpha for a transparent disc', () => {
    const m = extractMask(disc());
    expect(m?.mode).toBe('alpha');
    expect(m!.coverage[32 * 64 + 32]).toBe(1);
    expect(m!.coverage[0]).toBe(0);
  });

  it('keys out a flat background around an opaque tile', () => {
    const m = extractMask(tile());
    expect(m?.mode).toBe('background');
    expect(m!.coverage[40 * 80 + 40]).toBeGreaterThanOrEqual(0.99);
    expect(m!.coverage[2 * 80 + 2]).toBe(0);
  });

  it('keys the tile inside a transparent margin, so only the mark is covered', () => {
    const m = extractMask(marginTile());
    expect(m?.mode).toBe('background');
    expect(m!.coverage[50 * 100 + 50]).toBeGreaterThanOrEqual(0.99);
    // The tile itself and the margin around it are not the mark.
    expect(m!.coverage[10 * 100 + 10]).toBe(0);
    expect(m!.coverage[50 * 100 + 90]).toBe(0);
    expect(m!.coverage[2 * 100 + 2]).toBe(0);
  });

  it('keeps alpha for a flat square in a margin, where keying would leave nothing', () => {
    const r = blank(100, 100, [0, 0, 0, 0]);
    for (let y = 6; y < 94; y++) for (let x = 6; x < 94; x++) set(r, x, y, [...LIME, 255]);
    const m = extractMask(r);
    expect(m?.mode).toBe('alpha');
    expect(m!.coverage[50 * 100 + 50]).toBe(1);
  });

  it('returns null for photo-like noise', () => {
    const r = blank(64, 64, [0, 0, 0, 255]);
    let s = 12345;
    for (let i = 0; i < r.data.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      if (i % 4 !== 3) r.data[i] = (s >> 8) & 255;
    }
    expect(extractMask(r)).toBeNull();
  });

  it('returns null when almost nothing is covered', () => {
    const r = blank(100, 100, [0, 0, 0, 0]);
    set(r, 50, 50, [255, 0, 0, 255]);
    expect(extractMask(r)).toBeNull();
  });
});

describe('cropAndFit', () => {
  it('area-averages a wide image down to fit', () => {
    const r = blank(2000, 1000, [0, 0, 0, 0]);
    for (let y = 100; y < 900; y++) for (let x = 100; x < 1900; x++) set(r, x, y, [...LIME, 255]);
    const { image, mask } = cropAndFit(r, extractMask(r), 512, 512);
    expect(image.width).toBe(512);
    expect(image.height).toBeLessThanOrEqual(256);
    expect(mask?.width).toBe(image.width);
    expect(mask?.height).toBe(image.height);
    const mid = ((image.height >> 1) * image.width + (image.width >> 1)) * 4;
    expect(Math.abs(image.data[mid]! - LIME[0])).toBeLessThanOrEqual(1);
  });

  it('never upscales and crops with padding', () => {
    const d = disc();
    const { image, mask } = cropAndFit(d, extractMask(d), 512, 512);
    expect(image.width).toBeLessThan(64);
    expect(image.width).toBeGreaterThanOrEqual(41);
    expect(mask?.coverage.length).toBe(image.width * image.height);
  });

  it('crops to the alpha box when there is no mask', () => {
    const r = blank(100, 100, [0, 0, 0, 0]);
    for (let y = 40; y < 60; y++) for (let x = 20; x < 80; x++) set(r, x, y, [200, 10, 10, 255]);
    const { image, mask } = cropAndFit(r, null, 512, 512);
    expect(mask).toBeNull();
    expect(image.width).toBe(60 + 2 * Math.round(0.04 * 60));
  });
});

describe('cropAndFit alignment', () => {
  it('keeps mask and image on the same window in alpha mode', () => {
    const r = blank(300, 200, [0, 0, 0, 0]);
    for (let y = 20; y < 180; y++)
      for (let x = 30; x < 270; x++) {
        const a = x < 40 ? 20 : 255;
        set(r, x, y, [...LIME, a]);
      }
    const m = extractMask(r)!;
    const { image, mask } = cropAndFit(r, m, 100, 100);
    expect(mask!.coverage.length).toBe(image.width * image.height);
    for (let i = 0; i < mask!.coverage.length; i++) {
      expect(Math.abs(mask!.coverage[i]! - image.data[i * 4 + 3]! / 255)).toBeLessThanOrEqual(
        2 / 255,
      );
    }
  });

  it('keeps the whole opaque tile and aligns the bar mask with it', () => {
    const t = tile();
    const { image, mask } = cropAndFit(t, extractMask(t), 512, 512);
    expect([image.width, image.height]).toEqual([80, 80]);
    expect(mask!.mode).toBe('background');
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 80; x++) {
        const isBar = x >= 15 && x < 65 && y >= 30 && y < 50;
        expect(mask!.coverage[y * 80 + x]).toBeGreaterThanOrEqual(isBar ? 0.99 : 0);
        if (!isBar) expect(mask!.coverage[y * 80 + x]).toBe(0);
      }
    const big = blank(1000, 1000, [20, 24, 40, 255]);
    for (let y = 400; y < 600; y++) for (let x = 100; x < 900; x++) set(big, x, y, [...LIME, 255]);
    const f = cropAndFit(big, extractMask(big), 500, 500);
    expect([f.image.width, f.image.height]).toEqual([500, 500]);
    expect(f.mask!.coverage[250 * 500 + 250]).toBeGreaterThanOrEqual(0.99);
    expect(f.mask!.coverage[50 * 500 + 250]).toBe(0);
  });
});

describe('encoders and colours', () => {
  it('writes a white mask with alpha = coverage', () => {
    const m = extractMask(disc())!;
    const out = PNG.sync.read(Buffer.from(maskToPng(m)));
    expect(out.data[(32 * 64 + 32) * 4]).toBe(255);
    expect(out.data[(32 * 64 + 32) * 4 + 3]).toBe(255);
    expect(out.data[3]).toBe(0);
  });

  it('suggests the lime as the primary for the tile', () => {
    const t = tile();
    const { primary, glow } = suggestColors(t, extractMask(t)!);
    const p = [1, 3, 5].map((i) => parseInt(primary.slice(i, i + 2), 16));
    expect(Math.hypot(p[0]! - LIME[0], p[1]! - LIME[1], p[2]! - LIME[2])).toBeLessThan(20);
    expect(glow).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
