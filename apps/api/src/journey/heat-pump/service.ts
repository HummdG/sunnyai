/**
 * The heat pump quote: the visitor's answers as the engine's input, the
 * engine's estimate, and up to three options priced from the installer's list.
 *
 * Prices are the list's and nothing else. A unit the list cannot price leaves
 * the option to the installer (`installerPriced`), never an invented figure,
 * and the Boiler Upgrade Scheme grant is shown beside the price, not hidden in it.
 */

import { randomUUID } from 'node:crypto';

import type { Workflow } from '@sunny/contracts';
import {
  estimate,
  HEAT_PUMP_DISCLAIMER,
  STANDARD_SIZES_KW,
  type AgeBand,
  type Emitters,
  type Fuel,
  type Glazing,
  type HeatPumpEstimate,
  type HeatPumpInput,
  type Loft,
  type Walls,
} from '@sunny/heat-pump-engine';

import { getPublishedPriceList } from '../../catalogue/price-list-service.js';
import { SKIPPED } from '../../flow/resolve.js';
import { HOME_KEYS, epcAssumption, parseEpcRecord } from '../../homedata/index.js';
import type { Store } from '../../store.js';
import type { QuoteLineItem } from '../quote.js';
import { quotationNow, warrantiesNow, type JourneyDeps } from '../service.js';

import { heatPumpPricingFrom, type HeatPumpPricing, type PricedLine } from './pricing.js';
import type { HeatPumpOptionView, HeatPumpQuoteRecord } from './record.js';
import { heatPumpPostcode, hpStatus } from './status.js';

const AGE_BANDS: readonly AgeBand[] = [
  'pre_1919',
  '1919_1944',
  '1945_1964',
  '1965_1982',
  '1983_1995',
  '1996_2006',
  '2007_on',
];
/** Built before 1983: standard radiators are likely too small to run a heat pump well. */
const OLDER: ReadonlySet<AgeBand> = new Set(['pre_1919', '1919_1944', '1945_1964', '1965_1982']);
const WALLS: readonly Walls[] = [
  'solid_uninsulated',
  'solid_insulated',
  'cavity_unfilled',
  'cavity_filled',
  'timber_or_modern',
  'unsure',
];
const LOFTS: readonly Loft[] = ['none', 'some', 'good', 'unsure'];
const GLAZING: readonly Glazing[] = ['single', 'double', 'triple', 'unsure'];
const FUELS: readonly Fuel[] = [
  'gas',
  'oil',
  'lpg',
  'electric_storage',
  'electric_direct',
  'heat_pump',
  'other',
];
const EMITTERS: readonly Emitters[] = [
  'radiators_standard',
  'radiators_large',
  'underfloor',
  'unsure',
];

export const OUTDOOR_SPACE_WARNING =
  'The installer will need to check where the outdoor unit can go.';
const AGE_ASSUMPTION = 'Build date assumed to be between 1965 and 1982.';

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
): { input: HeatPumpInput; assumptions: string[] } | null {
  const postcode = heatPumpPostcode(answers);
  if (!postcode) return null;
  const assumptions: string[] = [];
  const records = epcAssumption(parseEpcRecord(answers[HOME_KEYS.epc]));
  if (records) assumptions.push(records);
  let ageBand = pick(answers['hp_age'], AGE_BANDS);
  if (!ageBand) {
    ageBand = '1965_1982';
    assumptions.push(AGE_ASSUMPTION);
  }
  let currentFuel = pick(answers['hp_current_heating'], FUELS);
  if (!currentFuel) {
    currentFuel = 'gas';
    assumptions.push('Current heating assumed to be mains gas.');
  }
  let hotWater = pick(answers['hp_hot_water'], ['cylinder', 'combi'] as const);
  if (!hotWater) {
    hotWater = 'combi';
    assumptions.push('Hot water assumed to come from a combi boiler.');
  }
  return {
    input: {
      postcode,
      propertyType: answers['property_type'] ?? 'other',
      ageBand,
      floorAreaM2: numberOf(answers['hp_floor_area']),
      bedrooms: numberOf(answers['hp_bedrooms']),
      walls: pick(answers['hp_walls'], WALLS) ?? 'unsure',
      loft: pick(answers['hp_loft'], LOFTS) ?? 'unsure',
      glazing: pick(answers['hp_glazing'], GLAZING) ?? 'unsure',
      currentFuel,
      emitters: pick(answers['hp_emitters'], EMITTERS) ?? 'unsure',
      hotWater,
      occupants: numberOf(answers['hp_occupants']),
      // Without an answer the grant is not assumed: only an owner can claim it.
      ownership: answers['ownership'] ?? 'unknown',
      annualSpendGbp: numberOf(answers['hp_annual_spend']),
      epcRecommendsInsulation: pick(answers['hp_epc'], ['yes', 'no', 'unsure'] as const),
    },
    assumptions,
  };
}

/** The visitor's answers as the engine's input, or null without a postcode. */
export function heatPumpInputFrom(answers: Record<string, string>): HeatPumpInput | null {
  return readAnswers(answers)?.input ?? null;
}

/** The pricing read from the tenant's published list, as the quote's deps want it. */
export function publishedHeatPumpPricing(
  store: Store,
): (tenantId: string) => Promise<HeatPumpPricing | null> {
  return async (tenantId) => heatPumpPricingFrom(await getPublishedPriceList(store, tenantId));
}

interface Line {
  sku: string;
  label: string;
  quantity: number;
  unitGbp: number;
}

function line(priced: PricedLine | null, quantity = 1): Line | null {
  return priced ? { ...priced, quantity } : null;
}

function present(lines: Array<Line | null>): Line[] {
  return lines.filter((l): l is Line => l !== null);
}

interface Unit {
  name: string;
  outputKw: number;
  sku: string | null;
  priceGbp: number | null;
}

/** How many standard sizes above the recommended one a priced unit may be. */
const MAX_STEP_UP = 2;

/** The largest unit offered for a recommended size: two standard sizes up at most. */
export function largestUnitKwFor(kw: number): number {
  const at = STANDARD_SIZES_KW.findIndex((s) => s >= kw);
  if (at < 0) return kw;
  return STANDARD_SIZES_KW[Math.min(at + MAX_STEP_UP, STANDARD_SIZES_KW.length - 1)]!;
}

/**
 * The unit at the recommended size, or the nearest priced size up, no more
 * than two standard sizes larger. Beyond that the installer prices the option.
 */
function unitFor(pricing: HeatPumpPricing | null, kw: number): Unit {
  const largest = largestUnitKwFor(kw);
  const big = (pricing?.units ?? []).filter((u) => u.outputKw >= kw && u.outputKw <= largest);
  const unit = big.find((u) => u.priceGbp !== null) ?? big[0];
  return unit
    ? { name: unit.name, outputKw: unit.outputKw, sku: unit.sku, priceGbp: unit.priceGbp }
    : { name: `${kw} kW air source heat pump`, outputKw: kw, sku: null, priceGbp: null };
}

/** Heat pump VAT is the engine's dated rule (zero now), never the list's solar rate. */
function priceLabel(pricing: HeatPumpPricing): string {
  const vat = pricing.vatRatePercent;
  return vat > 0 ? `Indicative price, including ${vat}% VAT` : `Indicative price, ${vat}% VAT`;
}

/** About one radiator per room: from the bedrooms when known, else from the floor area. */
export function radiatorCountFor(bedrooms: number | null, floorAreaM2: number): number {
  const rooms = bedrooms !== null ? bedrooms + 1 : Math.round(floorAreaM2 / 12);
  return Math.min(15, Math.max(3, rooms));
}

function optionsFor(
  input: HeatPumpInput,
  est: HeatPumpEstimate,
  pricing: HeatPumpPricing | null,
  warnings: string[],
): HeatPumpOptionView[] {
  const unit = unitFor(pricing, est.recommendedKw);
  const extras = pricing?.extras;
  const grant = est.bus.eligible === true ? est.bus.amountGbp : 0;
  const unitLine: Line | null =
    unit.sku !== null && unit.priceGbp !== null
      ? { sku: unit.sku, label: unit.name, quantity: 1, unitGbp: unit.priceGbp }
      : null;
  const base = present([
    unitLine,
    line(extras?.baseInstall ?? null),
    line(extras?.controls ?? null),
    line(extras?.electrical ?? null),
  ]);
  const cylinderLine = line(extras?.cylinder ?? null);
  const withCylinder = present([...base, cylinderLine]);
  const radiatorCount = radiatorCountFor(input.bedrooms, est.floorAreaM2);
  const radiatorLine = line(extras?.radiatorEach ?? null, radiatorCount);
  const powerflushLine = line(extras?.powerflush ?? null);
  const withRadiators = present([...withCylinder, radiatorLine, powerflushLine]);
  // The base install is part of every option: without its price, nothing has one.
  const basePriced = unitLine !== null && extras?.baseInstall != null;

  const offersCylinder = input.hotWater === 'combi' || cylinderLine !== null;
  const offersRadiators =
    (input.emitters === 'radiators_standard' || input.emitters === 'unsure') &&
    OLDER.has(input.ageBand);

  const running = est.runningCost;
  const option = (
    id: string,
    label: string,
    headline: string,
    lines: Line[],
    inclusions: string[],
    own: string[],
    /** Every line this option adds has a price. */
    complete: boolean,
  ): HeatPumpOptionView => {
    // A price missing any part of the work is no price: never a partial sum.
    const installerPriced = !basePriced || !complete;
    const priceGbp = installerPriced
      ? null
      : Math.round(lines.reduce((sum, l) => sum + l.unitGbp * l.quantity, 0));
    // The grant never takes more than the price: price less grant is the total, never below zero.
    const grantGbp = priceGbp === null ? grant : Math.min(grant, priceGbp);
    return {
      id,
      label,
      isRecommended: false,
      headline,
      outputKw: unit.outputKw,
      unitName: unit.name,
      priceGbp,
      grantGbp,
      priceAfterGrantGbp: priceGbp === null ? null : priceGbp - grantGbp,
      priceLabel: pricing && !installerPriced ? priceLabel(pricing) : 'Priced by your installer',
      // The priced lines stay, for the installer to see, even without a total.
      lineItems: lines.map((l): QuoteLineItem => ({
        sku: l.sku,
        label: l.label,
        quantity: l.quantity,
        totalGbp: Math.round(l.unitGbp * l.quantity),
      })),
      runningCostGbp: Math.round(running.heatPumpGbp),
      currentCostGbp: Math.round(running.currentGbp),
      annualSavingsGbp: Math.round(running.currentGbp - running.heatPumpGbp),
      inclusions,
      warnings: [...warnings, ...own],
      installerPriced,
    };
  };

  const kw = `${unit.outputKw} kW`;
  // A larger unit than the home needs says so: it is the nearest the installer prices.
  const stepUp = unit.outputKw > est.recommendedKw;
  const unitPhrase = stepUp
    ? `A ${kw} unit (the nearest your installer prices; the home needs about ${est.recommendedKw} kW)`
    : `A ${kw} heat pump`;
  const unitInclusions = [`A ${kw} air source heat pump`, 'Installation and controls'];
  const options: HeatPumpOptionView[] = [];
  // A combi boiler heats water on demand: a heat pump needs a cylinder, so never the unit alone.
  if (input.hotWater !== 'combi') {
    options.push(
      option(
        'heat_pump_only',
        'Heat pump only',
        stepUp ? `${unitPhrase}.` : `${unitPhrase}, sized to the home.`,
        base,
        unitInclusions,
        [],
        true,
      ),
    );
  }
  if (offersCylinder) {
    options.push(
      option(
        'with_cylinder',
        'With a new hot water cylinder',
        `${unitPhrase} with a new hot water cylinder.`,
        withCylinder,
        [...unitInclusions, 'A new hot water cylinder'],
        cylinderLine ? [] : ['Your installer will price the new cylinder.'],
        cylinderLine !== null,
      ),
    );
  }
  if (offersRadiators) {
    const unpriced = radiatorLine === null || powerflushLine === null;
    const newCylinder = cylinderLine !== null || input.hotWater === 'combi';
    options.push(
      option(
        'with_radiators',
        'With radiator upgrades',
        newCylinder
          ? `${unitPhrase} with a new cylinder and larger radiators.`
          : `${unitPhrase} with larger radiators.`,
        withRadiators,
        [
          ...unitInclusions,
          ...(newCylinder ? ['A new hot water cylinder'] : []),
          `About ${radiatorCount} larger radiators`,
          'A powerflush of the heating system',
        ],
        [
          ...(offersCylinder && !cylinderLine
            ? ['Your installer will price the new cylinder.']
            : []),
          ...(unpriced ? ['Your installer will price the radiator work.'] : []),
        ],
        !unpriced && (input.hotWater !== 'combi' || cylinderLine !== null),
      ),
    );
  }

  const recommended = offersRadiators
    ? 'with_radiators'
    : input.hotWater === 'combi'
      ? 'with_cylinder'
      : 'heat_pump_only';
  return options.map((o) => ({ ...o, isRecommended: o.id === recommended }));
}

export type CreateHeatPumpQuoteResult =
  { ok: true; quote: HeatPumpQuoteRecord } | { ok: false; missing: string[]; next: string | null };

export async function createHeatPumpQuote(
  deps: JourneyDeps & { heatPumpPricing: (tenantId: string) => Promise<HeatPumpPricing | null> },
  tenantId: string,
  sessionId: string,
  workflow: Workflow,
): Promise<CreateHeatPumpQuoteResult> {
  const answers = (await deps.store.getConversation(tenantId, sessionId))?.answers ?? {};
  const status = hpStatus(workflow, answers);
  const read = status.ready ? readAnswers(answers) : null;
  if (!read) return { ok: false, missing: status.missing, next: status.nextQuestionId };

  const est = estimate(read.input);
  est.assumptions.push(...read.assumptions);
  const warnings = [...est.warnings];
  if (answers['hp_outdoor_space'] === 'no') warnings.push(OUTDOOR_SPACE_WARNING);

  const pricing = await deps.heatPumpPricing(tenantId);
  const options = optionsFor(read.input, est, pricing, warnings);
  const quote: HeatPumpQuoteRecord = {
    kind: 'heat_pump',
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
          currency: pricing.currency,
        }
      : null,
    estimate: est,
    currentFuel: read.input.currentFuel,
    postcode: read.input.postcode,
    options,
    recommendedId: options.find((o) => o.isRecommended)!.id,
    warnings,
    disclaimer: HEAT_PUMP_DISCLAIMER,
    leadId: null,
    workflowId: workflow.id,
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
