import {
  ADDON_KEYS,
  addonsForPlans,
  PAYMENT_GRACE_DAYS,
  type AddonKey,
  type BillingState,
  type PlanKey,
} from '../entitlements.js';
import type { Store } from '../store.js';
import type { Tenant, TenantRegistry } from '../tenants.js';
import type { StripeConfig } from '../routes/portal-config.js';

/**
 * Applying Stripe events to tenant entitlements.
 *
 * Exactly once: each event id is claimed in the store before it is applied, so
 * a redelivery is acknowledged and ignored. In order: an event older than the
 * last one applied to the tenant is ignored, so a late `subscription.updated`
 * cannot re-enable add-ons a newer cancellation switched off.
 *
 * Failed payments (`invoice.payment_failed`): the tenant goes `past_due` with a
 * grace period of PAYMENT_GRACE_DAYS. Add-ons keep working until it ends (see
 * `hasEntitlement`), then every paid add-on is refused. A successful payment
 * (`invoice.paid`) clears it. A cancelled subscription switches everything off
 * at once.
 */
export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export type WebhookOutcome = 'applied' | 'duplicate' | 'ignored' | 'stale' | 'unknown_tenant';

const PLANS: readonly PlanKey[] = ['base', 'email', 'suite'];

function isPlan(value: unknown): value is PlanKey {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value);
}

function metadataOf(object: Record<string, unknown>): Record<string, string> {
  const metadata = object['metadata'];
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, string>) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Plans named by a subscription's line items, through the configured price ids. */
function plansFromItems(
  object: Record<string, unknown>,
  prices: StripeConfig['prices'],
): PlanKey[] {
  const items = (object['items'] as { data?: Array<{ price?: { id?: string } }> } | undefined)
    ?.data;
  if (!Array.isArray(items)) return [];
  const byPrice = new Map(Object.entries(prices).map(([plan, id]) => [id, plan as PlanKey]));
  return items
    .map((item) => byPrice.get(item.price?.id ?? ''))
    .filter((plan): plan is PlanKey => plan !== undefined);
}

function offAll(): Record<AddonKey, boolean> {
  return Object.fromEntries(ADDON_KEYS.map((key) => [key, false])) as Record<AddonKey, boolean>;
}

/** The event types `applyStripeEvent` acts on; any other is ignored before a tenant is looked up. */
const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
  'invoice.payment_succeeded',
]);

export async function applyStripeEvent(
  event: StripeEvent,
  deps: { store: Store; tenants: TenantRegistry; stripe: StripeConfig; now: () => number },
): Promise<WebhookOutcome> {
  const { store, tenants, stripe, now } = deps;
  if (!(await store.claimStripeEvent(event.id))) return 'duplicate';
  try {
    // Not one this handles: no tenant lookup, and no registry refresh to find one.
    if (!HANDLED_EVENTS.has(event.type)) return 'ignored';
    const object = event.data.object;
    const metadata = metadataOf(object);
    const customerId = str(object['customer']);
    const lookUp = () =>
      tenants.byId(str(object['client_reference_id']) ?? metadata['tenant_id'] ?? '') ??
      (customerId ? (tenants.all.find((t) => t.stripeCustomerId === customerId) ?? null) : null);
    let found = lookUp();
    if (!found) {
      // This instance's cache can be up to a refresh old: an installer signed up,
      // or a customer id saved, on another instance is in the store already.
      await tenants.refresh();
      found = lookUp();
    }
    if (!found) {
      // Give the claim back, so a redelivery (once the tenant exists) is
      // processed rather than skipped as a duplicate.
      await store.releaseStripeEvent(event.id);
      return 'unknown_tenant';
    }

    // Decided against the tenant as the store holds it when the change is
    // written, not this instance's cached copy: the staleness check needs the
    // latest billing state, and only the billing fields (customer, add-ons,
    // billing state) are changed, so a save made elsewhere is not undone.
    const decide = (tenant: Tenant): Tenant | 'stale' | 'ignored' => {
      const billing: BillingState = tenant.billing ?? {
        status: 'none',
        subscriptionId: null,
        graceUntil: null,
        lastEventAt: null,
      };
      if (billing.lastEventAt !== null && event.created < billing.lastEventAt) return 'stale';

      let next: Tenant | null = null;
      const stamp = (state: Partial<BillingState>): BillingState => ({
        ...billing,
        ...state,
        lastEventAt: event.created,
      });

      switch (event.type) {
        case 'checkout.session.completed': {
          const plan = metadata['plan'];
          if (!isPlan(plan)) return 'ignored';
          const current = tenant.config.addons ?? {};
          const granted = addonsForPlans([plan]);
          const addons = Object.fromEntries(
            ADDON_KEYS.map((key) => [key, Boolean(current[key]) || granted[key]]),
          ) as Record<AddonKey, boolean>;
          next = {
            ...tenant,
            stripeCustomerId: customerId ?? tenant.stripeCustomerId ?? null,
            config: { ...tenant.config, addons },
            billing: stamp({
              status: 'active',
              subscriptionId: str(object['subscription']) ?? billing.subscriptionId,
              graceUntil: null,
            }),
          };
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const status = str(object['status']);
          const plans = plansFromItems(object, stripe.prices);
          const fromMetadata = metadata['plan'];
          if (plans.length === 0 && isPlan(fromMetadata)) plans.push(fromMetadata);
          if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
            next = {
              ...tenant,
              config: { ...tenant.config, addons: offAll() },
              billing: stamp({ status: 'canceled', graceUntil: null }),
            };
          } else if (status === 'past_due') {
            next = {
              ...tenant,
              billing: stamp({
                status: 'past_due',
                graceUntil:
                  billing.graceUntil ??
                  new Date(now() + PAYMENT_GRACE_DAYS * 86_400_000).toISOString(),
              }),
            };
          } else {
            next = {
              ...tenant,
              stripeCustomerId: customerId ?? tenant.stripeCustomerId ?? null,
              config: { ...tenant.config, addons: addonsForPlans(plans) },
              billing: stamp({
                status: status === 'trialing' ? 'trialing' : 'active',
                subscriptionId: str(object['id']) ?? billing.subscriptionId,
                graceUntil: null,
              }),
            };
          }
          break;
        }
        case 'customer.subscription.deleted':
          next = {
            ...tenant,
            config: { ...tenant.config, addons: offAll() },
            billing: stamp({ status: 'canceled', graceUntil: null }),
          };
          break;
        case 'invoice.payment_failed':
          next = {
            ...tenant,
            billing: stamp({
              status: 'past_due',
              graceUntil:
                billing.graceUntil ??
                new Date(now() + PAYMENT_GRACE_DAYS * 86_400_000).toISOString(),
            }),
          };
          break;
        case 'invoice.paid':
        case 'invoice.payment_succeeded':
          next = {
            ...tenant,
            billing: stamp({
              status: billing.status === 'canceled' ? 'canceled' : 'active',
              graceUntil: null,
            }),
          };
          break;
        default:
          return 'ignored';
      }
      return next;
    };

    let outcome: WebhookOutcome = 'applied';
    const saved = await tenants.update(found.id, (current) => {
      const decided = decide(current);
      outcome = typeof decided === 'string' ? decided : 'applied';
      return typeof decided === 'string' ? current : decided;
    });
    if (!saved) return 'unknown_tenant';
    return outcome;
  } catch (error) {
    // Give the claim back so Stripe's retry is processed rather than skipped.
    await store.releaseStripeEvent(event.id);
    throw error;
  }
}
