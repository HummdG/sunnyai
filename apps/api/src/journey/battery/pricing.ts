/**
 * A tenant's published price list as the pricing a battery retrofit quote uses.
 *
 * Batteries are priced with the retrofit price only, never the with-solar
 * price: this quote is for a home that already has solar. A battery the list
 * does not price for retrofit has no price rather than an invented one.
 */

import { BATTERY_RETROFIT_VAT_PERCENT } from '@sunny/quote-engine';

import { priceFor, type PriceList } from '../../catalogue/price-list.js';
import { pounds } from '../catalogue-pricing.js';
import type { PricedLine } from '../heat-pump/pricing.js';

export interface RetrofitBattery {
  sku: string;
  name: string;
  capacityKwh: number;
  priceGbp: number | null;
  expansion: { sku: string; capacityKwh: number; priceGbp: number; maxUnits: number } | null;
}

export interface BatteryPricing {
  batteries: RetrofitBattery[];
  acCoupling: PricedLine | null;
  vatRatePercent: number;
  label: string;
  version: string;
}

/** Null when the list is missing or has no usable battery items. */
export function batteryPricingFrom(list: PriceList | null): BatteryPricing | null {
  if (!list || list.currency !== 'GBP') return null;
  const batteries: RetrofitBattery[] = [];
  for (const item of list.items) {
    if (item.category !== 'battery' || item.capacityWh === null) continue;
    const r = priceFor(item, { quantity: 1, context: 'retrofit' });
    const ex = item.expansion;
    batteries.push({
      sku: item.key,
      name: item.name,
      capacityKwh: item.capacityWh / 1000,
      priceGbp: r.status === 'priced' ? pounds(r.amountMinor) : null,
      // An expansion needs a sku, a capacity and a limit to be offered.
      expansion:
        ex && ex.sku && ex.capacityWh !== null && ex.maxUnits !== null
          ? {
              sku: ex.sku,
              capacityKwh: ex.capacityWh / 1000,
              priceGbp: pounds(ex.perUnitMinor),
              maxUnits: ex.maxUnits,
            }
          : null,
    });
  }
  if (batteries.length === 0) return null;

  let acCoupling: PricedLine | null = null;
  for (const item of list.items) {
    if (item.category !== 'inverter' || item.role !== 'ac_coupling') continue;
    const r = priceFor(item, { quantity: 1 });
    if (r.status !== 'priced') continue;
    acCoupling = { sku: item.key, label: item.name, unitGbp: pounds(r.amountMinor) };
    break;
  }

  return {
    batteries: batteries.sort((a, b) => a.capacityKwh - b.capacityKwh),
    acCoupling,
    // A dated rule in the engine, never the list's VAT row (that is the solar rate).
    vatRatePercent: BATTERY_RETROFIT_VAT_PERCENT,
    label: 'Battery quote',
    version: list.sourceVersion ?? 'unversioned',
  };
}
