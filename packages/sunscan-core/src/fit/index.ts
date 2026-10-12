// Module 'fit': co-registration, ground, pixel selection, roof model library (weighted-skeleton time for general
// polygons + rectangle closed forms), robust fitting / robust-BIC selection, partitions, chimneys, neighbour
// heights and the no-LiDAR priors fallback (docs/research/05-reconstruction-methods.md, spec section 5.5-5.6).
export { reconstruct, FIT_METHOD, MAX_FIT_PIXELS } from './reconstruct.js';
export { partIssues, maxInside, DEFAULT_PLAUSIBILITY, type PlausibilityOptions } from './plausibility.js';
export { simplifyUntil, DEFAULT_SIMPLIFY, type SimplifyOptions } from './outline.js';
export {
  priorsFallback, storeysFromEave, eaveForStoreys, modalEra, familyPrior, familyFromRoofShape, builtFormFromKinds, ERA_PRIORS, PRIOR_FLAT_AREA,
  type PriorsInput, type PriorsResult, type EraPrior, type PriorFamily,
} from './priors.js';
export { bilinear, pixelCentre, resampleTo, sameGeometry } from './raster.js';
export { coregister, DEFAULT_COREG, type CoregFootprint, type CoregOptions, type CoregResult } from './coregister.js';
export { estimateGround, DEFAULT_GROUND, type GroundEstimate, type GroundOptions } from './ground.js';
export { selectPixels, subsetPixels, DEFAULT_PIXELS, type PixelSet, type PixelOptions, type PixelSelection } from './pixels.js';
export {
  partLibrary, partLibrary as modelLibrary, rectLibrary, rectTime, makePartGeom, nParams, nonnegCols, DEFAULT_LIBRARY, ASYM_GABLE_GRID,
  type ModelDef, type Family, type PartGeom, type LibraryOptions, type RectSpec,
} from './models.js';
export {
  fitModel, fitModel as robustFit, selectHypotheses, selectHypotheses as selectModel, fitRectangleOracle, singleHyp, refitHyp, featureColumns, hypK,
  DEFAULT_FIT, type SampleSet, type FitSettings, type ModelFit, type Hyp, type PartChoice, type Selection, type RectOracleResult,
} from './select.js';
export {
  reflexPartitions, stepCutPartitions, partitionHypotheses, jointContext, jointDesign, cutStep, surfaceAt, corePixels, DEFAULT_PARTITION,
  type Partition, type PartitionOptions, type JointContext,
} from './partitions.js';
export { detectChimneys, DEFAULT_CHIMNEYS, type ChimneyOptions } from './chimneys.js';
export { neighbourHeights, type NeighbourHeight } from './neighbours.js';
export { summarisePart, type PartSummary } from './output.js';
export { makeTimeField, alignPolygon, skeletonSane, DegenerateSkeletonError, type TimeField, type Rotation } from './timefield.js';
export { median, madScale, quantile, rhoTilde, irls, irlsNonneg, TUKEY_C } from './robust.js';
export { normalizeFootprint, detectPartyEdges, rectangularity, dominantAngle, partFrame, type AxisFrame, type EdgeAttr } from './poly.js';
