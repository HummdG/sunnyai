'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { RangePicker } from '../../../components/admin/bits.js';
import { Freshness, LoadError, useAdminData } from '../../../components/admin/shell.js';
import { SkeletonRows } from '../../../components/dashboard/kit.js';
import { Card, Chip, PageHeader } from '../../../components/dashboard/ui.js';
import {
  compact,
  dayLabel,
  FLAG_TEXT,
  type Range,
  type TenantRow,
} from '../../../lib/admin-api.js';

type SortKey =
  'companyName' | 'turns' | 'leads' | 'tokens' | 'voiceMinutes' | 'errors' | 'lastActiveDay';

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'companyName', label: 'Installer', numeric: false },
  { key: 'turns', label: 'Replies', numeric: true },
  { key: 'leads', label: 'Leads', numeric: true },
  { key: 'tokens', label: 'Tokens', numeric: true },
  { key: 'voiceMinutes', label: 'Voice min', numeric: true },
  { key: 'errors', label: 'Errors', numeric: true },
  { key: 'lastActiveDay', label: 'Last active', numeric: false },
];

const BILLING_TONE: Record<TenantRow['billingStatus'], 'ok' | 'orange' | 'danger' | 'neutral'> = {
  active: 'ok',
  trialing: 'orange',
  past_due: 'danger',
  canceled: 'neutral',
  none: 'neutral',
};

/** Every installer with its usage over the window. Sortable by any column. */
export default function AdminTenantsPage() {
  const [days, setDays] = useState<Range>(30);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'turns', desc: true });
  const [filter, setFilter] = useState('');
  const { data, error, updatedAt, reload } = useAdminData<{ days: number; tenants: TenantRow[] }>(
    `/v1/admin/tenants?days=${days}`,
  );

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = (data?.tenants ?? []).filter(
      (t) => !needle || `${t.companyName} ${t.id}`.toLowerCase().includes(needle),
    );
    return [...list].sort((a, b) => {
      const x = a[sort.key] ?? '';
      const y = b[sort.key] ?? '';
      const order =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -order : order;
    });
  }, [data, filter, sort]);

  return (
    <>
      <PageHeader
        title="Installers"
        lead={<Freshness at={updatedAt} />}
        actions={<RangePicker value={days} onChange={setDays} />}
      />
      {error ? <LoadError error={error} retry={reload} /> : null}
      <Card>
        <label className="field compact">
          <span>Find an installer</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Name or id"
          />
        </label>
        {!data ? (
          <SkeletonRows rows={8} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={c.numeric ? 'num' : undefined}
                      aria-sort={
                        sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          setSort((s) => ({
                            key: c.key,
                            desc: s.key === c.key ? !s.desc : c.numeric,
                          }))
                        }
                      >
                        {c.label}
                        {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                  <th scope="col">Billing</th>
                  <th scope="col">Needs a look</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/admin/tenants/${encodeURIComponent(t.id)}`}>
                        {t.companyName}
                      </Link>
                      <div className="muted small">{t.addons.length} add-ons on</div>
                    </td>
                    <td className="num">{compact(t.turns)}</td>
                    <td className="num">{compact(t.leads)}</td>
                    <td className="num">{compact(t.tokens)}</td>
                    <td className="num">{compact(t.voiceMinutes)}</td>
                    <td className="num">{compact(t.errors)}</td>
                    <td>
                      {t.lastActiveDay ? (
                        dayLabel(t.lastActiveDay)
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                    <td>
                      <Chip tone={BILLING_TONE[t.billingStatus]}>
                        {t.billingStatus.replace('_', ' ')}
                      </Chip>
                    </td>
                    <td>
                      {t.flags.length === 0 ? (
                        <span className="muted">–</span>
                      ) : (
                        <span className="chips">
                          {t.flags.map((f) => (
                            <Chip key={f} tone={f === 'onboarding' ? 'neutral' : 'danger'}>
                              {FLAG_TEXT[f] ?? f}
                            </Chip>
                          ))}
                        </span>
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
