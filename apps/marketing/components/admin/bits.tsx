'use client';

import type { ReactNode } from 'react';

import { RANGES, type Range } from '../../lib/admin-api.js';
import { Sparkline } from './charts.js';

/**
 * A KPI tile: label, value, an optional hint and an optional 7-day trend. The
 * value is already formatted by the caller, so a tile never guesses a unit.
 */
export function Tile({
  label,
  value,
  hint,
  trend,
  children,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  trend?: number[];
  children?: ReactNode;
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {hint ? <span className="tile-hint">{hint}</span> : null}
      {trend && trend.length > 1 ? <Sparkline values={trend} label={`${label}, daily`} /> : null}
      {children}
    </div>
  );
}

/** 7, 30 or 90 days, as one row of toggle buttons. */
export function RangePicker({
  value,
  onChange,
  options = RANGES,
}: {
  value: Range;
  onChange: (range: Range) => void;
  options?: readonly Range[];
}) {
  return (
    <div className="range" role="group" aria-label="Time range">
      {options.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}

/** A source that could not be read, said plainly in place of its panel. */
export function Unavailable({ reason }: { reason: string }) {
  return <p className="unavailable">Not available: {reason}</p>;
}

/** Spent against a budget, coloured by how close it is. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max <= 0 ? 0 : value / max;
  const tone = share > 1 ? ' over' : share > 0.85 ? ' warn' : '';
  return (
    <div
      className={`meter${tone}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 100) / 100}
    >
      <span style={{ width: `${Math.min(100, share * 100)}%` }} />
    </div>
  );
}
