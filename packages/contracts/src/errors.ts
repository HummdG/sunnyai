import { z } from 'zod';

/**
 * Stable machine-readable error codes.
 *
 * Every failure the API can return has one of these. Clients branch on the code,
 * never on the message, so messages stay free to improve.
 *
 * This envelope is Sunny's own. An earlier draft of this comment claimed it
 * mirrored SunScan's convention; discovery found that SunScan has no single
 * error envelope at all -- its route handlers return differing shapes. So there
 * is nothing to mirror, and the adapter that talks to SunScan has to translate
 * per route rather than assume a shared format. See
 * `docs/integration/sunscan-contract.md`.
 */
export const ERROR_CODES = [
  /** The request was malformed: bad JSON, failed schema validation, missing field. */
  'bad_request',
  /** No session, or an expired/invalid one. The client should start a new session. */
  'unauthorized',
  /** Authenticated, but not permitted to touch this tenant's data. */
  'forbidden',
  /** The referenced record does not exist, or is not visible to this caller. */
  'not_found',
  /** The caller exceeded a quota or rate limit. */
  'rate_limited',
  /** A dependency (Gemini, Firestore, SunScan) failed. Retryable. */
  'upstream_failed',
  /** The dependency is configured but refuses to serve: quota exhausted, disabled API. */
  'upstream_unavailable',
  /** A feature is deliberately switched off for this tenant. */
  'not_enabled',
  /** We broke. Not retryable, and the caller can do nothing but report it. */
  'internal',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * The single response shape for every non-2xx reply. Errors never return a bare
 * string, and never leak stack traces or upstream provider text.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /** Correlation id for the failing request; also emitted to Cloud Logging. */
    requestId: z.string().optional(),
    /** Per-field validation detail, present only for `bad_request`. */
    details: z.record(z.string()).optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** HTTP status for each code, so the mapping lives in exactly one place. */
export const STATUS_FOR_CODE: Readonly<Record<ErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  upstream_failed: 502,
  upstream_unavailable: 503,
  not_enabled: 403,
  internal: 500,
};

/** An error carrying a contract code, safe to serialise straight into a response. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_FOR_CODE[this.code];
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(requestId ? { requestId } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/**
 * Turn a Zod failure into a `bad_request` with per-field detail, so clients can
 * point at the offending field instead of guessing.
 */
export function badRequestFromZod(error: z.ZodError): ApiError {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '(root)';
    details[path] = issue.message;
  }
  return new ApiError('bad_request', 'Request validation failed', details);
}
