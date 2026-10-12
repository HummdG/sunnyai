import type { PricingCatalogue } from './pricing/types.js';
import type { SentinelConfig } from './recommend/sentinel.js';

/**
 * One installer's pricing, in the shape the ported SunScan engine prices from.
 *
 * The catalogue is keyed by SunScan's SKUs (`DMEGC-DM430`, `FOX-EC2900`,
 * `ELEC-ADMIN-FEE`, `SCAFFOLD-EXTRA-STOREY`, ...). The installer catalogue
 * (WS7) imports the same seed with identical SKUs, so a tenant's published
 * catalogue maps onto this one field for field; until that adapter exists the
 * demo tenant prices from the HSEnergy fixture and every other tenant gets
 * `null` (sizing and savings without prices).
 */
export interface TenantPricing {
  catalogue: PricingCatalogue;
  currency: 'GBP';
  /**
   * VAT the installer applies, or null when the price list does not say --
   * never assumed (the HSEnergy sheet states none).
   */
  vatRatePercent: number | null;
  /** Whether listed prices already include VAT; null when not stated. */
  pricesIncludeVat: boolean | null;
  /**
   * Items every quote includes that the list prices individually ("bespoke")
   * or not at all: shown as "priced by your installer", never given a figure.
   */
  installerPriced?: string[];
  /**
   * `verified`: the installer has confirmed these are its current prices.
   * `indicative`: a reference list. Every figure is non-binding either way.
   */
  priceStatus: 'verified' | 'indicative';
  budgetBands: BudgetBand[];
  /** SunScan's optional "Sentinel" optimisation uplift; null disables it. */
  sentinel: SentinelConfig | null;
  warranty: Record<string, string>;
  /** Overrides of the engine's sizing/loss defaults (v1 `installer.config`). */
  assumptions: Partial<EngineAssumptions>;
  source: { kind: 'demo-fixture' | 'catalogue'; version: string; label: string };
}

export interface BudgetBand {
  id: string;
  label: string;
  minGbp: number;
  maxGbp: number;
}

export interface EngineAssumptions {
  shadingLoss: number;
  inverterLoss: number;
  systemLoss: number;
  energyInflationRate: number;
  panelDegradationPerYear: number;
  minPanels: number;
  maxPanels: number;
  marginPercent: number;
}

/** v1's defaults when an installer config field is unset (journey/results route). */
export const DEFAULT_ENGINE_ASSUMPTIONS: EngineAssumptions = {
  shadingLoss: 0.05,
  inverterLoss: 0.03,
  systemLoss: 0.1,
  energyInflationRate: 0.03,
  panelDegradationPerYear: 0.005,
  minPanels: 6,
  maxPanels: 50,
  marginPercent: 0,
};

/** Where a tenant's pricing comes from. Returns null when it has none. */
export interface PricingSource {
  forTenant(tenantId: string): Promise<TenantPricing | null>;
}

interface PricelistFile {
  _demo?: string;
  vatRatePercent?: number | null;
  priceStatus?: 'verified' | 'indicative';
  catalogue: PricingCatalogue;
  config: {
    budgetBands: BudgetBand[];
    sentinel: (SentinelConfig & { enabled?: boolean }) | null;
    warranty: Record<string, string>;
  };
}

/**
 * Read a price-list file (the shape `scripts/import-sunscan-pricelist.mjs`
 * writes) into a `TenantPricing`. Validates enough to fail loudly on a broken
 * file rather than quote from half a catalogue.
 */
export function pricingFromFile(raw: unknown, label: string): TenantPricing {
  const file = raw as PricelistFile;
  const c = file?.catalogue;
  if (!c || !Array.isArray(c.pvBasePrice) || c.pvBasePrice.length === 0) {
    throw new Error(`${label}: price list has no PV base price table`);
  }
  if (!Array.isArray(c.panels) || !c.panels.some((p) => p.isBase)) {
    throw new Error(`${label}: price list has no base panel`);
  }
  if (!Array.isArray(c.mounting) || c.mounting.length === 0) {
    throw new Error(`${label}: price list has no mounting options`);
  }
  return {
    catalogue: c,
    currency: 'GBP',
    // Not assumed: a file that states no rate has none.
    vatRatePercent: file.vatRatePercent ?? null,
    pricesIncludeVat: null,
    priceStatus: file.priceStatus ?? 'indicative',
    budgetBands: file.config?.budgetBands ?? [],
    sentinel: file.config?.sentinel ?? null,
    warranty: file.config?.warranty ?? {},
    assumptions: {},
    source: { kind: 'demo-fixture', version: c.version, label },
  };
}
