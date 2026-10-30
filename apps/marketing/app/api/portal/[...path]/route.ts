import { NextResponse, type NextRequest } from 'next/server';

import {
  apiHeaders,
  apiUrl,
  CSRF_HEADER,
  PROXY_PREFIXES,
  sameOrigin,
  SESSION_COOKIE,
} from '../../../../lib/session.js';

/**
 * The dashboard's same-origin door to the API.
 *
 * The browser calls `/api/portal/v1/portal/...`; this adds the Sunny session
 * from the HttpOnly cookie as a bearer token and forwards the request. The
 * credential never reaches page script. Only the portal and SunScan areas of
 * the API are reachable through here, and every state-changing request must be
 * same-origin and carry the `x-sunny-csrf` header -- which a cross-site form
 * cannot set -- on top of the cookie's SameSite=Lax.
 */
type Context = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, context: Context): Promise<NextResponse> {
  const { path } = await context.params;
  const target = path.map(encodeURIComponent).join('/');
  if (!PROXY_PREFIXES.some((prefix) => `${target}/`.startsWith(prefix))) {
    return NextResponse.json({ error: { message: 'Not found.' } }, { status: 404 });
  }
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    if (!sameOrigin(request) || request.headers.get(CSRF_HEADER) !== '1') {
      return NextResponse.json({ error: { message: 'Request refused.' } }, { status: 403 });
    }
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  const type = request.headers.get('content-type');
  if (type) headers['content-type'] = type;

  let response: Response;
  try {
    response = await fetch(`${apiUrl()}/${target}${request.nextUrl.search}`, {
      method,
      headers: apiHeaders(headers),
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { message: 'The Sunny service is not reachable. Try again in a moment.' } },
      { status: 503 },
    );
  }
  const out = new NextResponse(response.body, { status: response.status });
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const value = response.headers.get(name);
    if (value) out.headers.set(name, value);
  }
  return out;
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
