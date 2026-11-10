/**
 * The battery quote: the visitor's answers as the engine's input, the
 * engine's estimate, and up to three battery sizes priced from the installer's
 * list with the retrofit price.
 *
 * Prices are the list's and nothing else. A battery or a line the list cannot
 * price leaves the option to the installer (`installerPriced`), never a
 * partial sum or an invented figure.
 */

import { randomUUID } from 'node:crypto';

import type { Workflow } from '@sunny/contracts';
import {
  BATTERY_DISCLAIMER,
  batteryEstimate,
  type BatteryEstimate,
  type BatteryGoal,
  type BatteryInput,
  type BatteryTariff,
  type QuoteUsage,
} from '@sunny/quote-engine';

import { getPublishedPriceList } from '../../catalogue/price-list-service.js';
import { SKIPPED } from '../../flow/resolve.js';
import type { Store } from '../../store.js';
import { heatPumpPostcode } from '../heat-pump/status.js';
import type { QuoteLineItem } from '../quote.js';
import { quotationNow, warrantiesNow, type JourneyDeps } from '../service.js';

import { batteryPricingFrom, type BatteryPricing, type RetrofitBattery } from './pricing.js';
import {
  batteryDataEffectiveFrom,
  batteryPaybackYears,
  type BatteryOptionView,
  type BatteryQuoteRecord,
} from './record.js';
import { batteryNotSuitable, batteryStatus } from './status.js';

const TARIFFS: readonly BatteryTariff[] = [
  'standard',
  'economy7',
  'smart_tou',
  'import_export',
  'already_exports',
  'unknown',
];
const GOALS: readonly BatteryGoal[] = ['savings', 'backup', 'cheap_rate', 'unsure'];

/** Battery sizes offered when the installer's list prices none: unpriced. */
const FALLBACK_KWH: readonly number[] = [5, 10, 13.5];

export const EXISTING_BATTERY_WARNING =
  'You already have a battery. Your installer can advise on adding more storage.';
export const AC_COUPLING_WARNING =
  'Your inverter may need an extra unit to charge a battery. Your installer will check.';
const SOLAR_ASSUMPTION = 'Assumed the home already has solar panels.';

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function numberOf(value: string | undefined): number | null {
  if (value === undefined || value === SKIPPED) return null;
  const n = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The engine's input and the assumptions made reading the answers. */
function readAnswers(
  answers: Record<string, string>,
): { input: BatteryInput; assumptions: string[] } | null {
  const postcode = heatPumpPostcode(answers);
  if (!postcode || batteryNotSuitable(answers)) return null;
  const assumptions: string[] = [];
  const existing = answers['existing_system'];
  // A battery alone ('battery') is not solar either: the quote assumes the panels.
  if (existing !== 'solar' && existing !== 'solar_battery') {
    assumptions.push(SOLAR_ASSUMPTION);
  }
  const source = answers['usage_source'];
  // The same reading the solar quote gives the usage answers (journey.ts quoteAnswers).
  const usage: QuoteUsage = {
    // A bill upload is not something a chat can do; its kWh is typed instead.
    source:
      source === undefined || source === SKIPPED
        ? null
        : source === 'bill_ocr'
          ? 'manual_kwh'
          : source,
    annualKwh: numberOf(answers['annual_kwh']),
    unitRatePence: null,
    exportTariffPence: null,
    monthlyCostGbp: numberOf(answers['monthly_cost']),
    householdSize: numberOf(answers['household_size']),
  };
  const lifestyle = (answers['lifestyle'] ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== 'none' && tag !== SKIPPED);
  return {
    input: {
      postcode,
      pvKwp: numberOf(answers['bat_pv_kwp']),
      panelCount: numberOf(answers['bat_panels']),
      usage,
      tariff: pick(answers['tariff_type'], TARIFFS) ?? 'unknown',
      lifestyle,
      goal: pick(answers['bat_goal'], GOALS) ?? 'unsure',
    },
    assumptions,
  };
}

/** The visitor's answers as the engine's input, or null without a postcode or without solar. */
export function batteryInputFrom(answers: Record<string, string>): BatteryInput | null {
  return readAnswers(answers)?.input ?? null;
}

/** The pricing read from the tenant's published list, as the quote's deps want it. */
export function publishedBatteryPricing(
  store: Store,
): (tenantId: string) => Promise<BatteryPricing | null> {
  return async (tenantId) => batteryPricingFrom(await getPublishedPriceList(store, tenantId));
}

interface Line {
  sku: string;
  label: string;
  quantity: number;
  unitGbp: number;
}

/** One size offered: a battery, with expansion units when it needs them. */
interface Size {
  battery: RetrofitBattery;
  units: number;
  capacityKwh: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function sizeOf(battery: RetrofitBattery, units = 0): Size {
  const extra = units > 0 && battery.expansion ? units * battery.expansion.capacityKwh : 0;
  return { battery, units, capacityKwh: round1(battery.capacityKwh + extra) };
}

/** The batteries on the list, or the fallback sizes (unpriced) without one. */
function batteriesFor(pricing: BatteryPricing | null): RetrofitBattery[] {
  if (pricing && pricing.batteries.length > 0) return pricing.batteries;
  return FALLBACK_KWH.map((kwh) => ({
    sku: '',
    name: `${kwh} kWh battery`,
    capacityKwh: kwh,
    priceGbp: null,
    expansion: null,
  }));
}

/**
 * One battery per capacity, so no two options are the same size: a priced one
 * before an unpriced one, then the cheaper. Sorted by capacity.
 */
export function onePerCapacity(batteries: readonly RetrofitBattery[]): RetrofitBattery[] {
  const best = new Map<number, RetrofitBattery>();
  for (const b of batteries) {
    const kept = best.get(b.capacityKwh);
    const better =
      !kept ||
      (kept.priceGbp === null && b.priceGbp !== null) ||
      (kept.priceGbp !== null && b.priceGbp !== null && b.priceGbp < kept.priceGbp);
    if (better) best.set(b.capacityKwh, b);
  }
  return [...best.values()].sort((a, b) => a.capacityKwh - b.capacityKwh);
}

/**
 * Up to three sizes: the recommended one (the smallest at or above the
 * recommended capacity, else the largest below it), the next size up (or the
 * recommended battery with expansion units, when no larger one is listed), and
 * one size down (or, with none smaller, the next size up again).
 */
function sizesFor(
  listed: RetrofitBattery[],
  recommendedKwh: number,
): Array<{ id: string; label: string; size: Size }> {
  const batteries = onePerCapacity(listed);
  const at = batteries.findIndex((b) => b.capacityKwh >= recommendedKwh);
  const index = at >= 0 ? at : batteries.length - 1;
  const base = batteries[index]!;
  const out: Array<{ id: string; label: string; size: Size }> = [
    { id: 'recommended', label: 'Recommended', size: sizeOf(base) },
  ];

  const up = batteries[index + 1];
  if (up) {
    out.push({ id: 'more_storage', label: 'More storage', size: sizeOf(up) });
  } else if (base.expansion && base.expansion.maxUnits > 0 && base.expansion.capacityKwh > 0) {
    // No larger battery: expansion units, enough to reach the recommended size
    // (one at least), never more than the battery takes.
    const short = Math.max(0, recommendedKwh - base.capacityKwh);
    const units = Math.min(
      base.expansion.maxUnits,
      Math.max(1, Math.ceil(short / base.expansion.capacityKwh)),
    );
    out.push({ id: 'more_storage', label: 'More storage', size: sizeOf(base, units) });
  }

  const down = batteries[index - 1];
  const upAgain = batteries[index + 2];
  if (down) out.push({ id: 'smaller', label: 'Smaller', size: sizeOf(down) });
  else if (upAgain) out.push({ id: 'most_storage', label: 'Most storage', size: sizeOf(upAgain) });
  return out;
}

/** Battery VAT is the engine's dated rule (zero now), never the list's solar rate. */
function priceLabel(pricing: BatteryPricing): string {
  const vat = pricing.vatRatePercent;
  return vat > 0 ? `Indicative price, including ${vat}% VAT` : `Indicative price, ${vat}% VAT`;
}

function optionsFor(
  est: BatteryEstimate,
  pricing: BatteryPricing | null,
  needsAcCoupling: boolean,
  warnings: string[],
): BatteryOptionView[] {
  const sizes = sizesFor(batteriesFor(pricing), est.recommendedKwh);
  return sizes.map(({ id, label, size }): BatteryOptionView => {
    const { battery, units } = size;
    const lines: Line[] = [];
    let complete = true;
    if (battery.sku && battery.priceGbp !== null) {
      lines.push({ sku: battery.sku, label: battery.name, quantity: 1, unitGbp: battery.priceGbp });
    } else {
      complete = false;
    }
    if (units > 0 && battery.expansion) {
      lines.push({
        sku: battery.expansion.sku,
        label: `${battery.name} expansion unit`,
        quantity: units,
        unitGbp: battery.expansion.priceGbp,
      });
    }
    const own: string[] = [];
    if (needsAcCoupling) {
      const ac = pricing?.acCoupling ?? null;
      if (ac) {
        lines.push({ ...ac, quantity: 1 });
      } else {
        complete = false;
        own.push(AC_COUPLING_WARNING);
      }
    }
    // A price missing any part of the work is no price: never a partial sum.
    const installerPriced = !complete;
    const priceGbp = installerPriced
      ? null
      : Math.round(lines.reduce((sum, l) => sum + l.unitGbp * l.quantity, 0));
    const sizing = est.sizing(size.capacityKwh);
    const kwh = `${size.capacityKwh} kWh`;
    const headline =
      units > 0
        ? `A ${battery.name} with ${units} expansion unit${units === 1 ? '' : 's'}, ${kwh} in all.`
        : id === 'recommended' && size.capacityKwh < est.recommendedKwh
          ? `The largest battery your installer lists; the home could use about ${est.recommendedKwh} kWh.`
          : id === 'recommended'
            ? `A ${kwh} battery, sized to your solar and your use.`
            : id === 'smaller'
              ? `A smaller ${kwh} battery.`
              : `A ${kwh} battery, for more storage.`;
    return {
      id,
      label,
      isRecommended: id === 'recommended',
      headline,
      capacityKwh: size.capacityKwh,
      batteryName: battery.name,
      priceGbp,
      priceLabel: pricing && !installerPriced ? priceLabel(pricing) : 'Priced by your installer',
      // The priced lines stay, for the installer to see, even without a total.
      lineItems: lines.map((l): QuoteLineItem => ({
        sku: l.sku,
        label: l.label,
        quantity: l.quantity,
        totalGbp: Math.round(l.unitGbp * l.quantity),
      })),
      annualSavingsGbp: sizing.annualSavingGbp,
      selfUseSavingGbp: sizing.selfUseSavingGbp,
      shiftSavingGbp: sizing.shiftSavingGbp,
      paybackYears: batteryPaybackYears(priceGbp, sizing.annualSavingGbp),
      warnings: [...warnings, ...own],
      installerPriced,
    };
  });
}

export type CreateBatteryQuoteResult =
  { ok: true; quote: BatteryQuoteRecord } | { ok: false; missing: string[]; next: string | null };

export async function createBatteryQuote(
  deps: JourneyDeps & { batteryPricing: (tenantId: string) => Promise<BatteryPricing | null> },
  tenantId: string,
  sessionId: string,
  workflow: Workflow,
): Promise<CreateBatteryQuoteResult> {
  const answers = (await deps.store.getConversation(tenantId, sessionId))?.answers ?? {};
  const status = batteryStatus(workflow, answers);
  const read = status.ready ? readAnswers(answers) : null;
  if (!read) return { ok: false, missing: status.missing, next: status.nextQuestionId };

  const full = batteryEstimate(read.input);
  full.assumptions.push(...read.assumptions);
  // Stored as plain data: the sizing function is not.
  const { sizing: _sizing, ...est } = full;
  const warnings = [...est.warnings];
  const existing = answers['existing_system'];
  if (existing === 'battery' || existing === 'solar_battery') {
    warnings.push(EXISTING_BATTERY_WARNING);
  }
  const inverter = answers['bat_inverter'];
  const needsAcCoupling = inverter === 'standard' || inverter === 'unsure';

  const pricing = await deps.batteryPricing(tenantId);
  const options = optionsFor(full, pricing, needsAcCoupling, warnings);
  const quote: BatteryQuoteRecord = {
    kind: 'battery',
    id: `q_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    tenantId,
    sessionId,
    createdAt: new Date(deps.now()).toISOString(),
    priced: options.some((o) => o.priceGbp !== null),
    pricing: pricing
      ? {
          label: pricing.label,
          version: pricing.version,
          priceStatus: 'indicative',
          vatRatePercent: pricing.vatRatePercent,
          currency: 'GBP',
        }
      : null,
    estimate: est,
    postcode: read.input.postcode,
    tariff: read.input.tariff,
    options,
    recommendedId: options.find((o) => o.isRecommended)!.id,
    warnings,
    disclaimer: BATTERY_DISCLAIMER,
    leadId: null,
    workflowId: workflow.id,
    dataEffectiveFrom: batteryDataEffectiveFrom(read.input.tariff),
  };
  const quotation = await quotationNow(deps, tenantId);
  if (quotation) quote.quotation = quotation;
  quote.warranties = await warrantiesNow(
    deps.store,
    tenantId,
    options.flatMap((o) => o.lineItems),
  );
  await deps.store.saveQuote(quote);
  return { ok: true, quote };
}
