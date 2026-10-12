// Rules of the deterministic UK-archetype floor plans ("circulation strip + front/back bands",
// research 05 §7.4; prototype research/methods/roofit/layout.py). All dimensions are metres.
// Everything generated from these rules is an INDICATIVE ESTIMATE, never survey data.

/** Dimensions and thresholds used by `layoutInterior` (frozen; exported for documentation and tests). */
export const INTERIOR_RULES = Object.freeze({
  /** Straight flight (Approved Document K, private stair: rise 150-220 mm, going 220-300 mm, pitch <= 42 deg). */
  stairWidth: 0.85, // M4(2) asks >= 850 mm
  going: 0.225,
  /** Design rise used to count risers: n = ceil(ff / maxRise) -> rise <= 200 mm, pitch <= 41.6 deg. */
  maxRise: 0.2,
  /** First riser behind the front wall; 2.0 m when a box room sits over the front lobby; never closer than 0.6 m. */
  stairStart: 1.2,
  stairStartBoxRoom: 2.0,
  minStairStart: 0.6,
  /** Clear landing kept beyond the stair head when the flight is pulled forward in shallow plans. */
  stairHeadLanding: 1.0,
  /** Ground-floor hall strip; side-hall plans widen it to clamp(W - 5, 1.0, 1.8); bungalow spine 1.1 m. */
  hallWidth: 1.0,
  sideHallWidthOffset: 5.0,
  maxSideHallWidth: 1.8,
  bungalowHallWidth: 1.1,
  /** Upper-floor circulation strip = stairwell 0.85 + landing 0.9 (every room on that side opens onto it). */
  landingStripWidth: 1.75,
  /** A box room over the front lobby reaches this far over the first steps (headroom stays >= 2.0 m). */
  boxRoomOverhang: 0.3,
  centralHallMinWidth: 8.5,
  boxRoomMinWidth: 6.5,
  /** Bungalows narrower than this get a side hall instead of the central spine. */
  bungalowSpineMinWidth: 4.7,
  /** Front/back bands split at round(D / 2) snapped to this module. */
  bandSnap: 0.25,
  bathroomDepth: 2.2,
  bathroomBandMinWidth: 4.4,
  minLandingBeforeBathroom: 1.0,
  kitchenWidth: 2.6,
  kitchenSplitMinWidth: 5.6,
  /** Rear part (outrigger): kitchen + utility/WC (1.8 m) if deep enough; above: bedroom + bathroom (2.2 m). */
  rearUtilityDepth: 1.8,
  rearUtilityMinDepth: 4.5,
  rearBedroomMinDepth: 4.6,
  rearMinSize: 1.2,
  /** A single polygon's back wing becomes an implicit outrigger when its inscribed rectangle is at least this. */
  wingMinWidth: 1.8,
  wingMinDepth: 2.0,
  wingMinOverlap: 1.0,
  /** Nationally Described Space Standard (2015): a bedroom is >= 7.5 m2 and >= 2.15 m wide. */
  ndssSingleArea: 7.5,
  ndssMinWidth: 2.15,
  /** Halls >= 900 mm (Approved Document M); no room is planned narrower than this. */
  minRoomWidth: 0.9,
  /** Internal door leaf 762 x 1981 mm stock size -> 0.76 x 2.0 m, 0.1 m from the wall end. */
  doorWidth: 0.76,
  doorHeight: 2.0,
  doorEndOffset: 0.1,
  /** Depth of the clear zone each side of a door that must not overlap a stair flight or stairwell. */
  doorClearance: 0.6,
  partitionThickness: 0.1,
  /** Leftover areas outside the main rectangle become their own room when their inscribed rectangle is this big. */
  extraRoomMinWidth: 1.5,
  extraRoomMinArea: 3.0,
  /** Plans smaller than this (internal W x D of the main rectangle; the upper strip needs 1.75 + 1.0 m) fall back to a compact one-room-per-storey plan. */
  compactMaxWidth: 2.75,
  compactMaxDepth: 4.0,
  /** Plan-frame snapping: the front edge is used as x-axis unless it deviates from the dominant
   *  (length-weighted, mod 90 deg) footprint orientation by more than this (bay cants, splays). */
  frontSnapDeg: 10,
  /** Sub-band height used by the largest-inscribed-rectangle search on non-orthogonal outlines. */
  lirStep: 0.05,
});

/** Labels of circulation spaces (doors are hung from the rooms that open onto them). */
export const CIRCULATION_LABELS: readonly string[] = ['hall', 'landing'];
