// Mesh synthesis for the viewer: core/model `synthesizeHouse` is the only builder (same code as the server and the
// exports). It never throws on bad input (problems land in mesh.validation.issues); should it throw anyway, the error
// propagates to the caller, which keeps the last good mesh and reports the failure.
import { MATERIALS, synthesizeHouse } from '@sunny/sunscan-core/model';
import type { HouseMesh, HouseModelSpec, SynthesisOptions } from '@sunny/sunscan-core/types';

export type SynthEngine = 'core';

/** Core material palette (shape owned by core/model). */
export function corePalette(): unknown {
  return MATERIALS;
}

export interface SynthResult {
  mesh: HouseMesh;
  engine: SynthEngine;
  ms: number;
  /** Kept for API compatibility: there is no fallback builder any more, so this is never set. */
  coreError?: string;
}

export function synthesize(spec: HouseModelSpec, opts?: SynthesisOptions): SynthResult {
  const t0 = performance.now();
  const mesh = synthesizeHouse(spec, opts);
  return { mesh, engine: 'core', ms: performance.now() - t0 };
}
