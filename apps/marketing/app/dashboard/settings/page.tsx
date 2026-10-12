'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { CopyButton } from '../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import { useToast } from '../../../components/dashboard/toast.js';
import { Card, ErrorNote, errorText, PageHeader } from '../../../components/dashboard/ui.js';
import { api, tenantPath, type TenantView } from '../../../lib/portal-api.js';

/** "Saving…" → "Saved" as a toast with a thumbs-up Sunny (guidelines G, H2). */
function SavedToast({ saved }: { saved: boolean }) {
  const toast = useToast();
  useEffect(() => {
    if (saved) toast.success('Saved.');
  }, [saved, toast]);
  return null;
}

function useSave() {
  const { tenant, setTenant } = usePortal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { tenant: next } = await api<{ tenant: TenantView }>(
        tenantPath(tenant.id, '/settings'),
        { body },
      );
      setTenant(next);
      setSaved(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, saved, save };
}

function SaveRow({
  busy,
  saved,
  error,
  disabled,
}: {
  busy: boolean;
  saved: boolean;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <>
      <button className="button" type="submit" disabled={busy || disabled}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <SavedToast saved={saved} />
      <ErrorNote error={error} />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card title={title}>{children}</Card>;
}

function Settings() {
  const { tenant } = usePortal();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';

  const company = useSave();
  const [companyName, setCompanyName] = useState(tenant.companyName);
  const [phone, setPhone] = useState(tenant.supportContact?.phone ?? '');
  const [supportEmail, setSupportEmail] = useState(tenant.supportContact?.email ?? '');
  const [hours, setHours] = useState(tenant.supportContact?.hours ?? '');

  const site = useSave();
  const [domains, setDomains] = useState(tenant.domains.join('\n'));

  const voice = useSave();
  const [voiceName, setVoiceName] = useState(tenant.voice?.voiceName ?? '');
  const [maxCall, setMaxCall] = useState(String(tenant.voice?.maxCallSeconds ?? 300));
  const [concurrency, setConcurrency] = useState(String(tenant.voice?.concurrency ?? 2));
  const [bookingUrl, setBookingUrl] = useState(tenant.voice?.bookingUrl ?? '');
  const [disclosure, setDisclosure] = useState(tenant.voice?.disclosure ?? '');

  return (
    <>
      <PageHeader
        title="Settings"
        lead="Your company details, where Sunny may run, and how the add-on channels behave."
      />
      <Card title="Add Sunny to your website" id="install">
        <p className="muted card-lead">
          Paste this just before <code>&lt;/body&gt;</code> on every page, or in your site
          builder&apos;s &ldquo;custom code&rdquo; setting.
        </p>
        <pre className="snippet" aria-label="Install snippet">
          {tenant.installSnippet}
        </pre>
        <div className="actions">
          <CopyButton text={tenant.installSnippet} label="Copy snippet" />
        </div>
      </Card>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <Section title="Company and customer help">
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void company.save({
                companyName,
                supportContact: {
                  phone: phone.trim(),
                  ...(supportEmail.trim() ? { email: supportEmail.trim() } : {}),
                  ...(hours.trim() ? { hours: hours.trim() } : {}),
                },
              });
            }}
          >
            <label className="field">
              <span>Company name</span>
              <input
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Installer phone <span className="hint">(shown to customers who need help)</span>
              </span>
              <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
              <span className="hint">
                Sunny gives this number to customers with a problem, and straight away to anyone
                reporting a safety issue such as smoke or a burning smell.
              </span>
            </label>
            <label className="field">
              <span>
                Support email <span className="hint">(optional)</span>
              </span>
              <input
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Opening hours <span className="hint">(optional, e.g. Mon–Fri 9am–5pm)</span>
              </span>
              <input value={hours} onChange={(e) => setHours(e.target.value)} />
            </label>
            <SaveRow {...company} disabled={!canEdit} />
          </form>
        </Section>

        <Section title="Where Sunny may run">
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void site.save({
                domains: domains
                  .split(/[\s,]+/)
                  .map((d) =>
                    d
                      .trim()
                      .replace(/^https?:\/\//, '')
                      .replace(/\/.*$/, ''),
                  )
                  .filter(Boolean),
              });
            }}
          >
            <label className="field">
              <span>
                Website domains{' '}
                <span className="hint">(one per line; subdomains are included)</span>
              </span>
              <textarea
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="yourcompany.co.uk"
              />
              <span className="hint">
                The widget refuses to open a conversation on any other site.
              </span>
            </label>
            <SaveRow {...site} disabled={!canEdit} />
          </form>
        </Section>

        <div className="grid two" style={{ marginTop: 18 }}>
          <Card title="Email Assistant">
            <p className="muted" style={{ marginBottom: 14 }}>
              Connect your inbox, choose whether Sunny may send by itself, and see this month&apos;s
              drafts.
            </p>
            <Link className="button secondary" href="/dashboard/settings/email">
              Email settings
            </Link>
          </Card>
          <Card title="Voice & Phone">
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void voice.save({
                  voice: {
                    ...(voiceName.trim() ? { voiceName: voiceName.trim() } : {}),
                    maxCallSeconds: Number(maxCall),
                    concurrency: Number(concurrency),
                    ...(bookingUrl.trim() ? { bookingUrl: bookingUrl.trim() } : {}),
                    ...(disclosure.trim() ? { disclosure: disclosure.trim() } : {}),
                  },
                });
              }}
            >
              <p className="muted small" style={{ marginBottom: 12 }}>
                Phone number:{' '}
                {tenant.voice?.twilioNumbers?.length
                  ? tenant.voice.twilioNumbers.join(', ')
                  : 'not assigned yet'}
              </p>
              <label className="field">
                <span>Voice</span>
                <input
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  placeholder="Default"
                />
              </label>
              <label className="field">
                <span>Longest call (seconds, up to 300)</span>
                <input
                  type="number"
                  min={30}
                  max={300}
                  value={maxCall}
                  onChange={(e) => setMaxCall(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Calls at once</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                />
              </label>
              <label className="field">
                <span>
                  Booking link{' '}
                  <span className="hint">(texted to callers; your website if empty)</span>
                </span>
                <input
                  type="url"
                  value={bookingUrl}
                  onChange={(e) => setBookingUrl(e.target.value)}
                  placeholder={tenant.websiteUrl ?? 'https://'}
                />
              </label>
              <label className="field">
                <span>
                  Call opening{' '}
                  <span className="hint">(what Sunny says first; must say it is an AI)</span>
                </span>
                <textarea
                  value={disclosure}
                  onChange={(e) => setDisclosure(e.target.value)}
                  placeholder="Hi, you're through to Sunny, the AI assistant for your installer. This call may be recorded."
                />
              </label>
              <SaveRow {...voice} disabled={!canEdit} />
            </form>
          </Card>
        </div>
      </fieldset>
    </>
  );
}

export default function SettingsPage() {
  return (
    <PortalShell>
      <Settings />
    </PortalShell>
  );
}
