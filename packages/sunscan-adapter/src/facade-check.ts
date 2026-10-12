// Compile-time proof that the implementation satisfies `public.d.ts`, the
// declaration the strict root project compiles against. Checked by
// tsconfig.sunscan.json; never imported at runtime.

import type * as Facade from './public.js';
import type * as Impl from './index.js';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

export type FacadeChecks = [
  Assert<Extends<typeof Impl.createSunScanEngine, typeof Facade.createSunScanEngine>>,
  Assert<Extends<typeof Impl.createSunScanService, typeof Facade.createSunScanService>>,
  Assert<Extends<typeof Impl.SunScanError, typeof Facade.SunScanError>>,
  Assert<Extends<typeof Impl.InProcessQueue, typeof Facade.InProcessQueue>>,
  Assert<Extends<typeof Impl.FileArtefactStore, typeof Facade.FileArtefactStore>>,
  Assert<Extends<typeof Impl.MemoryArtefactStore, typeof Facade.MemoryArtefactStore>>,
  Assert<Extends<typeof Impl.MemoryAssessmentRepository, typeof Facade.MemoryAssessmentRepository>>,
  Assert<Extends<typeof Impl.SUNNY_USER_AGENT, typeof Facade.SUNNY_USER_AGENT>>,
  Assert<Extends<typeof Impl.toRoofAssessmentSummary, typeof Facade.toRoofAssessmentSummary>>,
  // Options a root caller passes must be accepted by the implementation.
  Assert<Extends<Facade.EngineOptions, Impl.EngineOptions>>,
  Assert<Extends<Facade.ServiceOptions, Impl.ServiceOptions>>,
];
