'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState, SkeletonRows } from '../../../components/dashboard/kit.js';
import { LeadDetail } from '../../../components/dashboard/lead-detail.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import {
  Card,
  ErrorNote,
  errorText,
  formatDate,
  PageHeader,
} from '../../../components/dashboard/ui.js';
import {
  api,
  download,
  tenantPath,
  type LeadRow,
  type LeadStatus,
} from '../../../lib/portal-api.js';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost'];

function Leads() {
  const { tenant } = usePortal();
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const canEdit = tenant.role !== 'viewer';

  useEffect(() => {
    api<{ leads: LeadRow[] }>(tenantPath(tenant.id, '/leads'))
      .then(({ leads: rows }) => setLeads(rows))
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);

  async function setStatus(lead: LeadRow, status: LeadStatus): Promise<void> {
    setError(null);
    try {
      await api(tenantPath(tenant.id, `/leads/${encodeURIComponent(lead.id)}/status`), {
        body: { status },
      });
      setLeads(
        (rows) => rows?.map((row) => (row.id === lead.id ? { ...row, status } : row)) ?? null,
      );
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  async function exportCsv(): Promise<void> {
    setError(null);
    try {
      await download(tenantPath(tenant.id, '/leads.csv'), 'sunny-leads.csv');
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  return (
    <>
      <PageHeader
        title="Leads"
        lead="People who asked to be contacted, with the consent they gave. Track them through your pipeline here."
        actions={
          canEdit ? (
            <button className="button secondary" type="button" onClick={() => void exportCsv()}>
              Export CSV
            </button>
          ) : null
        }
      />
      <ErrorNote error={error} />
      {open && leads?.find((l) => l.id === open) ? (
        <LeadDetail lead={leads.find((l) => l.id === open)!} onClose={() => setOpen(null)} />
      ) : null}
      <Card>
        {leads === null ? (
          <SkeletonRows rows={4} />
        ) : leads.length === 0 ? (
          <EmptyState
            pose="point"
            title="No leads yet"
            say="Pop me on your site and I’ll start filling this up."
            action={
              <Link className="button" href="/dashboard/settings#install">
                Get your install snippet
              </Link>
            }
          >
            Add Sunny to your site and they’ll start arriving.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Name</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Postcode</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>{formatDate(lead.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={open === lead.id}
                        onClick={() => setOpen(open === lead.id ? null : lead.id)}
                      >
                        {lead.name ?? 'Unnamed'}
                      </button>
                    </td>
                    <td>
                      {lead.email ? <div>{lead.email}</div> : null}
                      {lead.phone ? <div>{lead.phone}</div> : null}
                    </td>
                    <td>{lead.postcode ?? '–'}</td>
                    <td>{lead.summary}</td>
                    <td>
                      {canEdit ? (
                        <select
                          aria-label={`Status for ${lead.name ?? 'this lead'}`}
                          value={lead.status}
                          onChange={(event) =>
                            void setStatus(lead, event.target.value as LeadStatus)
                          }
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      ) : (
                        lead.status
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function LeadsPage() {
  return (
    <PortalShell>
      <Leads />
    </PortalShell>
  );
}
