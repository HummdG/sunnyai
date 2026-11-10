/**
 * Warranty years for a quote's line items, from the installer's catalogue,
 * worked out when the quote is made and stored on it (`QuoteRecord.warranties`)
 * so a later catalogue change never alters a re-download.
 *
 * A line item's sku is a price-list key; the price-list item names a make and
 * model; the catalogue product with that make and model (compared as the
 * catalogue compares them, `productKey`) carries `warrantyYears`. The PV base
 * line (`PV-BASE`, the system priced by panel count) is the list's base panel,
 * so it takes that panel's warranty. Only a single, positive figure is used:
 * no product, no figure, or products that disagree mean no warranty is printed.
 */

import type { Product } from '@sunny/contracts';

import type { PriceItem, PriceList } from '../catalogue/price-list.js';
import { productKey } from '../catalogue/service.js';
import type { QuoteLineItem } from '../journey/quote.js';

const PV_BASE = 'PV-BASE';

function yearsFor(item: PriceItem, products: readonly Product[]): number | null {
  if (!item.manufacturer || !item.model) return null;
  const key = productKey({ manufacturer: item.manufacturer, model: item.model });
  const years = new Set(
    products
      .filter((p) => productKey(p) === key)
      .map((p) => p.warrantyYears)
      .filter((y): y is number => y !== null && y > 0),
  );
  return years.size === 1 ? [...years][0]! : null;
}

/** The base panel the PV base price assumes: the panel with no uplift. */
function basePanel(list: PriceList): PriceItem | null {
  const panels = list.items.filter((i) => i.category === 'panel_uplift');
  const base = panels.filter((i) => i.pricing.kind === 'percent_uplift' && i.pricing.percent === 0);
  return base.length === 1 ? base[0]! : null;
}

export function warrantiesFor(
  items: readonly QuoteLineItem[],
  list: PriceList | null,
  products: readonly Product[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!list) return out;
  for (const { sku } of items) {
    if (sku in out) continue;
    const item = sku === PV_BASE ? basePanel(list) : list.items.find((i) => i.key === sku);
    const years = item ? yearsFor(item, products) : null;
    if (years !== null) out[sku] = years;
  }
  return out;
}
