import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KnowledgeChunk, KnowledgeIndex } from '@sunny/knowledge';
import { describe, expect, it } from 'vitest';

import { runTurn } from '../src/agent/agent.js';
import type { ChatChunk, ChatProvider, ChatTurnRequest } from '../src/agent/provider.js';
import { MAX_PAGE_CHARS, lexicalSearch, withWholePage } from '../src/agent/retrieval.js';
import { FileStore } from '../src/store.js';
import { defaultTenants } from '../src/tenants.js';

function chunk(documentId: string, ordinal: number, heading: string, text: string): KnowledgeChunk {
  return {
    id: `${documentId}_${ordinal}`,
    documentId,
    title: documentId === 'scams' ? '8 Solar Scams To Avoid' : `Page ${documentId}`,
    url: null,
    version: '1',
    heading,
    ordinal,
    text,
  };
}

// HSEnergy's scams page as the chunker splits it: one passage per scam, so a
// search for "other scams" returns a couple of them and never the list.
const SCAMS = [
  'Free solar panel offers',
  'High-pressure sales tactics',
  'Impersonation of government or utility officials',
  'Misleading contracts and hidden fees',
  'Identity theft through fake solar companies',
  'False claims of immediate tax rebates',
  'Overpriced and unnecessary maintenance plans',
  'Overpriced upgrades to older systems',
];
const PAGE = [
  chunk('scams', 0, 'About solar scams', 'Solar scams are on the rise. Here is what to look for.'),
  ...SCAMS.map((name, i) =>
    chunk('scams', i + 1, `${i + 1}. ${name}`, `${name}. A scam that costs homeowners money.`),
  ),
];
const FILLER = Array.from({ length: 10 }, (_, i) =>
  chunk(`p${i}`, 0, `Page ${i}`, `Our panels and batteries, page ${i}. Ask us anything.`),
);
const SITE: KnowledgeIndex = { sourceCount: 11, chunks: [...FILLER, ...PAGE] };

class Recording implements ChatProvider {
  readonly kind = 'scripted';
  readonly model = 'scripted-1';
  last: ChatTurnRequest | null = null;
  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(request: ChatTurnRequest): AsyncIterable<ChatChunk> {
    this.last = request;
    yield { type: 'text', text: 'ok' };
  }
}

async function contextFor(message: string, knowledge: KnowledgeIndex = SITE) {
  const provider = new Recording();
  const store = new FileStore(await mkdtemp(join(tmpdir(), 'sunny-page-')));
  for await (const _ of runTurn({
    tenant: defaultTenants(false)[0]!,
    provider,
    store,
    sessionId: 'sess_page',
    conversationId: null,
    history: [],
    message,
    clientMessageId: `c_${Math.random()}`,
    sunscanConnected: false,
    knowledge,
    search: lexicalSearch,
  })) {
    // drain
  }
  return provider.last!.message;
}

describe('reading a whole page', () => {
  it('lists every scam when the visitor asks for them all', async () => {
    const context = await contextFor('what other scams are there? list them all out');
    for (const name of SCAMS) expect(context).toContain(name);
    // In the page's own order, so a numbered list reads as one.
    const at = SCAMS.map((name) => context.indexOf(`${name}. A scam`));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('leaves a single-fact question with its best passages', async () => {
    const hits = await lexicalSearch(SITE, 'identity theft', 5);
    expect(withWholePage(SITE, hits, 'is identity theft a risk?')).toEqual(hits);
  });

  it('reads a long page outward from what matched, up to the cap', async () => {
    const long = Array.from({ length: 40 }, (_, i) =>
      chunk('long', i, `Part ${i}`, `${i === 20 ? 'heat pumps ' : ''}${'x'.repeat(490)}`),
    );
    const index: KnowledgeIndex = { sourceCount: 1, chunks: long };
    const hits = await lexicalSearch(index, 'heat pumps', 5);
    const read = withWholePage(index, hits, 'list all the heat pumps');
    const size = read.reduce((n, h) => n + h.chunk.text.length, 0);
    expect(size).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    expect(read.map((h) => h.chunk.ordinal)).toContain(20);
    const ordinals = read.map((h) => h.chunk.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(Math.min(...ordinals)).toBeGreaterThan(0);
    expect(Math.max(...ordinals)).toBeLessThan(39);
  });
});
