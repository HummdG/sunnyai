import { widgetConfigSchema, type WidgetConfig } from '@sunny/contracts';

/**
 * Tenant resolution.
 *
 * A widget identifies its tenant by a *public* id (`w_...`), never by a slug or
 * an internal id, so nothing about the tenant's identity, its SunScan slug or
 * its commercial configuration is discoverable from the page source. The public
 * id is the only key a browser ever holds.
 *
 * The demo tenant below is seed data, not a fallback: an unknown public id is a
 * 404. A default tenant would mean any mistyped or scraped id silently served
 * someone else's branding.
 */
export interface Tenant {
  id: string;
  publicId: string;
  config: WidgetConfig;
  /** The SunScan installer slug this tenant maps to, when it has one. */
  sunscanSlug: string | null;
  /**
   * The resolved SunScan base URL for this tenant, or null when the deployment
   * has no SunScan configured.
   *
   * Null is meaningful and must stay distinguishable from "configured but
   * broken": the tools check it and tell the visitor they cannot reach the
   * installer's system, rather than inventing a catalogue. Sunny does not talk
   * to SunScan at all until an operator sets `SUNSCAN_BASE_URL`.
   */
  sunscanUrl: string | null;
}

const DEMO_TENANT: Tenant = {
  id: 't_demo0001',
  publicId: 'w_demo000001',
  sunscanSlug: 'demo-solar',
  sunscanUrl: null,
  config: {
    publicId: 'w_demo000001',
    companyName: 'Northwind Solar',
    tagline: 'Ask me anything about solar for your home',
    primaryColor: '#FF7900',
    position: 'bottom-right',
    greeting: "Hi, I'm Sunny. Ask me about solar for your roof, or what it would cost.",
    suggestions: [
      'How much could I save?',
      'Is my roof suitable?',
      'What does a system cost?',
      'How do I get a survey?',
    ],
    intensity: 'balanced',
    voiceEnabled: false,
  },
};

/**
 * A second fixture tenant, for the isolation sweep.
 *
 * D-35's suite proves cross-tenant denial in process, against a registry it
 * builds itself. That is the right place for 98 cases, and it is not the same
 * claim as the one an operator wants before a release: that *this* deployment --
 * with its real session secret, its real data directory and its real origin list
 * -- keeps two installers apart. `scripts/verify-isolation.ts` asks the running
 * server, and a sweep needs a second tenant to ask about.
 *
 * Registered only when asked for, and refused in production (see
 * `assertProductionReady`). It is demo data with a fictional installer's name on
 * it: a production deployment that served it would be publishing a company that
 * does not exist under a customer's own domain, which is not a mistake worth
 * making available.
 */
const SANDBOX_TENANT: Tenant = {
  id: 't_sandbox001',
  publicId: 'w_sandbox0001',
  sunscanSlug: 'sandbox-solar',
  sunscanUrl: null,
  config: {
    ...DEMO_TENANT.config,
    publicId: 'w_sandbox0001',
    companyName: 'Southgate Solar',
    tagline: 'The second installer in the isolation sweep',
    primaryColor: '#1D4ED8',
  },
};

/**
 * The tenants a deployment serves.
 *
 * A list rather than a single tenant because the registry is already a map and
 * the sweep needs two; a *parameter* rather than two exported registries because
 * which set is served is a boot decision, and a boot decision that can differ
 * between two code paths is how "the sandbox tenant is off in production" turns
 * out to be true in one of them.
 */
export function defaultTenants(sandbox = false): Tenant[] {
  return sandbox ? [DEMO_TENANT, SANDBOX_TENANT] : [DEMO_TENANT];
}

/**
 * Resolve a tenant's SunScan base URL from the environment.
 *
 * Two variables, both optional: the origin of the SunScan instance, and a
 * per-tenant override for installations that live on their own host. Nothing is
 * guessed -- with no origin set, every SunScan-dependent tool reports that the
 * service is not connected.
 */
function resolveSunscanUrl(slug: string | null): string | null {
  if (!slug) return null;
  const perTenant = process.env[`SUNSCAN_URL_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  const base = perTenant ?? process.env['SUNSCAN_BASE_URL'];
  if (!base || base.trim() === '') return null;
  try {
    return new URL(`/${slug}`, base.trim()).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export class TenantRegistry {
  #byPublicId = new Map<string, Tenant>();

  constructor(tenants: Tenant[] = [DEMO_TENANT]) {
    for (const tenant of tenants) {
      this.#byPublicId.set(tenant.publicId, {
        ...tenant,
        sunscanUrl: resolveSunscanUrl(tenant.sunscanSlug),
      });
    }
  }

  byPublicId(publicId: string): Tenant | null {
    return this.#byPublicId.get(publicId) ?? null;
  }

  /** The widget config, validated on the way out so seed data cannot drift. */
  configFor(publicId: string): WidgetConfig | null {
    const tenant = this.byPublicId(publicId);
    if (!tenant) return null;
    const parsed = widgetConfigSchema.safeParse(tenant.config);
    return parsed.success ? parsed.data : null;
  }

  get all(): Tenant[] {
    return [...this.#byPublicId.values()];
  }
}

export { DEMO_TENANT, SANDBOX_TENANT };
