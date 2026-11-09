import { LOGO_EFFECTS } from '@sunny/contracts';
import { describe, expect, it } from 'vitest';

import { encodePng, extractMask, type Raster } from '../src/branding/image.js';
import { processLogo } from '../src/branding/process.js';
import { outlinePath, traceMask, verifyTrace } from '../src/branding/trace.js';

const LIME: [number, number, number] = [170, 230, 40];

function blank(w: number, h: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

function set(r: Raster, x: number, y: number, rgba: number[]): void {
  r.data.set(rgba, (y * r.width + x) * 4);
}

function disc(hole = 0): Raster {
  const r = blank(64, 64, [0, 0, 0, 0]);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const d = (x - 32) ** 2 + (y - 32) ** 2;
      if (d <= 20 ** 2 && d > hole ** 2) set(r, x, y, [...LIME, 255]);
    }
  return r;
}

/** Opaque dark tile with a lime bar in the middle. */
function tile(): Raster {
  const r = blank(80, 80, [20, 24, 40, 255]);
  for (let y = 30; y < 50; y++) for (let x = 15; x < 65; x++) set(r, x, y, [...LIME, 255]);
  return r;
}

/** The disc with isolated single pixels flipped in and out of it. */
function speckled(): Raster {
  const r = disc();
  let s = 777;
  for (let y = 1; y < 63; y += 3)
    for (let x = 1; x < 63; x += 3) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      if ((s >> 16) % 2 === 0) continue;
      const inside = r.data[(y * 64 + x) * 4 + 3]! > 0;
      set(r, x, y, inside ? [0, 0, 0, 0] : [...LIME, 255]);
    }
  return r;
}

function noise(): Raster {
  const r = blank(64, 64, [0, 0, 0, 255]);
  let s = 12345;
  for (let i = 0; i < r.data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    if (i % 4 !== 3) r.data[i] = (s >> 8) & 255;
  }
  return r;
}

function subpaths(path: string): number {
  return (path.match(/M/g) ?? []).length;
}

function bbox(path: string): [number, number, number, number] {
  const nums = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('traceMask and verifyTrace', () => {
  it('traces a disc as one closed polygon that matches the mask', () => {
    const m = extractMask(disc())!;
    const polys = traceMask(m);
    expect(polys).toHaveLength(1);
    const { iou, farMismatch } = verifyTrace(polys, m);
    expect(iou).toBeGreaterThanOrEqual(0.98);
    expect(farMismatch).toBe(0);
    expect(outlinePath(polys)).toMatch(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+ Z$/);
  });

  it('flags a trace that leaves out part of the shape', () => {
    const m = extractMask(disc(8))!;
    const outer = traceMask(m).slice(0, 1);
    const { iou, farMismatch } = verifyTrace(outer, m);
    expect(iou).toBeLessThan(0.98);
    expect(farMismatch).toBeGreaterThan(0);
  });
});

describe('processLogo', () => {
  it('a transparent disc passes with every effect and one subpath', () => {
    const p = processLogo(encodePng(disc()), 'icon');
    expect(p.kind).toBe('icon');
    expect(p.maskPng).not.toBeNull();
    expect(p.outline).not.toBeNull();
    expect(subpaths(p.outline!)).toBe(1);
    expect(p.availableEffects).toEqual([...LOGO_EFFECTS]);
    expect(p.suggestedColors?.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('a ring traces as two subpaths and passes', () => {
    const p = processLogo(encodePng(disc(8)), 'icon');
    expect(p.outline).not.toBeNull();
    expect(subpaths(p.outline!)).toBe(2);
    expect(p.availableEffects).toEqual([...LOGO_EFFECTS]);
  });

  it('an opaque tile traces the bar, not the tile', () => {
    const p = processLogo(encodePng(tile()), 'icon');
    expect([p.width, p.height]).toEqual([80, 80]);
    expect(p.outline).not.toBeNull();
    expect(p.availableEffects).toEqual([...LOGO_EFFECTS]);
    const [x0, y0, x1, y1] = bbox(p.outline!);
    expect(Math.abs(x0 - 15)).toBeLessThanOrEqual(1);
    expect(Math.abs(y0 - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(x1 - 65)).toBeLessThanOrEqual(1);
    expect(Math.abs(y1 - 50)).toBeLessThanOrEqual(1);
  });

  it('speckle fails verification and keeps only the stencil effects', () => {
    const p = processLogo(encodePng(speckled()), 'icon');
    expect(p.maskPng).not.toBeNull();
    expect(p.outline).toBeNull();
    expect(p.availableEffects).toEqual(['charge', 'shimmer', 'segments']);
  });

  it('a dense dot grid skips verification once the outline is too long', () => {
    const r = blank(512, 512, [0, 0, 0, 0]);
    for (let y = 1; y + 3 < 512; y += 5)
      for (let x = 1; x + 3 < 512; x += 5)
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 3; dx++) set(r, x + dx, y + dy, [...LIME, 255]);
    const bytes = encodePng(r);
    const start = performance.now();
    const p = processLogo(bytes, 'icon');
    const elapsed = performance.now() - start;
    expect(p.maskPng).not.toBeNull();
    expect(p.outline).toBeNull();
    expect(p.availableEffects).toEqual(['charge', 'shimmer', 'segments']);
    expect(elapsed).toBeLessThan(2000);
  });

  it('noise has no mask and no effects', () => {
    const p = processLogo(encodePng(noise()), 'icon');
    expect(p.maskPng).toBeNull();
    expect(p.outline).toBeNull();
    expect(p.availableEffects).toEqual([]);
    expect(p.suggestedColors).toBeNull();
  });

  it('a wordmark gets no mask, outline, effects or colours', () => {
    const p = processLogo(encodePng(disc()), 'wordmark');
    expect(p.kind).toBe('wordmark');
    expect(p.maskPng).toBeNull();
    expect(p.outline).toBeNull();
    expect(p.availableEffects).toEqual([]);
    expect(p.suggestedColors).toBeNull();
  });

  it('gives the same id for the same bytes', () => {
    const bytes = encodePng(tile());
    expect(processLogo(bytes, 'icon').id).toBe(processLogo(bytes, 'icon').id);
    expect(processLogo(bytes, 'icon').id).not.toBe(processLogo(encodePng(disc()), 'icon').id);
  });
});
