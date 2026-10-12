'use client';

import type { ReactNode } from 'react';

import type { SyncStatus } from '../../lib/portal-api.js';
import { CountUp } from './kit.js';

export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      className={`card ${className}`}
      id={id}
      aria-label={typeof title === 'string' ? title : undefined}
    >
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-value">
        {typeof value === 'number' ? <CountUp value={value} /> : value}
      </span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  disconnected: 'Not connected',
  pending: 'Pending',
  syncing: 'Syncing',
  connected: 'Connected',
  failed: 'Failed',
};

export function StatusChip({ status }: { status: SyncStatus }) {
  return <span className={`chip chip-${status}`}>{STATUS_TEXT[status]}</span>;
}

export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'orange' | 'danger' | 'ok';
  children: ReactNode;
}) {
  return <span className={`chip chip-tone-${tone}`}>{children}</span>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="error-note" role="alert">
      <span className="status-icon" aria-hidden="true">
        !
      </span>
      {error}
    </p>
  ) : null;
}

/** "12 Oct, 14:05" (guidelines H3: dates "12 Oct 2026", 24-hour times). */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** What happened, and what to do (guidelines H2): never a bare "something went wrong". */
export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'That didn’t work. Check your connection, then try again.';
}

/** A time-of-day greeting for the overview (guidelines I: "Morning, Brightside Solar"). */
export function greeting(name: string, now = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return `${part}, ${name}`;
}
