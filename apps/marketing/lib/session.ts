/**
 * The website's sign-in session, server side.
 *
 * After Firebase (or local dev) sign-in, the browser posts its proof to
 * `/api/session`; the API verifies it and returns a short-lived Sunny session
 * token, which is kept here in an **HttpOnly** cookie. Page script can never
 * read it. A second, non-secret cookie carries only the expiry time so the
 * site header can show "Dashboard" and the dashboard can refresh in time.
 *
 * Shared by the route handlers and `proxy.ts`; nothing in here may import
 * server-only Node APIs, because `proxy.ts` runs at the edge.
 */

export const SESSION_COOKIE = 'sunny_session';
/** Not a credential: the session's expiry (epoch ms), readable by page script. */
export const SIGNED_IN_COOKIE = 'sunny_signed_in';
export const CSRF_HEADER = 'x-sunny-csrf';

/** Where the Sunny API is, from the server's point of view. */
export function apiUrl(): string {
  return (
    process.env['SUNNY_API_URL'] ??
    process.env['NEXT_PUBLIC_SUNNY_API_URL'] ??
    'http://localhost:8787'
  ).replace(/\/+$/, '');
}

/**
 * The header that tells the load balancer a request is this website's server
 * calling the API, not a visitor. Every installer's dashboard traffic leaves
 * Cloud Run from the same few addresses, so the per-address rate limit at the
 * edge (infrastructure/terraform/armor.tf) would otherwise count all of them
 * as one visitor. The key is set by Terraform as `SUNNY_EDGE_KEY`.
 */
export const EDGE_KEY_HEADER = 'x-sunny-edge-key';

/** Headers for a call to the API: `headers`, plus the edge key where one is set. */
export function apiHeaders(headers: Record<string, string>): Record<string, string> {
  const key = process.env['SUNNY_EDGE_KEY'];
  return key ? { ...headers, [EDGE_KEY_HEADER]: key } : headers;
}

export function secureCookies(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/** The expiry inside a session token, without verifying it (the API does that). */
export function sessionExpiry(token: string | undefined): number | null {
  if (!token || !token.startsWith('ses.')) return null;
  const body = token.split('.')[1];
  if (!body) return null;
  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/**
 * Same-origin check for state-changing requests. Browsers send `Origin` on
 * every cross-origin POST; a request whose Origin names another site is
 * refused. (Requests without one are same-origin navigations or non-browser
 * clients, and the session cookie is SameSite=Lax regardless.)
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Only these API areas are reachable through the dashboard proxy. */
export const PROXY_PREFIXES = ['v1/portal/', 'v1/sunscan/'] as const;
