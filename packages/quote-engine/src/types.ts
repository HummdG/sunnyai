// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\types.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { QuoteBreakdown } from './pricing/types.js';

// Central TypeScript types shared between server and client

// ─── OS API ──────────────────────────────────────────────────────────────────

export interface OsAddress {
  uprn: string;
  address: string; // formatted single-line address
  lat: number;
  lng: number;
  postcode: string;
}

export interface RoofAspect {
  n: number;
  ne: number;
  e: number;
  se: number;
  s: number;
  sw: number;
  w: number;
  nw: number;
}

export interface OsBuilding {
  /** WGS84 polygon ring(s): [[lng, lat], ...] */
  footprintPolygon: [number, number][];
  source: 'os_ngd' | 'estimated';
  areaM2: number;
  /** Height from ground to eave/wall top (m) */
  eaveHeightM?: number;
  /** Height from ground to roof ridge (m) */
  ridgeHeightM?: number;
  /** Roof area facing each of 8 compass directions (m²) — only present for os_ngd source */
  roofAspect?: RoofAspect;
  /** True compass bearing (0=N, 180=S) of the best solar-facing slope, derived from roofAspect */
  roofAzimuthDeg?: number;
  /** Roof pitch angle (degrees) derived from OS eave/ridge heights */
  roofPitchDeg?: number;
  /** All building sections from OS NGD, sorted largest first.
   *  Only present when source === 'os_ngd' and multiple parts exist. */
  parts?: BuildingPart[];
  /** Per-plane roof segment hints, used as auxiliary input for the spec
   *  generation LLM. Typically derived from GoogleSolar.roofSegmentStats. */
  roofSegments?: Array<{
    pitchDeg: number;
    azimuthDeg: number;
    areaM2: number;
    centerLng: number;
    centerLat: number;
  }>;
}

export interface BuildingPart {
  /** WGS84 polygon ring for this building section */
  footprintPolygon: [number, number][];
  areaM2: number;
  eaveHeightM?: number;
  ridgeHeightM?: number;
  roofPitchDeg?: number;
}

// ─── Bill parsing ─────────────────────────────────────────────────────────────

export interface ParsedBill {
  annualKwh: number;
  tariffPencePerKwh: number;
  standingChargePencePerDay: number;
  exportTariffPencePerKwh: number;
  confidence: 'high' | 'medium' | 'low';
}

// ─── System specs ─────────────────────────────────────────────────────────────

export interface PanelSpec {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  wattPeak: number;
  modelName: string;
}

export interface InverterSpec {
  modelName: string;
  ratedKw: number;
  efficiency: number; // 0–1
}

export interface BatterySpec {
  modelName: string;
  capacityKwh: number;
  roundTripEfficiency: number; // 0–1
}

// ─── Solar assumptions ───────────────────────────────────────────────────────

export interface SolarAssumptions {
  roofPitchDeg: number;
  roofOrientationDeg: number; // 0=South (MCS convention), 90=East/West, 180=North
  shadingLoss: number; // 0–1, e.g. 0.05 for 5%
  inverterLoss: number; // 0–1
  systemLoss: number; // 0–1
  systemCostPounds: number;
  hasBattery: boolean;
  batteryKwh: number;
  exportTariffPencePerKwh: number;
  /** Annual energy price inflation used for the 25-year projection (0–1, default 0.03). */
  energyInflationRate?: number;
  /** Annual panel degradation rate used for the 25-year projection (0–1, default 0.005). */
  panelDegradationPerYear?: number;
}

// ─── Roof geometry ───────────────────────────────────────────────────────────

export interface RoofPlane {
  /** corners in local metres [x, z] relative to building centroid */
  cornersLocal: [number, number][];
  facingDeg: number; // compass bearing, 0=N
  orientationDeg: number; // MCS convention, 0=S
  tiltDeg: number;
  areaM2: number;
  normal: [number, number, number]; // unit normal in 3D local space
}

// ─── Panel layout ─────────────────────────────────────────────────────────────

export interface PanelPosition {
  col: number;
  row: number;
  /** centre position in 3D local space (metres) */
  x: number;
  y: number;
  z: number;
  /** rotation in radians around the roof plane Y axis */
  rotationY: number;
}

// ─── Solar calculation results ───────────────────────────────────────────────

export interface SolarResults {
  annualGenerationKwh: number;
  selfConsumptionKwh: number;
  exportKwh: number;
  selfConsumptionRate: number; // 0–1
  annualSavingsPounds: number;
  paybackYears: number;
  co2SavedTonnesPerYear: number;
  /** kWh per month, index 0=Jan */
  monthlyGenKwh: number[];
  /** year 1–25 savings */
  twentyFiveYearSavings: { year: number; saving: number; cumulative: number }[];
}

// ─── Data confidence (provenance) ────────────────────────────────────────────

/**
 * Records the provenance of the three load-bearing inputs to a proposal.
 * Lets the PDF show per-field footnotes instead of a blanket disclaimer.
 */
export interface DataConfidence {
  roof: 'os-confirmed' | 'user-confirmed';
  consumption: 'ocr-confirmed' | 'manual-confirmed';
  tariff: 'ocr' | 'manual';
}

// ─── Report data ─────────────────────────────────────────────────────────────

export interface ReportData {
  id: string;
  quoteNumber: string;
  createdAt: string; // ISO string

  // Address
  addressRaw: string;
  lat: number;
  lng: number;
  postcode: string;

  // Building
  footprintGeojson: string | null;
  footprintSource: 'os_ngd' | 'estimated' | 'google_solar';

  // Bill
  annualKwh: number;
  tariffPencePerKwh: number;
  standingChargePencePerDay: number;
  exportTariffPencePerKwh: number;
  billSource: 'ocr' | 'manual';

  // System
  panelCount: number;
  systemSizeKw: number;
  panelSpec: PanelSpec;
  inverterSpec: InverterSpec;
  batterySpec: BatterySpec | null;

  // Calculations
  mcsZone: string;
  irradianceKwhPerM2: number;
  results: SolarResults;

  // Assumptions
  assumptions: SolarAssumptions;

  // Google Solar
  solarApiData?: GoogleSolarBuildingInsights | null;
  solarCoveragePercent?: number | null;
  imageryQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  mcsGenerationKwh?: number | null;

  // Images
  pdfUrl: string | null;

  // Pricing (optional — present once a SystemConfiguration exists)
  quote?: QuoteBreakdown | null;

  // Per-field provenance — drives PDF footnotes
  dataConfidence?: DataConfidence | null;
}

// ─── Google Solar API ────────────────────────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface GoogleSolarDate {
  year: number;
  month: number;
  day: number;
}

export interface GoogleSolarStats {
  areaMeters2: number;
  sunshineQuantiles: number[];
  groundAreaMeters2: number;
}

export interface GoogleSolarRoofSegment {
  pitchDegrees: number;
  /** True compass bearing: 0=N, 90=E, 180=S, 270=W */
  azimuthDegrees: number;
  stats: GoogleSolarStats;
  center: LatLng;
  boundingBox: { sw: LatLng; ne: LatLng };
  planeHeightAtCenterMeters: number;
}

export interface GoogleSolarRoofSegmentSummary {
  pitchDegrees: number;
  azimuthDegrees: number;
  panelsCount: number;
  yearlyEnergyDcKwh: number;
  segmentIndex: number;
}

export interface GoogleSolarPanelConfig {
  panelsCount: number;
  yearlyEnergyDcKwh: number;
  roofSegmentSummaries: GoogleSolarRoofSegmentSummary[];
}

export interface GoogleSolarPanel {
  segmentIndex: number;
  center: LatLng;
  orientation: 'LANDSCAPE' | 'PORTRAIT';
  yearlyEnergyDcKwh: number;
}

export interface GoogleSolarBuildingInsights {
  name: string;
  center: LatLng;
  boundingBox: { sw: LatLng; ne: LatLng };
  imageryDate: GoogleSolarDate;
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  solarPotential: {
    maxArrayPanelsCount: number;
    maxArrayAreaMeters2: number;
    maxSunshineHoursPerYear: number;
    carbonOffsetFactorKgPerMwh: number;
    wholeRoofStats: GoogleSolarStats;
    roofSegmentStats: GoogleSolarRoofSegment[];
    solarPanels?: GoogleSolarPanel[];
    solarPanelConfigs: GoogleSolarPanelConfig[];
    panelCapacityWatts: number;
    panelHeightMeters: number;
    panelWidthMeters: number;
    panelLifetimeYears: number;
    buildingStats?: GoogleSolarStats;
  };
}

export interface GoogleSolarDataLayers {
  imageryDate: GoogleSolarDate;
  imageryProcessedDate: GoogleSolarDate;
  pixelSizeMeters: number;
  rgbUrl: string;
  dsmUrl: string;
  maskUrl: string;
  annualFluxUrl: string;
  monthlyFluxUrl?: string;
  hourlyShadeUrls?: string[];
  /** Extracted GCS id from rgbUrl for use with /api/solar/geotiff */
  rgbId?: string;
  /** Extracted GCS id from dsmUrl for use with /api/solar/geotiff */
  dsmId?: string;
}

// ─── API route payloads ───────────────────────────────────────────────────────

export interface GenerateReportPayload {
  addressRaw: string;
  addressUprn?: string;
  lat: number;
  lng: number;
  postcode: string;
  footprintGeojson: string | null;
  footprintSource: 'os_ngd' | 'estimated' | 'google_solar';
  annualKwh: number;
  tariffPencePerKwh: number;
  standingChargePencePerDay: number;
  exportTariffPencePerKwh: number;
  billSource: 'ocr' | 'manual';
  assumptions: SolarAssumptions;
  solarApiJson?: string;
  chartImagesBase64?: string[];
  dataConfidence: DataConfidence;
}
