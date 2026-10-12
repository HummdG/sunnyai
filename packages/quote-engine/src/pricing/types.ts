// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\pricing\types.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

// Pricing engine wire types — shared between server and client.
// Source of truth for all configurator state.

export type RoofType = 'pitched' | 'flat' | 'ground';

export type Tier = 'essential' | 'standard' | 'premium' | 'custom';

export interface SystemConfig {
  tier: Tier;
  panelSku: string;
  panelCount: number;
  mountingSku: string;
  /** Inverter SKU for this configuration. Falls back to the catalogue default when unset. */
  inverterSku?: string;
  battery: {
    sku: string;
    expansionUnits: number;
    /** For Fox EVO multi-unit installs (rare). 1 = single EVO, 2+ triggers discount. */
    multiplePremiumUnits?: number;
    isRetrofit: boolean;
  } | null;
  scaffoldingExtras: Array<{ sku: string; quantity: number }>;
  electricalExtras: Array<{ sku: string; quantity: number }>;
  optionalExtras: Array<{ sku: string; quantity: number }>;
  trenching: { surface: 'soft' | 'hard'; metres: number } | null;
  birdMesh: boolean;
  optimiserScope: 'none' | 'partial' | 'full';
  /** When optimiserScope === 'partial', how many panels are optimised. */
  optimiserPanelCount?: number;
}

export type LineItemCategory =
  | 'pv'
  | 'panel_uplift'
  | 'mounting'
  | 'battery'
  | 'scaffold'
  | 'electrical'
  | 'optional'
  | 'trenching'
  | 'admin';

export interface QuoteLineItem {
  sku: string;
  category: LineItemCategory;
  label: string;
  quantity: number;
  unitGbp: number;
  totalGbp: number;
}

export interface QuoteBreakdown {
  lineItems: QuoteLineItem[];
  subtotalsByCategory: Record<LineItemCategory, number>;
  totalPounds: number;
  vatRatePercent: number;
  warnings: string[];
  catalogueVersion: string;
}

// ─── Catalogue snapshots (mirror Prisma rows, JSON-safe) ───────────────────

export type ProductTier = 'budget' | 'standard' | 'premium';

export interface CataloguePanel {
  sku: string;
  modelName: string;
  manufacturer: string;
  wattPeak: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  upliftType: 'base' | 'percent' | 'flat_per_panel';
  upliftValue: number;
  productTier: ProductTier;
  isBase: boolean;
  sortOrder: number;
}

export interface CatalogueInverter {
  sku: string;
  modelName: string;
  manufacturer: string;
  ratedKw: number;
  efficiency: number;
  productTier: ProductTier;
  priceGbp: number;
  isDefault: boolean;
  sortOrder: number;
}

export interface CataloguePvBasePrice {
  panelCount: number;
  kwp: number;
  priceGbp: number;
}

export interface CatalogueMounting {
  sku: string;
  label: string;
  pricePerPanel: number;
  appliesTo: RoofType;
  isDefault: boolean;
  sortOrder: number;
}

export interface CatalogueBattery {
  sku: string;
  modelName: string;
  tier: 'standard' | 'premium';
  baseCapacityKwh: number;
  priceWithSolar: number;
  priceRetrofit: number;
  expansionSku: string | null;
  expansionCapacityKwh: number | null;
  expansionPriceGbp: number | null;
  expansionMaxUnits: number | null;
  multiUnitDiscountGbp: number;
  sortOrder: number;
}

export interface CatalogueExtra {
  sku: string;
  category:
    | 'scaffold'
    | 'general_electrical'
    | 'ev'
    | 'optimiser'
    | 'bird_mesh'
    | 'eps'
    | 'microinverter'
    | 'structural';
  label: string;
  priceCalc: 'flat' | 'per_panel' | 'per_panel_with_threshold' | 'fixed_plus_per_panel';
  baseGbp: number;
  perPanelGbp: number;
  panelThreshold: number | null;
  isMandatory: boolean;
  exclusiveGroup: string | null;
  sortOrder: number;
}

export interface CatalogueTrenching {
  sku: string;
  surface: 'soft' | 'hard';
  metresFrom: number;
  metresTo: number | null;
  perMetreGbp: number;
  fixedFeeGbp: number;
  isBespoke: boolean;
  sortOrder: number;
}

export interface PricingCatalogue {
  version: string;
  panels: CataloguePanel[];
  inverters: CatalogueInverter[];
  pvBasePrice: CataloguePvBasePrice[];
  mounting: CatalogueMounting[];
  batteries: CatalogueBattery[];
  extras: CatalogueExtra[];
  trenching: CatalogueTrenching[];
}

export interface PricingContext {
  catalogue: PricingCatalogue;
  /** Maximum panels physically fitting on the roof. */
  roofMaxPanels: number;
  /** Annual demand from bill (kWh) — drives tier preset sizing. */
  annualKwh: number;
  /** Roof type — drives default mounting and structural-survey gating. */
  roofType: RoofType;
}

export interface TierPresetSummary {
  tier: 'essential' | 'standard' | 'premium';
  config: SystemConfig;
  totalPounds: number;
  panelCount: number;
  kwp: number;
  inclusions: string[];
}
