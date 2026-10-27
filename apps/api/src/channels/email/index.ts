import { registerAddonTool } from '../../agent/tools.js';
import { serviceAccountTokens } from '../../ingest/drive.js';
import type { Tenant } from '../../tenants.js';
import type { EmailAddonConfig } from './config.js';
import { decryptSecret } from './crypto.js';
import { refreshingToken } from './oauth.js';
import {
  GmailClient,
  GraphMailClient,
  RestDriveFiles,
  type DriveFiles,
  type GmailPushClient,
  type MailboxClient,
} from './providers.js';
import type { EmailStateStore } from './state.js';

export * from './assistant.js';
export * from './config.js';
export * from './crypto.js';
export * from './followup.js';
export * from './inbound.js';
export * from './mime.js';
export * from './oauth.js';
export * from './policy.js';
export * from './providers.js';
export * from './state.js';
export { composeReply } from './compose.js';

/**
 * Provide the email channel's `create_gmail_draft` tool to the core.
 *
 * The draft itself is created by the system from the finished answer, footer
 * and all, exactly once per email -- so the tool does not touch the mailbox.
 * It tells the model how its answer will be used, which keeps one draft per
 * email and keeps a model from writing a second, unfooted draft of its own.
 */
export function registerEmailTools(): void {
  registerAddonTool('create_gmail_draft', () =>
    Promise.resolve({
      ok: true,
      data: { drafted_by_system: true },
      summary:
        "Write your reply as your answer. The system places it in the installer's drafts, with the legal footer, for a person to approve.",
    }),
  );
}

/** The tenant's mailbox client, built from its stored (encrypted) token. */
export function mailboxFromState(
  state: EmailStateStore,
  config: EmailAddonConfig,
  fetchImpl: typeof fetch = fetch,
): (tenant: Tenant) => Promise<(MailboxClient & Partial<GmailPushClient>) | null> {
  return async (tenant) => {
    const token = await state.getToken(tenant.id);
    if (!token || !config.tokenKey) return null;
    const client = token.provider === 'gmail' ? config.google : config.microsoft;
    if (!client) return null;
    const access = refreshingToken(
      token.provider,
      client,
      decryptSecret(config.tokenKey, token.ciphertext),
      fetchImpl,
    );
    return token.provider === 'gmail'
      ? new GmailClient(access, fetchImpl)
      : new GraphMailClient(access, fetchImpl);
  };
}

/**
 * Drive access for spec-sheet attachments, with the knowledge connector's
 * service account (the folder the installer shared with it). Null when the
 * deployment has no service account, in which case replies carry links only.
 */
export function driveFilesFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): ((tenant: Tenant) => DriveFiles | null) | undefined {
  const json = env['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'];
  if (!json || json.trim() === '') return undefined;
  let tokens: (() => Promise<string>) | null = null;
  try {
    tokens = serviceAccountTokens(json);
  } catch {
    return undefined;
  }
  const files = new RestDriveFiles(tokens, fetchImpl);
  return (tenant) => (tenant.gdriveFolderId ? files : null);
}
