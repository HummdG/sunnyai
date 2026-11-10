import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatClient } from '../src/chat.js';

function client(): ChatClient {
  return new ChatClient({
    apiUrl: 'https://api.example',
    sessionToken: 't',
    sessionId: 's1',
    onEvent: () => undefined,
    onError: () => undefined,
    onFinish: () => undefined,
  });
}

/** A fetch that records the body and answers with an empty stream. */
function stubFetch(): { body: () => Record<string, unknown> } {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);
  return {
    body: () => {
      const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1];
      return JSON.parse(init.body) as Record<string, unknown>;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatClient.send', () => {
  it('sends the page path with the message', async () => {
    vi.stubGlobal('location', { pathname: '/battery-deal', origin: 'https://site.example' });
    const sent = stubFetch();
    await client().send('hi', 'c1');
    expect(sent.body()).toMatchObject({ text: 'hi', clientMessageId: 'c1' });
    expect((sent.body().page as { path: string }).path).toBe('/battery-deal');
  });

  it('sends no page where there is no location', async () => {
    vi.stubGlobal('location', undefined);
    const sent = stubFetch();
    await client().send('hi', 'c1');
    expect(sent.body().page).toBeUndefined();
  });
});
