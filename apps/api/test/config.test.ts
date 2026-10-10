import { afterEach, describe, expect, it } from 'vitest';

import {
  DEV_SECRET,
  assertProductionReady,
  capabilityReport,
  loadConfig,
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
