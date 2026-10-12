import type { AccessToken } from './providers.js';

/**
 * The authorization-code flow that connects an installer's mailbox.
 *
 * Scopes are the least the add-on needs:
 *   Gmail     gmail.compose  (create drafts; send only when auto-send is on)
 *             gmail.readonly (read the ONE new message a push names; the code
 *                             has no list or search path -- see providers.ts)
 *   Outlook   Mail.ReadWrite (drafts), Mail.Send, offline_access
 * Drive spec sheets are read with the knowledge connector's credentials, not
 * the mailbox's, so the mailbox grant does not include Drive.
 */

export type MailProvider = 'gmail' | 'outlook';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface ProviderEndpoints {
  authorize: string;
  token: string;
  scopes: string[];
  extra: Record<string, string>;
}

export const OAUTH_PROVIDERS: Readonly<Record<MailProvider, ProviderEndpoints>> = {
  gmail: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    // `offline` + `consent` so Google returns a refresh token every time.
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' },
  },
  outlook: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Mail.ReadWrite', 'Mail.Send'],
    extra: { prompt: 'select_account' },
  },
};

export function authorizeUrl(provider: MailProvider, client: OAuthClient, state: string): string {
  const endpoints = OAUTH_PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: endpoints.scopes.join(' '),
    state,
    ...endpoints.extra,
  });
  return `${endpoints.authorize}?${params.toString()}`;
}

export interface TokenGrant {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
}

async function tokenRequest(
  fetchImpl: typeof fetch,
  url: string,
  body: URLSearchParams,
): Promise<TokenGrant> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`The token endpoint returned ${response.status}.`);
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) throw new Error('The token endpoint returned no access token.');
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ?? 3600,
    scopes: (json.scope ?? '').split(' ').filter(Boolean),
  };
}

export function exchangeCode(
  provider: MailProvider,
  client: OAuthClient,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenGrant> {
  return tokenRequest(
    fetchImpl,
    OAUTH_PROVIDERS[provider].token,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
    }),
  );
}

/**
 * An access-token source over a refresh token, cached until a minute before it
 * expires. Created per request from the decrypted refresh token, which is
 * never held longer than that.
 */
export function refreshingToken(
  provider: MailProvider,
  client: OAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): AccessToken {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && cached.until > now()) return cached.token;
    const grant = await tokenRequest(
      fetchImpl,
      OAUTH_PROVIDERS[provider].token,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }),
    );
    cached = { token: grant.accessToken, until: now() + Math.max(0, grant.expiresIn - 60) * 1000 };
    return grant.accessToken;
  };
}
