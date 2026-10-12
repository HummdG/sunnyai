import type { CatalogueIssue, Product } from '@sunny/contracts';
import { importRecords } from '@sunny/solar-rules';

import { newId } from '../store.js';
import type { CatalogueDraftItem } from './types.js';

/**
 * Finding products on an installer's own website.
 *
 * The input is the Markdown the knowledge pipeline already made of each
 * crawled page (tables kept as Markdown tables). Two passes:
 *
 *   1. **Deterministic** -- product tables (one row per product) and spec
 *      tables (one product described as `field | value` rows) are turned into
 *      records and read by the *same* importer an uploaded CSV goes through, so
 *      a website row is held to every unit, currency and duplicate rule a
 *      spreadsheet is. Nothing is guessed: a row the importer rejects is not a
 *      draft.
 *   2. **Gemini** (optional, when a key is configured) for pages that look like
 *      product pages but have no readable table. The model is asked for fields
 *      as they are written, `null` when absent, and its answer is fed through
 *      the same importer.
 *
 * Every draft records where each field was read, and any price found on a
 * page is `indicative` until the installer approves it: a figure on a
 * marketing page is not a price list.
 */

export type DraftCandidate = Omit<
  CatalogueDraftItem,
  'id' | 'status' | 'createdAt' | 'updatesProductId'
>;

export interface PageInput {
  url: string;
  /** The page's Markdown (from the knowledge pipeline). */
  markdown: string;
  /** The crawl's version for the page, recorded as the source version. */
  version?: string | null;
}

export interface ExtractResult {
  candidates: DraftCandidate[];
  /** Rows that looked like products but failed validation, for the report. */
  skipped: number;
  issues: CatalogueIssue[];
}

/** Brands commonly carried by UK installers, used only to split "Brand Model" cells. */
const KNOWN_MANUFACTURERS = [
  'Aiko',
  'Canadian Solar',
  'DMEGC',
  'Duracell',
  'Enphase',
  'Fox ESS',
  'FoxESS',
  'GivEnergy',
  'Growatt',
  'Hypontech',
  'Huawei',
  'JA Solar',
  'Jinko',
  'JinkoSolar',
  'LONGi',
  'Lux Power',
  'myenergi',
  'Ohme',
  'Pod Point',
  'Puredrive',
  'REC',
  'SigEnergy',
  'Sigenergy',
  'SolarEdge',
  'SolaX',
  'Solis',
  'Sunsynk',
  'Tesla',
  'Trina',
  'Trina Solar',
  'Victron',
  'Zappi',
];

const CATEGORY_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\b(batter(y|ies)|powerwall|storage)\b/i, 'battery'],
  [/\b(inverters?|hybrid)\b/i, 'inverter'],
  [/\b(ev|car)\s*charg(er|ers|ing)\b|\bwallbox\b|\bzappi\b/i, 'EV charger'],
  [/\b(solar\s+)?(panels?|modules?|pv)\b/i, 'panel'],
];

/** Table header names (normalised) the importer reads as a product's model. */
const MODEL_HEADERS =
  /^(model|model number|model no|sku|part number|part no|product|product code|mpn)$/;
const SPEC_KEYS =
  /^(category|type|manufacturer|brand|make|model|model number|sku|power|rated power|wattage|output|capacity|usable capacity|battery capacity|price|cost|warranty|guarantee|phase|hybrid|currency)$/;

interface Table {
  heading: string | null;
  headers: string[];
  rows: string[][];
  index: number;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

export function markdownTables(markdown: string): Table[] {
  const lines = markdown.split(/\r?\n/);
  const tables: Table[] = [];
  let heading: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1]!.trim();
      continue;
    }
    if (!line.trim().startsWith('|')) continue;
    const sep = lines[i + 1] ?? '';
    if (!/^\s*\|?\s*:?-{2,}/.test(sep)) continue;
    const headers = cells(line);
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && lines[j]!.trim().startsWith('|')) {
      rows.push(cells(lines[j]!));
      j++;
    }
    tables.push({ heading, headers, rows, index: tables.length });
    i = j - 1;
  }
  return tables;
}

/** The first "£1,234.56"-style amount in a cell, without the words around it. */
function cleanPrice(cell: string): string {
  const m = /([£€$])\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/.exec(cell);
  if (m) return `${m[1]}${m[2]!.replace(/,/g, '')}`;
  const code = /\b(GBP|EUR|USD)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(cell);
  return code ? `${code[2]!.replace(/,/g, '')} ${code[1]!.toUpperCase()}` : cell;
}

/** The first "5 kW" / "13.5kWh" / "450 W" measurement in a cell. */
function cleanMeasure(cell: string): string {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(kWh|Wh|kWp|kW|Wp|W)\b/i.exec(cell);
  return m ? `${m[1]} ${m[2]}` : cell;
}

function categoryFrom(...texts: Array<string | null | undefined>): string | null {
  const text = texts.filter(Boolean).join(' ');
  for (const [pattern, category] of CATEGORY_WORDS) if (pattern.test(text)) return category;
  return null;
}

function splitManufacturer(cell: string): { manufacturer: string; model: string } | null {
  const sorted = [...KNOWN_MANUFACTURERS].sort((a, b) => b.length - a.length);
  for (const brand of sorted) {
    if (cell.toLowerCase().startsWith(`${brand.toLowerCase()} `)) {
      return { manufacturer: brand, model: cell.slice(brand.length).trim() };
    }
  }
  return null;
}

/**
 * The importer's column for a header a website wrote freely ("Usable
 * capacity", "Rated output", "Brand"). Unrecognised headers keep their own
 * name and the importer ignores them.
 */
function canonicalHeader(key: string): string {
  const k = norm(key);
  if (/^(manufacturer|brand|make)$/.test(k)) return 'Manufacturer';
  if (/^(model|model number|model no|sku|part number|product|product code|mpn)$/.test(k)) {
    return 'Model';
  }
  if (/^(category|type|product type)$/.test(k)) return 'Category';
  if (/capacity|storage/.test(k)) return 'Capacity';
  if (/power|wattage|output/.test(k)) return 'Power';
  if (/price|cost|rrp/.test(k)) return 'Price';
  if (/warranty|guarantee/.test(k)) return 'Warranty';
  if (/^(currency)$/.test(k)) return 'Currency';
  if (/^(phase|supply phase)$/.test(k)) return 'Phase';
  if (/^hybrid/.test(k)) return 'Hybrid';
  return key;
}

function cleanRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const column = canonicalHeader(key);
    // The first column of a kind wins, as in a spreadsheet import.
    if (column in out) continue;
    if (column === 'Price') out[column] = cleanPrice(value);
    else if (column === 'Power' || column === 'Capacity') out[column] = cleanMeasure(value);
    else out[column] = value.replace(/\*\*/g, '').trim();
  }
  return out;
}

/** Turn product tables and spec tables into importer records. */
function tableRecords(table: Table, pageTitle: string): Array<Record<string, string>> {
  const headers = table.headers.map(norm);
  const records: Array<Record<string, string>> = [];

  // A spec table: two columns, field names down the left.
  if (table.headers.length === 2) {
    const rows = [table.headers, ...table.rows];
    const keyed = rows.filter((r) => SPEC_KEYS.test(norm(r[0] ?? '')));
    if (keyed.length >= 3 && keyed.some((r) => /model|sku/.test(norm(r[0] ?? '')))) {
      const record: Record<string, string> = {};
      for (const r of keyed) record[r[0]!] = r[1] ?? '';
      records.push(record);
      return records;
    }
  }

  // A product table: a model column and one row per product.
  if (!headers.some((h) => MODEL_HEADERS.test(h))) return records;
  for (const row of table.rows) {
    const record: Record<string, string> = {};
    table.headers.forEach((header, i) => {
      record[header] = row[i] ?? '';
    });
    records.push(record);
  }
  void pageTitle;
  return records;
}

/** Fill category and manufacturer from the page's own words where the table leaves them out. */
function complete(
  record: Record<string, string>,
  table: Table,
  pageTitle: string,
): Record<string, string> | null {
  const keys = Object.keys(record).map(norm);
  const value = (pattern: RegExp) =>
    Object.entries(record).find(([k]) => pattern.test(norm(k)))?.[1] ?? '';
  const out = { ...record };

  if (!keys.some((k) => /^(manufacturer|brand|make)$/.test(k))) {
    const modelKey = Object.keys(record).find(
      (k) => MODEL_HEADERS.test(norm(k)) || /model/.test(norm(k)),
    );
    const split = modelKey ? splitManufacturer(record[modelKey] ?? '') : null;
    const fromHeading = KNOWN_MANUFACTURERS.find((b) =>
      new RegExp(`\\b${b.replace(/\s+/g, '\\s+')}\\b`, 'i').test(table.heading ?? ''),
    );
    if (split && modelKey) {
      out['Manufacturer'] = split.manufacturer;
      out[modelKey] = split.model;
    } else if (fromHeading) {
      out['Manufacturer'] = fromHeading;
    } else {
      return null;
    }
  }
  if (!keys.some((k) => /^(category|type)$/.test(k))) {
    const category = categoryFrom(value(/model|product/), table.heading, pageTitle);
    if (!category) return null;
    out['Category'] = category;
  }
  return out;
}

function fieldsFound(product: Product): string[] {
  const fields: string[] = ['category', 'manufacturer', 'model'];
  for (const f of ['powerW', 'capacityWh', 'priceMinor', 'currency', 'warrantyYears'] as const) {
    if (product[f] !== null) fields.push(f);
  }
  for (const [k, v] of Object.entries(product.compatibility)) if (v !== null) fields.push(k);
  return fields;
}

function finishCandidates(
  records: Array<{ record: Record<string, string>; anchor: string }>,
  page: PageInput,
  tenantId: string,
  now: string,
  extractor: DraftCandidate['extractor'],
): ExtractResult {
  if (records.length === 0) return { candidates: [], skipped: 0, issues: [] };
  const imported = importRecords(
    records.map((r) => r.record),
    { tenantId, now, nextId: () => newId('prd') },
  );
  const candidates = imported.products.map((product) => {
    const anchor = records[(product.rowNumber ?? 1) - 1]?.anchor ?? page.url;
    const draft: Product = {
      ...product,
      // A price on a marketing page is not a price list: indicative until approved.
      priceStatus: product.priceMinor === null ? 'unknown' : 'indicative',
      sourceRef: page.url,
      sourceVersion: page.version ?? null,
      rowNumber: null,
    };
    return {
      origin: 'website' as const,
      sourceUrl: page.url,
      fieldSources: Object.fromEntries(fieldsFound(draft).map((f) => [f, anchor])),
      extractor,
      product: draft,
      // The page is the source, so the importer's "no source" warning does not apply.
      issues: imported.issues.filter(
        (i) =>
          i.rowNumber === product.rowNumber &&
          i.severity === 'warning' &&
          i.code !== 'no-provenance',
      ),
    };
  });
  return {
    candidates,
    skipped: Math.max(0, records.length - imported.products.length),
    issues: imported.issues.filter((i) => i.severity === 'error'),
  };
}

/** Deterministic extraction from one page's tables. */
export function extractFromPage(
  page: PageInput,
  tenantId: string,
  now: string,
  pageTitle = '',
): ExtractResult {
  const records: Array<{ record: Record<string, string>; anchor: string }> = [];
  let incomplete = 0;
  for (const table of markdownTables(page.markdown)) {
    for (const raw of tableRecords(table, pageTitle)) {
      const completed = complete(cleanRecord(raw), table, pageTitle);
      if (!completed) {
        incomplete += 1;
        continue;
      }
      records.push({ record: completed, anchor: `${page.url}#table-${table.index + 1}` });
    }
  }
  const result = finishCandidates(records, page, tenantId, now, 'deterministic');
  return { ...result, skipped: result.skipped + incomplete };
}

/** Whether a page reads like a product page: model numbers beside ratings or prices. */
export function looksLikeProductPage(markdown: string): boolean {
  const ratings = (markdown.match(/\b[0-9]+(?:\.[0-9]+)?\s*(kWh|kWp|kW|Wp|W)\b/gi) ?? []).length;
  const prices = (markdown.match(/[£€$]\s?[0-9][0-9,]*/g) ?? []).length;
  const models = (markdown.match(/\b[A-Z]{2,}[-‐]?[A-Z0-9]*[0-9][A-Z0-9.-]*\b/g) ?? []).length;
  return models >= 1 && ratings + prices >= 2;
}

// ─── optional Gemini pass ────────────────────────────────────────────────────

export interface GeminiExtractor {
  extract(page: PageInput): Promise<Array<Record<string, string | null>>>;
}

const GEMINI_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', nullable: true },
      manufacturer: { type: 'STRING', nullable: true },
      model: { type: 'STRING', nullable: true },
      power: { type: 'STRING', nullable: true },
      capacity: { type: 'STRING', nullable: true },
      price: { type: 'STRING', nullable: true },
      currency: { type: 'STRING', nullable: true },
      warranty: { type: 'STRING', nullable: true },
    },
    required: ['category', 'manufacturer', 'model'],
  },
} as const;

const GEMINI_INSTRUCTION = [
  'Extract the solar products this installer sells from the page below.',
  'Copy each value exactly as written on the page, including its unit (e.g. "450 W", "13.5 kWh", "£7,995").',
  'If a value is not written on the page, return null. Never infer, estimate or complete a value.',
  'Only include products with a model name or number written on the page.',
  'category is one of: panel, inverter, battery, EV charger, mounting, other.',
].join('\n');

export function geminiExtractor(options: {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
}): GeminiExtractor {
  const model = options.model ?? 'gemini-3.8-flash';
  const doFetch = options.fetch ?? fetch;
  return {
    async extract(page) {
      const response = await doFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: GEMINI_INSTRUCTION }] },
            contents: [
              {
                role: 'user',
                parts: [
                  { text: `<page url="${page.url}">\n${page.markdown.slice(0, 30_000)}\n</page>` },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: GEMINI_SCHEMA,
            },
          }),
        },
      );
      if (!response.ok) throw new Error(`Gemini extraction failed: HTTP ${response.status}`);
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed)
        ? (parsed.filter((r) => typeof r === 'object' && r !== null) as Array<
            Record<string, string | null>
          >)
        : [];
    },
  };
}

/** Gemini's records, held to the same importer as everything else. */
export async function extractWithGemini(
  page: PageInput,
  extractor: GeminiExtractor,
  tenantId: string,
  now: string,
): Promise<ExtractResult> {
  const rows = await extractor.extract(page);
  const records = rows.map((row) => ({
    record: cleanRecord(
      Object.fromEntries(
        Object.entries(row)
          .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
          .map(([k, v]) => [k, v as string]),
      ),
    ),
    anchor: page.url,
  }));
  return finishCandidates(records, page, tenantId, now, 'gemini');
}
