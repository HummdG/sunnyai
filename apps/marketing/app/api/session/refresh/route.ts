import { NextResponse, type NextRequest } from 'next/server';

import { apiUrl, sameOrigin, SESSION_COOKIE } from '../../../../lib/session.js';
import { clearSession, withSession } from '../../../../lib/session-cookies.js';

/**
 * Keep a session alive: the dashboard calls this before the hour is up. The
 * API re-issues the token but keeps the original sign-in time, so a session
 * still ends after seven days (or at once after "sign out everywhere").
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: { message: 'Cross-site request refused.' } },
      { status: 403 },
    );
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: { message: 'Not signed in.' } }, { status: 401 });
  }
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}/v1/portal/session/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { message: 'The Sunny service is not reachable.' } },
      { status: 503 },
    );
  }
  if (!response.ok) {
    return clearSession(
      NextResponse.json({ error: { message: 'Your session has ended.' } }, { status: 401 }),
    );
  }
  const session = (await response.json()) as { token: string; expiresAt: number };
  return withSession(NextResponse.json({ expiresAt: session.expiresAt }), session);
}
