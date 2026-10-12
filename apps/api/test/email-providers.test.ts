/* eslint-disable @typescript-eslint/require-await -- the fakes implement async interfaces and have nothing to await */
import { describe, expect, it } from 'vitest';

import {
  GmailClient,
  GraphMailClient,
  ProviderError,
  refreshingToken,
  RestDriveFiles,
} from '../src/channels/email/index.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
  auth: string | null;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const call: Call = {
      url: String(url),
      method: init.method ?? 'GET',
      body:
        typeof init.body === 'string' && init.body.startsWith('{')
          ? JSON.parse(init.body)
          : (init.body ?? null),
      auth: headers.get('authorization'),
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const token = async () => 'access-1';

describe('Gmail client', () => {
  it('creates a draft in the thread with the raw message base64url-encoded', async () => {
    const { impl, calls } = fakeFetch(() =>
      json({ id: 'r-1', message: { id: 'msg-1', threadId: 'th-1' } }),
    );
    const gmail = new GmailClient(token, impl);
    const draft = await gmail.createDraft({ raw: 'Subject: Hi?\r\n\r\nbody>>', threadId: 'th-1' });
    expect(calls[0]).toMatchObject({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      method: 'POST',
      auth: 'Bearer access-1',
    });
    const body = calls[0]!.body as { message: { raw: string; threadId: string } };
    expect(body.message.threadId).toBe('th-1');
    expect(body.message.raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(body.message.raw, 'base64url').toString()).toBe(
      'Subject: Hi?\r\n\r\nbody>>',
    );
    expect(draft).toMatchObject({ draftId: 'r-1', threadId: 'th-1' });
  });

  it('lists only messages added to the inbox, never sent or drafted ones', async () => {
    const { impl, calls } = fakeFetch(() =>
      json({
        historyId: '210',
        history: [
          { messagesAdded: [{ message: { id: 'a', labelIds: ['INBOX', 'UNREAD'] } }] },
          { messagesAdded: [{ message: { id: 'b', labelIds: ['SENT'] } }] },
          { messagesAdded: [{ message: { id: 'c', labelIds: ['INBOX', 'DRAFT'] } }] },
          { messagesAdded: [{ message: { id: 'a', labelIds: ['INBOX'] } }] },
        ],
      }),
    );
    const result = await new GmailClient(token, impl).newInboxMessageIds('200');
    expect(result).toEqual({ ids: ['a'], historyId: '210' });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/gmail/v1/users/me/history');
    expect(url.searchParams.get('startHistoryId')).toBe('200');
    expect(url.searchParams.get('historyTypes')).toBe('messageAdded');
  });

  it('reports provider failures without echoing the body', async () => {
    const { impl } = fakeFetch(() => new Response('secret customer content', { status: 403 }));
    const error = await new GmailClient(token, impl).profile().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).not.toContain('secret');
  });
});

describe('Microsoft Graph client', () => {
  it('drafts a true reply when the original Graph message id is known', async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.url.endsWith('/createReply')
        ? json({ id: 'draft-1' })
        : json({
            id: 'draft-1',
            webLink: 'https://outlook.office.com/x',
            conversationId: 'conv-1',
          }),
    );
    const graph = new GraphMailClient(token, impl);
    const draft = await graph.createDraft({
      replyToProviderId: 'orig-1',
      text: 'Hello',
      subject: 'Re: x',
      to: 'jo@example.com',
    });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /v1.0/me/messages/orig-1/createReply',
      'PATCH /v1.0/me/messages/draft-1',
    ]);
    expect(calls[1]!.body).toEqual({ body: { contentType: 'Text', content: 'Hello' } });
    expect(draft).toMatchObject({ draftId: 'draft-1', webLink: 'https://outlook.office.com/x' });
  });

  it('drafts a new message for forwarded mail', async () => {
    const { impl, calls } = fakeFetch(() => json({ id: 'draft-2' }));
    await new GraphMailClient(token, impl).createDraft({
      replyToProviderId: null,
      text: 'Hi',
      subject: 'Re: y',
      to: 'sam@example.com',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://graph.microsoft.com/v1.0/me/messages',
    });
    expect(calls[0]!.body).toMatchObject({
      subject: 'Re: y',
      toRecipients: [{ emailAddress: { address: 'sam@example.com' } }],
    });
  });
});

describe('Drive spec sheets', () => {
  it('downloads PDFs and declines other files', async () => {
    const { impl } = fakeFetch((call) => {
      if (call.url.includes('pdf-id') && call.url.includes('fields=')) {
        return json({ name: 'IQ8M datasheet', mimeType: 'application/pdf', size: '4' });
      }
      if (call.url.includes('pdf-id') && call.url.includes('alt=media'))
        return new Response('%PDF');
      return json({ name: 'Notes', mimeType: 'application/vnd.google-apps.document' });
    });
    const drive = new RestDriveFiles(token, impl);
    const pdf = await drive.downloadPdf('pdf-id');
    expect(pdf).toMatchObject({ filename: 'IQ8M datasheet.pdf', mimeType: 'application/pdf' });
    expect(pdf?.data.toString()).toBe('%PDF');
    expect(await drive.downloadPdf('doc-id')).toBeNull();
  });
});

describe('OAuth refresh', () => {
  it('caches the access token until shortly before it expires', async () => {
    let now = 0;
    const { impl, calls } = fakeFetch(() =>
      json({ access_token: `at-${calls.length}`, expires_in: 3600 }),
    );
    const access = refreshingToken(
      'gmail',
      { clientId: 'c', clientSecret: 's', redirectUri: 'r' },
      'rt',
      impl,
      () => now,
    );
    expect(await access()).toBe('at-1');
    now = 3_000_000;
    expect(await access()).toBe('at-1');
    now = 3_600_000;
    expect(await access()).toBe('at-2');
    expect(String(calls[0]!.body)).toContain('grant_type=refresh_token');
  });
});
