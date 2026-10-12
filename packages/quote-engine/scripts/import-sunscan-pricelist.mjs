#!/usr/bin/env node
/**
 * Build the DEMO tenant's price list from SunScan v1's seed (read-only).
 *
 *   node packages/quote-engine/scripts/import-sunscan-pricelist.mjs [path/to/seed.ts]
 *
 * The seed (C:\Work\Arkalith\SunScan\sunscan\prisma\seed.ts) holds HSEnergy's
 * 2026 master price list as structured constants; it was itself keyed from
 * "Residential Sales Pricelists - Google Sheets.pdf" and is cross-checked
 * against it by packages/quote-engine/test/pricelist.test.ts. Panel dimensions
 * are the Prisma schema defaults the seed relies on (1134 x 1762 x 30 mm, which
 * is also what the PDF states).
 *
 * Writes fixtures/pricing/hsenergy-demo-pricelist.json. DEMO DATA: a real
 * installer's prices, used only for the demo tenant until each installer
 * uploads their own (WS7's catalogue), and labelled as such in the file.
 */
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const seedPath = process.argv[2] ?? 'C:\\Work\\Arkalith\\SunScan\\sunscan\\prisma\\seed.ts';
const source = readFileSync(seedPath, 'utf8');

/** Evaluate one `const NAME[: Type] = <literal>` from the seed as plain data. */
function constant(name) {
  const start = source.search(new RegExp(`\\nconst ${name}\\b[^=]*=\\s*`));
  if (start < 0) throw new Error(`seed has no const ${name}`);
  const open = source.indexOf('=', start) + 1;
  let i = open;
  while (/\s/.test(source[i])) i++;
  const opener = source[i];
  const closer = opener === '[' ? ']' : '}';
  let depth = 0;
  let j = i;
  for (; j < source.length; j++) {
    const c = source[j];
    if (c === "'" || c === '"') {
      const q = c;
      for (j++; source[j] !== q; j++) if (source[j] === '\\') j++;
      continue;
    }
    if (c === opener) depth++;
    if (c === closer && --depth === 0) break;
  }
  const literal = source.slice(i, j + 1).replace(/\s+as\s+[A-Za-z[\]]+/g, '');
  // A plain-data literal from a trusted local file, evaluated in an empty context.
  return runInNewContext(`(${literal})`, {}, { timeout: 1000 });
}

const PANEL_DIMENSIONS = { widthMm: 1134, heightMm: 1762, depthMm: 30 };

const catalogue = {
  version: 'hsenergy-2026-02-23',
  panels: constant('PANELS').map((p) => ({ ...PANEL_DIMENSIONS, ...p })),
  inverters: constant('INVERTERS'),
  pvBasePrice: constant('PV_BASE'),
  mounting: constant('MOUNTING'),
  batteries: constant('BATTERIES'),
  extras: constant('EXTRAS'),
  trenching: constant('TRENCHING'),
};

const out = {
  _demo:
    'DEMO DATA for the demo tenant only: HSEnergy Group Ltd residential sales price list ' +
    '(v 23rd Feb 2026), imported from SunScan v1 prisma/seed.ts. Not for any other installer.',
  source: {
    seed: seedPath,
    seedSha256: createHash('sha256').update(source).digest('hex').slice(0, 16),
    pdf: 'C:\\Work\\Arkalith\\SunScan\\Residential Sales Pricelists - Google Sheets.pdf',
    importedAt: '2026-10-12',
  },
  installer: 'HSEnergy Residential (demo)',
  currency: 'GBP',
  // The sheet states no VAT treatment, so none is assumed.
  vatRatePercent: null,
  priceStatus: 'indicative',
  catalogue,
  config: {
    budgetBands: constant('BUDGET_BANDS'),
    sentinel: constant('SENTINEL_CONFIG'),
    surveyOptions: constant('SURVEY_OPTIONS'),
    financeOptions: constant('FINANCE_OPTIONS'),
    warranty: constant('WARRANTY'),
  },
};

const file = resolve(repo, 'fixtures/pricing/hsenergy-demo-pricelist.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `wrote ${file}: ${catalogue.pvBasePrice.length} PV rows, ${catalogue.panels.length} panels, ` +
    `${catalogue.batteries.length} batteries, ${catalogue.extras.length} extras`,
);
