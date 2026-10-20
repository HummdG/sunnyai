import { z } from 'zod';

/**
 * SunScan roof assessments: an address in, a measured 3D model of the house and
 * a summary of its roof planes out.
 *
 * The engine is SunScanV2's pipeline, vendored into this repository (see
 * docs/integration/sunscan-contract.md). Everything here is INDICATIVE: the
 * roof is reconstructed from open UK LiDAR and OpenStreetMap outlines, so a
 * summary always carries the engine's own confidence and flags, and an
 * unreliable fit is reported as `low-confidence` rather than presented as fact.
 */

export const SUNSCAN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'low-confidence',
  'failed',
] as const;
export const sunscanStatusSchema = z.enum(SUNSCAN_STATUSES);
export type SunScanStatus = z.infer<typeof sunscanStatusSchema>;

/** The statuses a job leaves: a client polling an assessment stops at these. */
export const SUNSCAN_FINAL_STATUSES: readonly SunScanStatus[] = [
  'succeeded',
  'low-confidence',
  'failed',
];

export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'flat'] as const;

export const roofPlaneSchema = z.object({
  /** The engine's roof face id (the 3D viewer highlights by this). */
  id: z.number().int().nonnegative(),
  partId: z.string(),
  pitchDeg: z.number(),
  /** Compass bearing the plane faces (downslope), 0 = north; null for a flat roof. */
  azimuthDeg: z.number().nullable(),
  facing: z.enum(COMPASS_POINTS),
  /** Sloped area in m². */
  areaM2: z.number().nonnegative(),
  /** Horizontal footprint of the plane in m². */
  planAreaM2: z.number().nonnegative(),
  /** Extent along the eave and up the slope (bounding), and how much of that rectangle the plane fills. */
  widthM: z.number().nonnegative(),
  slopeLengthM: z.number().nonnegative(),
  fillRatio: z.number().min(0).max(1),
  /** Area left for panels after the edge setback; 0 when not suitable. */
  usableAreaM2: z.number().nonnegative(),
  /** Upper estimate of standard modules that fit; 0 when not suitable. */
  maxPanels: z.number().int().nonnegative(),
  /**
   * Faces east through south to west at a pitch panels are normally fitted at
   * (or is flat). A classification of geometry, not a yield or a structural
   * judgement -- both need a survey.
   */
  suitable: z.boolean(),
});
export type RoofPlane = z.infer<typeof roofPlaneSchema>;

export const confidenceSchema = z.enum([
  'measured',
  'high',
  'medium',
  'low',
  'estimated',
  'manual',
]);

export const sunscanSummarySchema = z.object({
  address: z.string(),
  postcode: z.string().nullable(),
  builtForm: z.string(),
  era: z.string(),
  storeys: z.number().int().nonnegative(),
  roofType: z.string(),
  eaveHeightM: z.number(),
  roofPlanes: z.array(roofPlaneSchema),
  /** Sum of `suitable` planes' sloped area, m². */
  suitableRoofAreaM2: z.number().nonnegative(),
  usableRoofAreaM2: z.number().nonnegative(),
  estimatedMaxPanels: z.number().int().nonnegative(),
  mainPlaneId: z.number().int().nonnegative().nullable(),
  /** The facing of the largest suitable plane, or null when none is suitable. */
  bestFacing: z.enum(COMPASS_POINTS).nullable(),
  obstructions: z.object({ chimneys: z.number().int().nonnegative() }),
  /** Always includes 'shading-not-assessed': shading is not simulated. */
  shadingFlags: z.array(z.string()),
  confidence: z.object({
    geocode: confidenceSchema,
    footprint: confidenceSchema,
    heights: confidenceSchema,
    roof: confidenceSchema,
  }),
  /** False when the engine flagged the fit as unreliable or had no LiDAR. */
  reliable: z.boolean(),
  flags: z.array(z.string()),
  notes: z.array(z.string()),
  sources: z.array(
    z.object({ id: z.string(), title: z.string(), licence: z.string(), attribution: z.string() }),
  ),
  /** Always present; every client shows it next to the numbers. */
  label: z.literal('Indicative, subject to an on-site survey'),
});
export type SunScanSummary = z.infer<typeof sunscanSummarySchema>;

export const startSunScanRequestSchema = z
  .object({
    address: z.string().trim().min(3).max(200).optional(),
    postcode: z.string().trim().min(2).max(10).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
  })
  .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
    message: 'An address, or a lat/lon pair, is required.',
  });
export type StartSunScanRequest = z.infer<typeof startSunScanRequestSchema>;

/** What the API returns for an assessment: never the tenant id, never the raw spec. */
export const sunscanAssessmentSchema = z.object({
  id: z.string().min(1),
  status: sunscanStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: sunscanSummarySchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** Relative URLs, present once the model exists. */
  modelUrl: z.string().nullable(),
  specUrl: z.string().nullable(),
});
export type SunScanAssessment = z.infer<typeof sunscanAssessmentSchema>;
