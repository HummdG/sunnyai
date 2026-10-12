// @sunny/sunscan-adapter — Sunny's typed interface to the vendored SunScan
// engine: start an assessment for an address, read its status, its roof
// summary and its model files. See docs/integration/sunscan-contract.md.
//
// The strict root project reads this package through `public.d.ts` (the
// `sunny-facade` export condition); `facade-check.ts` proves that declaration
// against this implementation under tsconfig.sunscan.json.

export * from './types.js';
export {
  createSunScanEngine,
  SunScanError,
  SUNNY_USER_AGENT,
  type EngineOptions,
} from './engine.js';
export {
  createSunScanService,
  FileArtefactStore,
  InProcessQueue,
  MemoryArtefactStore,
  MemoryAssessmentRepository,
  toRoofAssessmentSummary,
  type ServiceOptions,
} from './service.js';
export { facingOf, isSuitable, summarise } from './summary.js';
