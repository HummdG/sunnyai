'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { signOut } from '../../lib/auth-client.js';
import { api } from '../../lib/portal-api.js';
import { EmptyState, SunnyLoading } from '../dashboard/kit.js';
import { NavIcon } from '../dashboard/nav-icon.js';
import { useMe } from '../dashboard/portal.js';

const NAV = [
  { href: '/admin', label: 'Overview', icon: 'overview' },
  { href: '/admin/usage', label: 'Usage', icon: 'usage' },
  { href: '/admin/health', label: 'Health', icon: 'health' },
  { href: '/admin/costs', label: 'Costs', icon: 'costs' },
  { href: '/admin/tenants', label: 'Installers', icon: 'team' },
  { href: '/admin/errors', label: 'Errors', icon: 'errors' },
] as const;

/** How often an open page re-reads its figures. */
export const REFRESH_MS = 60_000;

/**
 * Read an admin endpoint, and read it again every minute while the page is
 * open and visible. A failed refresh keeps the last figures on screen with the
 * error beside them, rather than blanking a page someone is reading.
 */
export function useAdminData<T>(path: string): {
  data: T | null;
  error: string | null;
  updatedAt: number | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(() => {
    const asked = path;
    api<T>(asked)
      .then((value) => {
        if (current.current !== asked) return;
        setData(value);
        setError(null);
        setUpdatedAt(Date.now());
      })
      .catch((failure: unknown) => {
        if (current.current !== asked) return;
        setError(failure instanceof Error ? failure.message : 'That didn’t load.');
      });
  }, [path]);

  useEffect(() => {
    setData(null);
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return { data, error, updatedAt, reload: load };
}

/** "Updated 14:05:12". */
export function Freshness({ at }: { at: number | null }) {
  if (at === null) return null;
  return (
    <span className="muted small">
      Updated{' '}
      {new Date(at).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
      , refreshes every minute
    </span>
  );
}

/**
 * Every staff page. Signed in and on the staff list, or a plain "not here":
 * the API makes the real decision on every call, this only saves a non-staff
 * visitor an empty page.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, error } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  if (error)
    return (
      <main className="center-note" id="main">
        <EmptyState pose="droop" title="We couldn’t load the staff dashboard">
          {error}
        </EmptyState>
      </main>
    );
  if (!me)
    return (
      <main className="center-note" id="main" aria-busy="true">
        <SunnyLoading text="Checking who you are…" />
      </main>
    );
  if (!me.staff)
    return (
      <main className="center-note" id="main">
        <EmptyState
          pose="droop"
          title="This page isn’t available"
          action={
            <Link className="button" href="/dashboard">
              Go to your dashboard
            </Link>
          }
        >
          The staff dashboard is only for the Sunny team.
        </EmptyState>
      </main>
    );

  return (
    <div className="shell admin-shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="brand">
          <img
            className="brand-logo"
            src="/brand/sunny-logo-64.png"
            width={34}
            height={34}
            alt=""
          />
          <div>
            <strong>Sunny</strong>
            <span className="brand-tenant">Staff dashboard</span>
          </div>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="admin-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            Menu
          </button>
        </div>
        <nav id="admin-nav" aria-label="Staff">
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={
                    pathname === item.href ||
                    (item.href !== '/admin' && pathname.startsWith(`${item.href}/`))
                      ? 'page'
                      : undefined
                  }
                  onClick={() => setMenuOpen(false)}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <span className="muted small">{me.user.email}</span>
          {me.tenants.length > 0 ? (
            <Link className="link-button" href="/dashboard">
              Installer dashboard
            </Link>
          ) : null}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              void signOut().then(() => router.replace('/'));
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="content" id="main">
        {children}
      </main>
    </div>
  );
}

/** A page-level error that keeps a retry beside it. */
export function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <p className="error-note" role="alert">
      <span className="status-icon" aria-hidden="true">
        !
      </span>
      {error}{' '}
      <button type="button" className="link-button" onClick={retry}>
        Try again
      </button>
    </p>
  );
}
