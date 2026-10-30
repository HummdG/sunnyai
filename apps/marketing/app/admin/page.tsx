'use client';

import Link from 'next/link';

import { Meter, Tile } from '../../components/admin/bits.js';
import { IssueList } from '../../components/admin/issues.js';
import { Freshness, LoadError, useAdminData } from '../../components/admin/shell.js';
import { Card, PageHeader } from '../../components/dashboard/ui.js';
import { SkeletonRows } from '../../components/dashboard/kit.js';
import { compact, latencyText, money, percent, type AdminOverview } from '../../lib/admin-api.js';

/** The landing page: what needs attention first, then the headline figures. */
export default function AdminOverviewPage() {
  const { data, error, updatedAt, reload } = useAdminData<AdminOverview>('/v1/admin/overview');

  return (
    <>
      <PageHeader title="Platform overview" lead={<Freshness at={updatedAt} />} />
      {error ? <LoadError error={error} retry={reload} /> : null}
      {!data ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <>
          <Card title="Needs attention">
            <IssueList issues={data.issues} />
          </Card>

          <h2 className="section-title">Usage</h2>
          <div className="grid tiles">
            <Tile
              label="Replies today"
              value={compact(data.kpis.turnsToday)}
              hint={`${compact(data.kpis.turns7d)} in 7 days`}
              trend={data.week.map((d) => d.turns)}
            />
            <Tile
              label="Leads, 7 days"
              value={compact(data.kpis.leads7d)}
              trend={data.week.map((d) => d.leads)}
            />
            <Tile
              label="Active installers, 7 days"
              value={compact(data.kpis.activeTenants7d)}
              hint={`of ${data.kpis.tenants}, ${data.kpis.payingTenants} paying`}
              trend={data.week.map((d) => d.activeTenants)}
            />
            <Tile
              label="Voice minutes, 7 days"
              value={compact(data.kpis.voiceMinutes7d)}
              trend={data.week.map((d) => d.voiceMinutes)}
            />
          </div>

          <h2 className="section-title">Health</h2>
          <div className="grid tiles">
            <Tile
              label="Errors today"
              value={compact(data.kpis.errorsToday)}
              hint={<Link href="/admin/errors">See the errors</Link>}
              trend={data.week.map((d) => d.errors)}
            />
            <Tile
              label="Model first reply, p95"
              value={latencyText(data.kpis.ttfbP95)}
              hint="Time to the first words, 7 days"
            />
            {data.health.available ? (
              <>
                <Tile
                  label="Requests, 24 hours"
                  value={compact(data.health.requests24h)}
                  hint={`${percent(data.health.errorRate24h)} server errors`}
                />
                <Tile
                  label="Uptime checks"
                  value={`${data.health.uptimePassing} of ${data.health.uptimeChecks}`}
                  hint={`passing; busiest service p95 ${latencyText(data.health.p95LastHourMs)}`}
                />
              </>
            ) : (
              <Tile label="Infrastructure" value="–" hint={data.health.reason} />
            )}
          </div>

          <h2 className="section-title">Money</h2>
          <div className="grid tiles">
            {data.costs.available ? (
              <Tile
                label="Google Cloud, this month"
                value={money(data.costs.monthToDate, data.costs.currency)}
                hint={`Forecast ${money(data.costs.forecast, data.costs.currency)}${
                  data.costs.budget !== null
                    ? ` of a ${money(data.costs.budget, data.costs.currency)} budget`
                    : ''
                }`}
              >
                {data.costs.budget !== null && data.costs.monthToDate !== null ? (
                  <Meter
                    value={data.costs.monthToDate}
                    max={data.costs.budget}
                    label="Spent against budget"
                  />
                ) : null}
              </Tile>
            ) : (
              <Tile label="Google Cloud spend" value="–" hint={data.costs.reason} />
            )}
            <Tile
              label="Monthly recurring revenue"
              value={money(data.costs.mrr, data.costs.mrrCurrency)}
              hint={<Link href="/admin/costs">Costs and margin</Link>}
            />
          </div>
        </>
      )}
    </>
  );
}
