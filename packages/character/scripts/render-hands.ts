// Rasterise the traced hands and shoes for review.
//   npx tsx packages/character/scripts/render-hands.ts → packages/character/out/hands.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

import { TRACED_HANDS } from '../src/traced-hands.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');
mkdirSync(outDir, { recursive: true });

const names = Object.keys(TRACED_HANDS) as (keyof typeof TRACED_HANDS)[];
const cell = 220;
const cells = names
  .map((name, i) => {
    const art = TRACED_HANDS[name];
    const x = i * cell + (name === 'shoe' ? 30 : cell / 2);
    const y = name === 'shoe' ? cell / 2 : cell * 0.78;
    return (
      `<g transform="translate(${x} ${y}) scale(6)">` +
      `<path d="${art.ink}" fill="#171717"/><path d="${art.fill}" fill="#FF7900"/>` +
      `<circle r="0.6" fill="red"/></g>` +
      `<text x="${i * cell + 8}" y="18" font-size="14" font-family="sans-serif">${name}</text>`
    );
  })
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${names.length * cell}" height="${cell}"><rect width="100%" height="100%" fill="#fff"/>${cells}</svg>`;
const file = join(outDir, 'hands.png');
writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
console.log(file);
