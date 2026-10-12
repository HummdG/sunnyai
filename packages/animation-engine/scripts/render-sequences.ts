// Rasterise sequences as frame strips, for reviewing the acting by eye.
// Output: packages/animation-engine/out/sequences.png (gitignored).
//
//   npx tsx packages/animation-engine/scripts/render-sequences.ts [id ...]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

import { defaultRig, renderSunny } from '@sunny/character';

import { SEQUENCES } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');
mkdirSync(outDir, { recursive: true });

const requested = process.argv.slice(2);
const list = requested.length > 0 ? SEQUENCES.filter((s) => requested.includes(s.id)) : SEQUENCES;
const frames = 10;
const cell = 150;
const label = 150;

const rows = list
  .map((seq, row) => {
    const y = row * cell;
    const cells = Array.from({ length: frames }, (_, k) => {
      const t = seq.duration <= 1 ? 0 : k / (frames - 1);
      const svg = renderSunny(seq.pose(defaultRig(), t), { size: cell })
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>$/, '');
      return `<g transform="translate(${label + k * cell} ${y}) scale(${cell / 200})">${svg}</g>`;
    }).join('');
    return `<text x="8" y="${y + cell / 2}" font-size="15" font-family="sans-serif">${seq.id}</text>${cells}`;
  })
  .join('');

const width = label + frames * cell;
const height = list.length * cell;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#FFF8F0"/>${rows}</svg>`;
const file = join(outDir, 'sequences.png');
writeFileSync(file, new Resvg(sheet, { fitTo: { mode: 'original' } }).render().asPng());
console.log(file);
