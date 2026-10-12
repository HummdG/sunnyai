import { NextResponse, type NextRequest } from 'next/server';

import { apiUrl, sameOrigin } from '../../../lib/session.js';
import { clearSession, withSession } from '../../../lib/session-cookies.js';

/**
 * Start a session: `{ idToken }` from Firebase, or `{ devEmail }` where the API
 * has development sign-in switched on (it refuses otherwise, and always in
 * production). The API verifies the proof and returns a Sunny session token,
 * which is set as an HttpOnly cookie.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return refuse(403, 'Cross-site sign-in is not allowed.');
  const body = (await request.json().catch(() => null)) as {
    idToken?: unknown;
    devEmail?: unknown;
  } | null;

  let proof: string | null = typeof body?.idToken === 'string' ? body.idToken : null;
  if (!proof && typeof body?.devEmail === 'string') {
    const dev = await callApi('/v1/portal/dev-login', { email: body.devEmail });
    if (!dev.ok) return relay(dev);
    proof = ((await dev.json()) as { token: string }).token;
  }
  if (!proof) return refuse(400, 'Nothing to sign in with.');

  const response = await callApi('/v1/portal/session', { idToken: proof });
  if (!response.ok) return relay(response);
  const session = (await response.json()) as {
    token: string;
    expiresAt: number;
    user: { uid: string; email: string };
  };
  return withSession(
    NextResponse.json({ user: session.user, expiresAt: session.expiresAt }),
    session,
  );
}

/** Sign out of this browser. ("Sign out everywhere" revokes through the API first.) */
export function DELETE(request: NextRequest): NextResponse {
  if (!sameOrigin(request)) return refuse(403, 'Cross-site sign-out is not allowed.');
  return clearSession(NextResponse.json({ signedOut: true }));
}

async function callApi(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${apiUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: { message: 'The Sunny.ai service is not reachable. Try again in a moment.' },
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
}

async function relay(response: Response): Promise<NextResponse> {
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

function refuse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: { message } }, { status });
}
