import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, sessionExpiry } from './lib/session.js';

/**
 * The dashboard is for signed-in installers. A request without a live session
 * cookie goes to the sign-in page, which brings the person back afterwards.
 * (The API still checks the session and the person's role on every call; this
 * only keeps signed-out visitors from loading an empty dashboard.)
 */
export function proxy(request: NextRequest): NextResponse {
  const exp = sessionExpiry(request.cookies.get(SESSION_COOKIE)?.value);
  if (exp !== null && exp > Date.now()) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/dashboard/:path*', '/dashboard'],
};
