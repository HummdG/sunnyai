'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PortalShell, usePortal } from '../../components/dashboard/portal.js';
import { SunnyLoading } from '../../components/dashboard/kit.js';
import { GreetingSunny } from '../../components/cameo/dashboard-cameos.js';
import { SunnySpot } from '../../components/sunny-spot.js';
import {
  Card,
  ErrorNote,
  errorText,
  greeting,
  PageHeader,
  Stat,
} from '../../components/dashboard/ui.js';
import { api, tenantPath, type Overview } from '../../lib/portal-api.js';

function OverviewPage() {
  const { tenant } = usePortal();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<{ products: number; drafts: number } | null>(null);

  useEffect(() => {
    api<Overview>(tenantPath(tenant.id, '/overview'))
      .then(setOverview)
      .catch((failure: unknown) => setError(errorText(failure)));
    // The product list is its own setup step: recommendations need one.
    api<{ counts: { products: number; drafts: number } }>(tenantPath(tenant.id, '/catalogue'))
      .then((view) => setCatalogue(view.counts))
      .catch(() => setCatalogue(null));
  }, [tenant.id]);

  const warnings = [
    ...(overview?.warnings ?? []),
    ...(catalogue && catalogue.products === 0
      ? [
          {
            id: 'catalogue-empty',
            text: 'Add your products. Recommendations need a product list, so until then Sunny cannot suggest or price a system.',
            href: '/dashboard/products/upload',
          },
        ]
      : []),
    ...(catalogue && catalogue.drafts > 0
      ? [
          {
            id: 'catalogue-drafts',
            text: `${catalogue.drafts} product${catalogue.drafts === 1 ? '' : 's'} found on your website or Sheet ${catalogue.drafts === 1 ? 'is' : 'are'} waiting for your approval.`,
            href: '/dashboard/products/drafts',
          },
        ]
      : []),
  ];

  const setupDone = tenant.onboarding.step === 'live';
  // The go-live celebration, once (guidelines G: "You're live!").
  const [justLive, setJustLive] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('live') !== '1') return;
    setJustLive(true);
    window.history.replaceState(null, '', '/dashboard');
  }, []);
  const site =
    tenant.domains[0] ?? tenant.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <>
      {/* A time-of-day hello, only on a calm overview: never beside a safety
          alert, and not while the go-live celebration has the stage. */}
      {overview && overview.conversations.escalations === 0 && !justLive ? <GreetingSunny /> : null}
      <PageHeader
        title={greeting(tenant.companyName)}
        lead="Here’s what Sunny has been up to. Every number is counted from real conversations."
      />
      {/* Never beside a safety alert (guidelines C2): the cheer waits for a calm overview. */}
      {justLive && setupDone && !(overview && overview.conversations.escalations > 0) ? (
        <section className="celebration" aria-live="polite">
          <SunnySpot pose="cheer" sequence="cool-shades" size={140} />
          <div>
            <h2>You’re live!</h2>
            <p>
              Sunny is now answering on {site ?? 'your website'}. The first conversations will land
              in your inbox.
            </p>
          </div>
        </section>
      ) : null}
      {!setupDone ? (
        <Card title="Finish setting up Sunny">
          <p className="muted card-lead">You’re part-way through. Pick up where you left off.</p>
          <Link className="button" href="/dashboard/onboarding">
            Continue setup
          </Link>
        </Card>
      ) : null}
      <ErrorNote error={error} />
      {overview ? (
        <>
          {overview.conversations.escalations > 0 ? (
            <div className="escalation-banner" role="alert">
              {overview.conversations.escalations === 1
                ? '1 safety escalation needs a call back.'
                : `${overview.conversations.escalations} safety escalations need a call back.`}{' '}
              <Link href="/dashboard/inbox?escalated=1">Open them</Link>
            </div>
          ) : null}
          <div className="grid stats">
            <Stat
              label="Conversations"
              value={overview.conversations.total}
              hint={`${overview.conversations.last30Days} in the last 30 days`}
            />
            <Stat label="Leads" value={overview.leads.total} hint={`${overview.leads.new} new`} />
            <Stat
              label="Support questions"
              value={overview.conversations.byIntent.support}
              hint={`${overview.conversations.byIntent.sales} sales enquiries`}
            />
            <Stat label="Knowledge sources" value={overview.knowledge.sources} />
            <Stat
              label="Products"
              value={catalogue?.products ?? '—'}
              hint={
                catalogue && catalogue.drafts > 0
                  ? `${catalogue.drafts} awaiting approval`
                  : undefined
              }
            />
          </div>
          <div className="grid two">
            <Card title="Setup checklist">
              {warnings.length === 0 ? (
                <p className="ok-note">
                  <span className="status-icon" aria-hidden="true">
                    ✓
                  </span>
                  Everything is in place. Sunny’s ready for anything.
                </p>
              ) : (
                <ul className="warning-list">
                  {warnings.map((warning) => (
                    <li key={warning.id}>
                      <span>
                        <span className="status-icon warn" aria-hidden="true">
                          !
                        </span>
                        {warning.text}
                      </span>
                      <Link className="link-button" href={warning.href}>
                        Fix this
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="By channel">
              <table>
                <tbody>
                  <tr>
                    <th scope="row">Web chat</th>
                    <td>{overview.conversations.byChannel.chat}</td>
                  </tr>
                  <tr>
                    <th scope="row">Email</th>
                    <td>{overview.conversations.byChannel.email}</td>
                  </tr>
                  <tr>
                    <th scope="row">Voice &amp; phone</th>
                    <td>{overview.conversations.byChannel.voice}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </div>
        </>
      ) : !error ? (
        <SunnyLoading text="Counting your conversations…" />
      ) : null}
    </>
  );
}

export default function Page() {
  return (
    <PortalShell>
      <OverviewPage />
    </PortalShell>
  );
}
