import { randomBytes } from 'node:crypto';

import { encodeHeader } from '../channels/email/mime.js';
import { metadataTokens, type TokenProvider } from '../google/auth.js';

/**
 * Account emails -- verify your address, reset your password, a sign-in link,
 * confirm a new address -- sent by Sunny itself rather than by Firebase.
 *
 * Firebase's own emails carry links to `<project>.firebaseapp.com`, and this
 * project may not change that link (the console and the Admin API both answer
 * EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED). So the API asks Firebase only for the
 * link (`accounts:sendOobCode` with `returnOobLink`, which sends nothing),
 * moves it onto the website's own handler at `/auth/action` with every query
 * parameter kept, and sends a branded email from the company's Google
 * Workspace mailbox through the Gmail API.
 *
 * The Gmail call uses domain-wide delegation: the API's service account signs
 * a JWT naming the mailbox (`sub`) through the IAM Credentials API, so there is
 * no key to store. The Workspace admin grants that service account the
 * `gmail.send` scope once (docs/integration/account-email.md).
 *
 * Configured by
 *
 *   SUNNY_ACCOUNT_MAIL_SERVICE_ACCOUNT  the API's service account (signs the JWT)
 *   SUNNY_ACCOUNT_MAIL_MAILBOX          the Workspace user the mail is sent as
 *   SUNNY_ACCOUNT_MAIL_FROM             the From header, a send-as address of that user
 *
 * Unconfigured, `accountMailFromEnv` returns null, the route answers
 * `not_enabled`, and the website falls back to Firebase's own emails.
 */

export type AccountEmailKind = 'verifyEmail' | 'resetPassword' | 'signIn' | 'changeEmail';

export interface AccountMailConfig {
  serviceAccount: string;
  mailbox: string;
  from: string;
  projectId: string;
  /** The website's origin; links land on `${siteUrl}/auth/action`. */
  siteUrl: string;
}

export function accountMailFromEnv(
  env: Record<string, string | undefined>,
  projectId: string | null,
  siteUrl: string,
): AccountMailConfig | null {
  const value = (name: string) => env[name]?.trim() || null;
  const serviceAccount = value('SUNNY_ACCOUNT_MAIL_SERVICE_ACCOUNT');
  const mailbox = value('SUNNY_ACCOUNT_MAIL_MAILBOX');
  const from = value('SUNNY_ACCOUNT_MAIL_FROM');
  if (!serviceAccount || !mailbox || !from || !projectId) return null;
  return { serviceAccount, mailbox, from, projectId, siteUrl: siteUrl.replace(/\/+$/, '') };
}

// ─── the link ────────────────────────────────────────────────────────────────

const REQUEST_TYPES: Record<AccountEmailKind, string> = {
  verifyEmail: 'VERIFY_EMAIL',
  resetPassword: 'PASSWORD_RESET',
  signIn: 'EMAIL_SIGNIN',
  changeEmail: 'VERIFY_AND_CHANGE_EMAIL',
};

/**
 * Firebase's link, moved onto the website's handler. Only the origin and path
 * change: `mode`, `oobCode`, `apiKey`, `continueUrl` and `lang` are what the
 * Firebase client reads to finish the action, so all of them are kept.
 */
export function brandedActionLink(oobLink: string, siteUrl: string): string {
  const original = new URL(oobLink);
  const link = new URL('/auth/action', siteUrl);
  link.search = original.search;
  if (!link.searchParams.get('oobCode') || !link.searchParams.get('mode')) {
    throw new Error('Firebase returned a link without an action code.');
  }
  return link.toString();
}

export interface LinkRequest {
  kind: AccountEmailKind;
  email: string;
  /** For `changeEmail`: the address being confirmed. */
  newEmail?: string;
  /** Where the website goes once the action is done (same origin as siteUrl). */
  continueUrl: string;
}

export class AccountLinkError extends Error {
  /** Firebase's reason, e.g. EMAIL_NOT_FOUND. */
  readonly reason: string;
  constructor(reason: string) {
    super(`Firebase refused the link: ${reason}`);
    this.reason = reason;
  }
}

/** Ask Firebase for an action link without it sending anything. */
export async function generateActionLink(
  config: AccountMailConfig,
  request: LinkRequest,
  token: TokenProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/accounts:sendOobCode`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
        'x-goog-user-project': config.projectId,
      },
      body: JSON.stringify({
        requestType: REQUEST_TYPES[request.kind],
        email: request.email,
        ...(request.newEmail ? { newEmail: request.newEmail } : {}),
        continueUrl: request.continueUrl,
        canHandleCodeInApp: request.kind === 'signIn',
        returnOobLink: true,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const json = (await response.json().catch(() => ({}))) as {
    oobLink?: string;
    error?: { message?: string };
  };
  if (!response.ok) throw new AccountLinkError(json.error?.message ?? `HTTP ${response.status}`);
  // With email enumeration protection on, an unknown address is a success with
  // no link: there is nobody to email.
  if (!json.oobLink) throw new AccountLinkError('EMAIL_NOT_FOUND');
  return brandedActionLink(json.oobLink, config.siteUrl);
}

// ─── the email ───────────────────────────────────────────────────────────────

export interface AccountEmailContent {
  subject: string;
  heading: string;
  intro: string;
  button: string;
  outro: string;
}

export function accountEmailContent(kind: AccountEmailKind): AccountEmailContent {
  switch (kind) {
    case 'verifyEmail':
      return {
        subject: 'Confirm your email for HeySunny',
        heading: 'Confirm your email',
        intro: 'You are one step away from your HeySunny dashboard. Confirm this is your address:',
        button: 'Confirm my email',
        outro: 'If you did not sign up for HeySunny, you can ignore this email.',
      };
    case 'resetPassword':
      return {
        subject: 'Reset your HeySunny password',
        heading: 'Reset your password',
        intro: 'We received a request to reset the password for your HeySunny account.',
        button: 'Choose a new password',
        outro:
          'If you did not ask for this, you can ignore this email. Your password stays the same.',
      };
    case 'signIn':
      return {
        subject: 'Your HeySunny sign-in link',
        heading: 'Sign in to HeySunny',
        intro: 'Use the button below to sign in. The link works once and expires soon.',
        button: 'Sign in',
        outro: 'If you did not ask to sign in, you can ignore this email.',
      };
    case 'changeEmail':
      return {
        subject: 'Confirm your new email for HeySunny',
        heading: 'Confirm your new email',
        intro: 'Confirm this address to start using it for your HeySunny account.',
        button: 'Confirm new email',
        outro: 'If you did not ask to change your email, you can ignore this email.',
      };
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function accountEmailBodies(
  content: AccountEmailContent,
  link: string,
  siteUrl: string,
): { text: string; html: string } {
  const text = [
    content.heading,
    '',
    content.intro,
    '',
    link,
    '',
    content.outro,
    '',
    'The HeySunny team',
    siteUrl.replace(/^https?:\/\//, ''),
  ].join('\n');
  const logo = `${siteUrl}/brand/sunny-logo-128.png`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fdf8f0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f0;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #f1e3cf;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b">
<tr><td style="padding:28px 28px 8px"><img src="${escapeHtml(logo)}" width="48" height="48" alt="HeySunny" style="display:block;border:0"></td></tr>
<tr><td style="padding:8px 28px 0;font-size:20px;font-weight:bold;color:#1f1f1f">${escapeHtml(content.heading)}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.5">${escapeHtml(content.intro)}</td></tr>
<tr><td style="padding:24px 28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#e0701a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:8px">${escapeHtml(content.button)}</a></td></tr>
<tr><td style="padding:0 28px;font-size:12px;line-height:1.5;color:#8a8a8a">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(link)}" style="color:#a8a8a8;font-size:11px;text-decoration:none;word-break:break-all">${escapeHtml(link)}</a></td></tr>
<tr><td style="padding:20px 28px 28px;font-size:13px;line-height:1.5;color:#666666">${escapeHtml(content.outro)}<br><br>The HeySunny team</td></tr>
</table>
</td></tr></table></body></html>`;
  return { text, html };
}

function wrap76(base64: string): string {
  return base64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

/** A text-and-HTML message (multipart/alternative), ready for Gmail's `raw`. */
export function buildAccountMime(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  date?: Date;
}): string {
  const boundary = `sunny_${randomBytes(12).toString('hex')}`;
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset="UTF-8"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(Buffer.from(body, 'utf8').toString('base64')),
    ].join('\r\n');
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  return [
    `From: ${clean(input.from)}`,
    `To: ${clean(input.to)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', input.text),
    part('text/html', input.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

// ─── sending ─────────────────────────────────────────────────────────────────

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const ADMIN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * A token for `mailbox` with `scope`, by domain-wide delegation: the runtime
 * service account signs the JWT through the IAM Credentials API (it needs
 * Token Creator on itself), and Google's token endpoint exchanges it.
 */
export function delegatedTokens(options: {
  serviceAccount: string;
  subject: string;
  scope: string;
  runtimeToken: TokenProvider;
  fetch?: typeof fetch;
  now?: () => number;
}): TokenProvider {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  let current: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (current && current.expiresAt > now() + 60_000) return current.token;
    const iat = Math.floor(now() / 1000);
    const signed = await fetchImpl(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(options.serviceAccount)}:signJwt`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await options.runtimeToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          payload: JSON.stringify({
            iss: options.serviceAccount,
            sub: options.subject,
            scope: options.scope,
            aud: 'https://oauth2.googleapis.com/token',
            iat,
            exp: iat + 3600,
          }),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const { signedJwt } = (await signed.json().catch(() => ({}))) as { signedJwt?: string };
    if (!signed.ok || !signedJwt) throw new Error(`signJwt failed (${signed.status})`);
    const exchanged = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedJwt,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await exchanged.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!exchanged.ok || !json.access_token) {
      throw new Error(`delegated token refused (${exchanged.status}): ${json.error ?? 'no token'}`);
    }
    current = { token: json.access_token, expiresAt: now() + (json.expires_in ?? 3600) * 1000 };
    return current.token;
  };
}

export interface AccountMailer {
  /** Generate the link and send the email. Throws AccountLinkError on Firebase's refusal. */
  send(request: LinkRequest): Promise<void>;
}

export function createAccountMailer(
  config: AccountMailConfig,
  options: { fetch?: typeof fetch; runtimeToken?: TokenProvider } = {},
): AccountMailer {
  const fetchImpl = options.fetch ?? fetch;
  const runtimeToken = options.runtimeToken ?? metadataTokens(fetchImpl);
  const gmailToken = delegatedTokens({
    serviceAccount: config.serviceAccount,
    subject: config.mailbox,
    scope: GMAIL_SEND_SCOPE,
    runtimeToken,
    fetch: fetchImpl,
  });
  return {
    async send(request) {
      const link = await generateActionLink(config, request, runtimeToken, fetchImpl);
      const content = accountEmailContent(request.kind);
      const bodies = accountEmailBodies(content, link, config.siteUrl);
      const raw = buildAccountMime({
        from: config.from,
        to: request.kind === 'changeEmail' && request.newEmail ? request.newEmail : request.email,
        subject: content.subject,
        ...bodies,
      });
      const response = await fetchImpl(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await gmailToken()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error(`Gmail refused the account email (${response.status}).`);
    },
  };
}
