/**
 * Renders scene pieces to a PNG for review, outside the browser:
 *
 *   npx tsx --tsconfig apps/marketing/scripts/tsconfig.render.json  *     apps/marketing/scripts/render-scenes.tsx <out.png> <sheet>
 *
 * Sheets: `homes` (the three house types) and `concepts` (the newest scenes).
 * Server-renders the React SVG with the page's print patterns, then rasterises
 * it with resvg, so art can be judged large without starting the site.
 */
import { writeFileSync } from 'node:fs';

import { Resvg } from '@resvg/resvg-js';
import { renderToStaticMarkup } from 'react-dom/server';

import { SceneDefs } from '../components/scenes/kit.js';
import { Detached, SemiDetached, Terrace } from '../components/scenes/homes.js';

const [out = 'scenes.png', sheet = 'homes'] = process.argv.slice(2);

function homes(): React.JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={1500} height={420} viewBox="0 0 1500 420">
      <SceneDefs />
      <rect width={1500} height={420} fill="#FFFDF7" />
      <SemiDetached x={30} y={360} panels={4} />
      <Terrace x={330} y={360} count={4} panels={3} />
      <Detached x={1250 - 220 + 200} y={360} s={1} panels={5} />
    </svg>
  );
}

const sheets: Record<string, () => React.JSX.Element> = { homes };
const markup = renderToStaticMarkup(sheets[sheet]!());
// The defs live in a nested <svg> on the page; inline them at the top level here.
const svg = markup
  .replace(
    '<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">',
    '<g>',
  )
  .replace('</defs></svg>', '</defs></g>');
writeFileSync(out, new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
process.stdout.write(`wrote ${out}
`);
