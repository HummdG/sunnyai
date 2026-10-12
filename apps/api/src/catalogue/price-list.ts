import { parseCsv } from '@sunny/solar-rules';
import { z } from 'zod';

import { toCsv } from './csv.js';

/**
 * The installer's **price list**: everything a quote is priced from that is
 * not a single product with a single price.
 *
 * A UK installer's price sheet (e.g. HSEnergy's "Residential Sales Pricelists
 * 2026 Master") prices a job by rules, not just by SKU: a PV base price looked
 * up by panel count, a percentage uplift for a premium panel, a per-panel
 * mounting surcharge, flat scaffold and electrical extras, a mandatory admin
 * fee, a battery that costs one price fitted with solar and another as a
 * retrofit, expansion units with a maximum, a discount per additional unit,
 * tiered bird mesh ("£600 up to 20 panels, £30 per panel onwards") and
 * distance-banded trenching with a "bespoke" band. This module holds those
 * rules as data, validated, versioned and published the same way the product
 * catalogue is -- and nothing here is guessed: a blank price is `null`, and a
 * band marked bespoke is a band the quote must refer to a person.
 *
 * The quote engine (WS8) reads the **published** list through
 * `getPublishedPriceList` and evaluates an item with `priceFor`. Every amount
 * is integer minor units (pence) in the list's single currency.
 */

export const PRICE_ITEM_CATEGORIES = [
  /** The PV system's base price, usually a table by panel count. */
  'pv',
  /** A premium panel's uplift on the base (percent, per panel, or flat). */
  'panel_uplift',
  /** Roof/ground mounting surcharges, usually per panel. */
  'mounting',
  /** Additional inverters (hybrid, string, AC charger). */
  'inverter',
  /** Batteries: with-solar vs retrofit price, expansion, multi-unit discount. */
  'battery',
  /** Scaffolding extras: extra side, extra storey, obstacles, restricted access. */
  'scaffold',
  /** General & electrical: sub-board, cable runs, structural survey. */
  'electrical',
  /** Optional extras: optimisers, bird mesh, EPS, micro-inverters, EV chargers. */
  'optional',
  /** Cable trenching, by ground type and distance band. */
  'trenching',
  /** Administration fee. */
  'admin',
  'other',
] as const;
export type PriceItemCategory = (typeof PRICE_ITEM_CATEGORIES)[number];

export const PRICE_UNITS = [
  'panel',
  'metre',
  'roof',
  'unit',
  'side',
  'storey',
  'kwh',
  'job',
] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

const minor = z.number().int().nonnegative();

/** One quantity row of a lookup table (PV base price by panel count). */
export const tableRowSchema = z.object({
  quantity: z.number().int().positive(),
  amountMinor: minor,
  /** Informational: the system size the row corresponds to, as written. */
  label: z.string().max(80).nullable().default(null),
});

/**
 * One band of a tiered price. For a quantity `q` in `[from, to]`:
 *   price = flatMinor + perUnitMinor × (counts === 'all' ? q : q − (from − 1))
 * A `bespoke` band has no price: the quote must hand the job to a person.
 */
export const tierSchema = z.object({
  from: z.number().nonnegative(),
  to: z.number().nonnegative().nullable(),
  flatMinor: minor.default(0),
  perUnitMinor: minor.default(0),
  counts: z.enum(['all', 'above']).default('all'),
  bespoke: z.boolean().default(false),
  /** The installer's SKU for this band (e.g. `TRENCH-SOFT-0-49`), when bands are priced separately. */
  sku: z.string().max(80).nullable().default(null),
});

export const pricingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flat'), amountMinor: minor }),
  z.object({
    kind: z.literal('per_unit'),
    unit: z.enum(PRICE_UNITS),
    amountMinor: minor,
    /** A fixed part added once (e.g. "£250 flat + £150 per panel"). */
    flatMinor: minor.default(0),
  }),
  z.object({
    kind: z.literal('percent_uplift'),
    /** What the percentage applies to; for panel uplifts, the PV base price. */
    of: z.enum(['pv']).default('pv'),
    percent: z.number().min(0).max(1000),
  }),
  z.object({
    kind: z.literal('table'),
    basis: z.enum(['panel_count']),
    rows: z.array(tableRowSchema).min(1),
  }),
  z.object({
    kind: z.literal('tiered'),
    unit: z.enum(PRICE_UNITS),
    tiers: z.array(tierSchema).min(1),
  }),
  z.object({
    kind: z.literal('install_context'),
    /** Price when fitted with a new solar system. */
    withSolarMinor: minor.nullable(),
    /** Price when retrofitted to an existing system. */
    retrofitMinor: minor.nullable(),
  }),
  z.object({ kind: z.literal('quote_only') }),
]);
export type Pricing = z.infer<typeof pricingSchema>;

export const priceItemSchema = z.object({
  /**
   * The installer's SKU or a stable slug, e.g. `ELEC-ADMIN-FEE`, `PV-BASE`.
   * Kept exactly as written: it is how a quote line maps back to the price
   * sheet, and how the quote engine finds the item.
   */
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  category: z.enum(PRICE_ITEM_CATEGORIES),
  name: z.string().min(1).max(200),
  manufacturer: z.string().max(120).nullable().default(null),
  model: z.string().max(120).nullable().default(null),
  pricing: pricingSchema,
  /** Always on a quote (the admin fee). */
  mandatory: z.boolean().default(false),
  /**
   * `verified` when the amount is the price sheet's figure as written;
   * `indicative` when it is not on the sheet (e.g. an inverter the installer
   * includes at no extra cost in another system's notes).
   */
  priceStatus: z.enum(['verified', 'indicative']).default('verified'),
  /** Items in the same group are alternatives: a quote picks at most one (Tigo part/full, EPS). */
  exclusiveGroup: z.string().max(80).nullable().default(null),
  /** Expansion units (batteries): price per extra unit, what each adds, the cap. */
  expansion: z
    .object({
      /** The expansion unit's own SKU, e.g. `FOX-ECS2900`. */
      sku: z.string().max(80).nullable().default(null),
      perUnitMinor: minor,
      capacityWh: z.number().int().positive().nullable().default(null),
      maxUnits: z.number().int().positive().nullable().default(null),
    })
    .nullable()
    .default(null),
  /** A discount per additional unit of the same item (e.g. −£200 per additional EVO). */
  additionalUnitDiscountMinor: minor.nullable().default(null),
  /** Rating facts as written (battery capacity, charger power), for matching. */
  capacityWh: z.number().int().positive().nullable().default(null),
  powerW: z.number().int().positive().nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
  /** 1-based CSV line(s) the item came from. */
  rows: z.array(z.number().int().positive()).default([]),
});
export type PriceItem = z.infer<typeof priceItemSchema>;

const percent = z.number().min(0).max(100);

/**
 * The installer's "Sentinel" optimisation uplift (SunScan v1's
 * `sentinelConfigJson`): an indicative boost to annual savings from smarter
 * charging, use and export, shown beside each option. Percentages as an
 * installer writes them (12 = 12%). Absent, or `enabled: false`, means quotes
 * carry no uplift at all.
 */
export const sentinelSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Base uplift on annual savings. */
  basePercent: percent,
  /** Extra uplift by tariff type (standard, economy7, smart_tou, ...). */
  tariffPercent: z.record(z.string().min(1).max(40), percent).default({}),
  /** Extra uplift per lifestyle tag (ev_now, heatpump_now, high_daytime, ...). */
  lifestylePercent: z.record(z.string().min(1).max(40), percent).default({}),
  /** Whether the full uplift needs a battery. */
  batteryRequiredForFullUplift: z.boolean(),
  /** Share of the uplift kept without a battery (40 = 40%). */
  noBatteryPercent: percent,
  /** Ceiling on the combined uplift. */
  capPercent: percent,
  /** One-off cost of adding the optimisation layer, in minor units. */
  addedCostMinor: minor,
});
export type SentinelSettings = z.infer<typeof sentinelSettingsSchema>;

export const priceListSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** VAT as a percentage (0, 5, 20). Null when the installer has not said. */
  vatRatePercent: z.number().min(0).max(100).nullable(),
  /** Whether the amounts in the list include VAT. Null when not stated. */
  pricesIncludeVat: z.boolean().nullable(),
  /** Where the list came from (file name, sheet link) and its revision. */
  sourceRef: z.string().max(500).nullable(),
  sourceVersion: z.string().max(120).nullable(),
  items: z.array(priceItemSchema),
  /** The budget bands a visitor can pick from, in minor units. */
  budgetBands: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().min(1).max(80),
        minMinor: minor,
        maxMinor: minor.nullable(),
      }),
    )
    .default([]),
  /** The optional optimisation uplift; null when the installer does not offer it. */
  sentinel: sentinelSettingsSchema.nullable().default(null),
});
export type PriceList = z.infer<typeof priceListSchema>;

export interface PriceListIssue {
  severity: 'error' | 'warning';
  message: string;
  rowNumber: number | null;
  key: string | null;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/**
 * The price-list CSV: one row per price, rows sharing a `Key` form one item
 * (a table's quantity rows, a tiered price's bands). `Pricing` says which
 * columns are read:
 *
 *   flat         Amount
 *   per_unit     Amount (per Unit), optional Flat fee
 *   percent      Percent (of the PV base price)
 *   table        From (= panel count), Amount; one row per count
 *   tier         From, To, Amount (= flat part), Per unit, Counts (all|above),
 *                or "bespoke" in Amount; one row per band
 *   with_solar   Price with solar, Price retrofit
 *   quote_only   nothing (always referred to a person)
 *   vat          Percent (the VAT rate) and "Prices include VAT" (yes/no)
 *
 * Rows with Category `sentinel` configure the optional optimisation uplift
 * rather than pricing anything. `Key` names the setting:
 *
 *   base                Percent: base uplift on annual savings
 *   tariff:<type>       Percent: extra uplift for a tariff (smart_tou, economy7, ...)
 *   lifestyle:<tag>     Percent: extra uplift for a lifestyle (ev_now, heatpump_now, ...)
 *   battery_required    Mandatory yes/no: whether the full uplift needs a battery
 *   no_battery          Percent: share of the uplift kept without a battery
 *   cap                 Percent: ceiling on the combined uplift
 *   cost                Amount: one-off cost of adding it
 *   enabled             Mandatory yes/no (default yes once any sentinel row exists)
 */
export const PRICE_LIST_COLUMNS = [
  'Category',
  'Key',
  'Name',
  'Manufacturer',
  'Model',
  'Pricing',
  'Amount',
  'Unit',
  'Flat fee',
  'Per unit',
  'Counts',
  'Percent',
  'From',
  'To',
  'Price with solar',
  'Price retrofit',
  'Expansion price',
  'Expansion capacity (kWh)',
  'Max units',
  'Additional unit discount',
  'Capacity (kWh)',
  'Power (kW)',
  'Mandatory',
  'Price status',
  'Exclusive group',
  'Expansion SKU',
  'Band SKU',
  'Prices include VAT',
  'Currency',
  'Notes',
] as const;

function normaliseHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\([^)]*\)/g, (m) => m)
    .replace(/[^a-z0-9()]+/g, ' ')
    .trim();
}

const HEADER_INDEX = new Map(PRICE_LIST_COLUMNS.map((c) => [normaliseHeader(c), c]));

/** "£3,985", "3985.00", "-£200" → pence; "" → null; anything else → NaN. */
export function parseMoney(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const m = /^-?\s*[£€$]?\s*-?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/.exec(
    text.replace(/[A-Z]{3}$/i, '').trim(),
  );
  if (!m) return Number.NaN;
  return Math.round(Number(m[1]!.replace(/,/g, '')) * 100);
}

function currencyOf(raw: string): string | null {
  if (raw.includes('£')) return 'GBP';
  if (raw.includes('€')) return 'EUR';
  if (raw.includes('$')) return 'USD';
  return null;
}

function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/%$/, '').replace(/,/g, '');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

function yesNo(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'mandatory'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return v === '' ? null : null;
}

const PRICING_WORDS: Record<string, string> = {
  flat: 'flat',
  fixed: 'flat',
  per_unit: 'per_unit',
  'per unit': 'per_unit',
  per: 'per_unit',
  percent: 'percent',
  percentage: 'percent',
  uplift: 'percent',
  table: 'table',
  tier: 'tier',
  tiered: 'tier',
  band: 'tier',
  with_solar: 'with_solar',
  'with solar': 'with_solar',
  install_context: 'with_solar',
  quote_only: 'quote_only',
  'quote only': 'quote_only',
  bespoke: 'quote_only',
  vat: 'vat',
};

interface Row {
  line: number;
  get: (column: (typeof PRICE_LIST_COLUMNS)[number]) => string;
}

export interface PriceListImport {
  list: PriceList | null;
  issues: PriceListIssue[];
  itemCount: number;
}

/** Read a price-list CSV into a validated `PriceList`, with every problem reported by row. */
export function importPriceList(
  csv: string,
  options: { sourceRef?: string | null; sourceVersion?: string | null } = {},
): PriceListImport {
  const parsed = parseCsv(csv);
  const issues: PriceListIssue[] = parsed.issues.map((i) => ({
    severity: i.severity,
    message: i.message,
    rowNumber: i.rowNumber,
    key: null,
  }));
  if (parsed.issues.some((i) => i.severity === 'error')) {
    return { list: null, issues, itemCount: 0 };
  }

  const rows: Row[] = parsed.rows.map((row) => {
    const byColumn = new Map<string, string>();
    for (const [header, value] of Object.entries(row.values)) {
      const column = HEADER_INDEX.get(normaliseHeader(header));
      if (column && !byColumn.has(column)) byColumn.set(column, value);
    }
    return { line: row.line, get: (c) => (byColumn.get(c) ?? '').trim() };
  });

  const error = (row: Row | null, key: string | null, message: string) =>
    issues.push({ severity: 'error', message, rowNumber: row?.line ?? null, key });
  const warn = (row: Row | null, key: string | null, message: string) =>
    issues.push({ severity: 'warning', message, rowNumber: row?.line ?? null, key });

  let currency: string | null = null;
  let vatRatePercent: number | null = null;
  let pricesIncludeVat: boolean | null = null;
  const groups = new Map<string, Row[]>();
  const order: string[] = [];
  const budgetBands: Array<{
    id: string;
    label: string;
    minMinor: number;
    maxMinor: number | null;
  }> = [];

  const money = (
    row: Row,
    key: string,
    column: (typeof PRICE_LIST_COLUMNS)[number],
  ): number | null => {
    const raw = row.get(column);
    const value = parseMoney(raw);
    if (Number.isNaN(value)) {
      error(row, key, `"${raw}" in ${column} is not an amount.`);
      return null;
    }
    const seen =
      currencyOf(raw) ?? (row.get('Currency') ? row.get('Currency').toUpperCase() : null);
    if (seen) {
      if (currency === null) currency = seen;
      else if (seen !== currency)
        error(row, key, `This row is in ${seen} and the list is in ${currency}.`);
    }
    return value;
  };

  let sentinel: SentinelSettings | null = null;
  const sentinelRow = (row: Row) => {
    const s: SentinelSettings = (sentinel ??= {
      enabled: true,
      basePercent: 0,
      tariffPercent: {},
      lifestylePercent: {},
      batteryRequiredForFullUplift: false,
      noBatteryPercent: 100,
      capPercent: 100,
      addedCostMinor: 0,
    });
    const key = row.get('Key').toLowerCase();
    const pct = (): number | null => {
      const value = parseNumber(row.get('Percent'));
      if (value === null || Number.isNaN(value) || value < 0 || value > 100) {
        error(row, `sentinel:${key}`, `Sentinel "${key}" needs a Percent between 0 and 100.`);
        return null;
      }
      return value;
    };
    const flag = (): boolean | null => {
      const value = yesNo(row.get('Mandatory'));
      if (value === null) error(row, `sentinel:${key}`, `Sentinel "${key}" needs yes or no.`);
      return value;
    };
    const named = /^(tariff|lifestyle):([a-z0-9_]+)$/.exec(key);
    if (named) {
      const value = pct();
      if (value !== null) {
        if (named[1] === 'tariff') s.tariffPercent[named[2]!] = value;
        else s.lifestylePercent[named[2]!] = value;
      }
      return;
    }
    switch (key) {
      case 'base': {
        const value = pct();
        if (value !== null) s.basePercent = value;
        return;
      }
      case 'no_battery': {
        const value = pct();
        if (value !== null) s.noBatteryPercent = value;
        return;
      }
      case 'cap': {
        const value = pct();
        if (value !== null) s.capPercent = value;
        return;
      }
      case 'cost': {
        const value = money(row, 'sentinel:cost', 'Amount');
        if (value !== null) s.addedCostMinor = value;
        return;
      }
      case 'battery_required': {
        const value = flag();
        if (value !== null) s.batteryRequiredForFullUplift = value;
        return;
      }
      case 'enabled': {
        const value = flag();
        if (value !== null) s.enabled = value;
        return;
      }
      default:
        error(row, `sentinel:${key}`, `"${row.get('Key')}" is not a Sentinel setting.`);
    }
  };

  for (const row of rows) {
    if (row.get('Category').toLowerCase() === 'sentinel') {
      sentinelRow(row);
      continue;
    }
    const pricingWord = PRICING_WORDS[row.get('Pricing').toLowerCase()] ?? null;
    if (pricingWord === 'vat' || row.get('Category').toLowerCase() === 'vat') {
      const rate = parseNumber(row.get('Percent'));
      if (rate === null)
        warn(row, 'vat', 'The VAT row has no rate; quotes will say VAT is to be confirmed.');
      else if (Number.isNaN(rate) || rate < 0 || rate > 100)
        error(row, 'vat', `"${row.get('Percent')}" is not a VAT rate.`);
      else vatRatePercent = rate;
      pricesIncludeVat = yesNo(row.get('Prices include VAT'));
      continue;
    }
    if (
      row
        .get('Category')
        .toLowerCase()
        .replace(/[\s-]+/g, '_') === 'budget_band'
    ) {
      const lo = parseMoney(row.get('From'));
      const hi = parseMoney(row.get('To'));
      const id = row.get('Key');
      if (
        !id ||
        !row.get('Name') ||
        lo === null ||
        Number.isNaN(lo) ||
        (hi !== null && Number.isNaN(hi))
      ) {
        error(
          row,
          id || null,
          'A budget band needs a Key, a Name and From (and optionally To) amounts.',
        );
      } else {
        budgetBands.push({ id, label: row.get('Name'), minMinor: lo, maxMinor: hi });
      }
      continue;
    }
    const key = row.get('Key');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) {
      error(
        row,
        null,
        key === ''
          ? 'The row has no Key.'
          : `"${row.get('Key')}" is not a usable Key (letters, digits, - . _).`,
      );
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  const items: PriceItem[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    const first = group[0]!;
    const category = first
      .get('Category')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (!(PRICE_ITEM_CATEGORIES as readonly string[]).includes(category)) {
      error(
        first,
        key,
        `"${first.get('Category')}" is not a price-list category: ${PRICE_ITEM_CATEGORIES.join(', ')}.`,
      );
      continue;
    }
    const name = first.get('Name');
    if (name === '') {
      error(first, key, 'The item has no Name.');
      continue;
    }
    const kind = PRICING_WORDS[first.get('Pricing').toLowerCase()] ?? null;
    if (!kind) {
      error(
        first,
        key,
        `"${first.get('Pricing')}" is not a pricing type (flat, per_unit, percent, table, tier, with_solar, quote_only).`,
      );
      continue;
    }
    if (group.some((r) => (PRICING_WORDS[r.get('Pricing').toLowerCase()] ?? kind) !== kind)) {
      error(first, key, `Rows with Key "${key}" mix pricing types.`);
      continue;
    }
    if (
      (kind === 'flat' ||
        kind === 'per_unit' ||
        kind === 'percent' ||
        kind === 'with_solar' ||
        kind === 'quote_only') &&
      group.length > 1
    ) {
      error(
        group[1]!,
        key,
        `Key "${key}" appears more than once; each ${kind} price needs its own Key.`,
      );
      continue;
    }

    const unitRaw = first
      .get('Unit')
      .toLowerCase()
      .replace(/^per\s+/, '')
      .replace(/s$/, '');
    const unit = (PRICE_UNITS as readonly string[]).includes(unitRaw)
      ? (unitRaw as PriceUnit)
      : null;

    let pricing: Pricing | null = null;
    const before = issues.filter((i) => i.severity === 'error').length;
    switch (kind) {
      case 'flat': {
        const amount = money(first, key, 'Amount');
        if (amount === null) error(first, key, 'A flat price needs an Amount.');
        else pricing = { kind: 'flat', amountMinor: amount };
        break;
      }
      case 'per_unit': {
        const amount = money(first, key, 'Amount') ?? money(first, key, 'Per unit');
        if (amount === null) error(first, key, 'A per-unit price needs an Amount.');
        if (!unit) error(first, key, `A per-unit price needs a Unit (${PRICE_UNITS.join(', ')}).`);
        if (amount !== null && unit) {
          pricing = {
            kind: 'per_unit',
            unit,
            amountMinor: amount,
            flatMinor: money(first, key, 'Flat fee') ?? 0,
          };
        }
        break;
      }
      case 'percent': {
        const percent = parseNumber(first.get('Percent'));
        if (percent === null || Number.isNaN(percent))
          error(first, key, 'A percentage uplift needs a Percent.');
        else pricing = { kind: 'percent_uplift', of: 'pv', percent };
        break;
      }
      case 'table': {
        const tableRows: Array<z.infer<typeof tableRowSchema>> = [];
        for (const row of group) {
          const quantity = parseNumber(row.get('From'));
          const amount = money(row, key, 'Amount');
          if (
            quantity === null ||
            Number.isNaN(quantity) ||
            !Number.isInteger(quantity) ||
            quantity < 1
          ) {
            error(row, key, 'A table row needs a whole-number quantity in From (the panel count).');
            continue;
          }
          if (amount === null) {
            error(row, key, `The table row for ${quantity} has no Amount.`);
            continue;
          }
          if (tableRows.some((t) => t.quantity === quantity)) {
            error(row, key, `The table already has a row for ${quantity}.`);
            continue;
          }
          tableRows.push({ quantity, amountMinor: amount, label: row.get('Notes') || null });
        }
        tableRows.sort((a, b) => a.quantity - b.quantity);
        if (tableRows.length > 0)
          pricing = { kind: 'table', basis: 'panel_count', rows: tableRows };
        break;
      }
      case 'tier': {
        if (!unit) error(first, key, `A tiered price needs a Unit (${PRICE_UNITS.join(', ')}).`);
        const tiers: Array<z.infer<typeof tierSchema>> = [];
        for (const row of group) {
          const from = parseNumber(row.get('From'));
          const to = parseNumber(row.get('To'));
          if (from === null || Number.isNaN(from)) {
            error(row, key, 'A band needs a From.');
            continue;
          }
          if (to !== null && (Number.isNaN(to) || to < from)) {
            error(row, key, `"${row.get('To')}" is not a valid To for this band.`);
            continue;
          }
          const bespoke = /bespoke|poa|quote/i.test(row.get('Amount'));
          const flat = bespoke
            ? 0
            : (money(row, key, 'Amount') ?? money(row, key, 'Flat fee') ?? 0);
          const perUnit = bespoke ? 0 : (money(row, key, 'Per unit') ?? 0);
          const counts = row.get('Counts').toLowerCase() === 'above' ? 'above' : 'all';
          tiers.push({
            from,
            to,
            flatMinor: flat,
            perUnitMinor: perUnit,
            counts,
            bespoke,
            sku: row.get('Band SKU') || null,
          });
        }
        tiers.sort((a, b) => a.from - b.from);
        for (let i = 1; i < tiers.length; i++) {
          const prev = tiers[i - 1]!;
          if (prev.to === null || tiers[i]!.from <= prev.to) {
            error(group[i] ?? first, key, `The bands of "${key}" overlap.`);
          }
        }
        if (unit && tiers.length > 0) pricing = { kind: 'tiered', unit, tiers };
        break;
      }
      case 'with_solar': {
        const withSolar = money(first, key, 'Price with solar');
        const retrofit = money(first, key, 'Price retrofit');
        if (withSolar === null && retrofit === null) {
          error(first, key, 'A battery price needs Price with solar or Price retrofit.');
        } else {
          pricing = { kind: 'install_context', withSolarMinor: withSolar, retrofitMinor: retrofit };
        }
        break;
      }
      case 'quote_only':
        pricing = { kind: 'quote_only' };
        break;
    }
    if (!pricing || issues.filter((i) => i.severity === 'error').length > before) continue;

    const expansionPrice = money(first, key, 'Expansion price');
    const expansionKwh = parseNumber(first.get('Expansion capacity (kWh)'));
    const maxUnits = parseNumber(first.get('Max units'));
    const discount = parseMoney(first.get('Additional unit discount').replace(/^-/, ''));
    const capacity = parseNumber(first.get('Capacity (kWh)'));
    const power = parseNumber(first.get('Power (kW)'));
    const mandatory = yesNo(first.get('Mandatory')) ?? category === 'admin';

    const candidate = {
      key,
      category,
      name,
      manufacturer: first.get('Manufacturer') || null,
      model: first.get('Model') || null,
      pricing,
      mandatory,
      priceStatus:
        first.get('Price status').toLowerCase() === 'indicative' ? 'indicative' : 'verified',
      exclusiveGroup: first.get('Exclusive group') || null,
      expansion:
        expansionPrice === null
          ? null
          : {
              sku: first.get('Expansion SKU') || null,
              perUnitMinor: expansionPrice,
              capacityWh:
                expansionKwh === null || Number.isNaN(expansionKwh)
                  ? null
                  : Math.round(expansionKwh * 1000),
              maxUnits: maxUnits === null || Number.isNaN(maxUnits) ? null : Math.round(maxUnits),
            },
      additionalUnitDiscountMinor: discount === null || Number.isNaN(discount) ? null : discount,
      capacityWh: capacity === null || Number.isNaN(capacity) ? null : Math.round(capacity * 1000),
      powerW: power === null || Number.isNaN(power) ? null : Math.round(power * 1000),
      notes: first.get('Notes') || null,
      rows: group.map((r) => r.line),
    };
    const result = priceItemSchema.safeParse(candidate);
    if (!result.success) {
      error(
        first,
        key,
        `The item could not be read: ${result.error.issues[0]?.message ?? 'invalid'}.`,
      );
      continue;
    }
    items.push(result.data);
  }

  if (vatRatePercent === null && !issues.some((i) => i.key === 'vat')) {
    warn(null, 'vat', 'No VAT row: quotes will say VAT is to be confirmed until you add one.');
  }
  if (!items.some((i) => i.category === 'pv')) {
    warn(
      null,
      null,
      'No PV base price (category pv): Sunny cannot price a solar system from this list.',
    );
  }
  if (currency === null && items.length > 0) {
    error(null, null, 'No currency: write amounts with £ or add a Currency column.');
  }
  if (
    items.length === 0 ||
    issues.some((i) => i.severity === 'error' && i.key === null && i.rowNumber === null)
  ) {
    return { list: null, issues, itemCount: items.length };
  }
  const list = priceListSchema.parse({
    currency,
    vatRatePercent,
    pricesIncludeVat,
    sourceRef: options.sourceRef ?? null,
    sourceVersion: options.sourceVersion ?? null,
    items,
    budgetBands,
    sentinel,
  });
  return { list, issues, itemCount: items.length };
}

// ─── evaluation ──────────────────────────────────────────────────────────────

export interface PriceQuery {
  /** Panels, metres, units… whatever the item's unit counts. */
  quantity?: number;
  /** For batteries: fitted with a new solar system, or retrofitted. */
  context?: 'with_solar' | 'retrofit';
  /** For percent uplifts: the PV base price in pence. */
  pvBaseMinor?: number;
}

export type PriceResult =
  | { status: 'priced'; amountMinor: number }
  | { status: 'bespoke'; reason: string }
  | { status: 'unpriced'; reason: string };

/**
 * The price of one item for one job, exactly as the list says -- or why it
 * cannot be priced. No interpolation, no extrapolation: a panel count outside
 * the table, a quantity outside every band, or a battery context the list has
 * no price for is `unpriced`, not estimated.
 */
export function priceFor(item: PriceItem, query: PriceQuery = {}): PriceResult {
  const p = item.pricing;
  const q = query.quantity ?? 1;
  switch (p.kind) {
    case 'flat':
      return { status: 'priced', amountMinor: p.amountMinor };
    case 'per_unit':
      return { status: 'priced', amountMinor: p.flatMinor + p.amountMinor * q };
    case 'percent_uplift':
      if (query.pvBaseMinor === undefined) {
        return { status: 'unpriced', reason: 'A percentage uplift needs the PV base price.' };
      }
      return { status: 'priced', amountMinor: Math.round((query.pvBaseMinor * p.percent) / 100) };
    case 'table': {
      const row = p.rows.find((r) => r.quantity === q);
      return row
        ? { status: 'priced', amountMinor: row.amountMinor }
        : {
            status: 'unpriced',
            reason: `The price list covers ${p.rows[0]!.quantity}–${p.rows[p.rows.length - 1]!.quantity} panels; ${q} is not in it.`,
          };
    }
    case 'tiered': {
      const band = p.tiers.find((t) => q >= t.from && (t.to === null || q <= t.to));
      if (!band)
        return {
          status: 'unpriced',
          reason: `${q} ${item.pricing.kind === 'tiered' ? p.unit : ''} is outside every band.`,
        };
      if (band.bespoke)
        return { status: 'bespoke', reason: `${item.name}: priced individually at this size.` };
      const counted = band.counts === 'above' ? q - (band.from - 1) : q;
      return {
        status: 'priced',
        amountMinor: band.flatMinor + band.perUnitMinor * Math.max(0, counted),
      };
    }
    case 'install_context': {
      const context = query.context ?? 'with_solar';
      const amount = context === 'with_solar' ? p.withSolarMinor : p.retrofitMinor;
      return amount === null
        ? {
            status: 'unpriced',
            reason: `${item.name} has no ${context === 'with_solar' ? 'with-solar' : 'retrofit'} price.`,
          }
        : { status: 'priced', amountMinor: amount };
    }
    case 'quote_only':
      return { status: 'bespoke', reason: `${item.name} is priced individually.` };
  }
}

/** A short human description of an item's pricing, for the dashboard. */
export function describePricing(item: PriceItem, currency: string): string {
  const fmt = (m: number) =>
    new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: m % 100 === 0 ? 0 : 2,
    }).format(m / 100);
  const p = item.pricing;
  switch (p.kind) {
    case 'flat':
      return fmt(p.amountMinor);
    case 'per_unit':
      return `${p.flatMinor ? `${fmt(p.flatMinor)} + ` : ''}${fmt(p.amountMinor)} per ${p.unit}`;
    case 'percent_uplift':
      return p.percent === 0 ? 'Base price' : `+${p.percent}% on the PV price`;
    case 'table':
      return `${p.rows.length} prices by panel count (${p.rows[0]!.quantity}–${p.rows[p.rows.length - 1]!.quantity})`;
    case 'tiered':
      return p.tiers
        .map((t) => {
          const range = `${t.from}${t.to === null ? '+' : `–${t.to}`} ${p.unit}${t.to === null || t.to > 1 ? 's' : ''}`;
          if (t.bespoke) return `${range}: bespoke`;
          const parts = [
            t.flatMinor ? fmt(t.flatMinor) : null,
            t.perUnitMinor
              ? `${fmt(t.perUnitMinor)}/${p.unit}${t.counts === 'above' ? ` over ${t.from - 1}` : ''}`
              : null,
          ].filter(Boolean);
          return `${range}: ${parts.join(' + ') || fmt(0)}`;
        })
        .join('; ');
    case 'install_context':
      return [
        p.withSolarMinor !== null ? `${fmt(p.withSolarMinor)} with solar` : null,
        p.retrofitMinor !== null ? `${fmt(p.retrofitMinor)} retrofit` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'quote_only':
      return 'Priced individually';
  }
}

type PriceListRow = Partial<Record<(typeof PRICE_LIST_COLUMNS)[number], string | number | null>>;

/** The CSV rows that configure a Sentinel uplift (see the column notes above). */
export function sentinelRows(s: SentinelSettings, currency = 'GBP'): PriceListRow[] {
  const row = (Key: string, Name: string, extra: PriceListRow): PriceListRow => ({
    Category: 'sentinel',
    Key,
    Name,
    ...extra,
  });
  const yes = (b: boolean) => (b ? 'yes' : 'no');
  return [
    row('enabled', 'Sentinel optimisation offered', { Mandatory: yes(s.enabled) }),
    row('base', 'Base uplift on annual savings', { Percent: s.basePercent }),
    ...Object.entries(s.tariffPercent).map(([t, v]) =>
      row(`tariff:${t}`, `Tariff extra (${t})`, { Percent: v }),
    ),
    ...Object.entries(s.lifestylePercent).map(([t, v]) =>
      row(`lifestyle:${t}`, `Lifestyle extra (${t})`, { Percent: v }),
    ),
    row('battery_required', 'Full uplift needs a battery', {
      Mandatory: yes(s.batteryRequiredForFullUplift),
    }),
    row('no_battery', 'Share of the uplift without a battery', { Percent: s.noBatteryPercent }),
    row('cap', 'Most the uplift can be', { Percent: s.capPercent }),
    row('cost', 'One-off cost of adding Sentinel', {
      Amount:
        currency === 'GBP'
          ? `£${(s.addedCostMinor / 100).toFixed(s.addedCostMinor % 100 ? 2 : 0)}`
          : (s.addedCostMinor / 100).toFixed(2),
      Currency: currency,
    }),
  ];
}

/** Build a price-list CSV from rows keyed by column. */
export function priceListCsv(rows: readonly PriceListRow[]): string {
  return toCsv(PRICE_LIST_COLUMNS, rows);
}

const EXAMPLE = 'EXAMPLE ROW - replace with your own prices';

/** The downloadable template: one example of every pricing type. */
export const PRICE_LIST_TEMPLATE = priceListCsv([
  {
    Category: 'vat',
    Key: 'VAT',
    Name: 'VAT rate',
    Pricing: 'vat',
    Percent: 0,
    'Prices include VAT': 'no',
    Notes: 'EXAMPLE ROW - set the VAT rate that applies to your installations',
  },
  {
    Category: 'pv',
    Key: 'PV-BASE',
    Name: 'Solar PV system by panel count',
    Pricing: 'table',
    From: 1,
    Amount: '£3,985',
    Notes: '0.43 kWp',
  },
  {
    Category: 'pv',
    Key: 'PV-BASE',
    Name: 'Solar PV system by panel count',
    Pricing: 'table',
    From: 2,
    Amount: '£4,195',
    Notes: '0.86 kWp',
  },
  {
    Category: 'panel_uplift',
    Key: 'PANEL-PREMIUM',
    Name: 'Premium panel 455 W',
    Manufacturer: 'ExampleSolar',
    Model: 'EX-455',
    Pricing: 'percent',
    Percent: 7.5,
    Notes: EXAMPLE,
  },
  {
    Category: 'mounting',
    Key: 'MOUNT-PITCHED-TILE',
    Name: 'Pitched tile surcharge (slate / clay)',
    Pricing: 'per_unit',
    Amount: '£30',
    Unit: 'panel',
  },
  {
    Category: 'scaffold',
    Key: 'SCAFFOLD-EXTRA-SIDE',
    Name: 'Additional scaffold side',
    Pricing: 'flat',
    Amount: '£500',
  },
  {
    Category: 'admin',
    Key: 'ADMIN-FEE',
    Name: 'Administration fee',
    Pricing: 'flat',
    Amount: '£350',
    Mandatory: 'yes',
  },
  {
    Category: 'electrical',
    Key: 'FLATROOF-SURVEY',
    Name: 'Flat roof desktop structural survey',
    Pricing: 'per_unit',
    Amount: '£261',
    Unit: 'roof',
  },
  {
    Category: 'battery',
    Key: 'BATTERY-EXAMPLE',
    Name: 'Example battery 9.6 kWh',
    Manufacturer: 'ExampleBattery',
    Model: 'EB-9.6',
    Pricing: 'with_solar',
    'Price with solar': '£3,995',
    'Price retrofit': '£4,695',
    'Expansion SKU': 'BATTERY-EXAMPLE-EXT',
    'Expansion price': '£1,395',
    'Expansion capacity (kWh)': 4.8,
    'Max units': 7,
    'Capacity (kWh)': 9.6,
    Notes: EXAMPLE,
  },
  {
    Category: 'optional',
    Key: 'OPT-TIGO-PART',
    Name: 'Optimiser (part system)',
    Pricing: 'per_unit',
    Amount: '£60',
    Unit: 'panel',
    'Exclusive group': 'tigo',
  },
  {
    Category: 'optional',
    Key: 'OPT-BIRDMESH',
    Name: 'Bird proofing mesh',
    Pricing: 'tier',
    Unit: 'panel',
    From: 1,
    To: 20,
    Amount: '£600',
  },
  {
    Category: 'optional',
    Key: 'OPT-BIRDMESH',
    Name: 'Bird proofing mesh',
    Pricing: 'tier',
    Unit: 'panel',
    From: 21,
    Amount: '£600',
    'Per unit': '£30',
    Counts: 'above',
  },
  {
    Category: 'trenching',
    Key: 'TRENCH-SOFT',
    Name: 'Trenching - soft ground',
    Pricing: 'tier',
    Unit: 'metre',
    From: 0,
    To: 49,
    Amount: '£250',
    'Per unit': '£15',
    'Band SKU': 'TRENCH-SOFT-0-49',
  },
  {
    Category: 'trenching',
    Key: 'TRENCH-SOFT',
    Name: 'Trenching - soft ground',
    Pricing: 'tier',
    Unit: 'metre',
    From: 150,
    Amount: 'bespoke',
    'Band SKU': 'TRENCH-SOFT-150PLUS',
  },
  { Category: 'budget_band', Key: 'under_6k', Name: 'Under £6,000', From: '£0', To: '£6,000' },
]);
