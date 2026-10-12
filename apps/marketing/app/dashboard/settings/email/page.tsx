'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';

import { SkeletonRows, Toggle } from '../../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  PageHeader,
} from '../../../../components/dashboard/ui.js';
import { api, ApiFailure, tenantPath, type TenantView } from '../../../../lib/portal-api.js';

interface EmailState {
  provider: 'gmail' | 'outlook' | 'forwarding';
  connected: boolean;
  mailbox: string | null;
  autoSend: boolean;
  autoReplyCapPerSender: number;
  autoSendThreshold: number;
  inboundAddress: string | null;
  inboundWebhookUrl: string;
  oauthAvailable: { gmail: boolean; outlook: boolean };
  usage: { month: string; processed: number; drafts: number; autoSends: number; skipped: number };
}

/** What the OAuth callback says when it sends the installer back here. */
const CALLBACK_TEXT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Your inbox is connected.' },
  denied: { ok: false, text: 'The connection was cancelled.' },
  invalid_state: { ok: false, text: 'That sign-in link expired. Please try again.' },
  not_enabled: { ok: false, text: 'The Email Assistant is not part of your package.' },
  not_configured: { ok: false, text: 'Inbox connection is not set up on this deployment yet.' },
  exchange_failed: { ok: false, text: 'We could not complete the connection. Please try again.' },
  no_refresh_token: {
    ok: false,
    text: 'The provider did not grant ongoing access. Remove Sunny from your account’s connected apps and connect again.',
  },
};

function EmailSettings() {
  const { tenant, setTenant } = usePortal();
  const params = useSearchParams();
  const callback = CALLBACK_TEXT[params.get('email') ?? ''];
  const [state, setState] = useState<EmailState | null>(null);
  const [notEntitled, setNotEntitled] = useState(false);
  const [signature, setSignature] = useState(tenant.email?.signatureName ?? '');
  const [inbound, setInbound] = useState(tenant.email?.inboundAddress ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';

  const load = useCallback(() => {
    api<EmailState>(tenantPath(tenant.id, '/email'))
      .then(setState)
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.status === 403) setNotEntitled(true);
        else setError(errorText(failure));
      });
  }, [tenant.id]);
  useEffect(load, [load]);

  async function run(work: () => Promise<void>, message?: string): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await work();
      if (message) setSaved(message);
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const connect = (provider: 'gmail' | 'outlook') =>
    run(async () => {
      const { url } = await api<{ url: string }>(tenantPath(tenant.id, '/email/connect'), {
        body: { provider },
      });
      window.location.assign(url);
    });

  if (notEntitled) {
    return (
      <>
        <PageHeader title="Email Assistant" />
        <Card>
          <p style={{ marginBottom: 14 }}>
            The Email Assistant drafts grounded replies to enquiries in your own inbox, for you to
            approve with one click. It is an add-on to your package.
          </p>
          <Link className="button" href="/dashboard/billing">
            See add-ons
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Email Assistant"
        lead="Sunny reads enquiries to your sales inbox and writes a reply from your own knowledge base. By default every reply waits for you as a draft."
      />
      {callback ? (
        <p className={callback.ok ? 'ok-note' : 'error-note'} role="status">
          {callback.text}
        </p>
      ) : null}
      <ErrorNote error={error} />
      {saved ? (
        <p className="ok-note" role="status">
          {saved}
        </p>
      ) : null}
      {state ? (
        <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <Card
            title={
              <>
                Inbox{' '}
                <Chip tone={state.connected ? 'ok' : 'neutral'}>
                  {state.connected ? 'Connected' : 'Not connected'}
                </Chip>
              </>
            }
          >
            {state.connected ? (
              <>
                <p style={{ marginBottom: 14 }}>
                  {state.provider === 'gmail' ? 'Gmail' : 'Outlook'}
                  {state.mailbox ? ` · ${state.mailbox}` : ''}. Sunny can read new enquiries and
                  create drafts; it never reads other customers&apos; threads.
                </p>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    void run(
                      () =>
                        api(tenantPath(tenant.id, '/email/disconnect'), { body: {} }).then(
                          () => undefined,
                        ),
                      'Inbox disconnected.',
                    )
                  }
                >
                  Disconnect
                </button>
              </>
            ) : (
              <div className="actions">
                <button
                  className="button"
                  type="button"
                  disabled={!state.oauthAvailable.gmail}
                  onClick={() => void connect('gmail')}
                >
                  Connect Gmail
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={!state.oauthAvailable.outlook}
                  onClick={() => void connect('outlook')}
                >
                  Connect Outlook
                </button>
              </div>
            )}
            {!state.connected && !state.oauthAvailable.gmail && !state.oauthAvailable.outlook ? (
              <p className="muted small" style={{ marginTop: 12 }}>
                Inbox connection is not set up on this deployment yet. You can forward enquiries
                instead (below).
              </p>
            ) : null}
          </Card>

          <Card title="Forwarding instead">
            <p className="muted" style={{ marginBottom: 12 }}>
              Prefer not to connect your inbox? Forward enquiries to Sunny and copy the drafts from
              your inbox here.
            </p>
            {state.inboundAddress ? (
              <p style={{ marginBottom: 12 }}>
                Forward to <code>{state.inboundAddress}</code>
              </p>
            ) : null}
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void run(async () => {
                  const { tenant: next } = await api<{ tenant: TenantView }>(
                    tenantPath(tenant.id, '/settings'),
                    {
                      body: {
                        email: {
                          signatureName: signature.trim(),
                          ...(inbound.trim() ? { inboundAddress: inbound.trim() } : {}),
                        },
                      },
                    },
                  );
                  setTenant(next);
                }, 'Saved.');
              }}
            >
              <label className="field">
                <span>
                  Your forwarding address <span className="hint">(if your provider gives one)</span>
                </span>
                <input type="email" value={inbound} onChange={(e) => setInbound(e.target.value)} />
              </label>
              <label className="field">
                <span>
                  Sign replies as <span className="hint">(e.g. The Brightside Solar team)</span>
                </span>
                <input
                  value={signature}
                  maxLength={120}
                  onChange={(e) => setSignature(e.target.value)}
                />
              </label>
              <button className="button" type="submit">
                Save
              </button>
            </form>
          </Card>

          <Card title="Sending without approval">
            <Toggle
              checked={state.autoSend}
              label="Let Sunny send some replies without waiting for me"
              onChange={(checked) =>
                void run(
                  () =>
                    api(tenantPath(tenant.id, '/email/settings'), {
                      body: { autoSend: checked },
                    }).then(() => undefined),
                  checked ? 'Auto-send is on.' : 'Auto-send is off.',
                )
              }
            />
            <p className="muted small" style={{ marginBottom: 8 }}>
              Off by default. Even when on, Sunny only sends by itself when all of these hold:
            </p>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                the answer is a common question and at least{' '}
                {Math.round(state.autoSendThreshold * 100)}% grounded in your knowledge base;
              </li>
              <li>
                no more than {state.autoReplyCapPerSender} automatic replies to the same sender a
                day;
              </li>
              <li>
                never for a safety concern, a message that looks like an attempt to manipulate
                Sunny, or when Sunny has to say it does not know.
              </li>
            </ul>
            <p className="muted small" style={{ marginTop: 8 }}>
              Everything else waits as a draft for you.
            </p>
          </Card>

          <Card title={`This month (${state.usage.month})`}>
            <div className="grid stats">
              <div className="stat">
                <span className="stat-value">{state.usage.processed}</span>
                <span className="stat-label">Emails read</span>
              </div>
              <div className="stat">
                <span className="stat-value">{state.usage.drafts}</span>
                <span className="stat-label">Drafts written</span>
              </div>
              <div className="stat">
                <span className="stat-value">{state.usage.autoSends}</span>
                <span className="stat-label">Sent automatically</span>
              </div>
              <div className="stat">
                <span className="stat-value">{state.usage.skipped}</span>
                <span className="stat-label">Skipped</span>
              </div>
            </div>
          </Card>
        </fieldset>
      ) : !error ? (
        <SkeletonRows rows={4} />
      ) : null}
    </>
  );
}

export default function EmailSettingsPage() {
  return (
    <PortalShell>
      <Suspense fallback={<SkeletonRows rows={4} />}>
        <EmailSettings />
      </Suspense>
    </PortalShell>
  );
}
