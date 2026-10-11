import { afterEach, describe, expect, it } from 'vitest';

import {
  DEV_SECRET,
  assertProductionReady,
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
      'WIDGET_ALLOWED_ORIGINS must list the customer origins in production',
    );
  });

  it('does not obstruct a local run', () => {
    expect(assertProductionReady(loadConfig())).toEqual([]);
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
