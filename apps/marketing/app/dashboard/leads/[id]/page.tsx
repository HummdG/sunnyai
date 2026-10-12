'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { EmptyState, SunnyLoading } from '../../../../components/dashboard/kit.js';
import { LeadDetail } from '../../../../components/dashboard/lead-detail.js';
import { PortalShell, usePortal } from '../../../../components/dashboard/portal.js';
import { ErrorNote, errorText, PageHeader } from '../../../../components/dashboard/ui.js';
import { api, tenantPath, type LeadRow } from '../../../../lib/portal-api.js';

/** One lead on its own page: contact, the quote from the chat, and the roof in 3D. */
function Lead() {
  const { tenant } = usePortal();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<LeadRow | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ leads: LeadRow[] }>(tenantPath(tenant.id, '/leads'))
      .then(({ leads }) => setLead(leads.find((l) => l.id === params.id) ?? null))
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id, params.id]);

  return (
    <>
      <PageHeader
        title={lead?.name ?? 'Lead'}
        lead="Everything Sunny learned about this enquiry: the conversation, the quote shown in the chat and the roof."
        actions={
          <Link className="button secondary" href="/dashboard/leads">
            All leads
          </Link>
        }
      />
      <ErrorNote error={error} />
      {lead === undefined && !error ? <SunnyLoading text="Fetching the lead…" /> : null}
      {lead === null ? (
        <EmptyState
          pose="shrug"
          title="We couldn't find that lead"
          action={
            <Link className="button" href="/dashboard/leads">
              Back to leads
            </Link>
          }
        >
          It may have been removed, or it belongs to another company.
        </EmptyState>
      ) : null}
      {lead ? (
        <LeadDetail lead={lead} onClose={() => router.push('/dashboard/leads')} fullPage />
      ) : null}
    </>
  );
}

export default function LeadPage() {
  return (
    <PortalShell>
      <Lead />
    </PortalShell>
  );
}
