'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { refreshSession, sessionExpiresAt, signOut } from '../../lib/auth-client.js';
import { api, ApiFailure, tenantPath, type TenantView } from '../../lib/portal-api.js';
import { EmptyState, SunnyLoading } from './kit.js';
import { NavIcon } from './nav-icon.js';
import { SidebarSunny } from '../cameo/dashboard-cameos.js';
import { ToastProvider } from './toast.js';

interface Me {
  user: { uid: string; email: string | null };
  tenants: Array<{ id: string; companyName: string; role: TenantView['role'] }>;
}

interface PortalContext {
  me: Me;
  tenant: TenantView;
  setTenant: (tenant: TenantView) => void;
  reloadTenant: () => Promise<void>;
}

const Ctx = createContext<PortalContext | null>(null);

export function usePortal(): PortalContext {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePortal outside <PortalShell>');
  return value;
}

const TENANT_KEY = 'sunny.portal.tenant';

/** The signed-in user and their installers, or a redirect to sign in / set up. */
export function useMe(): { me: Me | null; error: string | null } {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Me>('/v1/portal/me')
      .then(setMe)
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.status === 401) {
          void signOut().then(() =>
            router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`),
          );
          return;
        }
        setError(failure instanceof Error ? failure.message : 'We couldn’t load your account.');
      });
  }, [router, pathname]);
  return { me, error };
}

/**
 * Keep the session alive while the dashboard is open: refresh when less than
 * fifteen minutes remain, and go to sign-in if it can no longer be refreshed
 * (signed out everywhere, or past the seven-day limit).
 */
function useSessionKeeper(): void {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const check = () => {
      const exp = sessionExpiresAt();
      if (exp === null || exp - Date.now() > 15 * 60 * 1000) return;
      void refreshSession().then((ok) => {
        if (!ok) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      });
    };
    check();
    const timer = window.setInterval(check, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [router, pathname]);
}

export function rememberTenant(tenantId: string): void {
  window.localStorage.setItem(TENANT_KEY, tenantId);
}

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: 'overview' },
  { href: '/dashboard/inbox', label: 'Inbox', icon: 'inbox' },
  { href: '/dashboard/leads', label: 'Leads', icon: 'leads' },
  { href: '/dashboard/knowledge', label: 'Knowledge', icon: 'knowledge' },
  { href: '/dashboard/products', label: 'Products', icon: 'products' },
  { href: '/dashboard/studio', label: 'Sunny Studio', icon: 'studio' },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
  { href: '/dashboard/billing', label: 'Add-ons & billing', icon: 'billing' },
  { href: '/dashboard/team', label: 'Team', icon: 'team' },
  { href: '/dashboard/account', label: 'Your account', icon: 'account' },
] as const;

/**
 * Every signed-in page. Resolves the user and their installer, sends a new
 * user to set up their organisation, and lays out the navigation.
 */
export function PortalShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, error } = useMe();
  useSessionKeeper();
  const [tenant, setTenant] = useState<TenantView | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async (tenantId: string) => {
    const { tenant: view } = await api<{ tenant: TenantView }>(tenantPath(tenantId));
    setTenant(view);
  }, []);

  useEffect(() => {
    if (!me) return;
    if (me.tenants.length === 0) {
      router.replace('/dashboard/onboarding');
      return;
    }
    const remembered = window.localStorage.getItem(TENANT_KEY);
    const chosen = me.tenants.find((t) => t.id === remembered) ?? me.tenants[0]!;
    void load(chosen.id);
  }, [me, load, router]);

  if (error)
    return (
      <main className="center-note" id="main">
        <EmptyState
          pose="droop"
          title="We couldn’t load your dashboard"
          action={
            <button type="button" className="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          }
        >
          {error}
        </EmptyState>
      </main>
    );
  if (!me || !tenant)
    return (
      <main className="center-note" id="main" aria-busy="true">
        <SunnyLoading text="Fetching your dashboard…" />
      </main>
    );

  const context: PortalContext = {
    me,
    tenant,
    setTenant,
    reloadTenant: () => load(tenant.id),
  };

  if (bare)
    return (
      <Ctx.Provider value={context}>
        <ToastProvider>{children}</ToastProvider>
      </Ctx.Provider>
    );

  return (
    <Ctx.Provider value={context}>
      <ToastProvider>
        <div className="shell">
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
                <span className="brand-tenant">{tenant.companyName}</span>
              </div>
              <button
                type="button"
                className="menu-toggle"
                aria-expanded={menuOpen}
                aria-controls="portal-nav"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                Menu
              </button>
            </div>
            <nav id="portal-nav" aria-label="Portal">
              <ul>
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={
                        pathname === item.href ||
                        (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`))
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
            <SidebarSunny />
            <div className="sidebar-foot">
              {me.tenants.length > 1 ? (
                <label className="field compact">
                  <span>Installer</span>
                  <select
                    value={tenant.id}
                    onChange={(event) => {
                      rememberTenant(event.target.value);
                      void load(event.target.value);
                    }}
                  >
                    {me.tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.companyName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <span className="muted small">{me.user.email}</span>
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
      </ToastProvider>
    </Ctx.Provider>
  );
}
