/**
 * A tenant's published price list as the pricing the heat pump quote uses.
 *
 * `heat_pump` items are the units (rated by `powerW`); `heat_pump_install`
 * items are the extras, mapped by `role`. Amounts come from `priceFor`, so a
 * unit the list prices as quote-only has no price rather than an invented one.
 */

import { HEAT_PUMP_VAT_PERCENT } from '@sunny/heat-pump-engine';

import {
  priceFor,
  type HeatPumpRole,
  type PriceItem,
  type PriceList,
} from '../../catalogue/price-list.js';
import { pounds } from '../catalogue-pricing.js';

export interface HeatPumpUnit {
  sku: string;
  name: string;
  outputKw: number;
  priceGbp: number | null;
}

export interface PricedLine {
  sku: string;
  label: string;
  unitGbp: number;
}

export interface HeatPumpExtras {
  baseInstall: PricedLine | null;
  cylinder: PricedLine | null;
  radiatorEach: PricedLine | null;
  powerflush: PricedLine | null;
  controls: PricedLine | null;
  electrical: PricedLine | null;
}

export interface HeatPumpPricing {
  units: HeatPumpUnit[];
  extras: HeatPumpExtras;
  vatRatePercent: number;
  currency: 'GBP';
  label: string;
  version: string;
}

const EXTRA_KEY: Record<HeatPumpRole, keyof HeatPumpExtras> = {
  base_install: 'baseInstall',
  cylinder: 'cylinder',
  radiator: 'radiatorEach',
  powerflush: 'powerflush',
  controls: 'controls',
  electrical: 'electrical',
};

function lineOf(item: PriceItem): PricedLine | null {
  const r = priceFor(item, { quantity: 1 });
  if (r.status !== 'priced') return null;
  return { sku: item.key, label: item.name, unitGbp: pounds(r.amountMinor) };
}

/** Null when the list is missing or has no usable heat pump items. */
export function heatPumpPricingFrom(list: PriceList | null): HeatPumpPricing | null {
  if (!list || list.currency !== 'GBP') return null;
  const units: HeatPumpUnit[] = [];
  for (const item of list.items) {
    if (item.category !== 'heat_pump' || item.powerW === null) continue;
    const r = priceFor(item, { quantity: 1 });
    units.push({
      sku: item.key,
      name: item.name,
      outputKw: item.powerW / 1000,
      priceGbp: r.status === 'priced' ? pounds(r.amountMinor) : null,
    });
  }
  if (units.length === 0) return null;

  const extras: HeatPumpExtras = {
    baseInstall: null,
    cylinder: null,
    radiatorEach: null,
    powerflush: null,
    controls: null,
    electrical: null,
  };
  // Per role, the first item the list prices; without one, the first item (no price).
  for (const item of list.items) {
    if (item.category !== 'heat_pump_install' || !item.role) continue;
    const key = EXTRA_KEY[item.role];
    if (extras[key] === null) extras[key] = lineOf(item);
  }

  return {
    units: units.sort((a, b) => a.outputKw - b.outputKw),
    extras,
    // A dated rule in the engine, never the list's VAT row (that is the solar rate).
    vatRatePercent: HEAT_PUMP_VAT_PERCENT,
    currency: 'GBP',
    label: 'Heat pump quote',
    version: list.sourceVersion ?? 'unversioned',
  };
}
