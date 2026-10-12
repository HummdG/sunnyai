import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_LEAD_RETENTION_DAYS,
  DEV_SECRET,
  assertProductionReady,
  assertStoreConfigured,
  capabilityReport,
  loadConfig,
  productionWarnings,
  type ServerConfig,
} from '../src/config.js';

/**
 * Configuration is where a deployment is honest or not, so it is tested like any
 * other logic: the surface is chosen from the credentials, and a production
 * instance on development defaults refuses to start.
 */

const MANAGED = ['GEMINI_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GEMINI_MODEL'];

afterEach(() => {
  for (const name of MANAGED) delete process.env[name];
});

describe('configuration', () => {
  it('has no assistant at all without a key', () => {
    delete process.env['GEMINI_API_KEY'];
    const config = loadConfig();
    expect(config.gemini).toBeUndefined();
    expect(capabilityReport(config).chat.available).toBe(false);
    expect(capabilityReport(config).chat.reason).toContain('GEMINI_API_KEY');
  });

  it('chooses Vertex when a project is set, because that is where the ids were verified', () => {
    process.env['GEMINI_API_KEY'] = 'k';
    process.env['GOOGLE_CLOUD_PROJECT'] = 'sunny-prod';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'europe-west2';

    const config = loadConfig();
    expect(config.gemini?.surface).toBe('vertex');
    expect(config.gemini?.project).toBe('sunny-prod');
    expect(config.gemini?.location).toBe('europe-west2');
    expect(capabilityReport(config).chat.modelVerified).toBe(true);
  });

  it('chooses the Developer API from a key alone, and admits the id is unverified', () => {
    process.env['GEMINI_API_KEY'] = 'k';
    delete process.env['GOOGLE_CLOUD_PROJECT'];

    const config = loadConfig();
    expect(config.gemini?.surface).toBe('developer-api');
    expect(config.gemini?.project).toBeUndefined();

    const report = capabilityReport(config);
    // Still available -- a key is a key -- but the operator is told the model id
    // was checked against the other surface, because that is exactly the failure
    // that would otherwise show up as a 404 on the first turn.
    expect(report.chat.available).toBe(true);
    expect(report.chat.modelVerified).toBe(false);
    expect(report.chat.reason).toContain('Vertex AI documentation');
    expect(report.chat.surface).toBe('developer-api');
  });

  it('leaves escalation unset rather than pinning a retiring model', () => {
    process.env['GEMINI_API_KEY'] = 'k';
    const config = loadConfig();
    expect(config.gemini?.escalationModel).toBeUndefined();
    expect(capabilityReport(config).escalation.available).toBe(false);
    expect(capabilityReport(config).escalation.reason).toContain('retiring');
  });

  it('refuses a production boot on the development secret', () => {
    const config: ServerConfig = {
      ...loadConfig(),
      nodeEnv: 'production',
      sessionSecret: DEV_SECRET,
      allowedOrigins: ['https://example.com'],
    };
    expect(assertProductionReady(config)).toContain(
      'SESSION_SECRET must be set to a real secret in production',
    );
  });

  it('refuses a production boot with no allowed origin', () => {
    const config: ServerConfig = {
      ...loadConfig(),
      nodeEnv: 'production',
      sessionSecret: 'a-real-secret',
      allowedOrigins: [],
    };
    expect(assertProductionReady(config)).toContain(
      'WIDGET_ALLOWED_ORIGINS must list the platform origins (dashboard, marketing) in production',
    );
  });

  it('does not obstruct a local run', () => {
    expect(assertProductionReady(loadConfig())).toEqual([]);
  });
});

describe('operational database configuration', () => {
  const STORE_VARS = [
    'SUNNY_STORE',
    'SUNNY_FIRESTORE_DATABASE',
    'SUNNY_FIRESTORE_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
  ];

  afterEach(() => {
    for (const name of STORE_VARS) delete process.env[name];
  });

  it('leaves the store unchosen when the variable is unset', () => {
    const config = loadConfig();
    expect(config.store).toBeUndefined();
    expect(config.firestore).toBeUndefined();
    // Unset is a *development* default rather than a decision, so it is allowed
    // to boot locally and refused in production -- which the next test covers.
    expect(assertStoreConfigured(config)).toEqual([]);
  });

  it('refuses a production boot that never chose a store', () => {
    const config: ServerConfig = { ...loadConfig(), nodeEnv: 'production' };
    expect(assertStoreConfigured(config).join(' ')).toContain('SUNNY_STORE is not set');
  });

  it('addresses the database from GOOGLE_CLOUD_PROJECT, and says which database', () => {
    process.env['SUNNY_STORE'] = 'firestore';
    process.env['GOOGLE_CLOUD_PROJECT'] = 'sunny-prod';
    process.env['SUNNY_FIRESTORE_DATABASE'] = 'sunny-main';

    const config = loadConfig();
    expect(config.store).toBe('firestore');
    expect(config.firestore).toEqual({
      project: 'sunny-prod',
      databaseId: 'sunny-main',
      emulatorHost: null,
    });
    expect(assertStoreConfigured(config)).toEqual([]);
    expect(capabilityReport({ ...config, nodeEnv: 'production' }).persistence).toEqual({
      available: true,
      kind: 'firestore',
    });
  });

  it('defaults to the (default) database rather than inventing a name', () => {
    process.env['SUNNY_STORE'] = 'firestore';
    process.env['GOOGLE_CLOUD_PROJECT'] = 'sunny-prod';
    expect(loadConfig().firestore?.databaseId).toBe('(default)');
  });

  it('refuses firestore without a project, instead of falling back to local files', () => {
    process.env['SUNNY_STORE'] = 'firestore';
    const config = loadConfig();
    expect(config.firestore).toBeUndefined();
    // The refusal is the point: an operator who chose the database must not have
    // the process quietly write to a container's own filesystem instead.
    expect(assertStoreConfigured(config).join(' ')).toContain('requires GOOGLE_CLOUD_PROJECT');
  });

  it('rejects a store name it does not recognise, rather than guessing', () => {
    process.env['SUNNY_STORE'] = 'postgres';
    expect(() => loadConfig()).toThrow(/SUNNY_STORE must be "file" or "firestore"/);
  });

  it('warns -- but does not refuse -- an explicit file store in production', () => {
    // Allowed because an operator with a mounted volume may mean it, warned
    // because on Cloud Run without one it loses the data at the next deploy.
    const config: ServerConfig = {
      ...loadConfig(),
      nodeEnv: 'production',
      store: 'file',
      sessionSecret: 'a-real-secret',
      allowedOrigins: ['https://example.com'],
    };
    expect(assertStoreConfigured(config)).toEqual([]);
    expect(productionWarnings(config).join(' ')).toContain('SUNNY_STORE=file');
  });

  it('reads the emulator from SUNNY_FIRESTORE_EMULATOR_HOST, and ignores the conventional name', () => {
    // The client library honours `FIRESTORE_EMULATOR_HOST` on its own, which is
    // exactly why this is asserted: a stray ambient variable must not be able to
    // point a process at a throwaway database, so the name the *server* reads is
    // the sole thing that takes effect.
    process.env['SUNNY_STORE'] = 'firestore';
    process.env['GOOGLE_CLOUD_PROJECT'] = 'sunny-prod';
    process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080';
    expect(loadConfig().firestore?.emulatorHost).toBeNull();

    process.env['SUNNY_FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8085';
    expect(loadConfig().firestore?.emulatorHost).toBe('127.0.0.1:8085');
  });

  it('does not build a Firestore config for an emulator variable on its own', () => {
    process.env['SUNNY_FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8085';
    process.env['GOOGLE_CLOUD_PROJECT'] = 'sunny-prod';
    const config = loadConfig();
    expect(config.store).toBeUndefined();
    expect(config.firestore).toBeUndefined();
  });
});

describe('rate limit configuration', () => {
  afterEach(() => {
    for (const name of [
      'SUNNY_RATE_LIMIT',
      'SUNNY_TRUST_PROXY',
      'SUNNY_RL_SESSION_LIMIT',
      'SUNNY_RL_CHAT_LIMIT',
      'SUNNY_RL_MAX_KEYS',
    ]) {
      delete process.env[name];
    }
  });

  it('is on by default, with limits that a person will not reach', () => {
    const { rateLimit } = loadConfig();
    expect(rateLimit.enabled).toBe(true);
    expect(rateLimit.rules.session.limit).toBeGreaterThan(10);
    expect(rateLimit.rules.chat.limit).toBeGreaterThan(10);
  });

  it('trusts no proxy unless told to', () => {
    // The safe default: with no trust the limiter falls back to the socket peer,
    // which over-limits rather than believing a header the caller controls.
    expect(loadConfig().rateLimit.trustProxyHops).toBe(0);
  });

  it('can be switched off, and the limits changed, from the environment', () => {
    process.env['SUNNY_RATE_LIMIT'] = '0';
    process.env['SUNNY_RL_SESSION_LIMIT'] = '7';
    process.env['SUNNY_RL_CHAT_LIMIT'] = '3';
    const { rateLimit } = loadConfig();
    expect(rateLimit.enabled).toBe(false);
    expect(rateLimit.rules.session.limit).toBe(7);
    expect(rateLimit.rules.chat.limit).toBe(3);
  });

  it('accepts both a hop count and a boolean-ish spelling', () => {
    process.env['SUNNY_TRUST_PROXY'] = 'true';
    expect(loadConfig().rateLimit.trustProxyHops).toBe(1);
    process.env['SUNNY_TRUST_PROXY'] = '2';
    expect(loadConfig().rateLimit.trustProxyHops).toBe(2);
    process.env['SUNNY_TRUST_PROXY'] = 'false';
    expect(loadConfig().rateLimit.trustProxyHops).toBe(0);
  });

  it('treats a nonsensical hop count as no trust rather than as NaN', () => {
    // `Number('abc')` is NaN, and NaN fails every comparison silently -- which in
    // the resolver would mean `trustedHops <= 0` is false and the header is read
    // with an index of NaN. Falling back to 0 keeps the fail-closed behaviour.
    process.env['SUNNY_TRUST_PROXY'] = 'abc';
    expect(loadConfig().rateLimit.trustProxyHops).toBe(0);
  });

  it('warns in production that an untrusted proxy makes the limit global', () => {
    const config = loadConfig({
      nodeEnv: 'production',
      allowedOrigins: ['https://example.test'],
      sessionSecret: 'a-real-secret',
    });
    const warnings = productionWarnings(config);
    expect(warnings.join(' ')).toContain('SUNNY_TRUST_PROXY');
    expect(warnings.join(' ')).toContain('globally');
  });

  it('does not warn locally, where one bucket is not a surprise', () => {
    expect(productionWarnings(loadConfig())).toEqual([]);
  });

  it('does not warn in production once the hop count is set', () => {
    const config = loadConfig({
      nodeEnv: 'production',
      allowedOrigins: ['https://example.test'],
      sessionSecret: 'a-real-secret',
      rateLimit: {
        enabled: true,
        trustProxyHops: 1,
        rules: {
          session: { limit: 30, windowMs: 60_000 },
          chat: { limit: 20, windowMs: 60_000 },
          leads: { limit: 10, windowMs: 60_000 },
          qualification: { limit: 40, windowMs: 60_000 },
          catalogue: { limit: 20, windowMs: 60_000 },
          knowledge: { limit: 20, windowMs: 60_000 },
        },
        maxKeys: 10_000,
      },
    });
    expect(productionWarnings(config)).toEqual([]);
  });
});

describe('retention configuration', () => {
  afterEach(() => {
    delete process.env['SUNNY_LEAD_RETENTION_DAYS'];
  });

  it('keeps enquiries for a bounded window by default', () => {
    expect(loadConfig().leadRetentionDays).toBe(DEFAULT_LEAD_RETENTION_DAYS);
    // Two years, and the assertion is on the order of magnitude rather than the
    // exact number: a default that drifted to a week would remove enquiries before
    // an installer had rung back, and one that drifted to a century is not a window.
    expect(DEFAULT_LEAD_RETENTION_DAYS).toBeGreaterThanOrEqual(365);
    expect(DEFAULT_LEAD_RETENTION_DAYS).toBeLessThanOrEqual(3650);
  });

  it('takes a window from the environment', () => {
    process.env['SUNNY_LEAD_RETENTION_DAYS'] = '90';
    expect(loadConfig().leadRetentionDays).toBe(90);
  });

  it('reads zero as "keep", which is the one value that is not a window', () => {
    // Not a mistake to be corrected: it is how an operator says the deployment
    // keeps what it holds, and the sweep is disabled rather than run with a
    // zero-length window that would erase everything on boot.
    process.env['SUNNY_LEAD_RETENTION_DAYS'] = '0';
    expect(loadConfig().leadRetentionDays).toBe(0);
  });

  it('falls back to the default rather than to NaN for a value it cannot read', () => {
    for (const nonsense of ['abc', '-1', '']) {
      process.env['SUNNY_LEAD_RETENTION_DAYS'] = nonsense;
      // NaN compares false against everything, so a window of NaN would silently
      // expire nothing at all -- a retention promise that quietly does not run,
      // which is the failure mode worth the most care. A negative window would
      // expire everything, on every boot, which is the other one.
      expect(loadConfig().leadRetentionDays).toBe(DEFAULT_LEAD_RETENTION_DAYS);
    }
  });

  it('says so at boot when a production deployment keeps everything forever', () => {
    process.env['SUNNY_LEAD_RETENTION_DAYS'] = '0';
    const warnings = productionWarnings(
      loadConfig({
        nodeEnv: 'production',
        allowedOrigins: ['https://example.test'],
        sessionSecret: 'a-real-secret',
      }),
    );
    expect(warnings.join(' ')).toContain('SUNNY_LEAD_RETENTION_DAYS');
    expect(warnings.join(' ')).toContain('indefinitely');
  });

  it('does not mention retention when a window is set', () => {
    expect(productionWarnings(loadConfig({ nodeEnv: 'production' })).join(' ')).not.toContain(
      'SUNNY_LEAD_RETENTION_DAYS',
    );
  });

  it('reports the window and whether anything is enforcing it', () => {
    expect(capabilityReport(loadConfig()).retention).toEqual({
      windowDays: DEFAULT_LEAD_RETENTION_DAYS,
      sweeping: true,
    });
    // Both halves, because a window nothing carries out is a policy rather than a
    // practice -- and `/healthz` is where an operator checks without reading the
    // boot log.
    process.env['SUNNY_LEAD_RETENTION_DAYS'] = '0';
    expect(capabilityReport(loadConfig()).retention).toEqual({ windowDays: 0, sweeping: false });
  });
});
