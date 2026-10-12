import type { NextResponse } from 'next/server';

import { secureCookies, SESSION_COOKIE, SIGNED_IN_COOKIE } from './session.js';

/** Set the HttpOnly session cookie and its public expiry companion. */
export function withSession(
  response: NextResponse,
  session: { token: string; expiresAt: number },
): NextResponse {
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  response.cookies.set(SIGNED_IN_COOKIE, String(session.expiresAt), {
    httpOnly: false,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return response;
}

export function clearSession(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true });
  response.cookies.set(SIGNED_IN_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
