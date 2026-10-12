// Errors raised by the pipeline / API layer, carrying an HTTP status and a machine-readable code.

/** Machine-readable error codes returned as `{ error: { code, message } }`. */
export type PipelineErrorCode =
  | 'bad-request'
  | 'outside-uk'
  | 'invalid-footprint'
  | 'no-building'
  | 'building-not-found'
  | 'not-found'
  | 'upstream-error'
  | 'upstream-timeout'
  | 'replay-miss'
  | 'internal';

/** An error with an HTTP status (400/404/422/502/504/500) and a stable code. */
export class PipelineError extends Error {
  readonly status: number;
  readonly code: PipelineErrorCode;
  constructor(status: number, code: PipelineErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PipelineError';
    this.status = status;
    this.code = code;
  }
}

/**
 * True for HTTP replay misses (no recorded fixture in replay mode). They must never be swallowed by fallback logic:
 * an offline test run has to fail loudly instead of silently degrading to estimates.
 */
export function isReplayMiss(err: unknown): boolean {
  const e = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  return e.code === 'REPLAY_MISS' || e.name === 'ReplayMissError';
}

/** True for errors that look like a provider/upstream timeout (AbortError, TimeoutError, ETIMEDOUT, HTTP 504/408). */
function isTimeout(e: Record<string, unknown>, message: string): boolean {
  const name = String(e.name ?? '');
  const code = String(e.code ?? '');
  const status = Number(e.status ?? e.statusCode ?? NaN);
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    status === 504 ||
    status === 408 ||
    /\btimed? ?out\b|timeout/i.test(message)
  );
}

/**
 * Map any error thrown by a provider (geocoder, Overpass, LiDAR, ...) to a PipelineError:
 * timeouts -> 504 'upstream-timeout', replay misses -> 502 'replay-miss', everything else -> 502 'upstream-error'.
 * PipelineErrors pass through unchanged.
 */
export function toProviderError(err: unknown, what: string): PipelineError {
  if (err instanceof PipelineError) return err;
  const e = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  const message = err instanceof Error ? err.message : String(err);
  if (isReplayMiss(err)) {
    return new PipelineError(502, 'replay-miss', `${what}: ${message}`, { cause: err });
  }
  if (isTimeout(e, message)) return new PipelineError(504, 'upstream-timeout', `${what} timed out: ${message}`, { cause: err });
  return new PipelineError(502, 'upstream-error', `${what} failed: ${message}`, { cause: err });
}
