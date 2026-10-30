'use client';

import Link from 'next/link';

import { Tile, Unavailable } from '../../../components/admin/bits.js';
import { BarList, LineChart, type Series } from '../../../components/admin/charts.js';
import { Freshness, LoadError, useAdminData } from '../../../components/admin/shell.js';
import { SkeletonRows } from '../../../components/dashboard/kit.js';
import { Card, PageHeader, formatDate } from '../../../components/dashboard/ui.js';
import {
  compact,
  latencyText,
  percent,
  type AdminHealth,
  type ServiceHealth,
} from '../../../lib/admin-api.js';

/** "14:00", in the viewer's own time zone. */
function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** One series per Cloud Run service, in fixed slots by the service's position. */
function perService(
  services: ServiceHealth[],
  pick: (s: ServiceHealth) => Array<number | null>,
): Series[] {
  return services.slice(0, 3).map((s, i) => ({
    key: s.name,
    label: s.name,
    values: pick(s).map((v) => v ?? 0),
    slot: (i + 1) as 1 | 2 | 3,
  }));
}

/** Live infrastructure (Cloud Monitoring) and what the API itself logged as failing. */
export default function AdminHealthPage() {
  const { data, error, updatedAt, reload } = useAdminData<AdminHealth>('/v1/admin/health');
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Health" lead={<Freshness at={updatedAt} />} />
      {error ? <LoadError error={error} retry={reload} /> : null}
      {!data ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <>
          <h2 className="section-title">Infrastructure, last 24 hours</h2>
          {!data.monitoring.available ? (
            <Unavailable reason={data.monitoring.reason} />
          ) : (
            (() => {
              const m = data.monitoring.data;
              const labels = m.hours.map(hourLabel);
              return (
                <>
                  <div className="grid tiles">
                    {m.services.map((s) => {
                      const requests = sum(s.requests);
                      return (
                        <Tile
                          key={s.name}
                          label={s.name}
                          value={`${compact(requests)} requests`}
                          hint={`${percent(requests ? sum(s.errors5xx) / requests : null)} server errors, p95 now ${latencyText(s.p95Ms[s.p95Ms.length - 2] ?? null)}`}
                          trend={s.requests}
                        />
                      );
                    })}
                    <Tile
                      label="Uptime checks"
                      value={`${m.uptime.filter((u) => u.passing).length} of ${m.uptime.length}`}
                      hint="passing in the last ten minutes"
                    >
                      <ul className="plain-list">
                        {m.uptime.map((u) => (
                          <li key={u.name}>
                            <span
                              className={`status-dot ${u.passing === true ? 'ok' : u.passing === false ? 'bad' : ''}`}
                            >
                              {u.name}:{' '}
                              {u.passing === true
                                ? 'passing'
                                : u.passing === false
                                  ? 'failing'
                                  : 'no data'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Tile>
                  </div>
                  <div className="grid two">
                    <Card>
                      <LineChart
                        title="Requests per hour"
                        labels={labels}
                        series={perService(m.services, (s) => s.requests)}
                      />
                    </Card>
                    <Card>
                      <LineChart
                        title="Server errors (5xx) per hour"
                        labels={labels}
                        series={perService(m.services, (s) => s.errors5xx)}
                      />
                    </Card>
                    <Card>
                      <LineChart
                        title="Request latency, p95"
                        labels={labels}
                        series={perService(m.services, (s) => s.p95Ms)}
                        format={(n) => latencyText(n)}
                      />
                    </Card>
                    <Card>
                      <LineChart
                        title="Instances running"
                        labels={labels}
                        series={perService(m.services, (s) => s.instances)}
                      />
                    </Card>
                    <Card>
                      <LineChart
                        title="Turned away by Cloud Armor (429)"
                        labels={labels}
                        series={[
                          { key: 'edge', label: 'Requests', values: m.edgeRateLimited, slot: 1 },
                        ]}
                        area
                      />
                    </Card>
                  </div>
                </>
              );
            })()
          )}

          <h2 className="section-title">What the API logged, last 7 days</h2>
          <div className="grid two">
            <Card>
              <BarList
                title="Errors by what was being done"
                rows={Object.entries(data.errorsBySource).map(([label, value]) => ({
                  label,
                  value,
                }))}
                empty="No errors logged."
              />
            </Card>
            <Card>
              <BarList
                title="Refused by the API's own rate limiter"
                rows={Object.entries(data.rateLimited).map(([label, value]) => ({ label, value }))}
                empty="Nothing refused."
              />
            </Card>
          </div>
          <Card title="Most frequent errors">
            {data.topErrors.length === 0 ? (
              <p className="muted">No errors in the last 7 days.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">What failed</th>
                      <th scope="col">Code</th>
                      <th scope="col" className="num">
                        Times
                      </th>
                      <th scope="col">Last seen</th>
                      <th scope="col">Example</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topErrors.map((e) => (
                      <tr key={`${e.source}|${e.code}`}>
                        <td>{e.source}</td>
                        <td>
                          <code>{e.code}</code>
                        </td>
                        <td className="num">{compact(e.count)}</td>
                        <td>{formatDate(e.lastAt)}</td>
                        <td className="muted small">{e.sample}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">
              <Link href="/admin/errors">Every error, with links to its log lines</Link>
            </p>
          </Card>
        </>
      )}
    </>
  );
}
