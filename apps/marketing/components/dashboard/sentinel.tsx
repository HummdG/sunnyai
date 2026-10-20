'use client';

import { useEffect, useState } from 'react';

import { Toggle } from './kit.js';
import { Card, Chip } from './ui.js';

/**
 * Sentinel: the optional optimisation uplift an installer can offer (SunScan
 * v1's "Sentinel" layer). It lives on the price list; when it is on, every
 * quote shows an indicative extra saving beside each option. This card
 * explains it and lets an admin set it up, change it or switch it off.
 */

export interface SentinelView {
  enabled: boolean;
  basePercent: number;
  tariffPercent: Record<string, number>;
  lifestylePercent: Record<string, number>;
  batteryRequiredForFullUplift: boolean;
  noBatteryPercent: number;
  capPercent: number;
  addedCostMinor: number;
}

const TARIFFS: Array<[string, string]> = [
  ['standard', 'Standard'],
  ['economy7', 'Economy 7'],
  ['smart_tou', 'Smart / time-of-use'],
  ['import_export', 'Import and export'],
  ['already_exports', 'Already exporting'],
  ['unknown', "Doesn't know"],
];

const LIFESTYLES: Array<[string, string]> = [
  ['ev_now', 'Has an electric car'],
  ['ev_planned', 'Electric car planned'],
  ['heatpump_now', 'Has a heat pump'],
  ['heatpump_planned', 'Heat pump planned'],
  ['high_daytime', 'High daytime use'],
];

/** A sensible starting point (SunScan v1's defaults) for an installer setting it up. */
const STARTER: SentinelView = {
  enabled: true,
  basePercent: 12,
  tariffPercent: { standard: 0, economy7: 3, smart_tou: 8, import_export: 6, already_exports: 4 },
  lifestylePercent: {
    ev_now: 3,
    ev_planned: 1.5,
    heatpump_now: 3,
    heatpump_planned: 1.5,
    high_daytime: 2,
  },
  batteryRequiredForFullUplift: true,
  noBatteryPercent: 40,
  capPercent: 30,
  addedCostMinor: 0,
};

function PercentField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>
        {label} {hint ? <span className="hint">{hint}</span> : null}
      </span>
      <span className="input-suffix">
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
        />
        <span aria-hidden="true">%</span>
      </span>
    </label>
  );
}

export function SentinelCard({
  sentinel,
  canEdit,
  busy,
  onSave,
}: {
  sentinel: SentinelView | null;
  canEdit: boolean;
  busy: boolean;
  onSave: (next: SentinelView | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SentinelView>(sentinel ?? STARTER);
  useEffect(() => setDraft(sentinel ?? STARTER), [sentinel]);
  const on = sentinel?.enabled === true;
  const set = (patch: Partial<SentinelView>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Card title={<>Sentinel optimisation {on ? <Chip tone="ok">On</Chip> : <Chip>Off</Chip>}</>}>
      <p className="muted" style={{ marginBottom: 12 }}>
        Sentinel is an optional optimisation service you can offer: smarter battery charging, use
        and export. When it&apos;s on, each quote shows an <strong>indicative</strong> extra saving
        beside every option, for example &ldquo;with Sentinel: about £1,050 a year&rdquo;. It never
        changes your prices, and quotes stay the same while it&apos;s off.
      </p>
      {on && sentinel && !editing ? (
        <p className="small" style={{ marginBottom: 12 }}>
          Base uplift <strong>{sentinel.basePercent}%</strong>, up to{' '}
          <strong>{sentinel.capPercent}%</strong> in total
          {sentinel.batteryRequiredForFullUplift
            ? `; ${sentinel.noBatteryPercent}% of that without a battery`
            : ''}
          {sentinel.addedCostMinor > 0
            ? `; adds £${(sentinel.addedCostMinor / 100).toLocaleString('en-GB')} to the price`
            : ''}
          .
        </p>
      ) : null}
      {canEdit && !editing ? (
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => setEditing(true)}>
            {sentinel ? 'Change Sentinel settings' : 'Set up Sentinel'}
          </button>
        </div>
      ) : null}
      {canEdit && editing ? (
        <form
          className="sentinel-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
            setEditing(false);
          }}
        >
          <Toggle
            checked={draft.enabled}
            onChange={(enabled) => set({ enabled })}
            label="Show Sentinel savings on quotes"
          />
          <div className="field-grid">
            <PercentField
              label="Base uplift on yearly savings"
              value={draft.basePercent}
              onChange={(basePercent) => set({ basePercent })}
            />
            <PercentField
              label="Most it can add in total"
              value={draft.capPercent}
              onChange={(capPercent) => set({ capPercent })}
            />
            <PercentField
              label="Share kept without a battery"
              value={draft.noBatteryPercent}
              onChange={(noBatteryPercent) => set({ noBatteryPercent })}
              hint="(when a battery is needed for the full uplift)"
            />
            <label className="field">
              <span>One-off cost of adding Sentinel</span>
              <span className="input-suffix">
                <span aria-hidden="true">£</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.addedCostMinor / 100}
                  onChange={(e) =>
                    set({
                      addedCostMinor: Math.max(0, Math.round(Number(e.target.value) * 100) || 0),
                    })
                  }
                />
              </span>
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.batteryRequiredForFullUplift}
              onChange={(e) => set({ batteryRequiredForFullUplift: e.target.checked })}
            />{' '}
            The full uplift needs a battery
          </label>
          <fieldset className="sentinel-extras">
            <legend>Extra uplift by tariff</legend>
            <div className="field-grid">
              {TARIFFS.map(([key, label]) => (
                <PercentField
                  key={key}
                  label={label}
                  value={draft.tariffPercent[key] ?? 0}
                  onChange={(n) => set({ tariffPercent: { ...draft.tariffPercent, [key]: n } })}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="sentinel-extras">
            <legend>Extra uplift by lifestyle</legend>
            <div className="field-grid">
              {LIFESTYLES.map(([key, label]) => (
                <PercentField
                  key={key}
                  label={label}
                  value={draft.lifestylePercent[key] ?? 0}
                  onChange={(n) =>
                    set({ lifestylePercent: { ...draft.lifestylePercent, [key]: n } })
                  }
                />
              ))}
            </div>
          </fieldset>
          <div className="actions">
            <button type="submit" className="button" disabled={busy}>
              Save and publish
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setDraft(sentinel ?? STARTER);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
          <p className="muted small">
            Saving publishes a new version of your price list, so you can restore the previous one
            from &ldquo;Earlier versions&rdquo;.
          </p>
        </form>
      ) : null}
    </Card>
  );
}
