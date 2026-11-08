'use client';

import Link from 'next/link';

import { Meter, Tile, Unavailable } from '../../../components/admin/bits.js';
import { StackedBars } from '../../../components/admin/charts.js';
import { Freshness, LoadError, useAdminData } from '../../../components/admin/shell.js';
import { SkeletonRows } from '../../../components/dashboard/kit.js';
import { Card, PageHeader } from '../../../components/dashboard/ui.js';
import { compact, dayLabel, money, type AdminCosts } from '../../../lib/admin-api.js';

const PLAN_NAMES: Record<string, string> = {
  base: 'Base',
  email: 'Email Assistant',
  suite: 'Full Suite',
  other: 'Other prices',
};

/**
 * What the platform costs and earns. Every figure here is actual spend from the
 * billing export or a provider's own API, except two, which say so: Postmark
 * (sent count times the plan rate) and the per-installer split (actual spend
 * divided by each installer's share of usage).
 */
export default function AdminCostsPage() {
  const { data, error, updatedAt, reload } = useAdminData<AdminCosts>('/v1/admin/costs');

  return (
    <>
      <PageHeader title="Costs" lead={<Freshness at={updatedAt} />} />
      {error ? <LoadError error={error} retry={reload} /> : null}
      {!data ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <>
          <div className="grid tiles">
            {data.gcp.available ? (
              <>
                <Tile
                  label="Google Cloud, month to date"
                  value={money(data.gcp.data.monthToDate, data.gcp.data.currency)}
                  hint={`Billing export reaches ${data.gcp.data.lastDay ? dayLabel(data.gcp.data.lastDay) : 'no day yet'}; it runs about a day behind`}
                />
                <Tile
                  label="Forecast for the month"
                  value={money(data.gcp.data.forecast, data.gcp.data.currency)}
                  hint={
                    data.budget !== null
                      ? `Budget ${money(data.budget, data.gcp.data.currency)}`
                      : 'No budget set (OPS_MONTHLY_BUDGET)'
                  }
                >
                  {data.budget !== null ? (
                    <Meter
                      value={data.gcp.data.forecast}
                      max={data.budget}
                      label="Forecast against budget"
                    />
                  ) : null}
                </Tile>
                <Tile
                  label="Last month"
                  value={money(data.gcp.data.lastMonth, data.gcp.data.currency)}
                />
              </>
            ) : null}
            {data.stripe.available ? (
              <Tile
                label="Monthly recurring revenue"
                value={money(data.stripe.data.mrr, data.stripe.data.currency)}
                hint={`${data.stripe.data.active} active, ${data.stripe.data.trialing} trialing, ${data.stripe.data.pastDue} past due, ${data.stripe.data.canceledThisMonth} cancelled this month`}
              />
            ) : null}
            {data.margin.currency !== null ? (
              <Tile
                label="Margin this month"
                value={money(data.margin.margin, data.margin.currency)}
                hint={`Revenue ${money(data.margin.revenue, data.margin.currency)} less forecast costs ${money(data.margin.cost, data.margin.currency)} (${data.margin.included.join(', ')})`}
              />
            ) : (
              <Tile label="Margin this month" value="–" hint={data.margin.reason} />
            )}
          </div>

          <h2 className="section-title">Google Cloud</h2>
          {!data.gcp.available ? (
            <Unavailable reason={data.gcp.reason} />
          ) : (
            (() => {
              const gcp = data.gcp.data;
              const top = gcp.byService.slice(0, 3).map((s) => s.service);
              const days = gcp.daily.map((d) => d.day);
              const series = top.map((service, i) => ({
                key: service,
                label: service,
                values: gcp.daily.map((d) => d.byService[service] ?? 0),
                slot: (i + 1) as 1 | 2 | 3,
              }));
              const other = gcp.daily.map((d) =>
                Object.entries(d.byService)
                  .filter(([service]) => !top.includes(service))
                  .reduce((a, [, v]) => a + v, 0),
              );
              const fmt = (n: number) => money(n, gcp.currency);
              return (
                <>
                  <Card>
                    <StackedBars
                      title="Daily spend by service, last 30 days"
                      labels={days.map(dayLabel)}
                      series={series}
                      other={other}
                      format={fmt}
                    />
                  </Card>
                  <div className="grid two">
                    <Card title="By service">
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Service</th>
                              <th scope="col" className="num">
                                This month
                              </th>
                              <th scope="col" className="num">
                                Last month
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {gcp.byService.map((s) => (
                              <tr key={s.service}>
                                <td>{s.service}</td>
                                <td className="num">{fmt(s.monthToDate)}</td>
                                <td className="num">{fmt(s.lastMonth)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                    <Card title="Biggest line items this month">
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Item</th>
                              <th scope="col" className="num">
                                Cost
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {gcp.topSkus.map((s) => (
                              <tr key={`${s.service}|${s.sku}`}>
                                <td>
                                  {s.sku}
                                  <span className="muted small"> {s.service}</span>
                                </td>
                                <td className="num">{fmt(s.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </div>
                </>
              );
            })()
          )}

          <h2 className="section-title">Providers</h2>
          <div className="grid">
            <Card title="Postmark (quote emails)">
              {!data.postmark.available ? (
                <Unavailable reason={data.postmark.reason} />
              ) : (
                <>
                  <p>
                    <strong>{compact(data.postmark.data.sent)}</strong> sent this month,{' '}
                    {data.postmark.data.bounced} bounced, {data.postmark.data.spamComplaints} spam
                    complaints.
                  </p>
                  <p className="muted small">
                    {data.postmark.data.costFromPlanRate === null
                      ? 'Postmark has no billing API. Set OPS_POSTMARK_PRICE_PER_1K to see a cost.'
                      : `About ${money(data.postmark.data.costFromPlanRate, data.stripe.available ? data.stripe.data.currency : 'GBP')} at the plan rate. Postmark has no billing API, so this is worked out, not billed.`}
                  </p>
                </>
              )}
            </Card>
          </div>

          <h2 className="section-title">Revenue</h2>
          <Card title="Stripe subscriptions by plan">
            {!data.stripe.available ? (
              <Unavailable reason={data.stripe.reason} />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Plan</th>
                      <th scope="col" className="num">
                        Subscriptions
                      </th>
                      <th scope="col" className="num">
                        Monthly revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stripe.data.byPlan.map((p) => (
                      <tr key={p.plan}>
                        <td>{PLAN_NAMES[p.plan] ?? p.plan}</td>
                        <td className="num">{p.subscriptions}</td>
                        <td className="num">
                          {money(p.mrr, data.stripe.available ? data.stripe.data.currency : null)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <h2 className="section-title">Cost per installer this month</h2>
          <Card>
            <p className="muted small">
              Apportioned, not billed: the month’s actual Vertex AI spend split by each installer’s
              share of tokens.
            </p>
            {data.perTenant.rows.length === 0 ? (
              <p className="muted">No usage recorded this month yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Installer</th>
                      <th scope="col" className="num">
                        Tokens
                      </th>
                      <th scope="col" className="num">
                        Model cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perTenant.rows.map((r) => (
                      <tr key={r.tenantId}>
                        <td>
                          <Link href={`/admin/tenants/${encodeURIComponent(r.tenantId)}`}>
                            {r.companyName}
                          </Link>
                        </td>
                        <td className="num">{compact(r.tokens)}</td>
                        <td className="num">{money(r.model, data.perTenant.modelCurrency)}</td>
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
