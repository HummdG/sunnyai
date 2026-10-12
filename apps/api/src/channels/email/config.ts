import { parseTokenKey } from './crypto.js';
import type { OAuthClient } from './oauth.js';

/**
 * Deployment settings for the email add-on, from the environment. Every
 * credential is optional: without it the matching path reports itself as not
 * configured rather than pretending to work.
 */
export interface EmailAddonConfig {
  /** AES-256-GCM key for mailbox tokens at rest. Null: no mailbox can be connected. */
  tokenKey: Buffer | null;
  google: OAuthClient | null;
  microsoft: OAuthClient | null;
  /** Derives each tenant's inbound webhook token. */
  webhookSecret: string;
  /** Basic-auth credentials on the shared inbound route (Postmark / SendGrid). */
  inboundBasic: { user: string; password: string } | null;
  /** Domain inbound addresses live on, e.g. `inbound.sunny.ai` (`<tenant>@domain`). */
  inboundDomain: string | null;
  gmailPush: { topic: string; token: string } | null;
  /** Where the OAuth flow returns and the dashboard lives. */
  publicApiUrl: string;
  dashboardUrl: string;
  /** Blueprint §5 matrix: max automatic replies per sender per day. */
  autoReplyCapPerSender: number;
  /** Ceiling on inbound messages processed per sender per day (cost protection). */
  dailySenderLimit: number;
  /** Blueprint §5: auto-reply only above this grounding confidence. */
  autoSendThreshold: number;
}

export function loadEmailConfig(
  env: Record<string, string | undefined>,
  fallbackSecret: string,
): EmailAddonConfig {
  const value = (name: string): string | null => {
    const raw = env[name];
    return raw === undefined || raw.trim() === '' ? null : raw.trim();
  };
  const publicApiUrl = value('SUNNY_PUBLIC_API_URL') ?? 'http://localhost:8787';
  const redirectUri =
    value('SUNNY_EMAIL_OAUTH_REDIRECT') ?? `${publicApiUrl}/v1/email/oauth/callback`;
  const client = (id: string, secret: string): OAuthClient | null => {
    const clientId = value(id);
    const clientSecret = value(secret);
    return clientId && clientSecret ? { clientId, clientSecret, redirectUri } : null;
  };
  const basicUser = value('SUNNY_EMAIL_INBOUND_USER');
  const basicPassword = value('SUNNY_EMAIL_INBOUND_PASSWORD');
  const pushTopic = value('SUNNY_GMAIL_PUSH_TOPIC');
  const pushToken = value('SUNNY_GMAIL_PUSH_TOKEN');
  const number = (name: string, fallback: number): number => {
    const parsed = Number(value(name));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    tokenKey: parseTokenKey(value('SUNNY_EMAIL_TOKEN_KEY')),
    google: client('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'),
    microsoft: client('MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET'),
    webhookSecret: value('SUNNY_EMAIL_WEBHOOK_SECRET') ?? `email-webhook:${fallbackSecret}`,
    inboundBasic: basicUser && basicPassword ? { user: basicUser, password: basicPassword } : null,
    inboundDomain: value('SUNNY_EMAIL_INBOUND_DOMAIN'),
    gmailPush: pushTopic && pushToken ? { topic: pushTopic, token: pushToken } : null,
    publicApiUrl,
    dashboardUrl: value('SUNNY_DASHBOARD_URL') ?? 'http://localhost:4176',
    autoReplyCapPerSender: number('SUNNY_EMAIL_AUTO_REPLY_CAP', 3),
    dailySenderLimit: number('SUNNY_EMAIL_DAILY_SENDER_LIMIT', 20),
    autoSendThreshold: Math.min(1, number('SUNNY_EMAIL_AUTO_SEND_THRESHOLD', 0.95)),
  };
}
