// Rasterise sample poses to PNG so the rig can be compared against the reference
// artwork (sunny.png) and reviewed by eye. Output goes to packages/character/out/
// which is gitignored.
//
//   npm run render -w @sunny/character

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

import { cloneRig, defaultRig, renderSunny, themeByName, type SunnyRig } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');
mkdirSync(outDir, { recursive: true });

/**
 * The reference artwork's framing, in viewBox units: it is 1254 px square and
 * its body radius measures 366.8 px, so it spans +/- 78.63 units about the body
 * centre. Cropping our render identically makes the two directly comparable,
 * and matters for the measurement loop: a tighter crop clips our ray tips.
 */
const FRAME = 1254 / 2 / (366.8 / 46);
const TIGHT = { x: 100 - FRAME, y: 100 - FRAME, width: FRAME * 2, height: FRAME * 2 };

function writePng(
  name: string,
  rig: SunnyRig,
  crop: typeof TIGHT | undefined,
  size: number,
  background = '#FFFFFF',
): void {
  const svg = renderSunny(rig, { size, crop, title: name });
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background,
  })
    .render()
    .asPng();
  writeFileSync(join(outDir, `${name}.png`), png);
  writeFileSync(join(outDir, `${name}.svg`), svg);
  console.log(`${name}.png  ${Math.round(png.length / 1024)} KiB`);
}

// 1. The canonical pose, tightly cropped to match the reference framing.
writePng('default-tight', defaultRig(), TIGHT, 1254);

// 1b. The same, on the reference's black background, so
// scripts/measure-reference.py can be run against our own output and the two
// measurements diffed directly. This is how the rig is tuned, not by eye.
writePng('measure', defaultRig(), TIGHT, 1254, '#000000');

// 2. The canonical pose in the full viewBox (what the widget actually ships).
writePng('default-full', defaultRig(), undefined, 400);

// 3. A pose sheet exercising the rig's expressive range.
const poses: Array<[string, (r: SunnyRig) => void]> = [
  [
    'blink',
    (r) => {
      r.eyes.left.closed = 1;
      r.eyes.right.closed = 1;
    },
  ],
  [
    'look-right',
    (r) => {
      r.eyes.left.gaze = { x: 1, y: 0 };
      r.eyes.right.gaze = { x: 1, y: 0 };
      r.faceTilt = 6;
    },
  ],
  [
    'surprised',
    (r) => {
      r.brows.left.y -= 6;
      r.brows.right.y -= 6;
      r.brows.left.arch += 2;
      r.brows.right.arch += 2;
      r.eyes.left.scaleY = 1.18;
      r.eyes.right.scaleY = 1.18;
      r.smile.span = 18;
      r.smile.depth = 5.5;
      r.squash = -0.06;
    },
  ],
  [
    'sad',
    (r) => {
      r.brows.left.rotation = 8;
      r.brows.right.rotation = 22;
      r.brows.left.y = -20;
      r.brows.right.y = -22;
      r.smile.depth = -4.5;
      r.smile.rotation = -4;
      r.faceTilt = 4;
    },
  ],
  [
    'spinning',
    (r) => {
      for (const ray of r.rays) ray.rotation = 22;
      r.rotation = -6;
    },
  ],
  [
    'squash',
    (r) => {
      r.squash = 0.18;
      r.stretch = 0.14;
      r.eyes.left.closed = 0.4;
      r.eyes.right.closed = 0.4;
    },
  ],
];

for (const [name, mutate] of poses) {
  const rig = cloneRig(defaultRig());
  mutate(rig);
  writePng(`pose-${name}`, rig, TIGHT, 400);
}

// 4. Theme variants, to check the character stays legible on tenant colours.
for (const preset of ['orange', 'purple', 'green', 'blue']) {
  const rig = defaultRig();
  rig.theme = themeByName(preset);
  writePng(`theme-${preset}`, rig, TIGHT, 320);
}

console.log(`\nWrote ${outDir}`);
