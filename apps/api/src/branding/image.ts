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

/** Ring indices of the box (x0, y0)..(x1, y1), exclusive of x1 and y1, each once. */
function ring(w: number, box: Box): number[] {
  const out: number[] = [];
  const { x0, y0 } = box;
  const x1 = box.x1 - 1;
  const y1 = box.y1 - 1;
  for (let x = x0; x <= x1; x++) {
    out.push(y0 * w + x);
    if (y1 > y0) out.push(y1 * w + x);
  }
  for (let y = y0 + 1; y < y1; y++) {
    out.push(y * w + x0);
    if (x1 > x0) out.push(y * w + x1);
  }
  return out;
}

/**
 * A flat colour across at least 90 % of the opaque pixels of `pixels`, or null.
 * `key(i)` is then pixel i's keying ramp: 0 within 12 of that colour, 1 past 48.
 */
function flatKey(data: Uint8Array, pixels: number[]): ((i: number) => number) | null {
  const solid = pixels.filter((p) => data[p * 4 + 3]! >= 200);
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
  return (i) => Math.min(1, Math.max(0, (dist(i) - 12) / (48 - 12)));
}

export function extractMask(r: Raster): Mask | null {
  const { width: w, height: h, data } = r;
  const border = ring(w, { x0: 0, y0: 0, x1: w, y1: h });
  const enough = (c: Float32Array): boolean => {
    let covered = 0;
    for (let i = 0; i < c.length; i++) if (c[i]! > 0.5) covered++;
    return covered >= w * h * 0.005;
  };

  const coverage = new Float32Array(w * h);
  const clear = border.filter((p) => data[p * 4 + 3]! < 128).length;
  if (clear < border.length * 0.5) {
    const key = flatKey(data, border);
    if (!key) return null;
    for (let i = 0; i < w * h; i++) coverage[i] = key(i) * (data[i * 4 + 3]! / 255);
    return enough(coverage) ? { width: w, height: h, coverage, mode: 'background' } : null;
  }

  for (let i = 0; i < w * h; i++) coverage[i] = data[i * 4 + 3]! / 255;
  // A tile inside a transparent margin (an app icon exported with padding): the
  // opaque box's own edge is one flat colour, so key that out too, or every
  // effect would trace the square instead of the mark on it.
  const box = boundingBox(w, h, (i) => data[i * 4 + 3]! >= 200);
  if (box) {
    const edge = ring(w, box);
    const opaque = edge.filter((p) => data[p * 4 + 3]! >= 200).length;
    // Mostly opaque, so a tile and not a round or ragged mark that only touches its box.
    const key = opaque >= edge.length * 0.5 ? flatKey(data, edge) : null;
    if (key) {
      const keyed = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) keyed[i] = coverage[i]! * key(i);
      // Keying away everything means the flat shape was the mark itself.
      if (enough(keyed)) return { width: w, height: h, coverage: keyed, mode: 'background' };
    }
  }
  return enough(coverage) ? { width: w, height: h, coverage, mode: 'alpha' } : null;
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
  // The logo's own colour is a poor highlight: motion drawn in it vanishes on
  // the logo, and a dark or pale logo gives a muddy glow. The highlight keeps
  // the logo's hue but is vivid and mid-light, so it reads on the mark and on
  // white or dark pages alike; the glow is a pale tint of it. A grey or black
  // logo has no hue to keep, so it stays neutral.
  const [h, sat, light] = toHsl(top.r / top.n, top.g / top.n, top.b / top.n);
  const neutral = sat < 0.12 || light < 0.04;
  const s = neutral ? 0 : Math.max(sat, 0.78);
  const l = Math.min(Math.max(light, 0.55), 0.62);
  return {
    primary: fromHsl(h, s, neutral ? 0.5 : l),
    glow: fromHsl(h, neutral ? 0 : 1, 0.87),
  };
}

/** RGB 0..255 to hue (degrees), saturation and lightness (0..1). */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${hex((r + m) * 255)}${hex((g + m) * 255)}${hex((b + m) * 255)}`;
}

/**
 * Which chip the logo sits on so it stands out: a dark chip for a pale logo
 * (mostly white or very light), a light one for everything else. Measured as
 * the alpha-weighted mean luminance of the visible pixels.
 */
export function plateFor(r: Raster): 'light' | 'dark' {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < r.width * r.height; i++) {
    const a = r.data[i * 4 + 3]! / 255;
    if (a < 0.5) continue;
    const lum =
      (0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255;
    sum += lum * a;
    weight += a;
  }
  return weight > 0 && sum / weight > 0.72 ? 'dark' : 'light';
}
