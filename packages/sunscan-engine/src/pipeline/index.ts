// Server pipeline (I-API): point / address -> HouseModelSpec. See docs/superpowers/specs §5.
export { buildModel, consoleLog, resolveOptions, validateRequest } from './build-model.js';
export { PipelineError, isReplayMiss, toProviderError, type PipelineErrorCode } from './errors.js';
export { ATTRIBUTION, DEFAULTS, GENERATOR, SERVER_VERSION, SPEC_SCHEMA, UK_BOUNDS } from './constants.js';
export { annotateBuiltForms, type AnnotatedBuilding } from './candidates.js';
export {
  coreAnalyseFootprint, coreFrontEdge, corePriors, coreRegularize, lod1Fallback, normalisePriors, resolveReconstruct,
} from './core-adapters.js';
export { chooseFallback, plausibilityIssues, type FallbackChoice } from './fallback.js';
export { exportHouseGlb, GLB_METHOD, type GlbExport } from './export-glb.js';
export { renderReport, type ReportExtras } from './report.js';
export { normaliseRef, osmRefOf } from './scene.js';
export type * from './types.js';
