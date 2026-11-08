import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS, VertexEmbedder } from '../src/ingest/embeddings.js';

/** A fake Vertex endpoint: records each request and answers from `reply`. */
function vertex(reply: (body: { instances: Record<string, string>[] }, call: number) => Response) {
  const calls: {
    url: string;
    auth: string | null;
    body: { instances: Record<string, string>[]; parameters: unknown };
  }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as (typeof calls)[number]['body'];
    calls.push({ url, auth: new Headers(init.headers).get('authorization'), body });
    return Promise.resolve(reply(body, calls.length));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (values: number[]) =>
  new Response(JSON.stringify({ predictions: [{ embeddings: { values } }] }), { status: 200 });

function embedder(fetchImpl: typeof fetch) {
  return new VertexEmbedder({
    project: 'heysunny-prod',
    location: 'europe-west2',
    token: () => Promise.resolve('tok'),
    fetchImpl,
  });
}

describe('Vertex embeddings', () => {
  it('embeds as the service account, one text per request, in order', async () => {
    const { calls, fetchImpl } = vertex((body) => ok([body.instances[0]!['content']!.length]));
    const vectors = await embedder(fetchImpl).embedDocuments([
      { title: 'About us', text: 'a' },
      { title: 'Prices', text: 'bbb' },
      { title: 'Warranty', text: 'cc' },
    ]);

    expect(vectors).toEqual([[1], [3], [2]]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe(
      'https://europe-west2-aiplatform.googleapis.com/v1/projects/heysunny-prod/locations/europe-west2/publishers/google/models/gemini-embedding-001:predict',
    );
    expect(calls[0]!.auth).toBe('Bearer tok');
    expect(calls.every((c) => c.body.instances.length === 1)).toBe(true);
    expect(calls.find((c) => c.body.instances[0]!['title'] === 'Prices')!.body).toEqual({
      instances: [{ content: 'bbb', task_type: 'RETRIEVAL_DOCUMENT', title: 'Prices' }],
      parameters: { outputDimensionality: EMBEDDING_DIMENSIONS, autoTruncate: true },
    });
  });

  it('marks a visitor question as a query', async () => {
    const { calls, fetchImpl } = vertex(() => ok([0.5]));
    expect(await embedder(fetchImpl).embedQuery('who is the md?')).toEqual([0.5]);
    expect(calls[0]!.body.instances[0]).toEqual({
      content: 'who is the md?',
      task_type: 'RETRIEVAL_QUERY',
    });
  });

  it('waits out a busy answer while syncing, but not on a visitor question', async () => {
    const busyOnce = () =>
      vertex((_body, call) => (call === 1 ? new Response('busy', { status: 429 }) : ok([1])));

    const sync = busyOnce();
    expect(await embedder(sync.fetchImpl).embedDocuments([{ title: 't', text: 'x' }])).toEqual([
      [1],
    ]);
    expect(sync.calls).toHaveLength(2);

    const chat = busyOnce();
    await expect(embedder(chat.fetchImpl).embedQuery('hi')).rejects.toThrow('429');
    expect(chat.calls).toHaveLength(1);
  });

  it('fails loudly on an answer with no vector', async () => {
    const { fetchImpl } = vertex(() => new Response('{}', { status: 200 }));
    await expect(embedder(fetchImpl).embedQuery('hi')).rejects.toThrow('no embedding');
  });
});
