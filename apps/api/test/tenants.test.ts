import { afterEach, describe, expect, it } from 'vitest';

import { widgetConfigSchema } from '@sunny/contracts';

import { assertProductionReady, loadConfig } from '../src/config.js';
import { DEMO_TENANT, SANDBOX_TENANT, TenantRegistry, defaultTenants } from '../src/tenants.js';

/**
 * The second tenant, and the switch that serves it.
 *
 * `scripts/verify-isolation.ts` sweeps a *running* deployment for cross-tenant
 * leaks, and a sweep against a server that knows one tenant cannot fail --
 * every "the other installer sees nothing" assertion would be about a public id
 * that 404s. So the deployment has to be able to hold two, which is what these
 * tests are about. The security property itself is D-35's suite; this file
 * covers the fixture and the boot decision that makes that suite runnable
 * against a real process.
 */

const ENV_KEY = 'SUNNY_SANDBOX_TENANT';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('the sandbox tenant', () => {
  it('is served only when asked for by name', () => {
    expect(defaultTenants().map((tenant) => tenant.publicId)).toEqual([DEMO_TENANT.publicId]);
    expect(defaultTenants(true).map((tenant) => tenant.publicId)).toEqual([
      DEMO_TENANT.publicId,
      SANDBOX_TENANT.publicId,
    ]);
  });

  it('is a tenant the contract accepts, with nothing of the demo tenant left in it', () => {
    // A copy-paste that kept the demo `publicId` would produce two entries in the
    // registry's map under one key, and the sweep would compare a tenant with
    // itself -- the exact vacuous pass this fixture exists to prevent.
    const parsed = widgetConfigSchema.safeParse(SANDBOX_TENANT.config);
    expect(parsed.success).toBe(true);
    expect(SANDBOX_TENANT.config.publicId).toBe(SANDBOX_TENANT.publicId);
    expect(SANDBOX_TENANT.id).not.toBe(DEMO_TENANT.id);
    expect(SANDBOX_TENANT.publicId).not.toBe(DEMO_TENANT.publicId);
    // The sweep tells the two apart by comparing published configs, so the names
    // have to differ or every "read the other installer's branding" assertion
    // would pass on a config that is identical.
    expect(SANDBOX_TENANT.config.companyName).not.toBe(DEMO_TENANT.config.companyName);
  });

  it('resolves both tenants, each to its own config', () => {
    const registry = new TenantRegistry(defaultTenants(true));
    expect(registry.byPublicId(SANDBOX_TENANT.publicId)?.id).toBe(SANDBOX_TENANT.id);
    expect(registry.byPublicId(DEMO_TENANT.publicId)?.id).toBe(DEMO_TENANT.id);
    expect(registry.configFor(SANDBOX_TENANT.publicId)?.companyName).toBe(
      SANDBOX_TENANT.config.companyName,
    );
    expect(registry.configFor('w_notarealtenant')).toBeNull();
  });

  it('is off unless the environment says otherwise', () => {
    expect(loadConfig().sandboxTenant).toBe(false);
    expect(loadConfig({ sandboxTenant: true }).sandboxTenant).toBe(true);

    process.env[ENV_KEY] = '1';
    expect(loadConfig().sandboxTenant).toBe(true);
    process.env[ENV_KEY] = 'true';
    expect(loadConfig().sandboxTenant).toBe(true);

    // Anything else is off. A near-miss -- `yes`, `on`, a stray space -- must not
    // turn a demo installer on in a deployment that thought it had said no.
    process.env[ENV_KEY] = 'yes';
    expect(loadConfig().sandboxTenant).toBe(false);
    process.env[ENV_KEY] = '0';
    expect(loadConfig().sandboxTenant).toBe(false);
  });

  it('is refused in production, at boot', () => {
    const config = loadConfig({
      nodeEnv: 'production',
      sessionSecret: 'a-real-secret',
      allowedOrigins: ['https://example.test'],
      sandboxTenant: true,
    });
    expect(assertProductionReady(config).join(' ')).toContain('SUNNY_SANDBOX_TENANT');
    expect(assertProductionReady(loadConfig())).toEqual([]);
  });
});
