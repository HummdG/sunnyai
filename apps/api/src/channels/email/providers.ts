import type { GmailMessage } from './inbound.js';
import { base64url } from './mime.js';

/**
 * The mailbox providers, as narrow interfaces with REST implementations on
 * `fetch`. Narrow on purpose: the interfaces are the whole of what the add-on
 * may do to an installer's mailbox, and there is no method to list, search or
 * read arbitrary mail (Blueprint §5 "zero inbox read-back"). The one read is
 * `getMessage` for an id that a push notification just named as new.
 */

export type AccessToken = () => Promise<string>;

export interface DraftResult {
  draftId: string;
  messageId: string | null;
  threadId: string | null;
  /** Where a person opens it. */
  webLink: string | null;
}

/** What the email channel may do in a mailbox: draft, and (when allowed) send. */
export interface MailboxClient {
  readonly provider: 'gmail' | 'outlook';
  createDraft(input: {
    raw: string;
    threadId: string | null;
    replyToProviderId: string | null;
    text: string;
    subject: string;
    to: string;
  }): Promise<DraftResult>;
  /** Send a reply. Only ever called by the auto-send policy. */
  send(input: {
    raw: string;
    threadId: string | null;
    replyToProviderId: string | null;
    text: string;
    subject: string;
    to: string;
  }): Promise<{ messageId: string }>;
}

/** The Gmail push path's extra needs: the watch, and the new messages it reports. */
export interface GmailPushClient {
  profile(): Promise<{ emailAddress: string; historyId: string }>;
  watch(topicName: string): Promise<{ historyId: string; expiration: string | null }>;
  /** Ids of messages ADDED to the INBOX since `startHistoryId`. Nothing else. */
  newInboxMessageIds(startHistoryId: string): Promise<{ ids: string[]; historyId: string }>;
  getMessage(id: string): Promise<GmailMessage>;
}

export class ProviderError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

async function call<T>(
  fetchImpl: typeof fetch,
  token: AccessToken,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${await token()}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    // The provider's body can echo message content; it is not logged or passed on.
    throw new ProviderError(
      `${new URL(url).hostname} returned ${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ─── Gmail ───────────────────────────────────────────────────────────────────

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailClient implements MailboxClient, GmailPushClient {
  readonly provider = 'gmail' as const;
  readonly #token: AccessToken;
  readonly #fetch: typeof fetch;

  constructor(token: AccessToken, fetchImpl: typeof fetch = fetch) {
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async createDraft(input: { raw: string; threadId: string | null }): Promise<DraftResult> {
    const draft = await call<{ id: string; message?: { id?: string; threadId?: string } }>(
      this.#fetch,
      this.#token,
      `${GMAIL}/drafts`,
      {
        method: 'POST',
        body: JSON.stringify({
          message: {
            raw: base64url(input.raw),
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
        }),
      },
    );
    return {
      draftId: draft.id,
      messageId: draft.message?.id ?? null,
      threadId: draft.message?.threadId ?? input.threadId,
      webLink: draft.message?.id
        ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draft.message.id)}`
        : 'https://mail.google.com/mail/u/0/#drafts',
    };
  }

  async send(input: { raw: string; threadId: string | null }): Promise<{ messageId: string }> {
    const sent = await call<{ id: string }>(this.#fetch, this.#token, `${GMAIL}/messages/send`, {
      method: 'POST',
      body: JSON.stringify({
        raw: base64url(input.raw),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
    });
    return { messageId: sent.id };
  }

  async profile(): Promise<{ emailAddress: string; historyId: string }> {
    return call(this.#fetch, this.#token, `${GMAIL}/profile`);
  }

  async watch(topicName: string): Promise<{ historyId: string; expiration: string | null }> {
    const result = await call<{ historyId: string; expiration?: string }>(
      this.#fetch,
      this.#token,
      `${GMAIL}/watch`,
      {
        method: 'POST',
        body: JSON.stringify({ topicName, labelIds: ['INBOX'], labelFilterBehavior: 'include' }),
      },
    );
    return { historyId: result.historyId, expiration: result.expiration ?? null };
  }

  async newInboxMessageIds(startHistoryId: string): Promise<{ ids: string[]; historyId: string }> {
    const ids: string[] = [];
    let historyId = startHistoryId;
    let pageToken: string | undefined;
    // Bounded: a mailbox that has been offline a long time is not drained in one
    // push. The cursor still advances, so the next push continues from here.
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: 'messageAdded',
        labelId: 'INBOX',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const result = await call<{
        history?: Array<{
          messagesAdded?: Array<{ message: { id: string; labelIds?: string[] } }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      }>(this.#fetch, this.#token, `${GMAIL}/history?${params.toString()}`);
      for (const entry of result.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          const labels = added.message.labelIds ?? [];
          if (labels.includes('INBOX') && !labels.includes('SENT') && !labels.includes('DRAFT')) {
            ids.push(added.message.id);
          }
        }
      }
      if (result.historyId) historyId = result.historyId;
      if (!result.nextPageToken) break;
      pageToken = result.nextPageToken;
    }
    return { ids: [...new Set(ids)], historyId };
  }

  async getMessage(id: string): Promise<GmailMessage> {
    return call(
      this.#fetch,
      this.#token,
      `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`,
    );
  }
}

// ─── Microsoft 365 (Graph) ───────────────────────────────────────────────────

const GRAPH = 'https://graph.microsoft.com/v1.0/me';

/**
 * Outlook drafts through Microsoft Graph. With the original Graph message id the
 * draft is a true reply (`createReply`, which threads it); without one -- mail
 * that reached us by forwarding -- it is a new draft with a "Re:" subject.
 *
 * Real-provider acceptance is blocked on an Azure app registration and a
 * Microsoft 365 test mailbox; this is exercised against a fake only.
 */
export class GraphMailClient implements MailboxClient {
  readonly provider = 'outlook' as const;
  readonly #token: AccessToken;
  readonly #fetch: typeof fetch;

  constructor(token: AccessToken, fetchImpl: typeof fetch = fetch) {
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async createDraft(input: {
    replyToProviderId: string | null;
    text: string;
    subject: string;
    to: string;
  }): Promise<DraftResult> {
    let draft: { id: string; webLink?: string; conversationId?: string };
    if (input.replyToProviderId) {
      draft = await call(
        this.#fetch,
        this.#token,
        `${GRAPH}/messages/${encodeURIComponent(input.replyToProviderId)}/createReply`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      draft = await call(
        this.#fetch,
        this.#token,
        `${GRAPH}/messages/${encodeURIComponent(draft.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ body: { contentType: 'Text', content: input.text } }),
        },
      );
    } else {
      draft = await call(this.#fetch, this.#token, `${GRAPH}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          subject: input.subject,
          body: { contentType: 'Text', content: input.text },
          toRecipients: [{ emailAddress: { address: input.to } }],
        }),
      });
    }
    return {
      draftId: draft.id,
      messageId: draft.id,
      threadId: draft.conversationId ?? null,
      webLink: draft.webLink ?? null,
    };
  }

  async send(input: {
    replyToProviderId: string | null;
    text: string;
    subject: string;
    to: string;
  }): Promise<{ messageId: string }> {
    const draft = await this.createDraft(input);
    await call(
      this.#fetch,
      this.#token,
      `${GRAPH}/messages/${encodeURIComponent(draft.draftId)}/send`,
      {
        method: 'POST',
      },
    );
    return { messageId: draft.draftId };
  }
}

// ─── Drive (spec-sheet attachments) ──────────────────────────────────────────

export interface DriveAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** Fetch a PDF from the installer's Drive to attach to a draft. */
export interface DriveFiles {
  downloadPdf(fileId: string): Promise<DriveAttachment | null>;
}

/** Spec sheets above this are linked rather than attached. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export class RestDriveFiles implements DriveFiles {
  readonly #token: AccessToken;
  readonly #fetch: typeof fetch;

  constructor(token: AccessToken, fetchImpl: typeof fetch = fetch) {
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async downloadPdf(fileId: string): Promise<DriveAttachment | null> {
    const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
    const meta = await call<{ name: string; mimeType: string; size?: string }>(
      this.#fetch,
      this.#token,
      `${base}?fields=name,mimeType,size`,
    );
    if (meta.mimeType !== 'application/pdf') return null;
    if (meta.size && Number(meta.size) > MAX_ATTACHMENT_BYTES) return null;
    const response = await this.#fetch(`${base}?alt=media`, {
      headers: { authorization: `Bearer ${await this.#token()}` },
    });
    if (!response.ok) throw new ProviderError(`drive returned ${response.status}`, response.status);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_ATTACHMENT_BYTES) return null;
    return {
      filename: meta.name.endsWith('.pdf') ? meta.name : `${meta.name}.pdf`,
      mimeType: 'application/pdf',
      data,
    };
  }
}

/** The Drive file id in a knowledge source's link, if it is a Drive link. */
export function driveFileIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(parsed.hostname)) return null;
  const path = /\/d\/([A-Za-z0-9_-]{10,})/.exec(parsed.pathname);
  if (path) return path[1]!;
  const id = parsed.searchParams.get('id');
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
}
