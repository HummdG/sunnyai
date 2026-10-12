'use client';

import type { LimbPoseName } from '@sunny/character';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { SunnyCameo } from '../cameo/sunny-cameo.js';
import { SunnySpot } from '../sunny-spot.js';

/**
 * The dashboard's personality kit (brand guidelines C2, D3, F, G): empty
 * states with a posed Sunny, a loading Sunny, count-up KPIs, a copy button
 * with a sparkle, the sun-rising progress bar and the sun-ray toggle. Every
 * piece degrades under `prefers-reduced-motion` to an instant change.
 */

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Empty state: spot Sunny + headline + one sentence + one action (Part F). */
export function EmptyState({
  pose = 'shrug',
  sequence,
  at,
  title,
  children,
  action,
  say,
}: {
  pose?: LimbPoseName;
  sequence?: string;
  /** A still frame of `sequence` (0..1), e.g. mid-deckchair. */
  at?: number;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** A line in Sunny's speech bubble (empty states are where personality lives). */
  say?: string;
}) {
  return (
    <div className="empty-state">
      {say ? (
        <SunnyCameo
          pose={pose}
          sequence={sequence}
          at={at}
          still={at !== undefined}
          size={112}
          bubble={say}
          bubbleSide="top"
        />
      ) : (
        <SunnySpot pose={pose} sequence={sequence} at={at} size={112} />
      )}
      <div>
        <h2>{title}</h2>
        <p className="muted">{children}</p>
        {action ? <div className="actions">{action}</div> : null}
      </div>
    </div>
  );
}

/** Loading a page: Sunny thinking, rays ticking like clockwork (C2). */
export function SunnyLoading({ text }: { text: string }) {
  return (
    <div className="sunny-loading" role="status" aria-live="polite">
      <SunnySpot pose="chin" sequence="thinking-whirr" loop size={96} />
      <p className="muted">{text}</p>
    </div>
  );
}

/** Skeleton rows for tables (tables use skeletons, not the character — Part G). */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

/** A KPI number that counts up over 600ms with the brand ease-out (D3). */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(reducedMotion() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="tabular">{shown.toLocaleString('en-GB')}</span>;
}

/** Copy to clipboard: the label becomes "Copied!" with a sparkle for 1.5s (D3). */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`button secondary copy-button${copied ? ' copied' : ''}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <>
          <span className="sparkle" aria-hidden="true">
            ✦
          </span>
          Copied!
        </>
      ) : (
        label
      )}
    </button>
  );
}

/** Progress as a sun rising along the bar; done = the sun at the top, sparkling (D3). */
export function SunProgress({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const done = ratio >= 1;
  return (
    <div className={`sun-progress${done ? ' done' : ''}`}>
      <div
        className="sun-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <span className="sun-progress-fill" style={{ width: `${ratio * 100}%` }} />
        <span className="sun-progress-sun" style={{ left: `${ratio * 100}%` }} aria-hidden="true" />
      </div>
      <span className="small muted">{label}</span>
    </div>
  );
}

/** A switch whose knob springs across and bursts six sun rays when it turns on (D3). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const [burst, setBurst] = useState(0);
  return (
    <label className="toggle">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.checked) setBurst((n) => n + 1);
          onChange(event.target.checked);
        }}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob">
          {burst > 0 ? (
            <span key={burst} className="toggle-burst">
              {Array.from({ length: 6 }, (_, i) => (
                <i key={i} style={{ transform: `rotate(${i * 60}deg)` }} />
              ))}
            </span>
          ) : null}
        </span>
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  );
}
