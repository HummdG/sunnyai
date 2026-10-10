import {
  PRODUCT_CATEGORIES,
  type CatalogueIssue,
  type Product,
  type ProductCategory,
} from '@sunny/contracts';

import type { CsvRow } from './csv.js';

/**
 * Turning a spreadsheet into products, and refusing to guess while doing it.
 *
 * The plan's rule for this file is "missing fields remain null, never inferred",
 * and the whole design follows from taking it seriously. A column that is absent
 * leaves a null. A column that is present but unreadable rejects the row rather
 * than importing it with the field left out, because "no price" and "a price we
 * could not read" are different facts and only one of them is safe to show a
 * visitor. A unit that is not stated is not assumed: a panel row with a bare
 * `405` and no column header saying what 405 is gets rejected, since guessing
 * watts there is the same act as inventing the number.
 *
 * What it will do is read the units an installer actually writes. `405 W`,
 * `0.405 kW`, `£3,450`, `10 years`, `yes` and a header called "Capacity (kWh)"
 * are all unambiguous statements, and a validator that rejects them is a
 * validator that makes work rather than removing it.
 *
 * Two currencies in one catalogue is an error, not a conversion. Choosing an
 * exchange rate would be inventing a number, and the row would then look as
 * solid as one the installer typed.
 */

/** Columns whose meaning this build knows. Anything else is reported, not used. */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  category: ['category', 'type', 'product type', 'product category', 'kind'],
  manufacturer: ['manufacturer', 'brand', 'make', 'supplier', 'manufacturer name'],
  model: [
    'model',
    'model number',
    'model no',
    'sku',
    'part number',
    'part no',
    'mpn',
    'product code',
    'product',
  ],
  power: [
    'power',
    'power w',
    'power wp',
    'power watts',
    'wattage',
    'watts',
    'rated power',
    'panel power',
  ],
  capacity: ['capacity', 'capacity wh', 'capacity kwh', 'battery capacity', 'storage'],
  price: [
    'price',
    'unit price',
    'trade price',
    'price inc vat',
    'price ex vat',
    'cost',
    'rrp',
    'price gbp',
  ],
  currency: ['currency', 'currency code', 'ccy'],
  warranty: ['warranty', 'warranty years', 'warranty yrs', 'guarantee', 'guarantee years'],
  sourceRef: [
    'source',
    'source url',
    'source ref',
    'datasheet',
    'datasheet url',
    'document url',
    'price list',
  ],
  sourceVersion: ['source version', 'version', 'revision', 'price list version'],
  documentRefs: ['documents', 'document refs', 'attachments', 'docs'],
  imageUrl: ['image', 'image url', 'photo', 'image link'],
  notes: ['notes', 'note', 'comments', 'description'],
  vocV: ['voc', 'voc v', 'voc volts', 'open circuit voltage'],
  iscA: ['isc', 'isc a', 'short circuit current'],
  maxDcPowerW: ['max dc power', 'max dc power w', 'max dc input', 'max pv power', 'dc input power'],
  maxStringVoltageV: [
    'max string voltage',
    'max string voltage v',
    'max dc voltage',
    'max input voltage',
  ],
  mpptCount: ['mppt', 'mppt count', 'mppts', 'mppt inputs'],
  phase: ['phase', 'supply phase'],
  hybrid: ['hybrid', 'hybrid inverter', 'battery ready'],
  batteryFamilies: [
    'battery families',
    'supported batteries',
    'battery compatibility',
    'compatible batteries',
  ],
  batteryFamily: ['battery family', 'family', 'battery type'],
  inverterModels: [
    'compatible inverters',
    'inverters',
    'inverter models',
    'inverter compatibility',
  ],
};

/** Which header a normalised column name means, or null when nothing does. */
const COLUMN_BY_ALIAS: ReadonlyMap<string, string> = new Map(
  Object.entries(COLUMN_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [normaliseColumn(alias), field] as const),
  ),
);

/**
 * Case, punctuation and spacing are noise in a header. "Max DC Power (W)",
 * "max dc power w" and "MAX_DC_POWER_W" are one column.
 */
function normaliseColumn(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CATEGORY_WORDS: Readonly<Record<string, ProductCategory>> = {
  panel: 'panel',
  panels: 'panel',
  'solar panel': 'panel',
  'solar panels': 'panel',
  pv: 'panel',
  'pv module': 'panel',
  module: 'panel',
  modules: 'panel',
  inverter: 'inverter',
  inverters: 'inverter',
  'hybrid inverter': 'inverter',
  battery: 'battery',
  batteries: 'battery',
  'battery storage': 'battery',
  storage: 'battery',
  'ev charger': 'ev_charger',
  'ev chargers': 'ev_charger',
  charger: 'ev_charger',
  wallbox: 'ev_charger',
  'charging point': 'ev_charger',
  mounting: 'mounting',
  mountings: 'mounting',
  rails: 'mounting',
  'mounting system': 'mounting',
  other: 'other',
};

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  '£': 'GBP',
  '€': 'EUR',
  $: 'USD',
};

export interface ImportOptions {
  tenantId: string;
  /** Injected so an import is a pure function of its inputs in tests. */
  now: string;
  /** Allocates a product id. Injected for the same reason. */
  nextId: () => string;
  /** What the tenant already holds, for duplicate detection across imports. */
  existing?: readonly Product[];
}

export interface ImportResult {
  products: Product[];
  issues: CatalogueIssue[];
  /** The catalogue's currency, or null when nothing priced came through. */
  currency: string | null;
  /** Columns that matched no field, reported once rather than per row. */
  ignoredColumns: string[];
}

interface RowRead {
  /**
   * The row, still missing the three fields that belong to the import rather
   * than to the row: the id, the tenant and the timestamp. Filling them in here
   * would mean either a mutable id factory shared across rows or three more
   * parameters through every branch below, and both are ways for two rows to
   * disagree about which import they came from.
   */
  draft: ProductDraft | null;
  issues: CatalogueIssue[];
}

type ProductDraft = Omit<Product, 'id' | 'tenantId' | 'createdAt'>;

function issue(
  code: CatalogueIssue['code'],
  severity: CatalogueIssue['severity'],
  message: string,
  rowNumber: number | null,
  column: string | null = null,
): CatalogueIssue {
  return { code, severity, message, rowNumber, column };
}

/**
 * A number with either convention for thousands and decimals.
 *
 * `1,234.56` and `1.234,56` both mean twelve hundred and thirty four point five
 * six, and telling them apart is what the digits after the separator decide: a
 * single group of exactly three digits after a comma, with no other comma, is a
 * thousands separator ("1,234"), while anything else is a decimal comma
 * ("12,5"). Getting this wrong turns a £1,234 inverter into a £1.23 one, so the
 * rule is narrow on purpose and an ambiguous value is rejected instead.
 */
function parseLocalisedNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  if (cleaned === '') return null;
  if (!/^-?[0-9.,]+$/.test(cleaned)) return null;

  const commas = (cleaned.match(/,/g) ?? []).length;
  const dots = (cleaned.match(/\./g) ?? []).length;
  if (commas > 0 && dots > 0) {
    // Whichever comes last is the decimal separator; the other groups thousands.
    const decimal = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    if (
      cleaned.split(thousands).length - 1 > 1 &&
      new RegExp(`\\${thousands}[0-9]{3}`).test(cleaned)
    ) {
      return null;
    }
    const normalised = cleaned.split(thousands).join('').replace(decimal, '.');
    const value = Number(normalised);
    return Number.isFinite(value) ? value : null;
  }
  if (commas === 1 || dots === 1) {
    const separator = commas === 1 ? ',' : '.';
    const [head, tail] = cleaned.split(separator) as [string, string];
    if (tail.length === 3 && head.length >= 1 && head.length <= 3 && !head.includes('-')) {
      return Number(`${head}${tail}`);
    }
    return Number(cleaned.replace(separator, '.'));
  }
  if (commas > 1 || dots > 1) {
    // Grouped thousands: every group after the first must be exactly three.
    const groups = cleaned.split(commas > 0 ? ',' : '.').slice(1);
    if (groups.some((group) => group.length !== 3)) return null;
    return Number(cleaned.replace(/[.,]/g, ''));
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

interface ScaledNumber {
  value: number | null;
  /** True when the cell was readable but the unit it was in was not clear. */
  unitMissing: boolean;
  /** The unit the cell stated, upper case, when it stated one. */
  unit: string | null;
  /** True when the cell held a number below zero, which no measurement can be. */
  negative?: boolean;
}

/**
 * A number and the unit written beside it, or after it.
 *
 * `unitHint` carries a unit stated in the *column header* -- "Capacity (kWh)" --
 * which is as explicit as a suffix and is how half of real exports express it.
 */
function parseMeasurement(
  raw: string,
  accepted: readonly string[],
  unitHint: string | null,
): ScaledNumber {
  const cleaned = raw.trim();
  if (cleaned === '') return { value: null, unitMissing: false, unit: null };

  const match = /^(-?[0-9.,]+)\s*([a-z%/]*)$/i.exec(cleaned.replace(/[£€$]/g, '').trim());
  if (!match) return { value: null, unitMissing: false, unit: null };

  const magnitude = parseLocalisedNumber(match[1]!);
  if (magnitude === null) return { value: null, unitMissing: false, unit: null };
  // A minus sign is a readable cell with an impossible value, not a garbled one:
  // telling an installer "−405 is not a wattage" hides the one character to fix.
  if (magnitude < 0) return { value: null, unitMissing: false, unit: null, negative: true };

  const written = match[2]!.toUpperCase();
  const unit = written !== '' ? written : unitHint;
  if (unit === null) return { value: magnitude, unitMissing: true, unit: null };
  const index = accepted.indexOf(unit);
  if (index === -1) return { value: null, unitMissing: false, unit: null };
  return { value: magnitude, unitMissing: false, unit };
}

/**
 * Watts, when the row says so.
 *
 * `accepted` is ordered smallest unit first, and the index is the power of ten
 * to multiply by: `['W', 'KW']` means a value in W is itself and a value in kW
 * is a thousand times bigger.
 */
function parsePower(raw: string, headerUnit: string | null): ScaledNumber {
  const parsed = parseMeasurement(raw, ['W', 'WP', 'KW', 'KWP'], headerUnit);
  if (parsed.unit === null) return parsed;
  const power = Math.round(parsed.value! * (parsed.unit.startsWith('K') ? 1000 : 1));
  return { value: power > 0 ? power : null, unitMissing: false, unit: parsed.unit };
}

function parseCapacity(raw: string, headerUnit: string | null): ScaledNumber {
  const parsed = parseMeasurement(raw, ['WH', 'KWH', 'MWH'], headerUnit);
  if (parsed.unit === null) return parsed;
  const scale = parsed.unit === 'MWH' ? 1_000_000 : parsed.unit === 'KWH' ? 1000 : 1;
  const capacity = Math.round(parsed.value! * scale);
  return { value: capacity > 0 ? capacity : null, unitMissing: false, unit: parsed.unit };
}

/**
 * A price in minor units, plus the currency the cell named when it named one.
 *
 * Rounding rather than truncating, and refusing more than two decimals of
 * precision: `£3,450.001` is a typo or a unit price, and quietly turning it into
 * £3,450.01 makes the catalogue disagree with the installer's own invoice.
 */
function parsePrice(raw: string): {
  minor: number | null;
  currency: string | null;
  bad: boolean;
  negative?: boolean;
} {
  const trimmed = raw.trim();
  if (trimmed === '') return { minor: null, currency: null, bad: false };

  let currency: string | null = null;
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (trimmed.includes(symbol)) currency = code;
  }
  const withoutSymbols = trimmed.replace(/[£€$]/g, '').trim();
  const codeMatch = /\b([A-Za-z]{3})\b/.exec(withoutSymbols);
  if (codeMatch && /^(gbp|eur|usd|aud|cad|nzd|chf|sek|nok|dkk|pln)$/i.test(codeMatch[1]!)) {
    currency = codeMatch[1]!.toUpperCase();
  }
  const numeric = withoutSymbols.replace(/[A-Za-z]/g, '').trim();

  const value = parseLocalisedNumber(numeric);
  if (value === null) return { minor: null, currency, bad: true };
  if (value < 0) return { minor: null, currency, bad: true, negative: true };

  // Precision is decided on the value rather than on the text, which keeps one
  // rounding rule for both conventions: a price with more than two decimals is
  // a unit price or a typo, and folding it into the nearest penny would make
  // this catalogue disagree with the installer's own invoice.
  const minor = Math.round(value * 100);
  if (Math.abs(value * 100 - minor) > 1e-6) return { minor: null, currency, bad: true };
  return { minor, currency, bad: false };
}

const YES = new Set(['yes', 'y', 'true', '1', 'x']);
const NO = new Set(['no', 'n', 'false', '0', '']);

function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (YES.has(value)) return true;
  if (NO.has(value)) return false;
  return null;
}

function parsePhase(raw: string): 1 | 3 | null {
  const value = raw.trim().toLowerCase();
  if (value === '') return null;
  if (/^(1|1p|single|single phase|mono)$/.test(value)) return 1;
  if (/^(3|3p|three|three phase|tri)$/.test(value)) return 3;
  return null;
}

/** Lists are separated by semicolons and pipes; a comma is part of a model name. */
function parseList(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** The digits in "10 years", "10 yr" or "10". */
function parseYears(raw: string): { value: number | null; bad: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, bad: false };
  const match = /^([0-9]+(?:\.[0-9]+)?)/.exec(trimmed);
  if (!match) return { value: null, bad: true };
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return { value: null, bad: true };
  return { value: Math.round(value), bad: false };
}

/** A model number is an identifier: something the installer could search for. */
function isModelIdentifier(model: string, manufacturer: string | null): boolean {
  const trimmed = model.trim();
  if (trimmed.length < 2) return false;
  if (!/[a-z0-9]/i.test(trimmed)) return false;
  if (manufacturer && normaliseColumn(trimmed) === normaliseColumn(manufacturer)) return false;
  return true;
}

/**
 * The unit a column header states, if it states one.
 *
 * Read from the header rather than assumed, so "Capacity (kWh)" and
 * "Capacity (Wh)" are told apart and neither is a guess.
 */
function headerUnit(header: string): string | null {
  const match = /\(([a-z%/]+)\)\s*$/i.exec(header.trim());
  if (match) return match[1]!.toUpperCase();
  const trailing = /\b(wh|kwh|mwh|wp?|kwp?)\b/i.exec(header.trim());
  return trailing ? trailing[1]!.toUpperCase() : null;
}

export function importProducts(rows: readonly CsvRow[], options: ImportOptions): ImportResult {
  const mapped = rows.map((row) => readRow(row, options.existing ?? []));
  return finish(mapped, options);
}

/**
 * The same import for structured records rather than a file.
 *
 * §7.4 asks for "CSV/structured records", and the two paths must not drift: a
 * record is turned into the same string-keyed shape a CSV row produces and then
 * read by the same code. A JSON upload therefore inherits every unit rule, every
 * rejection and every warning, rather than being a second, laxer door.
 */
export function importRecords(
  records: readonly Record<string, unknown>[],
  options: ImportOptions,
): ImportResult {
  const rows: CsvRow[] = records.map((record, index) => ({
    line: index + 1,
    values: Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, cellText(value)]),
    ),
  }));
  return importProducts(rows, options);
}

/**
 * One cell of a structured record, as the text the reader will see.
 *
 * A nested object or array is not a value this reader can read, and
 * `String({...})` would spend it as "[object Object]" -- a string nobody typed,
 * which the row would then be rejected for in terms that hide what arrived. Its
 * JSON text goes through instead, so the rejection quotes the cell the caller
 * actually sent.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

/**
 * Which field a header names, unit annotation and all.
 *
 * "Power (kW)" is the same column as "Power": the bracketed unit says what the
 * values are in, not what the column is called, and `headerUnit` reads it
 * separately. Stripping it here rather than listing every spelling in the
 * aliases is what keeps "Capacity (kWh)" and "Capacity (Wh)" as the one column
 * they are while still telling their units apart.
 */
function fieldForHeader(header: string): string | undefined {
  return (
    COLUMN_BY_ALIAS.get(normaliseColumn(header)) ??
    COLUMN_BY_ALIAS.get(normaliseColumn(header.replace(/\([^)]*\)/g, ' ')))
  );
}

function readRow(row: CsvRow, existing: readonly Product[]): RowRead {
  const issues: CatalogueIssue[] = [];
  const at = row.line;

  // Header -> field, first match wins, so two columns that mean the same thing
  // do not double-read one value into two fields.
  const fields: Record<string, { value: string; header: string }> = {};
  for (const [header, value] of Object.entries(row.values)) {
    const field = fieldForHeader(header);
    if (!field) {
      issues.push(
        issue(
          'unknown-column',
          'warning',
          `The column "${header}" is not one this build reads.`,
          null,
          header,
        ),
      );
      continue;
    }
    if (fields[field] === undefined) fields[field] = { value, header };
  }

  const read = (field: string): string => fields[field]?.value ?? '';
  const readHeader = (field: string): string | null => {
    const header = fields[field]?.header;
    return header === undefined ? null : headerUnit(header);
  };
  const given = (field: string): boolean => (fields[field]?.value ?? '').trim() !== '';

  const manufacturer = read('manufacturer').trim();
  const model = read('model').trim();

  if (manufacturer === '') {
    issues.push(
      issue('missing-manufacturer', 'error', 'The row has no manufacturer.', at, 'manufacturer'),
    );
  }
  if (model === '') {
    issues.push(issue('missing-model', 'error', 'The row has no model.', at, 'model'));
  } else if (!isModelIdentifier(model, manufacturer || null)) {
    issues.push(
      issue(
        'model-not-an-identifier',
        'error',
        `"${model}" is not a model number; it repeats the manufacturer or has no letters or digits.`,
        at,
        'model',
      ),
    );
  }

  const categoryRaw = read('category').trim().toLowerCase();
  const category = CATEGORY_WORDS[categoryRaw] ?? null;
  if (category === null) {
    issues.push(
      issue(
        'unknown-category',
        'error',
        categoryRaw === ''
          ? 'The row has no category.'
          : `"${read('category')}" is not a category this build knows: ${PRODUCT_CATEGORIES.join(', ')}.`,
        at,
        'category',
      ),
    );
  }

  // Numbers. Each is either absent, read, or wrong -- never silently dropped.
  let powerW: number | null = null;
  let capacityWh: number | null = null;
  if (given('power')) {
    const parsed = parsePower(read('power'), readHeader('power'));
    if (parsed.negative === true) {
      issues.push(
        issue('negative-value', 'error', `"${read('power')}" is below zero.`, at, 'power'),
      );
    } else if (parsed.unitMissing) {
      issues.push(
        issue(
          'missing-unit',
          'error',
          `"${read('power')}" has no unit; write it as 405 W or 0.405 kW.`,
          at,
          'power',
        ),
      );
    } else if (parsed.value === null) {
      issues.push(
        issue('unreadable-number', 'error', `"${read('power')}" is not a wattage.`, at, 'power'),
      );
    } else {
      powerW = parsed.value;
    }
  }
  if (given('capacity')) {
    const parsed = parseCapacity(read('capacity'), readHeader('capacity'));
    if (parsed.negative === true) {
      issues.push(
        issue('negative-value', 'error', `"${read('capacity')}" is below zero.`, at, 'capacity'),
      );
    } else if (parsed.unitMissing) {
      issues.push(
        issue(
          'missing-unit',
          'error',
          `"${read('capacity')}" has no unit; write it as 13.5 kWh or 13500 Wh.`,
          at,
          'capacity',
        ),
      );
    } else if (parsed.value === null) {
      issues.push(
        issue(
          'unreadable-number',
          'error',
          `"${read('capacity')}" is not a capacity.`,
          at,
          'capacity',
        ),
      );
    } else {
      capacityWh = parsed.value;
    }
  }

  // A panel is its wattage and a battery is its capacity: a row of either kind
  // without the figure its rules read is a row that could only be shown with a
  // blank where a specification belongs.
  if (category === 'panel' && powerW === null) {
    issues.push(
      issue(
        'missing-unit',
        'error',
        'A panel needs its wattage to be placed in a system.',
        at,
        'power',
      ),
    );
  }
  if (category === 'battery' && capacityWh === null) {
    issues.push(
      issue(
        'missing-unit',
        'error',
        'A battery needs its capacity to be placed in a system.',
        at,
        'capacity',
      ),
    );
  }

  const currencyRaw = read('currency').trim();
  let currency: string | null = null;
  if (currencyRaw !== '') {
    currency = /^[A-Za-z]{3}$/.test(currencyRaw) ? currencyRaw.toUpperCase() : null;
    if (currency === null) {
      issues.push(
        issue(
          'currency-not-iso-4217',
          'error',
          `"${currencyRaw}" is not a three-letter currency code.`,
          at,
          'currency',
        ),
      );
    }
  }

  let priceMinor: number | null = null;
  if (given('price')) {
    const parsed = parsePrice(read('price'));
    if (parsed.negative === true) {
      issues.push(
        issue('negative-value', 'error', `"${read('price')}" is below zero.`, at, 'price'),
      );
    } else if (parsed.bad) {
      issues.push(
        issue('unreadable-number', 'error', `"${read('price')}" is not a price.`, at, 'price'),
      );
    } else if (parsed.minor === null) {
      issues.push(
        issue('unreadable-number', 'error', `"${read('price')}" is not a price.`, at, 'price'),
      );
    } else {
      priceMinor = parsed.minor;
      // The cell's own currency annotation is a statement about *this* row, so
      // it beats a column value that says something else.
      if (parsed.currency !== null) currency = parsed.currency;
    }
  }
  if (priceMinor !== null && currency === null) {
    issues.push(
      issue(
        'price-without-currency',
        'error',
        'A price needs a currency; add a currency column.',
        at,
        'currency',
      ),
    );
  }

  const warrantyRaw = read('warranty');
  const warranty = warrantyRaw === '' ? { value: null, bad: false } : parseYears(warrantyRaw);
  if (warranty.bad) {
    issues.push(
      issue(
        'unreadable-number',
        'error',
        `"${warrantyRaw}" is not a number of years.`,
        at,
        'warranty',
      ),
    );
  }
  if (warranty.value === null && !warranty.bad) {
    issues.push(
      issue('no-warranty', 'warning', 'No warranty is recorded for this product.', at, 'warranty'),
    );
  }

  const sourceRef = read('sourceRef').trim() || null;
  const sourceVersion = read('sourceVersion').trim() || null;
  if (priceMinor !== null && sourceRef === null && sourceVersion === null) {
    issues.push(
      issue(
        'no-provenance',
        'warning',
        'The price has no source, so it will be shown as indicative rather than verified.',
        at,
        'sourceRef',
      ),
    );
  }
  if (priceMinor === null) {
    issues.push(
      issue(
        'no-price',
        'warning',
        'No price is recorded, so this product cannot be costed.',
        at,
        'price',
      ),
    );
  }

  const hybridRaw = read('hybrid');
  const hybrid = hybridRaw.trim() === '' ? null : parseBoolean(hybridRaw);
  if (hybridRaw.trim() !== '' && hybrid === null) {
    issues.push(
      issue('unreadable-number', 'error', `"${hybridRaw}" is not a yes or no.`, at, 'hybrid'),
    );
  }

  const phaseRaw = read('phase');
  const phase = phaseRaw.trim() === '' ? null : parsePhase(phaseRaw);
  if (phaseRaw.trim() !== '' && phase === null) {
    issues.push(
      issue(
        'unreadable-number',
        'error',
        `"${phaseRaw}" is not a phase; use 1, 3, single or three.`,
        at,
        'phase',
      ),
    );
  }

  if (
    category === 'battery' &&
    read('batteryFamily').trim() === '' &&
    parseList(read('inverterModels')) === null
  ) {
    issues.push(
      issue(
        'battery-pairing-unknown',
        'warning',
        'No inverter pairing is recorded, so this battery cannot be shown as compatible with a particular inverter.',
        at,
        'batteryFamily',
      ),
    );
  }

  const errors = issues.some((entry) => entry.severity === 'error');
  if (errors || category === null || manufacturer === '' || model === '') {
    return { draft: null, issues };
  }

  const duplicate = existing.find(
    (product) =>
      product.category === category &&
      normaliseColumn(product.manufacturer) === normaliseColumn(manufacturer) &&
      normaliseColumn(product.model) === normaliseColumn(model),
  );
  if (duplicate) {
    return {
      draft: null,
      issues: [
        ...issues,
        issue(
          'duplicate-in-catalogue',
          'error',
          `"${manufacturer} ${model}" is already in the catalogue as ${duplicate.id}.`,
          at,
          'model',
        ),
      ],
    };
  }

  return {
    draft: {
      category,
      manufacturer,
      model,
      powerW,
      capacityWh,
      priceMinor,
      currency,
      priceStatus:
        priceMinor === null ? 'unknown' : sourceRef || sourceVersion ? 'verified' : 'indicative',
      warrantyYears: warranty.value,
      compatibility: {
        vocV: numberOrNull(read('vocV')),
        iscA: numberOrNull(read('iscA')),
        maxDcPowerW: intOrNull(read('maxDcPowerW')),
        maxStringVoltageV: intOrNull(read('maxStringVoltageV')),
        mpptCount: intOrNull(read('mpptCount')),
        phase,
        hybrid,
        batteryFamilies: parseList(read('batteryFamilies')),
        batteryFamily: read('batteryFamily').trim() || null,
        inverterModels: parseList(read('inverterModels')),
      },
      sourceRef,
      sourceVersion,
      documentRefs: parseList(read('documentRefs')) ?? [],
      imageUrl: read('imageUrl').trim() || null,
      notes: read('notes').trim() || null,
      rowNumber: at,
    },
    issues,
  };
}

function finish(reads: readonly RowRead[], options: ImportOptions): ImportResult {
  const issues: CatalogueIssue[] = [];
  const products: Product[] = [];
  const seen = new Map<string, number>();
  let currency: string | null = null;

  for (const read of reads) {
    issues.push(...read.issues);
    if (!read.draft) continue;

    const key = `${read.draft.category}:${normaliseColumn(read.draft.manufacturer)}:${normaliseColumn(read.draft.model)}`;
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      issues.push(
        issue(
          'duplicate-in-file',
          'error',
          `"${read.draft.manufacturer} ${read.draft.model}" is already on line ${firstLine} of this file.`,
          read.draft.rowNumber,
          'model',
        ),
      );
      continue;
    }
    seen.set(key, read.draft.rowNumber ?? 0);

    if (read.draft.currency !== null) {
      if (currency === null) currency = read.draft.currency;
      else if (currency !== read.draft.currency) {
        issues.push(
          issue(
            'mixed-currency',
            'error',
            `This row is priced in ${read.draft.currency} and the file is in ${currency}. Converting would mean inventing an exchange rate, so it has not been imported.`,
            read.draft.rowNumber,
            'currency',
          ),
        );
        continue;
      }
    }

    products.push({
      ...read.draft,
      id: options.nextId(),
      tenantId: options.tenantId,
      createdAt: options.now,
    });
  }

  const ignoredColumns = [
    ...new Set(
      issues.filter((entry) => entry.code === 'unknown-column').map((entry) => entry.column ?? ''),
    ),
  ].filter((column) => column !== '');

  return {
    products,
    // The per-row unknown-column warnings are summarised once at the top of the
    // report; repeating them for every row buries the errors that matter.
    issues: issues.filter((entry) => entry.code !== 'unknown-column'),
    currency,
    ignoredColumns,
  };
}

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = parseLocalisedNumber(trimmed.replace(/[a-z]/gi, ''));
  return value !== null && value > 0 ? value : null;
}

function intOrNull(raw: string): number | null {
  const value = numberOrNull(raw);
  return value === null ? null : Math.round(value);
}

export { normaliseColumn };
