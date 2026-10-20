// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\pricing\computeQuote.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type {
  CatalogueExtra,
  LineItemCategory,
  PricingContext,
  QuoteBreakdown,
  QuoteLineItem,
  SystemConfig,
} from './types.js';

const ZERO_SUBTOTALS: Record<LineItemCategory, number> = {
  pv: 0,
  panel_uplift: 0,
  mounting: 0,
  battery: 0,
  scaffold: 0,
  electrical: 0,
  optional: 0,
  trenching: 0,
  admin: 0,
};

/**
 * Deterministic quote builder. Pure function — no I/O.
 * Sums line items in a fixed order so the breakdown is stable across runs.
 */
export function computeQuote(config: SystemConfig, ctx: PricingContext): QuoteBreakdown {
  const { catalogue, roofType } = ctx;
  const lineItems: QuoteLineItem[] = [];
  const warnings: string[] = [];

  const panel = catalogue.panels.find((p) => p.sku === config.panelSku);
  if (!panel) {
    throw new Error(`Unknown panelSku: ${config.panelSku}`);
  }

  const panelCount = Math.max(1, Math.min(50, Math.round(config.panelCount)));
  if (panelCount !== config.panelCount) {
    warnings.push(`Panel count clamped to ${panelCount} (valid range 1–50).`);
  }

  // ── 1. PV base ──────────────────────────────────────────────────────────
  const basePriceRow = catalogue.pvBasePrice.find((r) => r.panelCount === panelCount);
  if (!basePriceRow) {
    throw new Error(`No PV base price for ${panelCount} panels`);
  }
  lineItems.push({
    sku: 'PV-BASE',
    category: 'pv',
    label: `${panelCount} × ${panel.wattPeak}W solar PV system (${basePriceRow.kwp} kWp)`,
    quantity: 1,
    unitGbp: basePriceRow.priceGbp,
    totalGbp: basePriceRow.priceGbp,
  });

  // ── 2. Panel uplift ─────────────────────────────────────────────────────
  if (panel.upliftType === 'percent' && panel.upliftValue > 0) {
    const upliftAmount = Math.round(basePriceRow.priceGbp * panel.upliftValue);
    lineItems.push({
      sku: panel.sku,
      category: 'panel_uplift',
      label: `${panel.modelName} uplift (+${(panel.upliftValue * 100).toFixed(1)}%)`,
      quantity: 1,
      unitGbp: upliftAmount,
      totalGbp: upliftAmount,
    });
  } else if (panel.upliftType === 'flat_per_panel' && panel.upliftValue > 0) {
    const total = Math.round(panelCount * panel.upliftValue);
    lineItems.push({
      sku: panel.sku,
      category: 'panel_uplift',
      label: `${panel.modelName} uplift`,
      quantity: panelCount,
      unitGbp: panel.upliftValue,
      totalGbp: total,
    });
  }

  // ── 2.5 Inverter ──────────────────────────────────────────────────────────
  // Inverters seed at £0 (bundled into PV base). When an installer prices a
  // specific inverter, the non-default choice surfaces as its own line item.
  if (config.inverterSku) {
    const inverter = catalogue.inverters.find((i) => i.sku === config.inverterSku);
    if (!inverter) {
      warnings.push(`Unknown inverterSku: ${config.inverterSku} — no inverter line added.`);
    } else if (inverter.priceGbp > 0) {
      lineItems.push({
        sku: inverter.sku,
        category: 'electrical',
        label: `${inverter.modelName} (${inverter.ratedKw} kW)`,
        quantity: 1,
        unitGbp: inverter.priceGbp,
        totalGbp: inverter.priceGbp,
      });
    }
  }

  // ── 3. Mounting ─────────────────────────────────────────────────────────
  const mounting = catalogue.mounting.find((m) => m.sku === config.mountingSku);
  if (mounting) {
    const total = mounting.pricePerPanel * panelCount;
    lineItems.push({
      sku: mounting.sku,
      category: 'mounting',
      label: mounting.label,
      quantity: panelCount,
      unitGbp: mounting.pricePerPanel,
      totalGbp: total,
    });
  } else {
    warnings.push(`Unknown mountingSku: ${config.mountingSku} — no mounting line added.`);
  }

  // ── 4. Battery ──────────────────────────────────────────────────────────
  if (config.battery) {
    const battery = catalogue.batteries.find((b) => b.sku === config.battery!.sku);
    if (battery) {
      const basePrice = config.battery.isRetrofit ? battery.priceRetrofit : battery.priceWithSolar;
      lineItems.push({
        sku: battery.sku,
        category: 'battery',
        label: `${battery.modelName} ${battery.baseCapacityKwh} kWh${
          config.battery.isRetrofit ? ' (retrofit)' : ''
        }`,
        quantity: 1,
        unitGbp: basePrice,
        totalGbp: basePrice,
      });

      // Expansion units
      if (battery.expansionSku && battery.expansionPriceGbp && battery.expansionMaxUnits) {
        const requested = Math.max(0, Math.round(config.battery.expansionUnits));
        const units = Math.min(requested, battery.expansionMaxUnits);
        if (requested > battery.expansionMaxUnits) {
          warnings.push(
            `${battery.modelName} expansion capped at ${battery.expansionMaxUnits} units (requested ${requested}).`,
          );
        }
        if (units > 0) {
          const total = units * battery.expansionPriceGbp;
          lineItems.push({
            sku: battery.expansionSku,
            category: 'battery',
            label: `Expansion module (+${battery.expansionCapacityKwh} kWh × ${units})`,
            quantity: units,
            unitGbp: battery.expansionPriceGbp,
            totalGbp: total,
          });
        }
      }

      // Multi-unit discount (Fox EVO: -£200 per additional EVO)
      const multiUnits = config.battery.multiplePremiumUnits ?? 1;
      if (multiUnits > 1 && battery.multiUnitDiscountGbp > 0) {
        const additional = multiUnits - 1;
        const additionalCost = additional * basePrice;
        const discount = additional * battery.multiUnitDiscountGbp;
        lineItems.push({
          sku: `${battery.sku}-EXTRA`,
          category: 'battery',
          label: `Additional ${battery.modelName} (× ${additional})`,
          quantity: additional,
          unitGbp: basePrice,
          totalGbp: additionalCost,
        });
        lineItems.push({
          sku: `${battery.sku}-DISCOUNT`,
          category: 'battery',
          label: `Multi-unit discount`,
          quantity: additional,
          unitGbp: -battery.multiUnitDiscountGbp,
          totalGbp: -discount,
        });
      }
    } else {
      warnings.push(`Unknown battery sku: ${config.battery.sku}`);
    }
  }

  const extrasBySku = new Map<string, CatalogueExtra>(catalogue.extras.map((e) => [e.sku, e]));

  // ── 5. Scaffolding extras ───────────────────────────────────────────────
  for (const item of config.scaffoldingExtras) {
    const extra = extrasBySku.get(item.sku);
    if (!extra) {
      warnings.push(`Unknown scaffolding sku: ${item.sku}`);
      continue;
    }
    const qty = Math.max(0, Math.round(item.quantity));
    if (qty === 0) continue;
    const unit = extra.baseGbp;
    const total = unit * qty;
    lineItems.push({
      sku: extra.sku,
      category: 'scaffold',
      label: extra.label + (qty > 1 ? ` × ${qty}` : ''),
      quantity: qty,
      unitGbp: unit,
      totalGbp: total,
    });
  }

  // ── 6. Electrical extras ────────────────────────────────────────────────
  for (const item of config.electricalExtras) {
    const extra = extrasBySku.get(item.sku);
    if (!extra) {
      warnings.push(`Unknown electrical sku: ${item.sku}`);
      continue;
    }
    const qty = Math.max(0, Math.round(item.quantity));
    if (qty === 0) continue;
    const unit = extra.baseGbp;
    const total = unit * qty;
    lineItems.push({
      sku: extra.sku,
      category: 'electrical',
      label: extra.label + (qty > 1 ? ` × ${qty}` : ''),
      quantity: qty,
      unitGbp: unit,
      totalGbp: total,
    });
  }

  // Auto-add flat-roof structural survey when applicable
  if (roofType === 'flat') {
    const survey = catalogue.extras.find(
      (e) => e.category === 'structural' && e.sku === 'STRUCT-FLATROOF-SURVEY',
    );
    if (survey && !config.electricalExtras.find((x) => x.sku === survey.sku)) {
      lineItems.push({
        sku: survey.sku,
        category: 'electrical',
        label: survey.label,
        quantity: 1,
        unitGbp: survey.baseGbp,
        totalGbp: survey.baseGbp,
      });
    }
  }

  // ── 7. Optional extras ──────────────────────────────────────────────────
  // Handle Tigo optimisers via optimiserScope first (so it can't be picked twice)
  if (config.optimiserScope === 'partial') {
    const tigo = catalogue.extras.find((e) => e.sku === 'OPT-TIGO-PART');
    const optPanels = Math.max(0, Math.min(panelCount, config.optimiserPanelCount ?? panelCount));
    if (tigo && optPanels > 0) {
      lineItems.push({
        sku: tigo.sku,
        category: 'optional',
        label: `${tigo.label} (${optPanels} panels)`,
        quantity: optPanels,
        unitGbp: tigo.perPanelGbp,
        totalGbp: tigo.perPanelGbp * optPanels,
      });
    }
  } else if (config.optimiserScope === 'full') {
    const tigo = catalogue.extras.find((e) => e.sku === 'OPT-TIGO-FULL');
    if (tigo) {
      lineItems.push({
        sku: tigo.sku,
        category: 'optional',
        label: tigo.label,
        quantity: panelCount,
        unitGbp: tigo.perPanelGbp,
        totalGbp: tigo.perPanelGbp * panelCount,
      });
    }
  }

  // Bird mesh (£600 up to 20 panels, +£30/panel onwards)
  if (config.birdMesh) {
    const mesh = catalogue.extras.find((e) => e.sku === 'OPT-BIRDMESH');
    if (mesh) {
      const threshold = mesh.panelThreshold ?? 20;
      const overage = Math.max(0, panelCount - threshold);
      const total = mesh.baseGbp + overage * mesh.perPanelGbp;
      lineItems.push({
        sku: mesh.sku,
        category: 'optional',
        label: `${mesh.label} (${panelCount} panels)`,
        quantity: 1,
        unitGbp: total,
        totalGbp: total,
      });
    }
  }

  // Other optional extras (EV, EPS, microinverter, etc.)
  const seenExclusive = new Set<string>();
  for (const item of config.optionalExtras) {
    const extra = extrasBySku.get(item.sku);
    if (!extra) {
      warnings.push(`Unknown optional sku: ${item.sku}`);
      continue;
    }
    // Skip Tigo + bird mesh — already handled via dedicated flags
    if (extra.sku.startsWith('OPT-TIGO') || extra.sku === 'OPT-BIRDMESH') continue;

    if (extra.exclusiveGroup) {
      if (seenExclusive.has(extra.exclusiveGroup)) {
        warnings.push(
          `Multiple items in mutually-exclusive group "${extra.exclusiveGroup}" — using first.`,
        );
        continue;
      }
      seenExclusive.add(extra.exclusiveGroup);
    }

    const qty = Math.max(0, Math.round(item.quantity));
    if (qty === 0) continue;

    let unit = extra.baseGbp;
    let total = unit * qty;
    let label = extra.label;

    if (extra.priceCalc === 'fixed_plus_per_panel') {
      // Enphase microinverter: £250 flat + £150/panel
      total = (extra.baseGbp + extra.perPanelGbp * panelCount) * qty;
      unit = total / qty;
      label += ` (${panelCount} panels)`;
    } else if (extra.priceCalc === 'per_panel') {
      total = extra.perPanelGbp * panelCount * qty;
      unit = extra.perPanelGbp;
      label += ` (${panelCount} panels)`;
    } else if (extra.priceCalc === 'per_panel_with_threshold') {
      const threshold = extra.panelThreshold ?? 0;
      const overage = Math.max(0, panelCount - threshold);
      total = (extra.baseGbp + overage * extra.perPanelGbp) * qty;
      unit = total / qty;
    }

    lineItems.push({
      sku: extra.sku,
      category: 'optional',
      label: label + (qty > 1 ? ` × ${qty}` : ''),
      quantity: qty,
      unitGbp: Math.round(unit),
      totalGbp: Math.round(total),
    });
  }

  // ── 8. Trenching ────────────────────────────────────────────────────────
  if (config.trenching && config.trenching.metres > 0) {
    const { surface, metres } = config.trenching;
    const tier = catalogue.trenching
      .filter((t) => t.surface === surface && !t.isBespoke)
      .find((t) => metres >= t.metresFrom && (t.metresTo == null || metres <= t.metresTo));

    if (tier) {
      const total = metres * tier.perMetreGbp + tier.fixedFeeGbp;
      lineItems.push({
        sku: tier.sku,
        category: 'trenching',
        label: `${surface === 'soft' ? 'Soft' : 'Hard'} ground trenching (${metres}m, 450mm depth)`,
        quantity: metres,
        unitGbp: tier.perMetreGbp,
        totalGbp: total,
      });
    } else {
      warnings.push(
        `Trenching distance ${metres}m on ${surface} ground requires a bespoke quote. Please contact us.`,
      );
      lineItems.push({
        sku: `TRENCH-${surface.toUpperCase()}-BESPOKE`,
        category: 'trenching',
        label: `${surface === 'soft' ? 'Soft' : 'Hard'} ground trenching (${metres}m), bespoke`,
        quantity: 1,
        unitGbp: 0,
        totalGbp: 0,
      });
    }
  }

  // ── 9. Mandatory admin fee ──────────────────────────────────────────────
  for (const extra of catalogue.extras) {
    if (!extra.isMandatory) continue;
    lineItems.push({
      sku: extra.sku,
      category: 'admin',
      label: extra.label,
      quantity: 1,
      unitGbp: extra.baseGbp,
      totalGbp: extra.baseGbp,
    });
  }

  // ── Subtotals + total ───────────────────────────────────────────────────
  const subtotalsByCategory: Record<LineItemCategory, number> = { ...ZERO_SUBTOTALS };
  for (const item of lineItems) {
    subtotalsByCategory[item.category] += item.totalGbp;
  }
  const totalPounds = lineItems.reduce((sum, item) => sum + item.totalGbp, 0);

  return {
    lineItems,
    subtotalsByCategory,
    totalPounds: Math.round(totalPounds),
    vatRatePercent: 0,
    warnings,
    catalogueVersion: catalogue.version,
  };
}
