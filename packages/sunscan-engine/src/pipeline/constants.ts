// Shared constants of the server pipeline.

/** Server version (keep in sync with apps/server/package.json). */
export const SERVER_VERSION = '0.1.0';

/** HouseModelSpec.generator. */
export const GENERATOR = `sunscan-server/${SERVER_VERSION}`;

/** HouseModelSpec.schema. */
export const SPEC_SCHEMA = 'sunscan.house/1' as const;

/** Rough WGS84 bounds of the UK (incl. Northern Ireland, Scilly, Shetland). */
export const UK_BOUNDS = { minLat: 49.8, maxLat: 60.95, minLon: -8.75, maxLon: 1.9 } as const;

/** Defaults of BuildModelOptions. */
export const DEFAULTS = {
  radius: 80,
  neighbourRadius: 50,
  /** neighbours handed to the fitter for joint co-registration */
  fitNeighbourRadius: 100,
  /** Window margin around the target (m). 14 m covers the ±6 m registration search, but terraces need more of the
   *  row for the joint co-registration: with 14 m the along-row shift of 20 Forthlin Road slid by 4.7 m, with
   *  24 m it matches the research value (−0.7, −0.3) m. EA windows stay tiny (~16 KB per layer). */
  lidarMargin: 24,
  terrain: true,
  terrainHalfSize: 30,
  terrainCell: 1,
  evidence: true,
  maxEvidence: 4000,
  /** live aerial ground texture (Esri, never exported) */
  imagery: true,
  imageryHalfSize: 60,
  /** LiDAR survey older than this (years) gets the 'survey-old' flag */
  surveyOldYears: 7,
  /** registration shifts larger than this (m) are flagged for review */
  largeShift: 3,
  /** fitted parts with a lower eave (m above ground) are implausible (and LoD1.3 blocks lower than this are not
   *  standing in the survey) */
  minPlausibleEave: 2.0,
  /** fitted parts smaller than this (m²) are implausible */
  minPartArea: 4,
} as const;

/** Licence/attribution strings (spec §10). */
export const ATTRIBUTION = {
  osm: '© OpenStreetMap contributors (ODbL)',
  overture: '© Overture Maps Foundation (ODbL-1.0); sources per feature (OpenStreetMap, Microsoft ML Building Footprints)',
  postcodes:
    'Contains OS data © Crown copyright and database right; Contains Royal Mail data © Royal Mail copyright and database right; ' +
    'Contains National Statistics data © Crown copyright and database right',
} as const;
