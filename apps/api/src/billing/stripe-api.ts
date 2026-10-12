import { ApiError } from '@sunny/contracts';

import type { PlanKey } from '../entitlements.js';

/**
 * The two Stripe API calls the portal makes, over plain `fetch`: a Checkout
 * session to subscribe, and a Customer Portal session to manage the
 * subscription. No SDK -- two form-encoded POSTs do not justify a dependency in
 * every API instance.
 */
const STRIPE_API = 'https://api.stripe.com/v1';

function form(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function post(
  secretKey: string,
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ id: string; url: string }> {
  const response = await fetchImpl(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form(params),
  });
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.url || !body.id) {
    throw new ApiError(
      'upstream_failed',
      `Stripe refused the request: ${body.error?.message ?? response.status}`,
    );
  }
  return { id: body.id, url: body.url };
}

export interface CheckoutInput {
  secretKey: string;
  tenantId: string;
  plan: PlanKey;
  priceId: string;
  customerId: string | null;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  fetch?: typeof fetch;
}

/**
 * A subscription Checkout session. The tenant and plan travel as metadata on
 * both the session and the subscription it creates, so every later webhook can
 * be tied back to the installer without trusting anything the browser sends.
 */
export async function createCheckoutSession(input: CheckoutInput): Promise<{ url: string }> {
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: input.tenantId,
    'metadata[tenant_id]': input.tenantId,
    'metadata[plan]': input.plan,
    'subscription_data[metadata][tenant_id]': input.tenantId,
    'subscription_data[metadata][plan]': input.plan,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
  if (input.customerId) params['customer'] = input.customerId;
  else if (input.customerEmail) params['customer_email'] = input.customerEmail;
  const session = await post(input.secretKey, '/checkout/sessions', params, input.fetch ?? fetch);
  return { url: session.url };
}

export async function createPortalSession(input: {
  secretKey: string;
  customerId: string;
  returnUrl: string;
  fetch?: typeof fetch;
}): Promise<{ url: string }> {
  const session = await post(
    input.secretKey,
    '/billing_portal/sessions',
    { customer: input.customerId, return_url: input.returnUrl },
    input.fetch ?? fetch,
  );
  return { url: session.url };
}
