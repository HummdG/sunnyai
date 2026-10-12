// Rasterise every pose in the limb library to one contact sheet, for checking
// against reference_poses.png. Output goes to packages/character/out/ (gitignored).
//
//   npx tsx packages/character/scripts/render-poses.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

import { defaultRig, LIMB_POSES, limbPose, renderSunny, type LimbPoseName } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');
mkdirSync(outDir, { recursive: true });

const names = Object.keys(LIMB_POSES) as LimbPoseName[];
const cell = 260;
const cols = 4;
const rows = Math.ceil(names.length / cols);
const cells = names
  .map((name, i) => {
    const rig = defaultRig();
    rig.limbs = limbPose(name);
    if (name === 'jump') rig.y -= 14;
    const svg = renderSunny(rig, { size: cell })
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>$/, '');
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;
    return (
      `<g transform="translate(${x} ${y}) scale(${cell / 200})">${svg}</g>` +
      `<text x="${x + 10}" y="${y + 20}" font-size="16" font-family="sans-serif">${name}</text>`
    );
  })
  .join('');
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}"><rect width="100%" height="100%" fill="#fff"/>${cells}</svg>`;
const file = join(outDir, 'poses.png');
writeFileSync(file, new Resvg(sheet, { fitTo: { mode: 'original' } }).render().asPng());
console.log(file);
