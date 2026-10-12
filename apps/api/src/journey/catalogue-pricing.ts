/**
 * A tenant's published price list (WS7, apps/api/src/catalogue/price-list.ts)
 * as the `TenantPricing` the ported SunScan v1 quote engine prices from.
 *
 * The price list keeps SunScan v1's SKUs as item keys (docs/integration/
 * catalogue.md, "SunScan v1 mapping"), so this is the reverse of that mapping:
 * each item becomes the engine catalogue row it came from, amounts in integer
 * pence become pounds, and the engine runs unchanged. Every amount is evaluated
 * with WS7's `priceFor`, which never interpolates.
 *
 * What cannot become a number is never invented. An item the list prices
 * "bespoke" or not at all is left out of the engine's catalogue; if it is one
 * every quote includes (mandatory), its name is carried as `installerPriced`
 * and every option says it is priced by the installer.
 */

import type {
  BudgetBand,
  CatalogueBattery,
  CatalogueExtra,
  CatalogueInverter,
  CatalogueMounting,
  CataloguePanel,
  CataloguePvBasePrice,
  CatalogueTrenching,
  PricingSource,
  ProductTier,
  RoofType,
  SentinelConfig,
  TenantPricing,
} from '@sunny/quote-engine';

import { priceFor, type PriceItem, type PriceList } from '../catalogue/price-list.js';
import { getPublishedPriceList } from '../catalogue/price-list-service.js';
import type { Store } from '../store.js';

const pounds = (minor: number) => Math.round(minor) / 100;

/** v1's catalogue extra categories, from SunScan's SKU prefixes. */
function extraCategory(item: PriceItem): CatalogueExtra['category'] {
  const key = item.key.toUpperCase();
  if (key.startsWith('SCAFFOLD')) return 'scaffold';
  if (key.startsWith('EV-')) return 'ev';
  if (key.startsWith('OPT-TIGO')) return 'optimiser';
  if (key.startsWith('OPT-BIRDMESH')) return 'bird_mesh';
  if (key.startsWith('EPS')) return 'eps';
  if (key.startsWith('OPT-ENPHASE')) return 'microinverter';
  if (key.startsWith('STRUCT')) return 'structural';
  if (item.category === 'scaffold') return 'scaffold';
  return 'general_electrical';
}

/** An extra as v1's priceCalc, or null when the list's pricing has no v1 shape. */
function extraOf(item: PriceItem, sortOrder: number): CatalogueExtra | null {
  const p = item.pricing;
  const base = {
    sku: item.key,
    category: extraCategory(item),
    label: item.name,
    isMandatory: item.mandatory,
    exclusiveGroup: item.exclusiveGroup,
    sortOrder,
  };
  if (p.kind === 'flat') {
    return {
      ...base,
      priceCalc: 'flat',
      baseGbp: pounds(p.amountMinor),
      perPanelGbp: 0,
      panelThreshold: null,
    };
  }
  if (p.kind === 'per_unit' && p.unit === 'panel') {
    return p.flatMinor > 0
      ? {
          ...base,
          priceCalc: 'fixed_plus_per_panel',
          baseGbp: pounds(p.flatMinor),
          perPanelGbp: pounds(p.amountMinor),
          panelThreshold: null,
        }
      : {
          ...base,
          priceCalc: 'per_panel',
          baseGbp: 0,
          perPanelGbp: pounds(p.amountMinor),
          panelThreshold: null,
        };
  }
  if (p.kind === 'per_unit' && (p.unit === 'roof' || p.unit === 'job' || p.unit === 'unit')) {
    // One roof, one job: the quote covers a single installation.
    return {
      ...base,
      priceCalc: 'flat',
      baseGbp: pounds(p.flatMinor + p.amountMinor),
      perPanelGbp: 0,
      panelThreshold: null,
    };
  }
  if (p.kind === 'tiered' && p.unit === 'panel' && p.tiers.length === 2) {
    // v1's bird mesh: a flat fee up to a threshold, then per panel above it.
    const [first, second] = p.tiers as [(typeof p.tiers)[0], (typeof p.tiers)[0]];
    if (!first.bespoke && !second.bespoke && first.to !== null && second.counts === 'above') {
      return {
        ...base,
        priceCalc: 'per_panel_with_threshold',
        baseGbp: pounds(first.flatMinor),
        perPanelGbp: pounds(second.perUnitMinor),
        panelThreshold: first.to,
      };
    }
  }
  return null;
}

function rankTiers<T>(rows: T[], price: (row: T) => number): Map<T, ProductTier> {
  const sorted = [...rows].sort((a, b) => price(a) - price(b));
  const tiers = new Map<T, ProductTier>();
  sorted.forEach((row, i) => {
    const third = sorted.length <= 1 ? 0 : i / (sorted.length - 1);
    tiers.set(row, third < 0.34 ? 'budget' : third < 0.67 ? 'standard' : 'premium');
  });
  return tiers;
}

export interface CataloguePricing {
  pricing: TenantPricing;
  /** Items the list could not price that would otherwise be left out silently. */
  skipped: { key: string; name: string; reason: string }[];
}

export function pricingFromPriceList(list: PriceList): CataloguePricing | null {
  if (list.currency !== 'GBP') return null; // The engine and its tariffs are UK-only.
  const skipped: CataloguePricing['skipped'] = [];
  const installerPriced: string[] = [];
  const skip = (item: PriceItem, reason: string) => {
    skipped.push({ key: item.key, name: item.name, reason });
    if (item.mandatory) installerPriced.push(item.name);
  };

  // PV base: the system price by panel count.
  const pvItem = list.items.find((i) => i.category === 'pv' && i.pricing.kind === 'table');
  if (!pvItem || pvItem.pricing.kind !== 'table') return null;
  const pvRows = pvItem.pricing.rows;

  // Panels: the uplift on the PV base, keyed by panel SKU.
  const panelItems = list.items.filter((i) => i.category === 'panel_uplift');
  const upliftOf = (i: PriceItem) =>
    i.pricing.kind === 'percent_uplift'
      ? i.pricing.percent
      : i.pricing.kind === 'per_unit'
        ? 1000 + i.pricing.amountMinor
        : Infinity;
  // The base panel is the budget tier; panels with an uplift split into
  // standard (the cheaper half) and premium -- SunScan's seed: +7.5% standard,
  // +8% and the per-panel Enphase option premium.
  const panelTier = new Map<PriceItem, ProductTier>();
  const uplifted = panelItems
    .filter((i) => !(i.pricing.kind === 'percent_uplift' && i.pricing.percent === 0))
    .sort((a, b) => upliftOf(a) - upliftOf(b));
  const standardCount = uplifted.length === 1 ? 1 : Math.floor(uplifted.length / 2);
  for (const item of panelItems) panelTier.set(item, 'budget');
  uplifted.forEach((item, i) => panelTier.set(item, i < standardCount ? 'standard' : 'premium'));
  const panels: CataloguePanel[] = [];
  panelItems.forEach((item, i) => {
    const p = item.pricing;
    const kw = (item.powerW ?? 0) / 1000 || 0.43;
    const common = {
      sku: item.key,
      modelName: item.name,
      manufacturer: item.manufacturer ?? '',
      wattPeak: Math.round(kw * 1000),
      widthMm: 1134,
      heightMm: 1762,
      depthMm: 30,
      productTier: panelTier.get(item) ?? 'standard',
      sortOrder: i + 1,
    };
    if (p.kind === 'percent_uplift') {
      panels.push({
        ...common,
        upliftType: p.percent === 0 ? 'base' : 'percent',
        upliftValue: p.percent / 100,
        isBase: p.percent === 0,
      });
    } else if (p.kind === 'per_unit' && p.unit === 'panel') {
      panels.push({
        ...common,
        upliftType: 'flat_per_panel',
        upliftValue: pounds(p.amountMinor),
        isBase: false,
      });
    } else {
      skip(item, 'panel uplift is not a percentage or a per-panel amount');
    }
  });
  const base = panels.find((p) => p.isBase);
  if (!base) return null;
  const pvBasePrice: CataloguePvBasePrice[] = pvRows.map((r) => ({
    panelCount: r.quantity,
    kwp: Math.round(((r.quantity * base.wattPeak) / 1000) * 100) / 100,
    priceGbp: pounds(r.amountMinor),
  }));

  // Inverters: v1 prices them inside the PV base (flat £0); middle one is default.
  const inverterItems = list.items.filter((i) => i.category === 'inverter');
  const invTier = rankTiers(inverterItems, (i) => i.powerW ?? 0);
  const inverters: CatalogueInverter[] = [];
  inverterItems.forEach((item, i) => {
    const r = priceFor(item);
    if (r.status !== 'priced') return skip(item, r.reason);
    inverters.push({
      sku: item.key,
      modelName: item.name,
      manufacturer: item.manufacturer ?? '',
      ratedKw: (item.powerW ?? 5000) / 1000,
      efficiency: 0.97,
      productTier: invTier.get(item) ?? 'standard',
      priceGbp: pounds(r.amountMinor),
      isDefault: false,
      sortOrder: i + 1,
    });
  });
  const middle = inverters.find((i) => i.productTier === 'standard') ?? inverters[0];
  if (middle) middle.isDefault = true;

  // Mounting: per panel, for the roof type named in its notes.
  const mounting: CatalogueMounting[] = [];
  list.items
    .filter((i) => i.category === 'mounting')
    .forEach((item, i) => {
      const p = item.pricing;
      if (p.kind !== 'per_unit' || p.unit !== 'panel')
        return skip(item, 'mounting is not priced per panel');
      const text = `${item.notes ?? ''} ${item.name}`.toLowerCase();
      const appliesTo: RoofType = text.includes('flat')
        ? 'flat'
        : text.includes('ground')
          ? 'ground'
          : 'pitched';
      mounting.push({
        sku: item.key,
        label: item.name,
        pricePerPanel: pounds(p.amountMinor),
        appliesTo,
        isDefault: !mounting.some((m) => m.appliesTo === appliesTo),
        sortOrder: i + 1,
      });
    });

  // Batteries: with-solar and retrofit prices, expansion, multi-unit discount.
  const batteryItems = list.items.filter((i) => i.category === 'battery');
  const batTier = rankTiers(batteryItems, (i) =>
    i.pricing.kind === 'install_context' ? (i.pricing.withSolarMinor ?? Infinity) : Infinity,
  );
  const batteries: CatalogueBattery[] = [];
  batteryItems.forEach((item, i) => {
    const p = item.pricing;
    if (p.kind !== 'install_context' || p.withSolarMinor === null) {
      return skip(item, 'no with-solar price');
    }
    const noted = /premium/i.test(item.notes ?? '')
      ? 'premium'
      : /standard/i.test(item.notes ?? '')
        ? 'standard'
        : null;
    batteries.push({
      sku: item.key,
      modelName: item.name,
      tier: noted ?? (batTier.get(item) === 'premium' ? 'premium' : 'standard'),
      baseCapacityKwh: (item.capacityWh ?? 0) / 1000,
      priceWithSolar: pounds(p.withSolarMinor),
      priceRetrofit: pounds(p.retrofitMinor ?? p.withSolarMinor),
      expansionSku: item.expansion?.sku ?? null,
      expansionCapacityKwh: item.expansion?.capacityWh ? item.expansion.capacityWh / 1000 : null,
      expansionPriceGbp: item.expansion ? pounds(item.expansion.perUnitMinor) : null,
      expansionMaxUnits: item.expansion?.maxUnits ?? null,
      multiUnitDiscountGbp: item.additionalUnitDiscountMinor
        ? pounds(item.additionalUnitDiscountMinor)
        : 0,
      sortOrder: i + 1,
    });
  });

  // Extras: scaffold, electrical, EV, optimisers, bird mesh, EPS, admin.
  const extras: CatalogueExtra[] = [];
  list.items
    .filter((i) => ['scaffold', 'electrical', 'optional', 'admin', 'other'].includes(i.category))
    .forEach((item, i) => {
      const extra = extraOf(item, i + 1);
      if (extra) extras.push(extra);
      else skip(item, 'priced individually or in a shape the quote engine cannot evaluate');
    });

  // Trenching bands (the engine prices none unless a config asks).
  const trenching: CatalogueTrenching[] = [];
  list.items
    .filter((i) => i.category === 'trenching' && i.pricing.kind === 'tiered')
    .forEach((item) => {
      if (item.pricing.kind !== 'tiered') return;
      const surface = /hard/i.test(item.key) ? 'hard' : 'soft';
      item.pricing.tiers.forEach((t, j) =>
        trenching.push({
          sku: t.sku ?? `${item.key}-${j + 1}`,
          surface,
          metresFrom: t.from,
          metresTo: t.to,
          perMetreGbp: pounds(t.perUnitMinor),
          fixedFeeGbp: pounds(t.flatMinor),
          isBespoke: t.bespoke,
          sortOrder: trenching.length + 1,
        }),
      );
    });

  if (mounting.length === 0) return null;
  const budgetBands: BudgetBand[] = list.budgetBands.map((b) => ({
    id: b.id,
    label: b.label,
    minGbp: pounds(b.minMinor),
    maxGbp: b.maxMinor === null ? 30000 : pounds(b.maxMinor),
  }));
  const maxTablePanels = Math.max(...pvRows.map((r) => r.quantity));
  const minTablePanels = Math.min(...pvRows.map((r) => r.quantity));

  return {
    skipped,
    pricing: {
      catalogue: {
        version: list.sourceVersion ?? 'published',
        panels,
        inverters,
        pvBasePrice,
        mounting,
        batteries,
        extras,
        trenching,
      },
      currency: 'GBP',
      vatRatePercent: list.vatRatePercent,
      pricesIncludeVat: list.pricesIncludeVat,
      priceStatus: list.items.some((i) => i.priceStatus === 'indicative')
        ? 'indicative'
        : 'verified',
      budgetBands,
      // The installer's optional optimisation uplift: off unless the price
      // list sets it up (Price list → Sentinel in the dashboard).
      sentinel: sentinelConfigFrom(list.sentinel),
      warranty: {},
      // Never size beyond the rows the list actually prices.
      assumptions: { maxPanels: maxTablePanels, minPanels: Math.max(6, minTablePanels) },
      installerPriced,
      source: {
        kind: 'catalogue',
        version: list.sourceVersion ?? 'published',
        label: list.sourceRef ?? "The installer's price list",
      },
    },
  };
}

/**
 * The price list's Sentinel settings (percentages, as installers write them)
 * in the engine's shape (fractions). Null -- no uplift -- when absent or off.
 */
export function sentinelConfigFrom(s: PriceList['sentinel']): SentinelConfig | null {
  if (!s || !s.enabled) return null;
  const fraction = (record: Record<string, number>) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v / 100]));
  return {
    enabled: true,
    baseUpliftPercent: s.basePercent / 100,
    tariffModifiers: fraction(s.tariffPercent),
    batteryRequiredForFullUplift: s.batteryRequiredForFullUplift,
    noBatteryUpliftFactor: s.noBatteryPercent / 100,
    lifestyleBonus: fraction(s.lifestylePercent),
    capUpliftPercent: s.capPercent / 100,
    addedCostGbp: s.addedCostMinor / 100,
  };
}

/** Prices from each tenant's published price list; none published → no prices. */
export function catalogueBackedPricing(store: Store): PricingSource {
  return {
    async forTenant(tenantId) {
      const list = await getPublishedPriceList(store, tenantId);
      return list ? (pricingFromPriceList(list)?.pricing ?? null) : null;
    },
  };
}
