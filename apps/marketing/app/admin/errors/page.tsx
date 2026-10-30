'use client';

import Link from 'next/link';
import { useState } from 'react';

import { RangePicker } from '../../../components/admin/bits.js';
import { Freshness, LoadError, useAdminData } from '../../../components/admin/shell.js';
import { SkeletonRows } from '../../../components/dashboard/kit.js';
import { Card, PageHeader, formatDate } from '../../../components/dashboard/ui.js';
import type { OpsError, Range } from '../../../lib/admin-api.js';

/** The request's own log lines in Cloud Logging, where Fastify wrote its id as `reqId`. */
function logsUrl(project: string, requestId: string): string {
  const query = encodeURIComponent(`jsonPayload.reqId="${requestId}"`);
  return `https://console.cloud.google.com/logs/query;query=${query}?project=${encodeURIComponent(project)}`;
}

/**
 * Every error the API logged, sampled: repeats of one error in one 15-second
 * window are one row with a count. Messages are redacted before they are
 * stored, so the full detail is in the log line the link opens.
 */
export default function AdminErrorsPage() {
  const [days, setDays] = useState<Range>(7);
  const [filter, setFilter] = useState('');
  const { data, error, updatedAt, reload } = useAdminData<{
    since: string;
    project: string | null;
    errors: OpsError[];
  }>(`/v1/admin/errors?days=${days}`);
  const shown =
    data?.errors.filter((e) =>
      `${e.source} ${e.code} ${e.message} ${e.tenantId ?? ''}`
        .toLowerCase()
        .includes(filter.trim().toLowerCase()),
    ) ?? [];

  return (
    <>
      <PageHeader
        title="Errors"
        lead={<Freshness at={updatedAt} />}
        actions={<RangePicker value={days} onChange={setDays} options={[7, 30]} />}
      />
      {error ? <LoadError error={error} retry={reload} /> : null}
      <Card>
        <label className="field compact">
          <span>Filter</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Source, code, message or installer id"
          />
        </label>
        {!data ? (
          <SkeletonRows rows={6} />
        ) : shown.length === 0 ? (
          <p className="muted">No errors {filter ? 'match' : 'in this period'}.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What failed</th>
                  <th scope="col">Code</th>
                  <th scope="col" className="num">
                    Times
                  </th>
                  <th scope="col">Installer</th>
                  <th scope="col">Message</th>
                  <th scope="col">Logs</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.at)}</td>
                    <td>{e.source}</td>
                    <td>
                      <code>{e.code}</code>
                    </td>
                    <td className="num">{e.count}</td>
                    <td>
                      {e.tenantId ? (
                        <Link href={`/admin/tenants/${encodeURIComponent(e.tenantId)}`}>
                          {e.tenantId}
                        </Link>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                    <td className="small">{e.message}</td>
                    <td>
                      {data.project && e.requestId ? (
                        <a
                          href={logsUrl(data.project, e.requestId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="muted">–</span>
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
