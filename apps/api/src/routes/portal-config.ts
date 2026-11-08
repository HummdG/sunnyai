import type { PlanKey } from '../entitlements.js';

/**
 * Configuration for the installer portal and billing, read from the
 * environment. Kept beside the routes it configures rather than in the shared
 * `config.ts`, so the portal can be reasoned about (and tested) on its own.
 *
 *   SUNNY_DEV_AUTH=1                 dev magic-link sign-in (never in production)
 *   FIREBASE_PROJECT_ID              Firebase Auth project (falls back to GOOGLE_CLOUD_PROJECT)
 *   SUNNY_DRIVE_SERVICE_ACCOUNT      the email installers share their Drive folder with
 *   SUNNY_WIDGET_SCRIPT_URL          the published widget.js, for install snippets
 *   SUNNY_PUBLIC_API_URL             this API's public URL, for install snippets
 *   SUNNY_DASHBOARD_URL              the website's origin (the dashboard is under /dashboard)
 *   STRIPE_SECRET_KEY                Stripe API key (test or live)
 *   STRIPE_WEBHOOK_SECRET            `whsec_...` for /v1/billing/webhook
 *   STRIPE_PRICE_BASE / _EMAIL / _SUITE   price ids per package
 *   SUNNY_STAFF_EMAILS               comma-separated Sunny staff, who may open /admin
 */
export interface StripeConfig {
  secretKey: string | null;
  webhookSecret: string | null;
  prices: Partial<Record<PlanKey, string>>;
}

export interface PortalConfig {
  devAuth: boolean;
  firebaseProjectId: string | null;
  /** Trust the Firebase Auth emulator's unsigned tokens (never in production). */
  firebaseEmulator: boolean;
  driveServiceAccountEmail: string | null;
  widgetScriptUrl: string;
  publicApiUrl: string;
  dashboardUrl: string;
  stripe: StripeConfig;
  /**
   * Sunny's own people, by verified email, lowercased: who may read the staff
   * dashboard (`routes/admin.ts`). Empty or absent switches it off. A person is
   * staff by being signed in as one of these addresses, never by a claim the
   * browser sends, so removing an address takes effect on their next request.
   */
  staffEmails?: readonly string[];
}

/** `SUNNY_STAFF_EMAILS`, parsed. A malformed entry is a startup error, not a silent skip. */
export function parseStaffEmails(raw: string | null): string[] {
  if (raw === null) return [];
  const emails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`SUNNY_STAFF_EMAILS has an entry that is not an email address: "${email}"`);
    }
  }
  return emails;
}

export function loadPortalConfig(
  env: Record<string, string | undefined>,
  nodeEnv: string,
): PortalConfig {
  const value = (name: string): string | null => {
    const raw = env[name];
    return raw === undefined || raw.trim() === '' ? null : raw.trim();
  };
  const prices: Partial<Record<PlanKey, string>> = {};
  for (const [plan, name] of [
    ['base', 'STRIPE_PRICE_BASE'],
    ['email', 'STRIPE_PRICE_EMAIL'],
    ['suite', 'STRIPE_PRICE_SUITE'],
  ] as const) {
    const id = value(name);
    if (id) prices[plan] = id;
  }
  return {
    // Refused in production whatever the variable says: dev sign-in lets anyone
    // be anyone, which is the point of it locally and a breach anywhere else.
    devAuth: value('SUNNY_DEV_AUTH') === '1' && nodeEnv !== 'production',
    firebaseProjectId: value('FIREBASE_PROJECT_ID') ?? value('GOOGLE_CLOUD_PROJECT'),
    firebaseEmulator: value('FIREBASE_AUTH_EMULATOR_HOST') !== null && nodeEnv !== 'production',
    driveServiceAccountEmail: value('SUNNY_DRIVE_SERVICE_ACCOUNT'),
    widgetScriptUrl:
      value('SUNNY_WIDGET_SCRIPT_URL') ?? 'http://localhost:4173/widget/sunny-widget.js',
    publicApiUrl: value('SUNNY_PUBLIC_API_URL') ?? 'http://localhost:8787',
    dashboardUrl: value('SUNNY_DASHBOARD_URL') ?? 'http://localhost:4176',
    stripe: {
      secretKey: value('STRIPE_SECRET_KEY'),
      webhookSecret: value('STRIPE_WEBHOOK_SECRET'),
      prices,
    },
    staffEmails: parseStaffEmails(value('SUNNY_STAFF_EMAILS')),
  };
}
