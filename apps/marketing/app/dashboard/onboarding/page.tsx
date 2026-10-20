'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import {
  PortalShell,
  rememberTenant,
  useMe,
  usePortal,
} from '../../../components/dashboard/portal.js';
import { SunnyCameo } from '../../../components/cameo/sunny-cameo.js';
import { StudioForm } from '../../../components/dashboard/studio-form.js';
import { CopyButton, SunnyLoading, SunProgress } from '../../../components/dashboard/kit.js';
import type { LimbPoseName } from '@sunny/character';
import { Card, ErrorNote, errorText } from '../../../components/dashboard/ui.js';
import {
  api,
  tenantPath,
  type KnowledgeView,
  type OnboardingStep,
  type TenantView,
} from '../../../lib/portal-api.js';

const STEPS: Array<{ key: OnboardingStep; label: string }> = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'website', label: 'Website' },
  { key: 'drive', label: 'Google Drive' },
  { key: 'customise', label: 'Customise Sunny' },
  { key: 'install', label: 'Install' },
  { key: 'live', label: 'Go live' },
];

function Steps({ current }: { current: OnboardingStep }) {
  const at = STEPS.findIndex((s) => s.key === current);
  return (
    <>
      <SunProgress value={at + 1} max={STEPS.length} label={`Step ${at + 1} of ${STEPS.length}`} />
      <ol className="steps" aria-label="Setup progress">
        {STEPS.map((step, index) => (
          <li
            key={step.key}
            aria-current={index === at ? 'step' : undefined}
            className={index < at ? 'done' : undefined}
          >
            {index + 1}. {step.label}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Sunny guides each step (guidelines B2: onboarding at 8/10, C2 poses). The
 * customise step shows the live Studio preview instead -- one animated
 * character per view.
 */
const GUIDE: Record<
  OnboardingStep,
  { pose: LimbPoseName; sequence?: string; line: string; quip: string } | null
> = {
  organisation: {
    pose: 'hips',
    sequence: 'listening-perk',
    line: 'Hi! I’m Sunny. Let’s get your assistant answering customers in about ten minutes.',
    quip: 'Ten minutes. I timed it.',
  },
  website: {
    pose: 'point',
    line: 'First, your website. I’ll read it so I can answer from what you already say.',
    quip: 'I’m a very quick reader.',
  },
  drive: {
    pose: 'idea',
    line: 'Got spec sheets or price lists in Google Drive? Share the folder and I’ll learn those too.',
    quip: 'Viewer access is plenty. I only read.',
  },
  customise: null,
  install: {
    pose: 'point',
    line: 'One snippet, pasted once. That’s how I get onto your website.',
    quip: 'Copy, paste, sunshine.',
  },
  live: {
    pose: 'thumbsUp',
    line: 'Last thing: your phone number, for customers who need a person.',
    quip: 'Nearly there. Shades at the ready!',
  },
};

function Frame({ children, step }: { children: ReactNode; step: OnboardingStep }) {
  const guide = GUIDE[step];
  return (
    <main className="content onboarding" id="main">
      <header className="onboarding-hero">
        {guide ? (
          <SunnyCameo
            key={step}
            pose={guide.pose}
            sequence={guide.sequence ?? 'listening-perk'}
            size={132}
            bubble={guide.quip}
            bubbleSide="right"
            priority={3}
          />
        ) : null}
        <div>
          <h1>Set up Sunny</h1>
          <p className="muted">
            {guide?.line ?? 'Make Sunny yours: your colour, your greeting, your questions.'}
          </p>
        </div>
      </header>
      <Steps current={step} />
      {children}
    </main>
  );
}

/** Step 1, before there is a tenant: create the organisation. */
function Organisation() {
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { tenant } = await api<{ tenant: TenantView }>('/v1/portal/tenants', {
        body: { companyName },
      });
      rememberTenant(tenant.id);
      window.location.assign('/dashboard/onboarding');
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  return (
    <Frame step="organisation">
      <Card title="Your company">
        <form onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Company name</span>
            <input
              required
              maxLength={120}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </label>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
          <ErrorNote error={error} />
        </form>
      </Card>
    </Frame>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function Wizard() {
  const router = useRouter();
  const { tenant, setTenant } = usePortal();
  const step = tenant.onboarding.step === 'organisation' ? 'website' : tenant.onboarding.step;
  const [website, setWebsite] = useState(tenant.websiteUrl ?? 'https://');
  const [folder, setFolder] = useState('');
  const [phone, setPhone] = useState(tenant.supportContact?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serviceAccount, setServiceAccount] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'drive') return;
    api<KnowledgeView>(tenantPath(tenant.id, '/knowledge'))
      .then((view) => setServiceAccount(view.drive.serviceAccountEmail))
      .catch(() => setServiceAccount(null));
  }, [step, tenant.id]);

  async function go(next: OnboardingStep, extra: Record<string, unknown> = {}): Promise<void> {
    const { tenant: saved } = await api<{ tenant: TenantView }>(
      tenantPath(tenant.id, '/settings'),
      {
        body: { onboardingStep: next, ...extra },
      },
    );
    setTenant(saved);
  }

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'website') {
    return (
      <Frame step="website">
        <Card title="Your website">
          <p className="muted" style={{ marginBottom: 14 }}>
            Sunny reads your website to answer questions, and the widget will only run on this
            domain.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api(tenantPath(tenant.id, '/knowledge/website'), { body: { url: website } });
                const host = hostOf(website);
                await go('drive', host ? { domains: [...new Set([...tenant.domains, host])] } : {});
              });
            }}
          >
            <label className="field">
              <span>Website address</span>
              <input
                type="url"
                required
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
            <button className="button" type="submit" disabled={busy}>
              Connect website
            </button>
          </form>
          <ErrorNote error={error} />
        </Card>
      </Frame>
    );
  }

  if (step === 'drive') {
    return (
      <Frame step="drive">
        <Card title="Your Google Drive folder">
          <p className="muted" style={{ marginBottom: 14 }}>
            Put spec sheets, price lists, warranties and FAQs in one folder.{' '}
            {serviceAccount ? (
              <>
                Share it as <strong>Viewer</strong> with <code>{serviceAccount}</code>, then paste
                its link here.
              </>
            ) : (
              <>
                Paste its link here; we will show you who to share it with once Drive sync is set
                up.
              </>
            )}{' '}
            Anything you add or change is picked up automatically.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api(tenantPath(tenant.id, '/knowledge/drive'), { body: { folder } });
                await go('customise');
              });
            }}
          >
            <label className="field">
              <span>Folder link</span>
              <input
                placeholder="https://drive.google.com/drive/folders/…"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                required
              />
            </label>
            <div className="actions">
              <button className="button" type="submit" disabled={busy}>
                Connect folder
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => void run(() => go('customise'))}
              >
                Skip for now
              </button>
            </div>
          </form>
          <ErrorNote error={error} />
        </Card>
      </Frame>
    );
  }

  if (step === 'customise') {
    return (
      <Frame step="customise">
        <Card title="Make Sunny yours">
          <StudioForm
            tenant={tenant}
            submitLabel="Save and continue"
            onSaved={(saved) => {
              setTenant(saved);
              void run(() => go('install'));
            }}
          />
        </Card>
      </Frame>
    );
  }

  if (step === 'install') {
    return (
      <Frame step="install">
        <Card title="Add Sunny to your website">
          <p className="muted card-lead">
            Paste this just before <code>&lt;/body&gt;</code> on every page, or in your site
            builder&apos;s &ldquo;custom code&rdquo; setting. It works with WordPress, Wix,
            Squarespace and any HTML site.
          </p>
          <pre className="snippet" aria-label="Install snippet">
            {tenant.installSnippet}
          </pre>
          <div className="actions">
            <CopyButton text={tenant.installSnippet} label="Copy snippet" />
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void run(() => go('live'))}
            >
              Continue
            </button>
          </div>
          {notice ? (
            <p className="ok-note" role="status">
              {notice}
            </p>
          ) : null}
          <ErrorNote error={error} />
        </Card>
      </Frame>
    );
  }

  // Go live: the installer phone is required before the assistant can send a
  // customer who needs help anywhere.
  const phoneMissing = phone.trim() === '';
  return (
    <Frame step="live">
      <Card title="Go live">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await go('live', {
                supportContact: { ...tenant.supportContact, phone: phone.trim() },
              });
              router.replace('/dashboard?live=1');
            });
          }}
        >
          <label className="field">
            <span>
              Installer phone <span className="hint">(shown to customers who need help)</span>
            </span>
            <input
              type="tel"
              required
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-describedby="phone-warning"
            />
          </label>
          {phoneMissing ? (
            <p className="error-note" id="phone-warning" role="alert">
              Add your phone number before going live. Sunny gives it to customers with a problem,
              including anyone reporting a safety issue such as a burning smell or smoke.
            </p>
          ) : null}
          <button className="button" type="submit" disabled={busy || phoneMissing}>
            Go live
          </button>
          <ErrorNote error={error} />
        </form>
      </Card>
    </Frame>
  );
}

export default function OnboardingPage() {
  const { me, error } = useMe();
  if (error) return <main className="center-note">{error}</main>;
  if (!me)
    return (
      <main className="center-note">
        <SunnyLoading text="Getting your setup ready…" />
      </main>
    );
  if (me.tenants.length === 0) return <Organisation />;
  return (
    <PortalShell bare>
      <Wizard />
    </PortalShell>
  );
}
