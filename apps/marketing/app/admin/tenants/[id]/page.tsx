'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { Tile } from '../../../../components/admin/bits.js';
import { LineChart } from '../../../../components/admin/charts.js';
import { Freshness, LoadError, useAdminData } from '../../../../components/admin/shell.js';
import { SkeletonRows } from '../../../../components/dashboard/kit.js';
import { Card, Chip, PageHeader, formatDate } from '../../../../components/dashboard/ui.js';
import {
  compact,
  dayLabel,
  FLAG_TEXT,
  latencyText,
  type TenantDetail,
} from '../../../../lib/admin-api.js';

/** Exact milliseconds, unlike the bucketed figures elsewhere. */
function ms(n: number | null): string {
  if (n === null) return '–';
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

/** One installer, last 30 days. Opening it is recorded in that installer's audit trail. */
export default function AdminTenantPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, updatedAt, reload } = useAdminData<TenantDetail>(
    `/v1/admin/tenants/${encodeURIComponent(id)}`,
  );
  const labels = data?.series.map((p) => dayLabel(p.day)) ?? [];

  return (
    <>
      <p className="small">
        <Link href="/admin/tenants">All installers</Link>
      </p>
      {error ? <LoadError error={error} retry={reload} /> : null}
      {!data ? (
        <Card>
          <SkeletonRows rows={8} />
        </Card>
      ) : (
        <>
          <PageHeader
            title={data.tenant.companyName}
            lead={
              <>
                <code>{data.tenant.id}</code> · widget <code>{data.tenant.publicId}</code> ·{' '}
                <Freshness at={updatedAt} />
              </>
            }
          />
          <p className="chips">
            <Chip tone={data.tenant.billingStatus === 'active' ? 'ok' : 'neutral'}>
              Billing: {data.tenant.billingStatus.replace('_', ' ')}
            </Chip>
            <Chip>Onboarding: {data.tenant.onboardingStep}</Chip>
            {data.tenant.addons.map((a) => (
              <Chip key={a} tone="orange">
                {a.replace('_', ' ')}
              </Chip>
            ))}
            {data.tenant.flags.map((f) => (
              <Chip key={f} tone="danger">
                {FLAG_TEXT[f] ?? f}
              </Chip>
            ))}
          </p>

          <div className="grid tiles">
            <Tile
              label="Replies, 30 days"
              value={compact(data.totals.turns)}
              trend={data.series.map((p) => p.turns)}
            />
            <Tile
              label="Leads, 30 days"
              value={compact(data.totals.leads)}
              trend={data.series.map((p) => p.leads)}
            />
            <Tile
              label="Tokens, 30 days"
              value={compact(data.models.inputTokens + data.models.outputTokens)}
              hint={`${compact(data.models.calls)} model calls`}
            />
            <Tile
              label="Errors, 30 days"
              value={compact(data.totals.errors)}
              trend={data.series.map((p) => p.errors)}
            />
            <Tile label="First words, p95" value={latencyText(data.totals.latency.ttfbP95)} />
          </div>

          <div className="grid two">
            <Card>
              <LineChart
                title="Replies and visitor messages"
                labels={labels}
                series={[
                  {
                    key: 'turns',
                    label: 'Replies',
                    values: data.series.map((p) => p.turns),
                    slot: 1,
                  },
                  {
                    key: 'messages',
                    label: 'Visitor messages',
                    values: data.series.map((p) => p.messages),
                    slot: 2,
                  },
                ]}
              />
            </Card>
            <Card>
              <LineChart
                title="Tokens"
                labels={labels}
                series={[
                  {
                    key: 'in',
                    label: 'Input',
                    values: data.series.map((p) => p.tokensIn),
                    slot: 1,
                  },
                  {
                    key: 'out',
                    label: 'Output',
                    values: data.series.map((p) => p.tokensOut),
                    slot: 2,
                  },
                ]}
              />
            </Card>
          </div>

          <Card title="Models, from this installer’s own replies">
            {data.models.byModel.length === 0 ? (
              <p className="muted">No model calls in the last 30 days.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col" className="num">
                        Calls
                      </th>
                      <th scope="col" className="num">
                        Tokens in
                      </th>
                      <th scope="col" className="num">
                        Tokens out
                      </th>
                      <th scope="col" className="num">
                        First words p50 / p95
                      </th>
                      <th scope="col" className="num">
                        Whole reply p50 / p95
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.byModel.map((m) => (
                      <tr key={`${m.provider}|${m.model ?? ''}`}>
                        <td>
                          {m.model ?? m.provider}
                          <span className="muted small"> {m.provider}</span>
                        </td>
                        <td className="num">{compact(m.calls)}</td>
                        <td className="num">{compact(m.inputTokens)}</td>
                        <td className="num">{compact(m.outputTokens)}</td>
                        <td className="num">
                          {ms(m.latency.ttfbMsP50)} / {ms(m.latency.ttfbMsP95)}
                        </td>
                        <td className="num">
                          {ms(m.latency.totalMsP50)} / {ms(m.latency.totalMsP95)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid two">
            <Card title="Knowledge connections">
              {Object.keys(data.tenant.sync).length === 0 ? (
                <p className="muted">No website or Drive connected.</p>
              ) : (
                <ul className="plain-list">
                  {Object.entries(data.tenant.sync).map(([kind, s]) => (
                    <li key={kind}>
                      <span
                        className={`status-dot ${s.status === 'connected' ? 'ok' : s.status === 'failed' ? 'bad' : ''}`}
                      >
                        {kind === 'drive' ? 'Google Drive' : 'Website'}: {s.status}
                      </span>{' '}
                      <span className="muted small">{formatDate(s.at)}</span>
                      {s.error ? <p className="muted small">{s.error}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted small">
                Domains:{' '}
                {data.tenant.domains.length ? data.tenant.domains.join(', ') : 'none registered'}
              </p>
            </Card>
            <Card title="Team">
              <ul className="plain-list">
                {Object.entries(data.tenant.members).map(([role, n]) => (
                  <li key={role}>
                    {n} {role}
                    {n === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Recent errors">
            {data.errors.length === 0 ? (
              <p className="muted">No errors recorded for this installer in 30 days.</p>
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
                      <th scope="col">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.errors.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.at)}</td>
                        <td>{e.source}</td>
                        <td>
                          <code>{e.code}</code>
                        </td>
                        <td className="num">{e.count}</td>
                        <td className="small">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
