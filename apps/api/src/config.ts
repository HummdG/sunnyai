/**
 * Environment configuration, read once at boot.
 *
 * Every optional integration is read here and reported through
 * `CapabilityReport` rather than being probed at request time. The plan is
 * unambiguous that a missing credential must be visible: the API refuses the
 * dependent route with `not_enabled` and `/healthz` advertises what is missing,
 * so an operator can never mistake a mocked assistant for a working one.
 */

import type { RateLimitRule } from './ratelimit.js';

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
  /** Absent on Vertex when the deployment's own Google identity is used. */
  apiKey: string | undefined;
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

/**
 * Rate limiting, as configuration rather than constants, because the right limit
 * depends on the deployment: a single-tenant pilot and a shared staging instance
 * want different numbers.
 *
 * `trustProxy` is the one field here with a security consequence, and it is a
 * *hop count* rather than a boolean on purpose. The naive version -- "read the
 * client address from `X-Forwarded-For`" -- takes the left-most entry, which is
 * the one a caller supplies and can therefore forge, turning the rate limit into
 * a header the attacker writes. Trusting N hops counts in from the socket
 * instead, so only addresses appended by proxies we chose to trust are believed.
 *
 * Zero (the default) trusts nothing and keys on the socket peer. Behind a load
 * balancer that peer is the balancer, so every visitor shares one bucket and the
 * limit applies globally -- coarse, but it fails *closed*: it can over-limit,
 * never under-limit. See `docs/DECISIONS.md`, D-10, which also records that the
 * exact hop count for Cloud Run has **not** been verified.
 */
export interface RateLimitConfig {
  enabled: boolean;
  /** Trusted proxies between the client and this process. 0 trusts none. */
  trustProxyHops: number;
  rules: {
    /** Per client address. Unauthenticated, and writes a conversation record. */
    session: RateLimitRule;
    /** Per session. Authenticated, and spends model tokens. */
    chat: RateLimitRule;
    /**
     * Per client address. Writes a durable lead row, which is the thing a spam
     * script wants, and is the one write a visitor cannot undo.
     */
    leads: RateLimitRule;
    /**
     * Per client address. Grows the stored conversation one answer at a time,
     * and is driven by a page form rather than by a person typing, so it is
     * likelier to be the target of a loop than the chat is.
     */
    qualification: RateLimitRule;
    /**
     * Per client address. The only route that takes a multi-megabyte body, and
     * the only one behind an admin token — limited anyway, because a leaked
     * token should not also be an unlimited write amplifier.
     */
    catalogue: RateLimitRule;
    /**
     * Per client address. Onboards an installer's own document, which is a
     * multi-megabyte body behind an admin token -- limited for the same reason
     * the catalogue is: a leaked token should not be an unlimited write.
     */
    knowledge: RateLimitRule;
    /**
     * Per client address, on top of the per-session rule: Blueprint §4.6's "max
     * 20 messages per 10 minutes per IP", so opening fresh sessions does not
     * buy a script more model calls. Optional for configs written before it;
     * the server applies the default.
     */
    chatIp?: RateLimitRule;
  };
  maxKeys: number;
}

/** Blueprint §4.6 / §5 matrix: 20 chat messages per 10 minutes per address. */
export const DEFAULT_CHAT_IP_RULE: RateLimitRule = { limit: 20, windowMs: 10 * 60_000 };

/** Blueprint §4.6: the longest visitor message the assistant accepts. */
export const DEFAULT_MAX_INPUT_CHARS = 500;

/**
 * Cloudflare Turnstile (Blueprint §4.6), verified when a widget session opens.
 * Both keys or neither: a site key without a secret would show a challenge the
 * server never checks.
 */
export interface TurnstileConfig {
  siteKey: string;
  secretKey: string;
}

/**
 * Where the operational database is, when it is Firestore.
 *
 * Present only when the deployment asked for Firestore *and* named a project, so
 * `config.firestore` being set is the whole test a caller needs; there is no
 * second flag to keep in step with it.
 */
export interface FirestoreConfig {
  project: string;
  /**
   * The database id. `(default)` unless the deployment named another.
   *
   * Carried rather than assumed because a project can hold several databases, and
   * the mistake this prevents -- reading and writing the default database of the
   * wrong one -- is invisible from inside the process.
   */
  databaseId: string;
  /**
   * The emulator's `host:port`, or null for real Firestore.
   *
   * Deliberately **not** read from `FIRESTORE_EMULATOR_HOST`, which the client
   * library honours by convention. Reading that would make an ambient environment
   * variable enough to point a deployment at a throwaway database, and the failure
   * would be silent data loss rather than an error. This deployment names its
   * emulator explicitly or it does not have one.
   */
  emulatorHost: string | null;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** `production` tightens CORS, logging and error detail. */
  nodeEnv: 'development' | 'test' | 'production';
  gemini: GeminiConfig | undefined;
  /** Where conversations and leads are persisted, when the file store is in use. */
  dataDir: string;
  /**
   * Which store the deployment asked for; absent when it did not say.
   *
   * Absent is not "file". It is "nobody chose", which is a fine answer in
   * development and a boot failure in production (see `assertStoreConfigured`).
   * Collapsing the two would let a production deployment inherit a
   * container-local file store from an unset variable and lose every enquiry on
   * the next deploy, with nothing in the configuration afterwards to point at.
   */
  store?: 'file' | 'firestore';
  firestore?: FirestoreConfig;
  /** Origins allowed to open a widget session. Empty means any (dev only). */
  allowedOrigins: string[];
  sessionSecret: string;
  /**
   * The token that authorises a catalogue upload.
   *
   * Unset by default, and an unset token means uploads are *off* rather than
   * open: there is no default value here, because a default would be a published
   * credential guarding the one route that writes an installer's commercial
   * data. With it unset, `/v1/catalog/products` answers `not_enabled` and says
   * which variable to set.
   */
  adminToken: string | null;
  logLevel: string;
  rateLimit: RateLimitConfig;
  /** Absent: Turnstile is off. Optional so configs written before it still type. */
  turnstile?: TurnstileConfig | null;
  /** The longest chat message accepted. Absent means `DEFAULT_MAX_INPUT_CHARS`. */
  maxInputChars?: number;
  /**
   * Whether to serve the second, fictional installer as well as the demo one.
   *
   * Off unless `SUNNY_SANDBOX_TENANT=1`, and refused in production. It exists so
   * that `scripts/verify-isolation.ts` has two tenants to hold apart on a
   * running deployment: an isolation sweep against a server that knows one
   * tenant cannot fail, which makes it worse than no sweep at all.
   */
  sandboxTenant: boolean;
  /**
   * How long a lead and its conversation are kept before the sweep removes them.
   *
   * In days, because that is the unit a retention policy is written in, converted
   * to a window by the caller. `0` means keep indefinitely, which is the one value
   * that turns the sweep off: an operator who is required to hold enquiries for a
   * statutory period sets a number at or above it, and one whose policy is "we do
   * not delete" says so explicitly rather than by leaving a variable unset.
   *
   * It applies to conversations as well as leads, because a conversation *is* the
   * qualification record for the enquiry -- deleting the lead and keeping the
   * transcript would leave a visitor's answers on file with nothing pointing at
   * them, which is worse for them than either end of the choice.
   */
  leadRetentionDays: number;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * Two years, and the number is a starting position rather than a legal opinion.
 *
 * It is long enough to cover a heating season plus the follow-up on an enquiry
 * that went quiet, and short enough that the deployment is not quietly becoming an
 * archive. An installer whose obligation is shorter sets it shorter; one who is
 * required to hold records for longer sets it longer.
 */
export const DEFAULT_LEAD_RETENTION_DAYS = 730;

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const nodeEnv = (env('NODE_ENV') ?? 'development') as ServerConfig['nodeEnv'];
  const apiKey = env('GEMINI_API_KEY');
  const project = env('GOOGLE_CLOUD_PROJECT');

  // A project implies Vertex: that is the surface where a project is meaningful,
  // and the one whose identifiers were verified. Without one, an API key alone
  // is the Developer API. GEMINI_SURFACE overrides the inference, because a
  // deployed API always has a project (Firestore needs it) and a Gemini API key
  // from AI Studio cannot call Vertex. The decision is made here, once, and
  // carried on the config so the provider does not have to re-derive it.
  const surfaceRaw = env('GEMINI_SURFACE');
  if (surfaceRaw !== undefined && surfaceRaw !== 'vertex' && surfaceRaw !== 'developer-api') {
    throw new Error(`GEMINI_SURFACE must be "vertex" or "developer-api", not "${surfaceRaw}"`);
  }
  const surface: ModelSurface = surfaceRaw ?? (project ? 'vertex' : 'developer-api');

  // Chat is on with a key, or, when told to use Vertex, with a project to bill:
  // Vertex accepts the deployment's own Google identity, so it needs no key
  // (and no prepaid Gemini API credit; it bills the project's account).
  const keylessVertex = surfaceRaw === 'vertex' && project !== undefined;
  const gemini: GeminiConfig | undefined =
    apiKey !== undefined || keylessVertex
      ? {
          apiKey,
          surface,
          model: env('GEMINI_MODEL') ?? 'gemini-3.8-flash',
          escalationModel: env('GEMINI_ESCALATION_MODEL'),
          location: env('GOOGLE_CLOUD_LOCATION') ?? 'global',
          project: surface === 'vertex' ? project : undefined,
        }
      : undefined;

  const origins = env('WIDGET_ALLOWED_ORIGINS');

  // The window is read here rather than computed at every sweep for the same
  // reason as everything else in this file: one place decides, and the value on
  // the config is the value in force.
  //
  // An unparseable value falls back to the default instead of becoming NaN. NaN
  // is the dangerous outcome, not the safe one: every age comparison against it is
  // false, so a typo would silently retain everything forever -- the opposite of
  // what an operator who bothered to set this variable was asking for.
  const retentionRaw = env('SUNNY_LEAD_RETENTION_DAYS');
  const parsedRetention =
    retentionRaw === undefined ? DEFAULT_LEAD_RETENTION_DAYS : Number(retentionRaw);
  const leadRetentionDays =
    Number.isFinite(parsedRetention) && parsedRetention >= 0
      ? Math.trunc(parsedRetention)
      : DEFAULT_LEAD_RETENTION_DAYS;

  // Defaults are generous on purpose. A limit that fires on ordinary use is
  // worse than no limit: it teaches the operator to switch it off, and then the
  // abuse case is unguarded too. These numbers stop a script, not a person.
  //
  // `SUNNY_TRUST_PROXY` accepts `1`/`true` as shorthand for one hop, because that
  // is the common single-load-balancer case and writing `=1` for a boolean-ish
  // setting is what people expect. Anything else must parse as a hop count.
  const trustProxyRaw = env('SUNNY_TRUST_PROXY');
  // `Number('abc')` is NaN, and NaN survives `Math.max(0, …)` -- it is the one
  // value that propagates through the clamp. Left as NaN it would make
  // `trustedHops <= 0` false and hand the resolver an index of NaN, so an
  // unparseable value has to become "trust nothing" rather than flow through.
  const hops = Number(trustProxyRaw);
  const proxyHops =
    trustProxyRaw === undefined || trustProxyRaw === 'false' || trustProxyRaw === '0'
      ? 0
      : trustProxyRaw === 'true'
        ? 1
        : Number.isFinite(hops)
          ? Math.max(0, Math.trunc(hops))
          : 0;

  const rateLimit: RateLimitConfig = {
    enabled: env('SUNNY_RATE_LIMIT') !== '0',
    trustProxyHops: proxyHops,
    rules: {
      session: {
        limit: Number(env('SUNNY_RL_SESSION_LIMIT') ?? 30),
        windowMs: Number(env('SUNNY_RL_SESSION_WINDOW_MS') ?? 60_000),
      },
      chat: {
        limit: Number(env('SUNNY_RL_CHAT_LIMIT') ?? 20),
        windowMs: Number(env('SUNNY_RL_CHAT_WINDOW_MS') ?? 60_000),
      },
      // Tighter than the others, but not one-a-minute: several people can share
      // one address (an office, a mobile carrier's NAT), and refusing the second
      // genuine enquiry of the minute costs a lead. Ten stops a script without
      // standing in a real visitor's way.
      leads: {
        limit: Number(env('SUNNY_RL_LEADS_LIMIT') ?? 10),
        windowMs: Number(env('SUNNY_RL_LEADS_WINDOW_MS') ?? 60_000),
      },
      // Higher than the others because the journey has fourteen questions and a
      // page that submits them one at a time consumes one allowance each. The
      // limit has to clear a whole questionnaire or it would cut off a genuine
      // visitor partway through the form.
      qualification: {
        limit: Number(env('SUNNY_RL_QUALIFICATION_LIMIT') ?? 40),
        windowMs: Number(env('SUNNY_RL_QUALIFICATION_WINDOW_MS') ?? 60_000),
      },
      // Low, because a real price list is uploaded a handful of times a season
      // and the route is token-guarded anyway. This is the limit that stops a
      // loop, not the one that shapes normal use.
      catalogue: {
        limit: Number(env('SUNNY_RL_CATALOGUE_LIMIT') ?? 20),
        windowMs: Number(env('SUNNY_RL_CATALOGUE_WINDOW_MS') ?? 60_000),
      },
      // Like the catalogue: token-guarded, and a document is onboarded when it
      // changes rather than on a schedule. Kept separate from the catalogue's
      // counter so a season of price-list uploads cannot exhaust the allowance
      // for a warranty that needs re-ingesting the same afternoon.
      knowledge: {
        limit: Number(env('SUNNY_RL_KNOWLEDGE_LIMIT') ?? 20),
        windowMs: Number(env('SUNNY_RL_KNOWLEDGE_WINDOW_MS') ?? 60_000),
      },
      chatIp: {
        limit: Number(env('SUNNY_RL_CHAT_IP_LIMIT') ?? DEFAULT_CHAT_IP_RULE.limit),
        windowMs: Number(env('SUNNY_RL_CHAT_IP_WINDOW_MS') ?? DEFAULT_CHAT_IP_RULE.windowMs),
      },
    },
    maxKeys: Number(env('SUNNY_RL_MAX_KEYS') ?? 10_000),
  };

  // Which store. An unrecognised value is thrown rather than ignored: a typo in
  // this variable decides where every conversation and enquiry in the deployment
  // is written, and "it quietly used the file store instead" is not a recovery
  // anybody would notice before it mattered.
  const storeRaw = env('SUNNY_STORE');
  if (storeRaw !== undefined && storeRaw !== 'file' && storeRaw !== 'firestore') {
    throw new Error(`SUNNY_STORE must be "file" or "firestore", not "${storeRaw}"`);
  }
  // The throw above is what narrows this, so no assertion is needed here: what is
  // left is `'file' | 'firestore' | undefined`, which is the field's own type.
  const store: ServerConfig['store'] = storeRaw;
  // A project is what makes Firestore addressable at all. Without one there is
  // nothing to configure, and `assertStoreConfigured` refuses the boot rather
  // than letting a Firestore deployment fall back to local files.
  const firestoreProject = env('GOOGLE_CLOUD_PROJECT');
  const firestore: FirestoreConfig | undefined =
    store === 'firestore' && firestoreProject
      ? {
          project: firestoreProject,
          databaseId: env('SUNNY_FIRESTORE_DATABASE') ?? '(default)',
          emulatorHost: env('SUNNY_FIRESTORE_EMULATOR_HOST') ?? null,
        }
      : undefined;

  return {
    port: Number(env('PORT') ?? 8787),
    host: env('HOST') ?? '127.0.0.1',
    nodeEnv,
    gemini,
    dataDir: env('SUNNY_DATA_DIR') ?? '.data',
    store,
    firestore,
    allowedOrigins: origins ? origins.split(',').map((o) => o.trim()) : [],
    // A development default, replaced by Secret Manager in Cloud Run. The API
    // refuses to boot in production with this value (see `assertProductionReady`).
    sessionSecret: env('SESSION_SECRET') ?? 'dev-only-insecure-session-secret',
    adminToken: env('SUNNY_ADMIN_TOKEN') ?? null,
    logLevel: env('LOG_LEVEL') ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    rateLimit,
    turnstile:
      env('TURNSTILE_SITE_KEY') && env('TURNSTILE_SECRET_KEY')
        ? { siteKey: env('TURNSTILE_SITE_KEY')!, secretKey: env('TURNSTILE_SECRET_KEY')! }
        : null,
    maxInputChars: Number(env('SUNNY_CHAT_MAX_INPUT_CHARS') ?? DEFAULT_MAX_INPUT_CHARS),
    // Written as an explicit opt-in rather than "on unless production": a flag
    // whose default depends on the environment is one a staging deployment can
    // silently lose, and the sweep would then pass by having nothing to compare.
    sandboxTenant: ['1', 'true'].includes(env('SUNNY_SANDBOX_TENANT') ?? ''),
    leadRetentionDays,
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
  // Installers' own sites are allowed through their registered domains (read
  // live from the tenant records), so this list only names the platform's own
  // origins -- the dashboard and marketing site. It must still be explicit:
  // an empty list means "any origin" in development.
  if (config.allowedOrigins.length === 0) {
    problems.push(
      'WIDGET_ALLOWED_ORIGINS must list the platform origins (dashboard, marketing) in production',
    );
  }
  if (config.sandboxTenant) {
    problems.push(
      'SUNNY_SANDBOX_TENANT must be unset in production: it serves a fictional installer ' +
        'alongside the real ones, and it exists for the isolation sweep rather than for visitors',
    );
  }
  return problems;
}

/**
 * Refuse to boot when the deployment cannot say where its data lives.
 *
 * Two failures, and they are the same failure seen from either end. A production
 * deployment that never set `SUNNY_STORE` gets the file store, which on Cloud Run
 * is a container's own filesystem: every conversation and every enquiry is gone
 * at the next deploy, and the deployment is otherwise perfectly healthy. And a
 * deployment that *did* set `SUNNY_STORE=firestore` without a project would
 * otherwise have to fall back silently to those same local files, which is worse
 * -- somebody chose the database and the process ignored them.
 *
 * Both are refusals rather than warnings, unlike `productionWarnings` below,
 * because neither is a degraded mode an operator might intend. Running without a
 * store decision is not running.
 */
export function assertStoreConfigured(config: ServerConfig): string[] {
  const problems: string[] = [];
  if (config.nodeEnv === 'production' && config.store === undefined) {
    problems.push(
      'SUNNY_STORE is not set. In production the file store writes to the container’s ' +
        'own filesystem, so every enquiry is lost at the next deploy. Set SUNNY_STORE=firestore ' +
        '(and GOOGLE_CLOUD_PROJECT), or set SUNNY_STORE=file deliberately to accept local files.',
    );
  }
  if (config.store === 'firestore' && !config.firestore) {
    problems.push(
      'SUNNY_STORE=firestore requires GOOGLE_CLOUD_PROJECT: without a project there is ' +
        'no database to address, and falling back to local files would quietly discard the choice.',
    );
  }
  return problems;
}

/**
 * Things that are not fatal but will surprise someone in production.
 *
 * Kept separate from `assertProductionReady` because the distinction is real:
 * that function refuses to boot, and none of these is worth refusing to boot
 * over. Collapsing them would mean either refusing to start for a
 * misconfiguration that is merely degraded, or losing the warning entirely.
 */
export function productionWarnings(config: ServerConfig): string[] {
  const warnings: string[] = [];
  if (config.nodeEnv !== 'production') return warnings;

  if (config.store === 'file') {
    // Allowed, because an operator with a mounted volume may genuinely mean it --
    // but never by accident, and never silently. See `assertStoreConfigured` for
    // the version of this that refuses.
    warnings.push(
      'SUNNY_STORE=file: conversations and enquiries are written to the container’s own ' +
        'filesystem. On Cloud Run that is lost at the next deploy unless a volume is mounted ' +
        'at SUNNY_DATA_DIR. Set SUNNY_STORE=firestore to use the operational database.',
    );
  }

  if (config.rateLimit.enabled && config.rateLimit.trustProxyHops === 0) {
    // The failure this warns about is the opposite of the usual one: not too
    // little limiting, but too much. With no trusted proxy the limiter keys on
    // whichever peer opened the socket, which on Cloud Run is the front end --
    // so one bucket is shared by every visitor and the site 429s itself.
    warnings.push(
      'SUNNY_TRUST_PROXY is unset, so the rate limiter keys on the socket peer. ' +
        'Behind a load balancer that is the balancer itself, so all visitors share one ' +
        'bucket and the limit applies globally rather than per visitor. Confirm the proxy ' +
        'hop count and set SUNNY_TRUST_PROXY before launch (docs/DECISIONS.md, D-10).',
    );
  }

  if (config.leadRetentionDays <= 0) {
    // A warning rather than a refusal, in the same spirit as the one above: an
    // operator may genuinely mean it, and refusing to boot over a retention policy
    // would be answered by whoever is on call setting a number they have not
    // thought about. But "we keep every enquiry forever" is not a default anyone
    // should discover from a support ticket, so it is said out loud at boot.
    warnings.push(
      'SUNNY_LEAD_RETENTION_DAYS is 0, so enquiries are kept indefinitely. ' +
        'Set a retention window before launch, or confirm the decision and record it ' +
        '(docs/DECISIONS.md, D-44).',
    );
  }

  return warnings;
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
  /** Whether an installer can load a catalogue into this deployment. */
  catalogue: { uploadsEnabled: boolean; reason: string | null };
  /**
   * How long an enquiry is kept, and whether anything is enforcing it.
   *
   * Both numbers, because they answer different questions and only one of them is
   * a promise: `windowDays` is what the deployment says it keeps, and `sweeping`
   * is whether a running process is doing so. A window with the sweep disabled is
   * a policy nothing carries out, and an operator reading `/healthz` should not
   * have to infer that from a boot log they may not have seen.
   */
  retention: { windowDays: number; sweeping: boolean };
}

/** The retention half of the capability report: one place, one reading of the rule. */
function retentionReport(config: ServerConfig): CapabilityReport['retention'] {
  return { windowDays: config.leadRetentionDays, sweeping: config.leadRetentionDays > 0 };
}

export function capabilityReport(config: ServerConfig): CapabilityReport {
  // What the deployment asked for, which is not the same as what it got: whether
  // the database is *reachable* is the live check `/healthz` makes against the
  // store itself. This half is the configuration statement, so an operator can
  // see the two side by side and tell a wrong setting from an outage.
  const persistence: CapabilityReport['persistence'] = {
    available: true,
    kind: config.store === 'firestore' ? 'firestore' : 'file',
  };
  const catalogue: CapabilityReport['catalogue'] = config.adminToken
    ? { uploadsEnabled: true, reason: null }
    : {
        uploadsEnabled: false,
        reason:
          'SUNNY_ADMIN_TOKEN is not set, so no catalogue can be uploaded. Set it to load an ' +
          'installer’s product list; without one, recommendations have nothing to price.',
      };

  if (!config.gemini) {
    return {
      chat: {
        available: false,
        model: null,
        surface: null,
        modelVerified: false,
        reason:
          'GEMINI_API_KEY is not set. Chat is disabled rather than simulated. ' +
          'To enable it locally: copy .env.example to .env at the repo root and set ' +
          'GEMINI_API_KEY (get a key at https://aistudio.google.com/apikey).',
      },
      escalation: { available: false, model: null, reason: 'GEMINI_API_KEY is not set.' },
      persistence,
      catalogue,
      retention: retentionReport(config),
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
    persistence,
    catalogue,
    retention: retentionReport(config),
  };
}
