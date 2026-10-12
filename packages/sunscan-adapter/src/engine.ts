import {
  buildModel,
  configureHttp,
  createProviders,
  exportHouseGlb,
  GENERATOR,
  isReplayMiss,
  PipelineError,
  type BuildModelDeps,
  type HttpMode,
  type Providers,
} from '@sunny/sunscan-engine';

import { summarise } from './summary.js';
import type { AssessmentError, AssessmentTarget, EngineOutcome, SunScanEngine } from './types.js';

/** A failure with a code the API and the assistant can act on. */
export class SunScanError extends Error implements AssessmentError {
  constructor(
    readonly code: AssessmentError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'SunScanError';
  }
}

export interface EngineOptions {
  /** live (default), record or replay. See SUNSCAN_HTTP_MODE in the engine's http/config. */
  httpMode?: HttpMode;
  fixturesDir?: string;
  cacheDir?: string;
  /** Identifying, contact-free User-Agent sent to the open-data providers. */
  userAgent?: string;
  /** Overrides individual providers (tests). */
  providers?: Partial<Providers>;
  /** Fixed clock for deterministic specs (tests, replay demos). */
  now?: () => Date;
  log?: BuildModelDeps['log'];
}

export const SUNNY_USER_AGENT = 'Sunny/0.1 (solar assistant roof assessment; SunScan engine)';

/**
 * The vendored SunScanV2 pipeline behind Sunny's adapter interface.
 *
 * The flow is the one SunScanV2's web app drove over HTTP -- geocode the
 * address, build the model at the geocoded building, export the GLB -- run
 * in-process. The HTTP layer is process-global in the engine, so configuring a
 * second engine with different settings reconfigures the first; Sunny runs one.
 */
export function createSunScanEngine(opts: EngineOptions = {}): SunScanEngine {
  configureHttp({
    userAgent: opts.userAgent ?? SUNNY_USER_AGENT,
    ...(opts.httpMode ? { mode: opts.httpMode } : {}),
    ...(opts.fixturesDir ? { fixturesDir: opts.fixturesDir } : {}),
    ...(opts.cacheDir ? { cacheDir: opts.cacheDir } : {}),
  });
  const providers = createProviders(opts.providers ?? {});
  const log: NonNullable<BuildModelDeps['log']> = opts.log ?? (() => undefined);

  return {
    version: GENERATOR,
    async assess(target: AssessmentTarget): Promise<EngineOutcome> {
      const query = [target.address, target.postcode]
        .filter((p) => p && p.trim() !== '')
        .join(', ');
      let lat = target.lat;
      let lon = target.lon;
      let geocode: Awaited<ReturnType<Providers['geocodeUk']>> | undefined;

      if (query) {
        try {
          geocode = await providers.geocodeUk(query);
        } catch (e) {
          throw new SunScanError(
            'provider-unavailable',
            `The address lookup failed (${(e as Error).message}).`,
          );
        }
        const best = geocode.best;
        if (!best) {
          throw new SunScanError(
            'address-not-found',
            'That address could not be found. A house number, street and postcode usually works.',
          );
        }
        // A postcode centroid or a street is not a house: modelling "a building
        // near there" and calling it theirs would be the invention this adapter
        // exists to avoid.
        if (
          geocode.confidence === 'low' &&
          best.level !== 'building' &&
          best.level !== 'address-point'
        ) {
          throw new SunScanError(
            'address-ambiguous',
            'That address matched an area rather than one house. The house number or name would pin it down.',
          );
        }
        lat = best.lat;
        lon = best.lon;
      }
      if (lat === undefined || lon === undefined) {
        throw new SunScanError('address-required', 'An address, or a point on the map, is needed.');
      }

      let result;
      try {
        result = await buildModel(
          {
            lat,
            lon,
            ...(query ? { address: query } : {}),
            ...(geocode ? { geocode } : {}),
          },
          { providers, log, ...(opts.now ? { now: opts.now } : {}) },
        );
      } catch (e) {
        throw toSunScanError(e);
      }

      const { glb, mesh } = exportHouseGlb(result.spec);
      return {
        summary: summarise(result.spec, mesh),
        specJson: JSON.stringify(result.spec),
        glb,
      };
    },
  };
}

function toSunScanError(e: unknown): SunScanError {
  if (e instanceof SunScanError) return e;
  if (isReplayMiss(e)) {
    return new SunScanError(
      'provider-unavailable',
      'No recorded data for that address in replay mode.',
    );
  }
  if (e instanceof PipelineError) {
    switch (e.code) {
      case 'outside-uk':
        return new SunScanError('outside-uk', 'Roof assessments cover the United Kingdom only.');
      case 'no-building':
      case 'building-not-found':
      case 'not-found':
        return new SunScanError('no-building', 'No building outline was found at that address.');
      case 'upstream-error':
      case 'upstream-timeout':
        return new SunScanError('provider-unavailable', e.message);
      default:
        return new SunScanError('engine-error', e.message);
    }
  }
  return new SunScanError('engine-error', (e as Error)?.message ?? String(e));
}
