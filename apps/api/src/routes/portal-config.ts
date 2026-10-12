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
 *   STRIPE_PRICE_BASE / _EMAIL / _VOICE / _SUITE   price ids per package
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
    ['voice', 'STRIPE_PRICE_VOICE'],
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
  };
}
