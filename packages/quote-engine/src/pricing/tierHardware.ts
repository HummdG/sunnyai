// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\pricing\tierHardware.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type {
  CatalogueBattery,
  CatalogueExtra,
  CatalogueInverter,
  CataloguePanel,
  PricingCatalogue,
  ProductTier,
  Tier,
} from './types.js';

/**
 * Catalogue-driven tier hardware selection.
 *
 * The three SunScan packages (essential / standard / premium) must map to an
 * installer's *own* catalogue rather than hardcoded SKUs — every installer
 * onboards a different set of panels, inverters and batteries. We rank each
 * product family by capability and pick a representative for each tier, honouring
 * the catalogue's `productTier` / `tier` tags when present and degrading
 * gracefully (sharing hardware) when an installer has fewer products.
 */

type PresetTier = Exclude<Tier, 'custom'>;

export interface TierHardware {
  panelSku: string;
  inverterSku?: string;
  batterySku: string | null;
}

const CLASS_RANK: Record<ProductTier, number> = { budget: 0, standard: 1, premium: 2 };

/**
 * Choose a low / mid / high representative from `items`, ranked ascending by
 * capability. Honours explicit class tags (`classOf`) first; falls back to
 * positional selection so the result is always monotonic essential ≤ premium and
 * as distinct as the catalogue allows.
 */
function pickThree<T>(
  items: T[],
  classOf: (t: T) => ProductTier,
  capacityOf: (t: T) => number,
  sortOf: (t: T) => number,
): { essential?: T; standard?: T; premium?: T } {
  if (items.length === 0) return {};

  const asc = [...items].sort(
    (a, b) =>
      CLASS_RANK[classOf(a)] - CLASS_RANK[classOf(b)] ||
      capacityOf(a) - capacityOf(b) ||
      sortOf(a) - sortOf(b),
  );

  // Index (into `asc`) of the representative for a class, or -1 if absent.
  const classIndex = (cls: ProductTier, pos: 'low' | 'mid' | 'high'): number => {
    const inClass = asc.filter((x) => classOf(x) === cls);
    if (inClass.length === 0) return -1;
    const chosen =
      pos === 'low'
        ? inClass[0]
        : pos === 'high'
          ? inClass[inClass.length - 1]
          : inClass[Math.floor(inClass.length / 2)];
    return asc.indexOf(chosen!);
  };

  let eIdx = classIndex('budget', 'low');
  let pIdx = classIndex('premium', 'high');
  let sIdx = classIndex('standard', 'mid');

  if (eIdx < 0) eIdx = 0;
  if (pIdx < 0) pIdx = asc.length - 1;
  if (sIdx < 0) sIdx = Math.round((eIdx + pIdx) / 2);

  // Keep essential ≤ standard ≤ premium in capability.
  eIdx = Math.min(eIdx, pIdx);
  sIdx = Math.min(Math.max(sIdx, eIdx), pIdx);

  return { essential: asc[eIdx], standard: asc[sIdx], premium: asc[pIdx] };
}

function selectPanels(panels: CataloguePanel[]): Record<PresetTier, CataloguePanel | undefined> {
  // Prefer the installer's marked base panel as the essential anchor when present.
  const base = panels.find((p) => p.isBase);
  const picked = pickThree(
    panels,
    (p) => p.productTier,
    (p) => p.wattPeak,
    (p) => p.sortOrder,
  );
  return {
    essential: base ?? picked.essential,
    standard: picked.standard,
    premium: picked.premium,
  };
}

function selectInverters(
  inverters: CatalogueInverter[],
): Record<PresetTier, CatalogueInverter | undefined> {
  const picked = pickThree(
    inverters,
    (i) => i.productTier,
    (i) => i.ratedKw,
    (i) => i.sortOrder,
  );
  return { essential: picked.essential, standard: picked.standard, premium: picked.premium };
}

function selectBatteries(batteries: CatalogueBattery[]): {
  standard: CatalogueBattery | null;
  premium: CatalogueBattery | null;
} {
  if (batteries.length === 0) return { standard: null, premium: null };
  const asc = [...batteries].sort(
    (a, b) =>
      (a.tier === 'premium' ? 1 : 0) - (b.tier === 'premium' ? 1 : 0) ||
      a.baseCapacityKwh - b.baseCapacityKwh ||
      a.sortOrder - b.sortOrder,
  );
  // Use the entry of each class as the sensible default: smallest standard-class
  // for the standard tier, smallest premium-class for premium (a clear step up
  // without defaulting every premium quote to the most expensive flagship).
  // Installers can offer larger units as configurator upgrades.
  const standard = asc.find((b) => b.tier === 'standard') ?? asc[0] ?? null;
  const premium = asc.find((b) => b.tier === 'premium') ?? asc[asc.length - 1] ?? null;
  return { standard, premium };
}

/** First extra in a category (catalogue-driven; avoids hardcoding extra SKUs). */
export function extraSkuByCategory(
  catalogue: PricingCatalogue,
  category: CatalogueExtra['category'],
): string | undefined {
  return catalogue.extras.find((e) => e.category === category)?.sku;
}

/**
 * Resolve the panel / inverter / battery SKUs for all three tiers from an
 * installer's catalogue. Pure — no I/O. Essential never carries a battery.
 */
export function selectTierHardware(catalogue: PricingCatalogue): Record<PresetTier, TierHardware> {
  const panels = selectPanels(catalogue.panels);
  const inverters = selectInverters(catalogue.inverters);
  const batteries = selectBatteries(catalogue.batteries);

  const fallbackPanel = catalogue.panels[0]?.sku ?? '';

  return {
    essential: {
      panelSku: panels.essential?.sku ?? fallbackPanel,
      inverterSku: inverters.essential?.sku,
      batterySku: null,
    },
    standard: {
      panelSku: panels.standard?.sku ?? panels.essential?.sku ?? fallbackPanel,
      inverterSku: inverters.standard?.sku,
      batterySku: batteries.standard?.sku ?? null,
    },
    premium: {
      panelSku: panels.premium?.sku ?? panels.standard?.sku ?? fallbackPanel,
      inverterSku: inverters.premium?.sku,
      batterySku: batteries.premium?.sku ?? null,
    },
  };
}
