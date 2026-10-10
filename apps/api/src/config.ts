/**
 * Environment configuration, read once at boot.
 *
 * Every optional integration is read here and reported through
 * `CapabilityReport` rather than being probed at request time. The plan is
 * unambiguous that a missing credential must be visible: the API refuses the
 * dependent route with `not_enabled` and `/healthz` advertises what is missing,
 * so an operator can never mistake a mocked assistant for a working one.
 */

/**
 * Which Google surface the model calls go to.
 *
 * This is not cosmetic. The model identifiers this project verified — including
 * the default below — were read from the **Vertex AI** model pages. The other
 * surface, the Gemini Developer API, is reached with an API key and a different
 * host, and there is no guarantee that the two publish the same identifier set.
 * Sending a Vertex identifier to the Developer API fails with a model-not-found
 * rather than degrading, so the surface has to be chosen deliberately and
 * reported, not assumed.
 */
export type ModelSurface = 'vertex' | 'developer-api';

export interface GeminiConfig {
  apiKey: string;
  surface: ModelSurface;
  /** Fast, GA, and the model the widget uses for ordinary turns. */
  model: string;
  /**
   * The escalation model for hard reasoning. Left unset by default on purpose:
   * at the time of writing the only GA Pro-class model (`gemini-2.5-pro`)
   * retires 2026-10-20 and its successor is preview-only, so choosing one is a
   * deliberate operator decision rather than a default we can safely hard-code.
   */
  escalationModel: string | undefined;
  location: string;
  /** Required on the Vertex surface; absent on the Developer API surface. */
  project: string | undefined;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** `production` tightens CORS, logging and error detail. */
  nodeEnv: 'development' | 'test' | 'production';
  gemini: GeminiConfig | undefined;
  /** Where conversations and leads are persisted. */
  dataDir: string;
  /** Origins allowed to open a widget session. Empty means any (dev only). */
  allowedOrigins: string[];
  sessionSecret: string;
  logLevel: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const nodeEnv = (env('NODE_ENV') ?? 'development') as ServerConfig['nodeEnv'];
  const apiKey = env('GEMINI_API_KEY');
  const project = env('GOOGLE_CLOUD_PROJECT');

  // A project implies Vertex: that is the surface where a project is meaningful,
  // and the one whose identifiers were verified. Without one, an API key alone
  // is the Developer API. The decision is made here, once, and carried on the
  // config so the provider does not have to re-derive it.
  const surface: ModelSurface = project ? 'vertex' : 'developer-api';

  const gemini: GeminiConfig | undefined = apiKey
    ? {
        apiKey,
        surface,
        model: env('GEMINI_MODEL') ?? 'gemini-3.8-flash',
        escalationModel: env('GEMINI_ESCALATION_MODEL'),
        location: env('GOOGLE_CLOUD_LOCATION') ?? 'global',
        project,
      }
    : undefined;

  const origins = env('WIDGET_ALLOWED_ORIGINS');

  return {
    port: Number(env('PORT') ?? 8787),
    host: env('HOST') ?? '127.0.0.1',
    nodeEnv,
    gemini,
    dataDir: env('SUNNY_DATA_DIR') ?? '.data',
    allowedOrigins: origins ? origins.split(',').map((o) => o.trim()) : [],
    // A development default, replaced by Secret Manager in Cloud Run. The API
    // refuses to boot in production with this value (see `assertProductionReady`).
    sessionSecret: env('SESSION_SECRET') ?? 'dev-only-insecure-session-secret',
    logLevel: env('LOG_LEVEL') ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    ...overrides,
  };
}

/**
 * The development session secret. Exported because more than one place needs to
 * name it: the boot check below, the smoke test, and the deployment notes. It is
 * a published constant, which is exactly why production refuses to start on it.
 */
export const DEV_SECRET = 'dev-only-insecure-session-secret';

/**
 * Refuse to run a production deployment on development defaults.
 *
 * Failing at boot is the whole point: a production instance quietly signing
 * sessions with a published constant is the kind of mistake that looks fine
 * until someone forges a session token.
 */
export function assertProductionReady(config: ServerConfig): string[] {
  const problems: string[] = [];
  if (config.nodeEnv !== 'production') return problems;
  if (config.sessionSecret === DEV_SECRET) {
    problems.push('SESSION_SECRET must be set to a real secret in production');
  }
  if (config.allowedOrigins.length === 0) {
    problems.push('WIDGET_ALLOWED_ORIGINS must list the customer origins in production');
  }
  return problems;
}

/**
 * What this deployment can actually do right now. Surfaced by `/healthz`.
 *
 * `surface` and `modelVerified` exist because the model identifiers this project
 * checked were read from Vertex AI documentation. If the deployment is pointed
 * at the Developer API instead, the identifier is unverified and the honest
 * thing is to say so here rather than let an operator discover it as a 404 on
 * the first turn.
 */
export interface CapabilityReport {
  chat: {
    available: boolean;
    model: string | null;
    surface: ModelSurface | null;
    /** False when the model id was not checked against the surface in use. */
    modelVerified: boolean;
    reason: string | null;
  };
  escalation: { available: boolean; model: string | null; reason: string | null };
  persistence: { available: boolean; kind: string };
}

export function capabilityReport(config: ServerConfig): CapabilityReport {
  if (!config.gemini) {
    return {
      chat: {
        available: false,
        model: null,
        surface: null,
        modelVerified: false,
        reason:
          'GEMINI_API_KEY is not set. Chat is disabled rather than simulated: ' +
          'run with a key to exercise the assistant.',
      },
      escalation: { available: false, model: null, reason: 'GEMINI_API_KEY is not set.' },
      persistence: { available: true, kind: 'file' },
    };
  }

  const { surface, model } = config.gemini;
  // Only the Vertex identifiers were read from the product's own documentation.
  // A Developer API deployment may well work with the same string, but "may
  // well" is not a verification and this field is not allowed to pretend it is.
  const modelVerified = surface === 'vertex';

  return {
    chat: {
      available: true,
      model,
      surface,
      modelVerified,
      reason: modelVerified
        ? null
        : `Model "${model}" was verified against Vertex AI documentation. This deployment ` +
          'is on the Developer API, where the identifier set was not checked — if turns ' +
          'fail with a model-not-found, set GEMINI_MODEL or GOOGLE_CLOUD_PROJECT.',
    },
    escalation: config.gemini.escalationModel
      ? { available: true, model: config.gemini.escalationModel, reason: null }
      : {
          available: false,
          model: null,
          reason:
            'No escalation model configured. There is no GA Pro-class model that ' +
            'is not retiring, so this is left to the operator.',
        },
    persistence: { available: true, kind: 'file' },
  };
}
