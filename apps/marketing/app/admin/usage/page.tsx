'use client';

import { useState } from 'react';

import { RangePicker, Tile } from '../../../components/admin/bits.js';
import { BarList, LineChart } from '../../../components/admin/charts.js';
import { Freshness, LoadError, useAdminData } from '../../../components/admin/shell.js';
import { SkeletonRows } from '../../../components/dashboard/kit.js';
import { Card, PageHeader } from '../../../components/dashboard/ui.js';
import {
  compact,
  dayLabel,
  latencyText,
  type Range,
  type UsageReport,
} from '../../../lib/admin-api.js';

const CHANNEL_LABEL: Record<string, string> = { chat: 'Web chat', email: 'Email' };

/** Everything the platform did, per day, across every installer. */
export default function AdminUsagePage() {
  const [days, setDays] = useState<Range>(30);
  const { data, error, updatedAt, reload } = useAdminData<UsageReport>(
    `/v1/admin/usage?days=${days}`,
  );
  const labels = data?.series.map((p) => dayLabel(p.day)) ?? [];
  const pick = (key: keyof UsageReport['series'][number]) =>
    data?.series.map((p) => Number(p[key])) ?? [];

  return (
    <>
      <PageHeader
        title="Usage"
        lead={<Freshness at={updatedAt} />}
        actions={<RangePicker value={days} onChange={setDays} />}
      />
      {error ? <LoadError error={error} retry={reload} /> : null}
      {!data ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <>
          <div className="grid tiles">
            <Tile label="Replies" value={compact(data.totals.turns)} trend={pick('turns')} />
            <Tile
              label="Visitor messages"
              value={compact(data.totals.messages)}
              trend={pick('messages')}
            />
            <Tile label="Leads" value={compact(data.totals.leads)} trend={pick('leads')} />
            <Tile
              label="Tokens"
              value={compact(data.totals.byModel.reduce((a, m) => a + m.tokensIn + m.tokensOut, 0))}
              hint="Input and output, all models"
            />
            <Tile
              label="Safety escalations"
              value={compact(data.totals.escalations)}
              hint="Answered without the model"
            />
          </div>

          <div className="grid two">
            <Card>
              <LineChart
                title="Replies and visitor messages"
                labels={labels}
                series={[
                  { key: 'turns', label: 'Replies', values: pick('turns'), slot: 1 },
                  { key: 'messages', label: 'Visitor messages', values: pick('messages'), slot: 2 },
                ]}
              />
            </Card>
            <Card>
              <LineChart
                title="Tokens"
                labels={labels}
                series={[
                  { key: 'in', label: 'Input', values: pick('tokensIn'), slot: 1 },
                  { key: 'out', label: 'Output', values: pick('tokensOut'), slot: 2 },
                ]}
              />
            </Card>
            <Card>
              <LineChart
                title="Leads captured"
                labels={labels}
                series={[{ key: 'leads', label: 'Leads', values: pick('leads'), slot: 1 }]}
                area
              />
            </Card>
            <Card>
              <LineChart
                title="Installers with at least one reply"
                labels={labels}
                series={[
                  {
                    key: 'active',
                    label: 'Active installers',
                    values: pick('activeTenants'),
                    slot: 1,
                  },
                ]}
                area
              />
            </Card>
            <Card>
              <LineChart
                title="Failures"
                labels={labels}
                series={[
                  { key: 'errors', label: 'Errors logged', values: pick('errors'), slot: 1 },
                  {
                    key: 'ingest',
                    label: 'Knowledge imports failed',
                    values: pick('ingestFailed'),
                    slot: 2,
                  },
                  {
                    key: 'sunscan',
                    label: 'Roof scans failed',
                    values: pick('sunscanFailed'),
                    slot: 3,
                  },
                ]}
              />
            </Card>
          </div>

          <h2 className="section-title">Models and channels</h2>
          <div className="grid two">
            <Card>
              <BarList
                title="Model calls"
                rows={data.totals.byModel.map((m) => ({
                  label: m.model,
                  value: m.calls,
                  note: `${compact(m.tokensIn)} in, ${compact(m.tokensOut)} out`,
                }))}
              />
            </Card>
            <Card>
              <BarList
                title="Replies by channel"
                rows={Object.entries(data.totals.turnsByChannel).map(([channel, n]) => ({
                  label: CHANNEL_LABEL[channel] ?? channel,
                  value: n,
                }))}
              />
            </Card>
          </div>
          <div className="grid tiles">
            <Tile
              label="First words, median"
              value={latencyText(data.totals.latency.ttfbP50)}
              hint={`p95 ${latencyText(data.totals.latency.ttfbP95)}`}
            />
            <Tile
              label="Whole reply, median"
              value={latencyText(data.totals.latency.turnP50)}
              hint={`p95 ${latencyText(data.totals.latency.turnP95)}, tools included`}
            />
            <Tile
              label="Knowledge imports"
              value={`${compact(data.totals.ingestOk)} ok`}
              hint={`${compact(data.totals.ingestFailed)} failed`}
            />
            <Tile
              label="Roof scans"
              value={`${compact(data.totals.sunscanOk)} ok`}
              hint={`${compact(data.totals.sunscanFailed)} failed`}
            />
          </div>
          <p className="muted small">
            Latencies are read from buckets, so each is the upper edge of the bucket it falls in.
          </p>
        </>
      )}
    </>
  );
}
