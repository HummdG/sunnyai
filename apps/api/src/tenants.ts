import { widgetConfigSchema, type WidgetConfig } from '@sunny/contracts';

import type { SavingsModel } from './agent/savings.js';
import type { AddonConfig, AddonKey, BillingState } from './entitlements.js';
import type { Store } from './store.js';

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
  /**
   * The public widget config, plus server-only settings. `addons` never reaches
   * the browser: `configFor` parses through `widgetConfigSchema`, which drops it.
   */
  config: WidgetConfig & {
    addons?: Partial<Record<AddonKey, boolean>>;
    /**
     * Who customers call after installation (the support knowledge base's
     * escalation line). Unset is a setup warning in the portal overview.
     */
    supportContact?: SupportContact;
    /** Email Assistant add-on settings (Blueprint §5, Add-On 2). */
    email?: EmailChannelConfig;
    /** Voice & Phone add-on settings (Blueprint §5, Add-On 1). */
    voice?: VoiceChannelConfig;
  };
  /**
   * The installer's registered website domains (Blueprint §4.6). When set, a
   * widget session is only opened for a page on one of these hosts or their
   * subdomains. Unset means not yet registered, which only a development
   * deployment should run with.
   */
  domains?: readonly string[];
  /**
   * The installer's own tariff assumptions for `estimate_savings`. Absent means
   * the installer has not supplied any, and the tool declines rather than
   * inventing a price per kWh.
   */
  savingsModel?: SavingsModel;
  /** The installer's website, crawled into the knowledge base (Blueprint §3.1). */
  websiteUrl?: string | null;
  /** The Google Drive folder synced into the knowledge base. */
  gdriveFolderId?: string | null;
  stripeCustomerId?: string | null;
  /** `config_json` per add-on: quotas and channel settings, never secrets. */
  addonConfig?: Partial<Record<AddonKey, AddonConfig>>;
  billing?: BillingState;
  /** Where the installer is in the onboarding wizard, so it resumes there. */
  onboarding?: { step: OnboardingStep; completedAt: string | null };
  /** Last sync of each knowledge connection, as the portal shows it. */
  sync?: Partial<Record<'website' | 'drive', SyncState>>;
  createdAt?: string;
  updatedAt?: string;
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

export interface EmailChannelConfig {
  provider: 'gmail' | 'outlook' | 'forwarding';
  /** The address forwarded mail arrives at (forwarding provider). */
  inboundAddress?: string;
  /**
   * Send replies without a person approving them. Off by default: the
   * blueprint's human-in-the-loop draft mode.
   */
  autoSend: boolean;
  /** A Secret Manager reference to the OAuth token, never the token itself. */
  tokenRef?: string;
  /** The name replies are signed with (e.g. "The Brightside Solar team"). */
  signatureName?: string;
}

export interface VoiceChannelConfig {
  /** Twilio numbers assigned to this installer's phone receptionist (E.164). */
  twilioNumbers?: string[];
  voiceName?: string;
  /** Longest call before a polite hand-off; the blueprint caps calls at 5 minutes. */
  maxCallSeconds: number;
  /** Simultaneous calls allowed. */
  concurrency: number;
  /** The booking link texted to callers (`send_sms_link`); falls back to `websiteUrl`. */
  bookingUrl?: string;
  /** What Sunny says when it answers a call: the AI disclosure. A default when unset. */
  disclosure?: string;
}

export interface SyncState {
  status: 'pending' | 'syncing' | 'connected' | 'failed';
  at: string;
  jobId: string | null;
  error: string | null;
}

export interface SupportContact {
  phone?: string;
  email?: string;
  hours?: string;
}

export const ONBOARDING_STEPS = [
  'organisation',
  'website',
  'drive',
  'customise',
  'install',
  'live',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

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
  #store: Store | null = null;

  constructor(tenants: Tenant[] = [DEMO_TENANT]) {
    for (const tenant of tenants) this.#set(tenant);
  }

  /**
   * The registry for a running deployment: seeded tenants written to the store
   * if they are not there yet, then every tenant the store holds -- including
   * those installers created through the portal.
   *
   * Lookups stay synchronous (every request resolves its tenant first), so the
   * registry is a cache over the store: `save` writes through, and `refresh`
   * re-reads, which `main.ts` runs on an interval so a second instance picks up
   * a tenant created on the first.
   */
  static async load(store: Store, seed: Tenant[] = [DEMO_TENANT]): Promise<TenantRegistry> {
    for (const tenant of seed) {
      if (!(await store.getTenant(tenant.id))) await store.putTenant(tenant);
    }
    const registry = new TenantRegistry([]);
    registry.#store = store;
    await registry.refresh();
    return registry;
  }

  #set(tenant: Tenant): void {
    for (const [publicId, existing] of this.#byPublicId) {
      if (existing.id === tenant.id && publicId !== tenant.publicId) {
        this.#byPublicId.delete(publicId);
      }
    }
    this.#byPublicId.set(tenant.publicId, {
      ...tenant,
      sunscanUrl: resolveSunscanUrl(tenant.sunscanSlug),
    });
  }

  /** Re-read every tenant from the store. A no-op for a registry built in memory. */
  async refresh(): Promise<void> {
    if (!this.#store) return;
    for (const tenant of await this.#store.listTenants()) this.#set(tenant);
  }

  /** Write a tenant through to the store (when there is one) and the cache. */
  async save(tenant: Tenant): Promise<Tenant> {
    const stamped = { ...tenant, updatedAt: new Date().toISOString() };
    // `sunscanUrl` is resolved from the environment at load, never persisted.
    if (this.#store) await this.#store.putTenant({ ...stamped, sunscanUrl: null });
    this.#set(stamped);
    return this.byId(tenant.id) ?? stamped;
  }

  byId(tenantId: string): Tenant | null {
    for (const tenant of this.#byPublicId.values()) if (tenant.id === tenantId) return tenant;
    return null;
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
