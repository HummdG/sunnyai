import { PNG } from 'pngjs';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, not premultiplied. */
  data: Uint8Array;
}

export interface Mask {
  width: number;
  height: number;
  /** 0..1 per pixel. */
  coverage: Float32Array;
  mode: 'alpha' | 'background';
}

export type LogoImageErrorCode = 'not_png' | 'too_large' | 'empty';

export class LogoImageError extends Error {
  constructor(readonly code: LogoImageErrorCode) {
    super(code);
    this.name = 'LogoImageError';
  }
}

/**
 * Decoded side cap. A small PNG can inflate to width x height x 4 bytes, and the
 * API shares a 512 MiB instance, so 2048 keeps one upload's working set bounded.
 */
const MAX_SIDE = 2048;
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePng(bytes: Uint8Array): Raster {
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new LogoImageError('not_png');
  }
  // Check the declared size before inflating anything.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16) > MAX_SIDE || view.getUint32(20) > MAX_SIDE) {
    throw new LogoImageError('too_large');
  }
  let png: PNG;
  try {
    png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    throw new LogoImageError('not_png');
  }
  if (png.width > MAX_SIDE || png.height > MAX_SIDE) throw new LogoImageError('too_large');
  // A view, not a copy: the decoder's buffer is ours alone.
  const data = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  let visible = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 0) {
      visible = true;
      break;
    }
  }
  if (!visible) throw new LogoImageError('empty');
  return { width: png.width, height: png.height, data };
}

export function encodePng(r: Raster): Uint8Array {
  const png = new PNG({ width: r.width, height: r.height });
  png.data = Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  return new Uint8Array(PNG.sync.write(png));
}

export function maskToPng(m: Mask): Uint8Array {
  const data = new Uint8Array(m.width * m.height * 4);
  for (let i = 0; i < m.coverage.length; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = Math.round(m.coverage[i]! * 255);
  }
  return encodePng({ width: m.width, height: m.height, data });
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export function extractMask(r: Raster): Mask | null {
  const { width: w, height: h, data } = r;
  const border: number[] = [];
  for (let x = 0; x < w; x++) {
    border.push(x, (h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    border.push(y * w, y * w + w - 1);
  }
  const uniq = [...new Set(border)];

  const coverage = new Float32Array(w * h);
  let mode: Mask['mode'];

  const clear = uniq.filter((p) => data[p * 4 + 3]! < 128).length;
  if (clear >= uniq.length * 0.5) {
    mode = 'alpha';
    for (let i = 0; i < w * h; i++) coverage[i] = data[i * 4 + 3]! / 255;
  } else {
    const solid = uniq.filter((p) => data[p * 4 + 3]! >= 200);
    if (solid.length === 0) return null;
    const bg = [0, 1, 2].map((c) => median(solid.map((p) => data[p * 4 + c]!)));
    const dist = (i: number): number => {
      const dr = data[i * 4]! - bg[0]!;
      const dg = data[i * 4 + 1]! - bg[1]!;
      const db = data[i * 4 + 2]! - bg[2]!;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    const near = solid.filter((p) => dist(p) <= 24).length;
    if (near < solid.length * 0.9) return null;
    mode = 'background';
    for (let i = 0; i < w * h; i++) {
      const t = Math.min(1, Math.max(0, (dist(i) - 12) / (48 - 12)));
      coverage[i] = t * (data[i * 4 + 3]! / 255);
    }
  }

  let covered = 0;
  for (let i = 0; i < coverage.length; i++) if (coverage[i]! > 0.5) covered++;
  if (covered < w * h * 0.005) return null;
  return { width: w, height: h, coverage, mode };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boundingBox(w: number, h: number, inside: (i: number) => boolean): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(y * w + x)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Box-filter resample of the window (x0, y0, cw, ch) of a `stride`-wide source
 * straight into a `dw` x `dh` x `channels` plane. `add` accumulates source pixel
 * `si` at weight `wgt` into `acc`, so no full-size float copy of the source is
 * ever made.
 */
function boxResample(
  stride: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  dw: number,
  dh: number,
  channels: number,
  add: (acc: Float64Array, si: number, wgt: number) => void,
): Float32Array {
  const out = new Float32Array(dw * dh * channels);
  const acc = new Float64Array(channels);
  const sx = cw / dw;
  const sy = ch / dh;
  for (let dy = 0; dy < dh; dy++) {
    const ya = dy * sy;
    const yb = (dy + 1) * sy;
    for (let dx = 0; dx < dw; dx++) {
      const xa = dx * sx;
      const xb = (dx + 1) * sx;
      acc.fill(0);
      let weight = 0;
      for (let y = Math.floor(ya); y < Math.min(ch, Math.ceil(yb)); y++) {
        const wy = Math.min(y + 1, yb) - Math.max(y, ya);
        const row = (y0 + y) * stride + x0;
        for (let x = Math.floor(xa); x < Math.min(cw, Math.ceil(xb)); x++) {
          const wgt = wy * (Math.min(x + 1, xb) - Math.max(x, xa));
          weight += wgt;
          add(acc, row + x, wgt);
        }
      }
      for (let c = 0; c < channels; c++) out[(dy * dw + dx) * channels + c] = acc[c]! / weight;
    }
  }
  return out;
}

export function cropAndFit(
  r: Raster,
  mask: Mask | null,
  maxW: number,
  maxH: number,
): { image: Raster; mask: Mask | null } {
  // Always the visible pixels, never the mask: the logo shown is exactly what was uploaded.
  const box = boundingBox(r.width, r.height, (i) => r.data[i * 4 + 3]! > 0) ?? {
    x0: 0,
    y0: 0,
    x1: r.width,
    y1: r.height,
  };

  const pad = Math.round(0.04 * Math.max(box.x1 - box.x0, box.y1 - box.y0));
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(r.width, box.x1 + pad);
  const y1 = Math.min(r.height, box.y1 + pad);
  const cw = x1 - x0;
  const ch = y1 - y0;

  const scale = Math.min(1, maxW / cw, maxH / ch);
  const dw = Math.max(1, Math.min(maxW, Math.round(cw * scale)));
  const dh = Math.max(1, Math.min(maxH, Math.round(ch * scale)));

  // Premultiplied RGBA so transparent pixels do not darken the edges. Only the
  // output size is ever held in floats.
  const src = r.data;
  const rgba = boxResample(r.width, x0, y0, cw, ch, dw, dh, 4, (acc, si, wgt) => {
    const a = (src[si * 4 + 3]! / 255) * wgt;
    acc[0]! += src[si * 4]! * a;
    acc[1]! += src[si * 4 + 1]! * a;
    acc[2]! += src[si * 4 + 2]! * a;
    acc[3]! += a;
  });
  const data = new Uint8Array(dw * dh * 4);
  for (let i = 0; i < dw * dh; i++) {
    const a = rgba[i * 4 + 3]!;
    if (a > 0) {
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = Math.min(255, Math.max(0, Math.round(rgba[i * 4 + c]! / a)));
      }
    }
    data[i * 4 + 3] = Math.min(255, Math.round(a * 255));
  }

  let fitted: Mask | null = null;
  if (mask) {
    const cov = mask.coverage;
    fitted = {
      width: dw,
      height: dh,
      coverage: boxResample(r.width, x0, y0, cw, ch, dw, dh, 1, (acc, si, wgt) => {
        acc[0]! += cov[si]! * wgt;
      }),
      mode: mask.mode,
    };
  }
  return { image: { width: dw, height: dh, data }, mask: fitted };
}

function hex(n: number): string {
  return Math.min(255, Math.max(0, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

export function suggestColors(r: Raster, m: Mask): { primary: string; glow: string } {
  const buckets = new Map<number, { score: number; n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < r.width * r.height; i++) {
    if (m.coverage[i]! < 0.9) continue;
    const red = r.data[i * 4]!;
    const green = r.data[i * 4 + 1]!;
    const blue = r.data[i * 4 + 2]!;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    const b = buckets.get(key) ?? { score: 0, n: 0, r: 0, g: 0, b: 0 };
    b.score += saturation + 0.1;
    b.n++;
    b.r += red;
    b.g += green;
    b.b += blue;
    buckets.set(key, b);
  }
  let top: { score: number; n: number; r: number; g: number; b: number } | undefined;
  for (const b of buckets.values()) if (!top || b.score > top.score) top = b;
  if (!top) return { primary: '#888888', glow: '#d3d3d3' };
  const pr = top.r / top.n;
  const pg = top.g / top.n;
  const pb = top.b / top.n;
  const mix = (c: number): number => c + (255 - c) * 0.65;
  return {
    primary: `#${hex(pr)}${hex(pg)}${hex(pb)}`,
    glow: `#${hex(mix(pr))}${hex(mix(pg))}${hex(mix(pb))}`,
  };
}
