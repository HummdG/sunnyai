'use client';

import { useEffect, useState } from 'react';

import { SkeletonRows } from '../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  formatDate,
  PageHeader,
} from '../../../components/dashboard/ui.js';
import {
  ADDON_LABELS,
  api,
  PLAN_LABELS,
  tenantPath,
  type AddonKey,
  type BillingView,
} from '../../../lib/portal-api.js';

const STATUS_TEXT = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment failed',
  canceled: 'Cancelled',
  none: 'No subscription',
} as const;

function Billing() {
  const { tenant } = usePortal();
  const [view, setView] = useState<BillingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = tenant.role === 'owner';

  useEffect(() => {
    api<BillingView>(tenantPath(tenant.id, '/billing'))
      .then(setView)
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);

  async function redirect(path: string, body: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(tenantPath(tenant.id, path), { body });
      window.location.assign(url);
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  const status = view?.billing?.status ?? 'none';

  return (
    <>
      <PageHeader
        title="Add-ons & billing"
        lead="Your package, what each add-on is connected to, and your subscription."
        actions={
          isOwner && view?.hasCustomer ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => void redirect('/billing/portal', {})}
            >
              Manage subscription
            </button>
          ) : null
        }
      />
      <ErrorNote error={error} />
      {view ? (
        <>
          {status === 'past_due' ? (
            <div className="escalation-banner" role="alert">
              Your last payment failed. Add-ons keep working until{' '}
              {view.billing?.graceUntil
                ? formatDate(view.billing.graceUntil)
                : 'the end of the grace period'}
              ; update your card to avoid interruption.
            </div>
          ) : null}
          <Card
            title={
              <>
                Subscription{' '}
                <Chip tone={status === 'active' ? 'ok' : 'orange'}>{STATUS_TEXT[status]}</Chip>
              </>
            }
          >
            {(Object.keys(ADDON_LABELS) as AddonKey[]).map((key) => (
              <div className="addon-row" key={key}>
                <div>
                  <strong>{ADDON_LABELS[key]}</strong>
                  <div className="muted small">{view.connections[key].detail}</div>
                </div>
                <Chip tone={view.connections[key].connected ? 'ok' : 'neutral'}>
                  {view.connections[key].connected ? 'Connected' : 'Not connected'}
                </Chip>
                <Chip tone={view.addons[key] ? 'ok' : 'neutral'}>
                  {view.addons[key] ? 'Included' : 'Not included'}
                </Chip>
              </div>
            ))}
          </Card>
          <Card title="Voice & Phone usage">
            <div className="grid stats">
              <div className="stat">
                <span className="stat-value">
                  {view.voice.minutesUsed === null ? '–' : view.voice.minutesUsed}
                  {view.voice.minutesQuota !== null ? (
                    <span className="muted" style={{ fontSize: '1rem' }}>
                      {' '}
                      / {view.voice.minutesQuota}
                    </span>
                  ) : null}
                </span>
                <span className="stat-label">Minutes this month</span>
                <span className="stat-hint">
                  {view.voice.minutesQuota === null
                    ? 'No monthly cap set'
                    : 'Web voice and phone share one allowance'}
                </span>
              </div>
              <div className="stat">
                <span className="stat-value" style={{ fontSize: '1.2rem' }}>
                  {view.voice.numbers.length > 0 ? view.voice.numbers.join(', ') : 'None yet'}
                </span>
                <span className="stat-label">Phone number</span>
                <span className="stat-hint">Assigned when the phone receptionist is set up</span>
              </div>
            </div>
          </Card>
          <Card title="Packages">
            {!view.stripeConfigured ? (
              <p className="muted" style={{ marginBottom: 14 }}>
                Online payment is not switched on for this deployment yet. Contact us to change your
                package.
              </p>
            ) : null}
            <div className="plan-grid">
              {view.plans.map((plan) => (
                <div className="plan" key={plan.key}>
                  <span style={{ fontWeight: 700 }}>{PLAN_LABELS[plan.key].name}</span>
                  <strong>{PLAN_LABELS[plan.key].price}</strong>
                  <span className="muted small">{PLAN_LABELS[plan.key].blurb}</span>
                  {isOwner ? (
                    <button
                      className="button"
                      type="button"
                      disabled={busy || !view.stripeConfigured || !plan.available}
                      onClick={() => void redirect('/billing/checkout', { plan: plan.key })}
                    >
                      Choose
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {!isOwner ? (
              <p className="muted small" style={{ marginTop: 12 }}>
                Only an owner can change the package.
              </p>
            ) : null}
          </Card>
        </>
      ) : !error ? (
        <SkeletonRows rows={4} />
      ) : null}
    </>
  );
}

export default function BillingPage() {
  return (
    <PortalShell>
      <Billing />
    </PortalShell>
  );
}
