// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\pricing\tiers.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { PricingCatalogue, PricingContext, SystemConfig, Tier } from './types.js';
import { extraSkuByCategory, selectTierHardware } from './tierHardware.js';

export const KWH_PER_KWP_UK = 950; // typical UK annual yield

type PresetTier = Exclude<Tier, 'custom'>;

// Each tier targets a clearly different share of annual demand so the three
// options span a real size range (essential ≈ part-cover, premium ≈ roof-fill).
// buildOptionSet additionally enforces a minimum gap between the final picks.
export const TIER_DEMAND_FACTOR: Record<PresetTier, number> = {
  essential: 0.45,
  standard: 0.8,
  premium: 1.15,
};

/**
 * Choose a target panel count from annual demand using the tier's own panel
 * wattage:
 *   target_kWp = (annualKwh × demandFactor) / 950 kWh/kWp
 *   panel_count = ceil(target_kWp × 1000 / panelW)
 * Clamped to [6, roofMaxPanels] (never exceeding the roof).
 */
function targetPanelCountForTier(ctx: PricingContext, panelW: number, tier: PresetTier): number {
  const targetKwh = ctx.annualKwh * TIER_DEMAND_FACTOR[tier];
  const targetKwp = targetKwh / KWH_PER_KWP_UK;
  const rawCount = Math.ceil((targetKwp * 1000) / panelW);
  const capped = Math.min(rawCount, ctx.roofMaxPanels);
  return Math.min(ctx.roofMaxPanels, Math.max(6, capped));
}

function defaultMountingSku(ctx: PricingContext): string {
  const match = ctx.catalogue.mounting.find((m) => m.appliesTo === ctx.roofType && m.isDefault);
  if (match) return match.sku;
  // Fall back to any mounting matching roof type
  const fallback = ctx.catalogue.mounting.find((m) => m.appliesTo === ctx.roofType);
  if (fallback) return fallback.sku;
  // Final fallback
  return ctx.catalogue.mounting[0]?.sku ?? 'MOUNT-PITCHED-TILE';
}

function panelWattFor(ctx: PricingContext, resolvedSku: string): number {
  return ctx.catalogue.panels.find((p) => p.sku === resolvedSku)?.wattPeak ?? 430;
}

/**
 * Build the three preset tier configurations for a given context. Hardware
 * (panel / inverter / battery) is selected algorithmically from the installer's
 * own catalogue — no hardcoded SKUs — so each tier has a genuinely distinct
 * profile wherever the catalogue supports it, and degrades gracefully otherwise.
 * Each tier is sized from its own demand factor and panel wattage, then clamped
 * to the roof.
 */
export function buildTierPresets(ctx: PricingContext): Record<PresetTier, SystemConfig> {
  const mounting = defaultMountingSku(ctx);
  const hardware = selectTierHardware(ctx.catalogue);
  const epsSku = extraSkuByCategory(ctx.catalogue, 'eps');

  const build = (tier: PresetTier): SystemConfig => {
    const hw = hardware[tier];
    const panelCount = targetPanelCountForTier(ctx, panelWattFor(ctx, hw.panelSku), tier);
    const premiumExtras = tier === 'premium' && epsSku ? [{ sku: epsSku, quantity: 1 }] : [];
    return {
      tier,
      panelSku: hw.panelSku,
      panelCount,
      mountingSku: mounting,
      inverterSku: hw.inverterSku,
      battery: hw.batterySku ? { sku: hw.batterySku, expansionUnits: 0, isRetrofit: false } : null,
      scaffoldingExtras: [],
      electricalExtras: [],
      optionalExtras: premiumExtras,
      trenching: null,
      birdMesh: tier === 'premium',
      optimiserScope: tier === 'essential' ? 'none' : 'full',
    };
  };

  return {
    essential: build('essential'),
    standard: build('standard'),
    premium: build('premium'),
  };
}

/**
 * Build the "what's included" bullet list for a configuration directly from the
 * resolved catalogue hardware, so the copy is always accurate for the installer
 * (no hardcoded brand/model strings).
 */
export function buildInclusions(config: SystemConfig, catalogue: PricingCatalogue): string[] {
  const out: string[] = [];

  const panel = catalogue.panels.find((p) => p.sku === config.panelSku);
  if (panel) out.push(`${panel.wattPeak}W panels (${panel.modelName})`);

  const inverter = config.inverterSku
    ? catalogue.inverters.find((i) => i.sku === config.inverterSku)
    : (catalogue.inverters.find((i) => i.isDefault) ?? catalogue.inverters[0]);
  if (inverter) out.push(`${inverter.modelName} inverter & isolators`);

  if (config.battery) {
    const battery = catalogue.batteries.find((b) => b.sku === config.battery!.sku);
    if (battery) out.push(`${battery.modelName} ${battery.baseCapacityKwh} kWh battery`);
  }

  if (config.optimiserScope === 'full') out.push('Power optimisers (full system)');
  else if (config.optimiserScope === 'partial') out.push('Power optimisers (partial)');

  if (config.birdMesh) out.push('Bird-proofing mesh');

  for (const item of config.optionalExtras) {
    const extra = catalogue.extras.find((e) => e.sku === item.sku);
    if (extra) out.push(extra.label);
  }

  out.push('Mounting kit & fixings');
  out.push('Installation & DNO application');
  return out;
}
