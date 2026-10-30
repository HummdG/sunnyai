'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { compact } from '../../lib/admin-api.js';

/**
 * The staff dashboard's charts: hand-drawn SVG, because the dashboard carries
 * no chart library and these four shapes are all it needs.
 *
 * The rules they follow (the dataviz method): one axis per chart, thin marks
 * (2px lines, bars no thicker than 24px with a rounded data end), recessive
 * hairline grid, series colours assigned by fixed slot and never by rank, a
 * legend whenever there are two or more series, text in ink rather than in the
 * series colour, a hover readout, and a table view under every chart so no
 * number is reachable only by colour or only by mouse. The slot colours are in
 * `admin.css` as `--series-1..3` and were checked with the palette validator
 * against the card surface; slot 3 sits under 3:1, which is what the table
 * view is for.
 */

export interface Series {
  key: string;
  label: string;
  values: number[];
  /** Categorical slot 1..3, fixed per entity across every chart. */
  slot: 1 | 2 | 3;
}

/** The element's rendered width, so text is drawn at its real size rather than scaled. */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round tick values: 0 and two more on a 1/2/5 step. */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 2;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  return [0, step, step * 2];
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="viz-legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className={`viz-key slot-${s.slot}`} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Every value in a table, collapsed under the chart. */
function TableView({
  caption,
  labels,
  series,
  format,
}: {
  caption: string;
  labels: string[];
  series: Series[];
  format: (n: number) => string;
}) {
  return (
    <details className="viz-table">
      <summary>Show as a table</summary>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {series.map((s) => (
                <th scope="col" key={s.key}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {series.map((s) => (
                  <td key={s.key}>{format(s.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * A line chart over days, one y axis. Hover (or focus and arrow keys) moves a
 * crosshair and reads every series out for that day.
 */
export function LineChart({
  title,
  labels,
  series,
  format = compact,
  height = 200,
  area = false,
}: {
  title: string;
  labels: string[];
  series: Series[];
  format?: (n: number) => string;
  height?: number;
  /** A 10% wash under a single series. */
  area?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const pad = { top: 12, right: 12, bottom: 24, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const yTicks = ticks(max);
  const top = yTicks[yTicks.length - 1]!;
  const n = labels.length;
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const path = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const xLabelIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  function pick(clientX: number, rect: DOMRect) {
    const local = clientX - rect.left - pad.left;
    const i = Math.round((local / plotW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  return (
    <figure className="viz" ref={ref}>
      <figcaption className="viz-title">{title}</figcaption>
      <Legend series={series} />
      <div className="viz-plot">
        <svg
          width={width}
          height={height}
          role="img"
          aria-labelledby={`${id}-desc`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
            if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
          }}
        >
          <desc id={`${id}-desc`}>
            {title}, {labels[0]} to {labels[n - 1]}. Use the table below for every value.
          </desc>
          {yTicks.map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? 'viz-baseline' : 'viz-grid'}
                x1={pad.left}
                x2={width - pad.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="viz-axis" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {xLabelIdx.map((i) => (
            <text
              key={i}
              className="viz-axis"
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            >
              {labels[i]}
            </text>
          ))}
          {area && series.length === 1 ? (
            <path
              className={`viz-area slot-${series[0]!.slot}`}
              d={`${path(series[0]!.values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`}
            />
          ) : null}
          {series.map((s) => (
            <path key={s.key} className={`viz-line slot-${s.slot}`} d={path(s.values)} />
          ))}
          {series.map((s) => (
            <circle
              key={s.key}
              className={`viz-dot slot-${s.slot}`}
              cx={x(n - 1)}
              cy={y(s.values[n - 1] ?? 0)}
              r={4}
            />
          ))}
          {hover !== null ? (
            <g>
              <line
                className="viz-crosshair"
                x1={x(hover)}
                x2={x(hover)}
                y1={pad.top}
                y2={pad.top + plotH}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  className={`viz-dot slot-${s.slot}`}
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r={4}
                />
              ))}
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <div
            className="viz-tooltip"
            style={{
              left: Math.min(Math.max(x(hover), 80), width - 80),
            }}
            aria-live="polite"
          >
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <span className={`viz-key slot-${s.slot}`} aria-hidden="true" />
                {s.label}: {format(s.values[hover] ?? 0)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <TableView caption={title} labels={labels} series={series} format={format} />
    </figure>
  );
}

/** A trend line for a stat tile: one series, no axes, the last point marked. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 120;
  const height = 32;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => 2 + (n <= 1 ? 0 : (i / (n - 1)) * (width - 8));
  const y = (v: number) => height - 4 - (v / max) * (height - 8);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join('');
  return (
    <svg className="viz-spark" width={width} height={height} role="img" aria-label={label}>
      <path className="viz-line spark" d={d} />
      <circle className="viz-dot slot-1" cx={x(n - 1)} cy={y(values[n - 1] ?? 0)} r={3} />
    </svg>
  );
}

/** Horizontal bars, largest first, value at the tip. For shares: models, sources, services. */
export function BarList({
  title,
  rows,
  format = compact,
  empty = 'Nothing recorded yet.',
}: {
  title: string;
  rows: Array<{ label: string; value: number; note?: ReactNode }>;
  format?: (n: number) => string;
  empty?: string;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((r) => r.value));
  return (
    <figure className="viz">
      <figcaption className="viz-title">{title}</figcaption>
      {sorted.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="viz-bars">
          {sorted.map((row) => (
            <li key={row.label}>
              <span className="viz-bar-label">
                {row.label}
                {row.note ? <span className="muted small"> {row.note}</span> : null}
              </span>
              <span className="viz-bar-track">
                <span
                  className="viz-bar slot-1"
                  style={{ width: `${Math.max(1, (row.value / max) * 100)}%` }}
                />
                <span className="viz-bar-value">{format(row.value)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/**
 * Daily columns split into stacked segments, for spend by service. At most three
 * named segments plus a grey "Other", so the colours stay inside the validated
 * slots; a 2px surface gap separates segments, and the top one carries the
 * rounded end.
 */
export function StackedBars({
  title,
  labels,
  series,
  other,
  format = compact,
  height = 220,
}: {
  title: string;
  labels: string[];
  series: Series[];
  /** Everything outside the named series, per day. */
  other?: number[];
  format?: (n: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const pad = { top: 12, right: 12, bottom: 24, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = labels.length;
  const totals = labels.map(
    (_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0) + (other?.[i] ?? 0),
  );
  const yTicks = ticks(Math.max(0, ...totals));
  const top = yTicks[yTicks.length - 1]!;
  const band = plotW / Math.max(1, n);
  const barW = Math.min(24, Math.max(2, band - 4));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const all: Array<Series | { key: string; label: string; values: number[]; slot: 0 }> = [
    ...series,
    ...(other ? [{ key: 'other', label: 'Other', values: other, slot: 0 as const }] : []),
  ];

  return (
    <figure className="viz" ref={ref}>
      <figcaption className="viz-title">{title}</figcaption>
      <ul className="viz-legend">
        {all.map((s) => (
          <li key={s.key}>
            <span className={`viz-key slot-${s.slot}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="viz-plot">
        <svg
          className="viz-stack"
          width={width}
          height={height}
          role="img"
          aria-labelledby={`${id}-desc`}
          tabIndex={0}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - rect.left - pad.left) / band);
            setHover(i >= 0 && i < n ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
            if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
          }}
        >
          <desc id={`${id}-desc`}>
            {title}, {labels[0]} to {labels[n - 1]}. Use the table below for every value.
          </desc>
          {yTicks.map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? 'viz-baseline' : 'viz-grid'}
                x1={pad.left}
                x2={width - pad.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="viz-axis" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((label, i) => {
            const cx = pad.left + band * i + band / 2;
            let base = 0;
            const segments = all.map((s) => ({ s, v: s.values[i] ?? 0 })).filter(({ v }) => v > 0);
            return (
              <g key={label} opacity={hover === null || hover === i ? 1 : 0.55}>
                {segments.map(({ s, v }, k) => {
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  // 2px surface gap between segments; the top segment is rounded.
                  const h = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
                  const isTop = k === segments.length - 1;
                  return isTop ? (
                    <path
                      key={s.key}
                      className={`viz-seg slot-${s.slot}`}
                      d={roundedTop(cx - barW / 2, y1, barW, h, Math.min(4, h, barW / 2))}
                    />
                  ) : (
                    <rect
                      key={s.key}
                      className={`viz-seg slot-${s.slot}`}
                      x={cx - barW / 2}
                      y={y1}
                      width={barW}
                      height={h}
                    />
                  );
                })}
              </g>
            );
          })}
          {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
            <text
              key={i}
              className="viz-axis"
              x={pad.left + band * i + band / 2}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            >
              {labels[i]}
            </text>
          ))}
        </svg>
        {hover !== null ? (
          <div
            className="viz-tooltip"
            style={{ left: Math.min(Math.max(pad.left + band * hover + band / 2, 90), width - 90) }}
            aria-live="polite"
          >
            <strong>
              {labels[hover]}: {format(totals[hover] ?? 0)}
            </strong>
            {all.map((s) => (
              <span key={s.key}>
                <span className={`viz-key slot-${s.slot}`} aria-hidden="true" />
                {s.label}: {format(s.values[hover] ?? 0)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <TableView
        caption={title}
        labels={labels}
        series={all.map((s) => ({ ...s, slot: 1 }))}
        format={format}
      />
    </figure>
  );
}

/** A column with its top corners rounded and its base square. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
