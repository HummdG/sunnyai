// The adapter's public API as the strict root project sees it (`sunny-facade`
// export condition). Hand-written so the root never compiles the vendored
// engine; `facade-check.ts` fails the SunScan typecheck if the implementation
// stops satisfying anything declared here.

import type {
  ArtefactStore,
  AssessmentError,
  AssessmentRecord,
  AssessmentRepository,
  JobQueue,
  RoofAssessmentSummary,
  SunScanEngine,
  SunScanService,
} from './types.js';

export * from './types.js';

export interface EngineOptions {
  httpMode?: 'live' | 'record' | 'replay';
  fixturesDir?: string;
  cacheDir?: string;
  userAgent?: string;
  now?: () => Date;
  log?: (level: 'info' | 'warn' | 'error', message: string, err?: unknown) => void;
}

export declare const SUNNY_USER_AGENT: string;

export declare class SunScanError extends Error implements AssessmentError {
  readonly code: AssessmentError['code'];
  constructor(code: AssessmentError['code'], message: string);
}

export declare function createSunScanEngine(opts?: EngineOptions): SunScanEngine;

export interface ServiceOptions {
  engine: SunScanEngine;
  repository: AssessmentRepository;
  artefacts: ArtefactStore;
  queue?: JobQueue;
  now?: () => Date;
  newId?: () => string;
}

export declare function createSunScanService(opts: ServiceOptions): SunScanService;

export declare class InProcessQueue implements JobQueue {
  constructor(concurrency?: number);
  enqueue(job: () => Promise<void>): void;
  idle(): Promise<void>;
}

export declare class FileArtefactStore implements ArtefactStore {
  constructor(dir: string);
  put(tenantId: string, assessmentId: string, name: string, bytes: Uint8Array): Promise<void>;
  get(tenantId: string, assessmentId: string, name: string): Promise<Uint8Array | null>;
}

export declare class MemoryArtefactStore implements ArtefactStore {
  put(tenantId: string, assessmentId: string, name: string, bytes: Uint8Array): Promise<void>;
  get(tenantId: string, assessmentId: string, name: string): Promise<Uint8Array | null>;
}

export declare class MemoryAssessmentRepository implements AssessmentRepository {
  save(record: AssessmentRecord): Promise<void>;
  get(tenantId: string, id: string): Promise<AssessmentRecord | null>;
}

export declare function toRoofAssessmentSummary(
  record: AssessmentRecord,
): RoofAssessmentSummary | null;
