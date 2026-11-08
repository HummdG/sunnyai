import type { Tenant } from './tenants.js';

/**
 * Package entitlements (Blueprint §5, `tenant_addons`).
 *
 * The base package is the web chat; the email assistant is the add-on. Stripe
 * webhooks switch them (`billing/webhook.ts`); every channel checks them here
 * before doing any work. This module is the shared contract with the chat and
 * email channels: `hasEntitlement(tenant, key)` is the only question they ask.
 *
 * A tenant record saved while the phone add-on existed may still carry
 * `voice_widget` or `phone_agent` flags. Nothing reads them: only the keys
 * below are ever looked up.
 */
export type AddonKey = 'web_chat' | 'email_assistant';

export const ADDON_KEYS: readonly AddonKey[] = ['web_chat', 'email_assistant'];

/** The packages a tenant can buy, and the add-ons each one switches on. */
export type PlanKey = 'base' | 'email' | 'suite';

export const PLAN_ADDONS: Readonly<Record<PlanKey, readonly AddonKey[]>> = {
  base: ['web_chat'],
  email: ['email_assistant'],
  suite: ['web_chat', 'email_assistant'],
};

/** Per-add-on configuration (`config_json` in the blueprint). */
export interface AddonConfig {
  /** Monthly usage quota: messages for chat, or emails. */
  monthlyQuota?: number;
  /** Channel-specific settings. Never secrets: those live in Secret Manager. */
  [key: string]: unknown;
}

/**
 * Billing state as the webhooks leave it.
 *
 * `past_due` keeps the add-ons running until `graceUntil`, so a card that fails
 * once does not switch an installer's assistant off mid-week; after the grace
 * period every paid add-on is refused until a payment succeeds. `canceled`
 * switches everything off immediately.
 */
export interface BillingState {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';
  subscriptionId: string | null;
  /** ISO time after which a past-due tenant loses its add-ons. */
  graceUntil: string | null;
  /** `created` of the last Stripe event applied, so an older event cannot undo a newer one. */
  lastEventAt: number | null;
}

/** Days a past-due tenant keeps its add-ons. */
export const PAYMENT_GRACE_DAYS = 7;

/**
 * Whether a tenant may use an add-on now.
 *
 * Absent configuration means the base chat only, which is what every tenant
 * created before entitlements existed (and the seeded demo tenant) has.
 */
export function hasEntitlement(tenant: Tenant, key: AddonKey, now: number = Date.now()): boolean {
  const on = tenant.config.addons?.[key] ?? key === 'web_chat';
  if (!on) return false;
  const billing = tenant.billing;
  if (!billing) return true;
  if (billing.status === 'canceled') return false;
  if (billing.status === 'past_due' && billing.graceUntil !== null) {
    return now <= Date.parse(billing.graceUntil);
  }
  return true;
}

/** The add-ons a set of plans grants, as a full map (false for the rest). */
export function addonsForPlans(plans: readonly PlanKey[]): Record<AddonKey, boolean> {
  const granted = new Set(plans.flatMap((plan) => PLAN_ADDONS[plan]));
  return Object.fromEntries(ADDON_KEYS.map((key) => [key, granted.has(key)])) as Record<
    AddonKey,
    boolean
  >;
}
