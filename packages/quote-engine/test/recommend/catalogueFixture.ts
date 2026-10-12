// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\__tests__\catalogueFixture.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { PricingCatalogue } from '../../src/pricing/types.js';
import type { OptionSetInput } from '../../src/recommend/optionTypes.js';

/**
 * Compact but complete-enough catalogue for engine tests. Covers all three
 * product classes for panels (budget/standard/premium), inverters and batteries
 * so the catalogue-driven tier selection can pick distinct hardware per tier,
 * plus pitched mounting and Tigo/bird-mesh/EPS/admin extras so computeQuote
 * prices cleanly. PV base price is synthetic but strictly monotonic in count.
 */
export function makeTestCatalogue(): PricingCatalogue {
  const pvBasePrice = Array.from({ length: 50 }, (_, i) => {
    const panelCount = i + 1;
    return {
      panelCount,
      kwp: Math.round(panelCount * 0.43 * 100) / 100,
      priceGbp: 3900 + panelCount * 250,
    };
  });

  return {
    version: 'test',
    panels: [
      {
        sku: 'DMEGC-DM430',
        modelName: 'DMEGC 430W',
        manufacturer: 'DMEGC',
        wattPeak: 430,
        widthMm: 1134,
        heightMm: 1722,
        depthMm: 30,
        upliftType: 'base',
        upliftValue: 0,
        productTier: 'budget',
        isBase: true,
        sortOrder: 1,
      },
      {
        sku: 'DMEGC-DM455',
        modelName: 'DMEGC 455W',
        manufacturer: 'DMEGC',
        wattPeak: 455,
        widthMm: 1134,
        heightMm: 1722,
        depthMm: 30,
        upliftType: 'percent',
        upliftValue: 0.075,
        productTier: 'standard',
        isBase: false,
        sortOrder: 2,
      },
      {
        sku: 'REA-HD96-460',
        modelName: 'REA 460W Bifacial',
        manufacturer: 'REA',
        wattPeak: 460,
        widthMm: 1134,
        heightMm: 1722,
        depthMm: 30,
        upliftType: 'percent',
        upliftValue: 0.08,
        productTier: 'premium',
        isBase: false,
        sortOrder: 3,
      },
    ],
    inverters: [
      {
        sku: 'INV-BUDGET',
        modelName: 'Budget Hybrid 3.7kW',
        manufacturer: 'Test',
        ratedKw: 3.7,
        efficiency: 0.97,
        productTier: 'budget',
        priceGbp: 0,
        isDefault: false,
        sortOrder: 1,
      },
      {
        sku: 'INV-STD',
        modelName: 'Standard Hybrid 5kW',
        manufacturer: 'Test',
        ratedKw: 5,
        efficiency: 0.97,
        productTier: 'standard',
        priceGbp: 0,
        isDefault: true,
        sortOrder: 2,
      },
      {
        sku: 'INV-PREM',
        modelName: 'Premium Hybrid 8kW',
        manufacturer: 'Test',
        ratedKw: 8,
        efficiency: 0.975,
        productTier: 'premium',
        priceGbp: 0,
        isDefault: false,
        sortOrder: 3,
      },
    ],
    pvBasePrice,
    mounting: [
      {
        sku: 'MOUNT-PITCHED-TILE',
        label: 'Pitched tile',
        pricePerPanel: 30,
        appliesTo: 'pitched',
        isDefault: true,
        sortOrder: 1,
      },
    ],
    batteries: [
      {
        sku: 'FOX-EC2900',
        modelName: 'Fox EC2900 5.8kWh',
        tier: 'standard',
        baseCapacityKwh: 5.8,
        priceWithSolar: 2595,
        priceRetrofit: 3195,
        expansionSku: null,
        expansionCapacityKwh: null,
        expansionPriceGbp: null,
        expansionMaxUnits: null,
        multiUnitDiscountGbp: 0,
        sortOrder: 1,
      },
      {
        sku: 'FOX-EVO-1024',
        modelName: 'Fox EVO 10.24kWh',
        tier: 'premium',
        baseCapacityKwh: 10.24,
        priceWithSolar: 4295,
        priceRetrofit: 4995,
        expansionSku: null,
        expansionCapacityKwh: null,
        expansionPriceGbp: null,
        expansionMaxUnits: null,
        multiUnitDiscountGbp: 0,
        sortOrder: 2,
      },
    ],
    extras: [
      {
        sku: 'ELEC-ADMIN-FEE',
        category: 'general_electrical',
        label: 'Admin fee',
        priceCalc: 'flat',
        baseGbp: 350,
        perPanelGbp: 0,
        panelThreshold: null,
        isMandatory: true,
        exclusiveGroup: null,
        sortOrder: 5,
      },
      {
        sku: 'OPT-TIGO-FULL',
        category: 'optimiser',
        label: 'Tigo full',
        priceCalc: 'per_panel',
        baseGbp: 0,
        perPanelGbp: 50,
        panelThreshold: null,
        isMandatory: false,
        exclusiveGroup: 'tigo',
        sortOrder: 2,
      },
      {
        sku: 'OPT-BIRDMESH',
        category: 'bird_mesh',
        label: 'Bird mesh',
        priceCalc: 'per_panel_with_threshold',
        baseGbp: 600,
        perPanelGbp: 30,
        panelThreshold: 20,
        isMandatory: false,
        exclusiveGroup: null,
        sortOrder: 1,
      },
      {
        sku: 'EPS-FOX',
        category: 'eps',
        label: 'Fox EPS',
        priceCalc: 'flat',
        baseGbp: 825,
        perPanelGbp: 0,
        panelThreshold: null,
        isMandatory: false,
        exclusiveGroup: 'eps',
        sortOrder: 1,
      },
    ],
    trenching: [],
  };
}

export function makeInput(overrides: Partial<OptionSetInput> = {}): OptionSetInput {
  return {
    catalogue: makeTestCatalogue(),
    roofMaxPanels: 20,
    roofType: 'pitched',
    pitchDeg: 35,
    mcsOrientationDeg: 0,
    solarInsights: null,
    annualKwh: 4200,
    importTariffPence: 27,
    exportTariffPence: 15,
    tariffType: 'standard',
    lifestyle: [],
    motivation: null,
    existing: null,
    sentinelConfig: null,
    mcsZone: '1',
    irradianceKwhPerM2: 950,
    shadingLoss: 0.05,
    inverterLoss: 0.03,
    systemLoss: 0.1,
    energyInflationRate: 0.03,
    panelDegradationPerYear: 0.005,
    minPanels: 6,
    maxPanels: 50,
    marginPercent: 0,
    budgetMaxGbp: 10000,
    ...overrides,
  };
}
