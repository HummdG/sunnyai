// Seeded procedural material textures (CanvasTexture, sRGB). Deterministic so screenshots are stable; exported
// as PNG inside GLB files (our own artwork — no imagery licence involved).
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

export type TextureKind = 'brick' | 'tile' | 'slate' | 'render' | 'pebbledash' | 'stone' | 'timber' | 'grass' | 'felt';

const SIZE = 256;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [160, 160, 160];
}

const shade = ([r, g, b]: [number, number, number], f: number, warm = 0) =>
  `rgb(${Math.max(0, Math.min(255, Math.round(r * f + warm)))},${Math.max(0, Math.min(255, Math.round(g * f)))},${Math.max(0, Math.min(255, Math.round(b * f - warm / 2)))})`;

function speckle(g: CanvasRenderingContext2D, rand: () => number, base: [number, number, number], count: number, amp: number, size = 2) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = shade(base, 1 + (rand() - 0.5) * amp);
    g.fillRect(rand() * SIZE, rand() * SIZE, size, size);
  }
}

type Draw = (g: CanvasRenderingContext2D, base: [number, number, number], rand: () => number) => void;

const DRAW: Record<TextureKind, Draw> = {
  // 0.9 m x 0.6 m: 4 bricks (225 mm) x 8 courses (75 mm), stretcher bond, light mortar
  brick: (g, base, rand) => {
    g.fillStyle = '#cbc3b4'; g.fillRect(0, 0, SIZE, SIZE);
    const ch = SIZE / 8, bw = SIZE / 4;
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let k = -1; k < 5; k++) {
        const x = k * bw + off;
        g.fillStyle = shade(base, 0.82 + rand() * 0.3, (rand() - 0.5) * 18);
        g.fillRect(x + 1.5, row * ch + 2, bw - 3, ch - 4);
      }
    }
    speckle(g, rand, base, 900, 0.35, 1.5);
  },
  // 1.2 m x 1.2 m: 4 courses (0.3 m) of 0.3 m tiles, lap shadow on the down-slope edge (canvas bottom = down)
  tile: (g, base, rand) => {
    const ch = SIZE / 4, tw = SIZE / 4;
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? tw / 2 : 0;
      for (let k = -1; k < 5; k++) {
        g.fillStyle = shade(base, 0.86 + rand() * 0.22);
        g.fillRect(k * tw + off, row * ch, tw - 1, ch);
      }
      g.fillStyle = 'rgba(20,12,8,0.42)'; g.fillRect(0, row * ch + ch - 6, SIZE, 6);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, row * ch, SIZE, 3);
    }
    speckle(g, rand, base, 500, 0.3);
  },
  // 1.0 m x 1.0 m: 5 courses of 0.25 m wide slates
  slate: (g, base, rand) => {
    g.fillStyle = shade(base, 0.55); g.fillRect(0, 0, SIZE, SIZE);
    const ch = SIZE / 5, sw = SIZE / 4;
    for (let row = 0; row < 5; row++) {
      const off = row % 2 ? sw / 2 : 0;
      for (let k = -1; k < 5; k++) {
        g.fillStyle = shade(base, 0.88 + rand() * 0.2);
        g.fillRect(k * sw + off + 1, row * ch, sw - 2, ch - 3);
      }
    }
    speckle(g, rand, base, 400, 0.18);
  },
  render: (g, base, rand) => { g.fillStyle = shade(base, 1); g.fillRect(0, 0, SIZE, SIZE); speckle(g, rand, base, 2600, 0.06, 3); },
  pebbledash: (g, base, rand) => { g.fillStyle = shade(base, 1); g.fillRect(0, 0, SIZE, SIZE); speckle(g, rand, base, 9000, 0.32, 2); },
  // 1.6 m x 1.2 m coursed stone
  stone: (g, base, rand) => {
    g.fillStyle = shade(base, 0.7); g.fillRect(0, 0, SIZE, SIZE);
    let y = 0;
    while (y < SIZE) {
      const h = 24 + Math.floor(rand() * 20);
      let x = -Math.floor(rand() * 40);
      while (x < SIZE) {
        const w = 40 + Math.floor(rand() * 60);
        g.fillStyle = shade(base, 0.85 + rand() * 0.28, (rand() - 0.5) * 12);
        g.fillRect(x + 2, y + 2, w - 4, Math.min(h, SIZE - y) - 4);
        x += w;
      }
      y += h;
    }
    speckle(g, rand, base, 700, 0.2);
  },
  // 1.0 m x 1.2 m: 8 horizontal boards
  timber: (g, base, rand) => {
    const bh = SIZE / 8;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = shade(base, 0.85 + rand() * 0.25); g.fillRect(0, i * bh, SIZE, bh);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, i * bh + bh - 3, SIZE, 3);
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(40,25,10,0.12)'; g.fillRect(rand() * SIZE, rand() * SIZE, 30 + rand() * 60, 1); }
  },
  grass: (g, base, rand) => { g.fillStyle = shade(base, 1); g.fillRect(0, 0, SIZE, SIZE); speckle(g, rand, base, 5000, 0.28, 2); },
  felt: (g, base, rand) => { g.fillStyle = shade(base, 1); g.fillRect(0, 0, SIZE, SIZE); speckle(g, rand, base, 3000, 0.12, 2); },
};

/** Builds a repeat-wrapped sRGB canvas texture of the given kind in the given base colour. */
export function makeTexture(kind: TextureKind, baseHex: string, seed = 7): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  DRAW[kind](g, hexToRgb(baseHex), rng(seed + kind.length * 101));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace; // colour textures must be tagged sRGB
  tex.wrapS = tex.wrapT = RepeatWrapping; // tiling lives in the UVs (no KHR_texture_transform in exports)
  tex.anisotropy = 4;
  tex.name = `${kind}-${baseHex.replace('#', '')}`;
  return tex;
}
