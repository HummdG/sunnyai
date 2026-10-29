import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  IngestionJob,
  KnowledgeSourceResponse,
  KnowledgeSyncResponse,
} from '@sunny/contracts';

import type { ServerConfig } from '../src/config.js';
import { crawlSite } from '../src/ingest/crawler.js';
import {
  csvToMarkdown,
  serviceAccountAssertion,
  type DriveChange,
  type DriveClient,
  type DriveContent,
  type DriveFile,
} from '../src/ingest/drive.js';
import type { Embedder } from '../src/ingest/embeddings.js';
import {
  assertPublicUrl,
  isPrivateAddress,
  type FetchedPage,
  type Fetcher,
} from '../src/ingest/fetcher.js';
import { parseRobots } from '../src/ingest/robots.js';
import { MemoryKnowledgeSyncStore } from '../src/ingest/sync-store.js';
import { embeddingKey } from '../src/ingest/sync.js';
import {
  createKnowledgeLoader,
  createKnowledgeRetriever,
  EMBEDDING_REFRESH_MS,
  tenantOfIndex,
} from '../src/knowledge.js';
import { createKnowledgePipeline } from '../src/routes/knowledge-ingest.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, DEMO_TENANT, type Tenant } from '../src/tenants.js';
import { TEST_ADMIN_TOKEN } from './catalogue-fixture.js';

import type { FastifyInstance } from 'fastify';

/**
 * The knowledge pipeline end to end, with the network replaced by fakes:
 * crawl a website, sync a Drive folder, quarantine personal data, flag
 * placeholders, search hybrid, and never let one installer's documents reach
 * another's visitor.
 */

const RIVAL: Tenant = {
  ...DEMO_TENANT,
  id: 't_rival001',
  publicId: 'w_rival00001',
  config: { ...DEMO_TENANT.config, publicId: 'w_rival00001', companyName: 'Riverside Renewables' },
};

function makeConfig(dataDir: string): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir,
    allowedOrigins: ['http://localhost:4173'],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: TEST_ADMIN_TOKEN,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: true,
      trustProxyHops: 0,
      rules: {
        session: { limit: 100_000, windowMs: 60_000 },
        chat: { limit: 100_000, windowMs: 60_000 },
        leads: { limit: 100_000, windowMs: 60_000 },
        qualification: { limit: 100_000, windowMs: 60_000 },
        catalogue: { limit: 100_000, windowMs: 60_000 },
        knowledge: { limit: 100_000, windowMs: 60_000 },
      },
      maxKeys: 10_000,
    },
  };
}

// ─── fakes ───────────────────────────────────────────────────────────────────

function fakeSite(
  pages: Record<string, { body: string; type?: string; status?: number }>,
): Fetcher & {
  hits: string[];
} {
  const hits: string[] = [];
  const fetcher = (url: string): Promise<FetchedPage> => {
    hits.push(url);
    const page = pages[url];
    if (!page) return Promise.resolve({ url, status: 404, contentType: 'text/html', body: '' });
    return Promise.resolve({
      url,
      status: page.status ?? 200,
      contentType: page.type ?? 'text/html',
      body: page.body,
    });
  };
  return Object.assign(fetcher, { hits });
}

const html = (title: string, main: string) =>
  `<html><head><title>${title}</title></head><body><nav><a href="/">Home</a></nav><main>${main}</main><footer>© Northwind</footer></body></html>`;

class FakeDrive implements DriveClient {
  files = new Map<string, { file: DriveFile; content: DriveContent }>();
  folders = ['root_folder'];
  pending: DriveChange[] = [];
  token = 1;
  reads: string[] = [];

  add(
    id: string,
    name: string,
    markdown: string,
    mimeType = 'application/vnd.google-apps.document',
  ): void {
    this.files.set(id, {
      file: {
        id,
        name,
        mimeType,
        modifiedTime: `2026-10-0${this.token}T00:00:00Z`,
        version: String(this.token),
        parents: ['root_folder'],
      },
      content:
        mimeType === 'application/pdf'
          ? { kind: 'needs-extraction', reason: 'PDF text extraction is not available' }
          : { kind: 'text', markdown },
    });
  }
  listFolder() {
    return Promise.resolve({
      files: [...this.files.values()].map((f) => f.file),
      folderIds: this.folders,
    });
  }
  read(file: DriveFile) {
    this.reads.push(file.id);
    return Promise.resolve(this.files.get(file.id)!.content);
  }
  startPageToken() {
    return Promise.resolve(`tok_${this.token}`);
  }
  changes() {
    const changes = this.pending;
    this.pending = [];
    this.token += 1;
    return Promise.resolve({ changes, newStartPageToken: `tok_${this.token}` });
  }
}

/** A deterministic "embedding": which of a few topics a text is about. */
const TOPICS = ['price cost pound £', 'battery powerwall storage', 'warranty guarantee years'];
const fakeEmbedder: Embedder & { calls: number } = {
  model: 'fake-embed',
  calls: 0,
  embedDocuments(texts) {
    this.calls += 1;
    return Promise.resolve(texts.map((t) => vectorise(t.text)));
  },
  embedQuery(text) {
    return Promise.resolve(vectorise(text));
  },
};
function vectorise(text: string): number[] {
  const lower = text.toLowerCase();
  return TOPICS.map((topic) => topic.split(' ').filter((w) => lower.includes(w)).length + 0.01);
}

// ─── harness ─────────────────────────────────────────────────────────────────

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function harness(
  options: { fetcher?: Fetcher; drive?: FakeDrive; embedder?: Embedder | null } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-ingest-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const syncStore = new MemoryKnowledgeSyncStore();
  const app = buildServer({
    config: makeConfig(dir),
    store,
    tenants: new TenantRegistry([DEMO_TENANT, RIVAL]),
    now: () => 1_760_000_000_000,
    knowledge: {
      syncStore,
      fetcher: options.fetcher ?? fakeSite({}),
      driveClient: () => options.drive ?? { error: 'no drive in this test' },
      embedder: options.embedder ?? null,
      rerank: null,
      urlCheck: (url) => assertPublicUrl(url, { resolve: false }),
    },
  });
  await app.ready();
  return { app, store, syncStore };
}

const auth = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

async function connect(app: FastifyInstance, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/knowledge/connections',
    headers: auth,
    payload,
  });
  return { status: response.statusCode, body: response.json<KnowledgeSyncResponse>() };
}

async function waitForJob(
  app: FastifyInstance,
  tenantId: string,
  jobId: string,
): Promise<IngestionJob> {
  for (let i = 0; i < 200; i++) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/knowledge/jobs/${jobId}?tenantId=${tenantId}`,
      headers: auth,
    });
    const job = response.json<{ job: IngestionJob }>().job;
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job never finished');
}

// ─── crawler ─────────────────────────────────────────────────────────────────

describe('website crawler', () => {
  const origin = 'https://northwind.test';
  const site = () =>
    fakeSite({
      [`${origin}/robots.txt`]: {
        body: 'User-agent: *\nDisallow: /admin\nSitemap: https://northwind.test/sitemap-index.xml',
        type: 'text/plain',
      },
      [`${origin}/sitemap-index.xml`]: {
        body: `<sitemapindex><sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
        type: 'application/xml',
      },
      [`${origin}/sitemap-pages.xml`]: {
        body: `<urlset><url><loc>${origin}/batteries</loc></url><url><loc>${origin}/admin/secret</loc></url></urlset>`,
        type: 'application/xml',
      },
      [`${origin}/`]: {
        body: html(
          'Northwind',
          '<h1>Solar for Sheffield</h1><p>See <a href="/warranty">our warranty</a> and <a href="https://elsewhere.test/x">a partner</a>.</p><a href="/spec.pdf">Spec</a>',
        ),
      },
      [`${origin}/batteries`]: {
        body: html('Batteries', '<h1>Batteries</h1><p>We fit the Powerwall 3.</p>'),
      },
      [`${origin}/warranty`]: {
        body: html('Warranty', '<h1>Warranty</h1><p>25 years on workmanship.</p>'),
      },
      [`${origin}/spec.pdf`]: { body: '%PDF-1.7', type: 'application/pdf' },
    });

  it('reads the sitemap, follows same-site links, honours robots.txt and skips PDFs', async () => {
    const fetcher = site();
    const result = await crawlSite({ startUrl: `${origin}/`, fetcher });
    expect(result.pages.map((p) => p.url).sort()).toEqual([
      `${origin}/`,
      `${origin}/batteries`,
      `${origin}/warranty`,
    ]);
    expect(result.disallowed).toEqual([`${origin}/admin/secret`]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ url: `${origin}/spec.pdf`, needsExtraction: true }),
    ]);
    expect(fetcher.hits.some((u) => u.includes('elsewhere.test'))).toBe(false);
    expect(fetcher.hits).not.toContain(`${origin}/admin/secret`);
    const battery = result.pages.find((p) => p.url.endsWith('/batteries'));
    expect(battery?.markdown).toContain('# Batteries');
    expect(battery?.markdown).not.toContain('©');
  });

  it('stops at the page cap and says so', async () => {
    const result = await crawlSite({ startUrl: `${origin}/`, fetcher: site(), maxPages: 2 });
    expect(result.pages.length).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('reads robots.txt rules with wildcards, allow-overrides and our own group', () => {
    const robots = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: SunnyBot\nDisallow: /private\nAllow: /private/faq$\nDisallow: /*.pdf$',
    );
    expect(robots.allowed('/batteries')).toBe(true);
    expect(robots.allowed('/private/x')).toBe(false);
    expect(robots.allowed('/private/faq')).toBe(true);
    expect(robots.allowed('/docs/spec.pdf')).toBe(false);
  });
});

describe('SSRF guard', () => {
  it('refuses private, loopback and metadata addresses', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest',
      'http://10.1.2.3/',
      'http://localhost:8787/',
      'ftp://example.com/',
      'http://[::1]/',
    ]) {
      await expect(assertPublicUrl(url)).rejects.toThrow();
    }
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('rejects a website connection to an internal address before crawling', async () => {
    const { app } = await harness();
    const response = await connect(app, {
      tenantId: DEMO_TENANT.id,
      kind: 'website',
      url: 'http://169.254.169.254/',
    });
    expect(response.status).toBe(400);
  });
});

// ─── website sync ────────────────────────────────────────────────────────────

describe('website sync', () => {
  const origin = 'https://northwind.test';
  function pages(extra: Record<string, { body: string }> = {}) {
    return {
      [`${origin}/`]: {
        body: html(
          'Northwind',
          '<h1>Solar</h1><p><a href="/prices">Prices</a> <a href="/bill">Example bill</a> <a href="/safety">Safety</a></p>',
        ),
      },
      [`${origin}/prices`]: {
        body: html(
          'Prices',
          '<h1>Prices</h1><table><tr><th>Package</th><th>Price</th></tr><tr><td>Family</td><td>£13,900</td></tr></table>',
        ),
      },
      [`${origin}/bill`]: {
        body: html(
          'Bill',
          '<h1>Bill</h1><p>Customer name: Jane Example, 14 Acacia Avenue, Leeds LS1 4AB. Account number 12345678, sort code 20-00-00. Amount due by Direct Debit. jane@gmail.com</p>',
        ),
      },
      [`${origin}/safety`]: {
        body: html(
          'Safety',
          '<h1>Safety</h1><p>If you smell burning, call XXXXX XXXXXX immediately.</p>',
        ),
      },
      ...extra,
    };
  }

  it('crawls, quarantines personal data, flags placeholders, and re-syncs incrementally', async () => {
    const site = { ...pages() } as Record<string, { body: string }>;
    const fetcher = fakeSite(site);
    const { app, store } = await harness({ fetcher });

    const started = await connect(app, {
      tenantId: DEMO_TENANT.id,
      kind: 'website',
      url: `${origin}/`,
    });
    expect(started.status).toBe(202);
    expect(started.body.job.status).toBe('queued');
    expect(started.body.connection).not.toHaveProperty('refreshToken');

    const job = await waitForJob(app, DEMO_TENANT.id, started.body.job.id);
    expect(job.status).toBe('succeeded');
    expect(job.counts).toMatchObject({ seen: 4, quarantined: 1, unchanged: 0 });
    expect(job.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['quarantined-pii', 'placeholder']),
    );

    const sources = await store.listKnowledgeSources(DEMO_TENANT.id);
    expect(sources.map((s) => s.title).sort()).toEqual(['Northwind', 'Prices', 'Safety']);
    expect(sources.every((s) => s.kind === 'website')).toBe(true);
    const safety = sources.find((s) => s.title === 'Safety');
    expect(safety?.warnings).toEqual([
      expect.objectContaining({ kind: 'placeholder', text: 'XXXXX XXXXXX', section: 'Safety' }),
    ]);

    // The installer can see the warning on the source list.
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/knowledge/sources?tenantId=${DEMO_TENANT.id}`,
      headers: auth,
    });
    expect(JSON.stringify(listed.json())).toContain('XXXXX XXXXXX');

    // Re-sync: nothing changed, one page edited, one page removed from the site.
    site[`${origin}/prices`] = {
      body: html('Prices', '<h1>Prices</h1><p>Family package now £12,900.</p>'),
    };
    site[`${origin}/`] = {
      body: html(
        'Northwind',
        '<h1>Solar</h1><p><a href="/prices">Prices</a> <a href="/bill">Bill</a></p>',
      ),
    };
    const again = await app.inject({
      method: 'POST',
      url: `/v1/knowledge/connections/${started.body.connection.id}/sync?tenantId=${DEMO_TENANT.id}`,
      headers: auth,
      payload: {},
    });
    const second = await waitForJob(
      app,
      DEMO_TENANT.id,
      again.json<KnowledgeSyncResponse>().job.id,
    );
    expect(second.counts).toMatchObject({ deleted: 1, quarantined: 1 });
    expect(second.documents).toBe(2);
    const after = await store.listKnowledgeSources(DEMO_TENANT.id);
    expect(after.map((s) => s.title).sort()).toEqual(['Northwind', 'Prices']);
    expect(after.find((s) => s.title === 'Prices')?.text).toContain('£12,900');
  });

  it("keeps one installer's crawled pages out of another's index", async () => {
    const { app, store } = await harness({ fetcher: fakeSite(pages()) });
    const started = await connect(app, {
      tenantId: DEMO_TENANT.id,
      kind: 'website',
      url: `${origin}/`,
    });
    await waitForJob(app, DEMO_TENANT.id, started.body.job.id);
    expect(await store.listKnowledgeSources(RIVAL.id)).toEqual([]);
    const rivalList = await app.inject({
      method: 'GET',
      url: `/v1/knowledge/connections?tenantId=${RIVAL.id}`,
      headers: auth,
    });
    expect(rivalList.json<{ connections: unknown[] }>().connections).toEqual([]);
    const rivalJob = await app.inject({
      method: 'GET',
      url: `/v1/knowledge/jobs/${started.body.job.id}?tenantId=${RIVAL.id}`,
      headers: auth,
    });
    expect(rivalJob.statusCode).toBe(404);
  });

  it('requires the admin token', async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/connections',
      payload: { tenantId: DEMO_TENANT.id, kind: 'website', url: `${origin}/` },
    });
    expect(response.statusCode).toBe(401);
  });
});

// ─── Drive sync ──────────────────────────────────────────────────────────────

describe('Drive sync', () => {
  it('syncs a folder, skips PDFs with a reason, then follows changes', async () => {
    const drive = new FakeDrive();
    drive.add('doc_warranty', 'Warranty', '# Warranty\n\n25-year workmanship warranty.');
    drive.add(
      'doc_prices',
      'Price list',
      '# Prices\n\n| Package | Price |\n| --- | --- |\n| Family | £13,900 |',
    );
    drive.add('pdf_spec', 'Spec sheet.pdf', '', 'application/pdf');
    const { app, store } = await harness({ drive });

    const started = await connect(app, {
      tenantId: DEMO_TENANT.id,
      kind: 'drive',
      folderId: 'root_folder',
      mode: 'service_account',
    });
    const job = await waitForJob(app, DEMO_TENANT.id, started.body.job.id);
    expect(job).toMatchObject({ status: 'succeeded', kind: 'drive', documents: 2 });
    expect(job.counts).toMatchObject({ seen: 3, skipped: 1 });
    expect(job.issues).toEqual([expect.objectContaining({ code: 'needs-extraction' })]);
    const sources = await store.listKnowledgeSources(DEMO_TENANT.id);
    expect(sources.map((s) => s.url)).toContain(
      'https://drive.google.com/file/d/doc_warranty/view',
    );

    // A change: the price list is edited, the warranty is deleted.
    drive.token = 5;
    drive.add(
      'doc_prices',
      'Price list',
      '# Prices\n\n| Package | Price |\n| --- | --- |\n| Family | £12,900 |',
    );
    drive.pending = [
      { fileId: 'doc_prices', removed: false, file: drive.files.get('doc_prices')!.file },
      { fileId: 'doc_warranty', removed: true },
      {
        fileId: 'unrelated',
        removed: false,
        file: {
          id: 'unrelated',
          name: 'Holiday photos',
          mimeType: 'image/jpeg',
          modifiedTime: '',
          parents: ['someone_else'],
        },
      },
    ];
    drive.reads = [];
    const again = await app.inject({
      method: 'POST',
      url: `/v1/knowledge/connections/${started.body.connection.id}/sync?tenantId=${DEMO_TENANT.id}`,
      headers: auth,
      payload: {},
    });
    const second = await waitForJob(
      app,
      DEMO_TENANT.id,
      again.json<KnowledgeSyncResponse>().job.id,
    );
    expect(second.counts).toMatchObject({ deleted: 1, seen: 1 });
    expect(drive.reads).toEqual(['doc_prices']);
    const after = await store.listKnowledgeSources(DEMO_TENANT.id);
    expect(after.map((s) => s.title)).toEqual(['Price list']);
    expect(after[0]!.text).toContain('£12,900');
  });

  it('reports a Drive connection it cannot make, rather than pretending', async () => {
    const { app } = await harness();
    const started = await connect(app, {
      tenantId: DEMO_TENANT.id,
      kind: 'drive',
      folderId: 'root_folder',
      mode: 'service_account',
    });
    const job = await waitForJob(app, DEMO_TENANT.id, started.body.job.id);
    expect(job.status).toBe('failed');
    const list = await app.inject({
      method: 'GET',
      url: `/v1/knowledge/connections?tenantId=${DEMO_TENANT.id}`,
      headers: auth,
    });
    expect(
      list.json<{ connections: { status: string; lastError: string }[] }>().connections[0],
    ).toMatchObject({
      status: 'failed',
      lastError: 'no drive in this test',
    });
  });

  it('turns a Google Sheet export into a Markdown table', () => {
    expect(csvToMarkdown('Package,Price\nFamily,"£13,900"\n')).toBe(
      '| Package | Price |\n| --- | --- |\n| Family | £13,900 |',
    );
  });

  it('signs a service-account assertion Google can verify', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = serviceAccountAssertion(
      {
        client_email: 'bot-sync@sunny.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      },
      1_760_000_000,
    );
    const [header, claims, signature] = jwt.split('.');
    const verify = createVerify('RSA-SHA256');
    verify.update(`${header}.${claims}`);
    expect(verify.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      exp: 1_760_003_600,
    });
  });
});

// ─── retrieval ───────────────────────────────────────────────────────────────

describe('hybrid retrieval', () => {
  async function seeded(embedder: Embedder | null) {
    const drive = new FakeDrive();
    drive.add(
      'doc_prices',
      'Price list',
      '# Prices\n\nThe Family package is £13,900 including VAT.',
    );
    drive.add(
      'doc_battery',
      'Batteries',
      '# Batteries\n\nWe fit the Tesla Powerwall 3 storage unit.',
    );
    drive.add('doc_safety', 'Safety', '# Safety\n\nIf you smell burning, call XXXXX XXXXXX.');
    const h = await harness({ drive, embedder });
    const started = await connect(h.app, {
      tenantId: DEMO_TENANT.id,
      kind: 'drive',
      folderId: 'root_folder',
      mode: 'service_account',
    });
    await waitForJob(h.app, DEMO_TENANT.id, started.body.job.id);
    const pipeline = createKnowledgePipeline(
      { config: makeConfig(dirs.at(-1)!), store: h.store, now: () => 1_760_000_000_000 },
      {
        syncStore: h.syncStore,
        embedder,
        rerank: null,
        fetcher: fakeSite({}),
        driveClient: () => drive,
      },
    );
    return { ...h, pipeline };
  }

  it('is lexical without a key, and hybrid with one -- finding "cost" in a page that says "price"', async () => {
    const lexical = await seeded(null);
    const plain = await lexical.pipeline.retrieve.retrieveKnowledge(
      DEMO_TENANT.id,
      'how much does it cost',
    );
    expect(plain.mode).toBe('lexical');

    fakeEmbedder.calls = 0;
    const hybrid = await seeded(fakeEmbedder);
    expect(fakeEmbedder.calls).toBeGreaterThan(0);
    const result = await hybrid.pipeline.retrieve.retrieveKnowledge(
      DEMO_TENANT.id,
      'what is the cost in pounds',
    );
    expect(result.mode).toBe('hybrid');
    expect(result.passages[0]?.citation).toMatchObject({
      title: 'Price list',
      kind: 'drive',
      url: 'https://drive.google.com/file/d/doc_prices/view',
    });
  });

  it('masks a placeholder so it can never be quoted', async () => {
    const { pipeline } = await seeded(null);
    const result = await pipeline.retrieve.retrieveKnowledge(
      DEMO_TENANT.id,
      'smell burning safety call',
    );
    const safety = result.passages.find((p) => p.citation.title === 'Safety');
    expect(safety?.hasPlaceholder).toBe(true);
    expect(safety?.text).not.toContain('XXXXX');
    expect(safety?.text).toContain('[not yet provided by the installer]');
  });

  it("answers one installer's question only from that installer's documents", async () => {
    const { pipeline } = await seeded(fakeEmbedder);
    const rival = await pipeline.retrieve.retrieveKnowledge(RIVAL.id, 'Powerwall price');
    expect(rival).toMatchObject({ configured: false, passages: [] });
  });

  it('gives the chat core a passageSearch that knows its tenant only through the server loader', async () => {
    const { pipeline, store } = await seeded(fakeEmbedder);
    const index = await createKnowledgeLoader(store)(DEMO_TENANT.id);
    expect(tenantOfIndex(index)).toBe(DEMO_TENANT.id);
    const hits = await pipeline.retrieve.passageSearch(index, 'battery storage', 3);
    expect(hits[0]?.chunk.title).toBe('Batteries');
    // An index nobody loaded has no tenant: it is searched lexically, never with
    // another tenant's vectors.
    expect(tenantOfIndex({ sourceCount: index.sourceCount, chunks: index.chunks })).toBeNull();
  });
});

describe('vectors on the chat path', () => {
  async function oneDocument() {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-vectors-'));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.putKnowledgeSource({
      id: 'ks_prices',
      tenantId: DEMO_TENANT.id,
      title: 'Price list',
      url: null,
      version: '1',
      text: [
        '# Prices',
        'The Family package is £13,900 including VAT.',
        '# Batteries',
        'We fit the Powerwall 3 storage unit.',
      ].join(String.fromCharCode(10, 10)),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const loader = createKnowledgeLoader(store);
    const index = await loader(DEMO_TENANT.id);
    return { store, loader, index, syncStore: new MemoryKnowledgeSyncStore() };
  }

  function embedAll(
    syncStore: MemoryKnowledgeSyncStore,
    chunks: Awaited<ReturnType<typeof oneDocument>>['index']['chunks'],
  ) {
    return syncStore.putEmbeddings(
      DEMO_TENANT.id,
      fakeEmbedder.model,
      chunks.map((chunk) => ({
        key: embeddingKey(fakeEmbedder.model, chunk),
        vector: vectorise(chunk.text),
      })),
    );
  }

  it("reads an index's vectors once, not on every search", async () => {
    const { store, loader, index, syncStore } = await oneDocument();
    await embedAll(syncStore, index.chunks);
    const reads = vi.spyOn(syncStore, 'getEmbeddings');
    const retrieve = createKnowledgeRetriever({ store, loader, syncStore, embedder: fakeEmbedder });

    await retrieve.passageSearch(index, 'battery storage', 3);
    await retrieve.passageSearch(index, 'what does it cost', 3);

    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('picks up vectors that arrive after the first search, once the refresh interval passes', async () => {
    const { store, loader, index, syncStore } = await oneDocument();
    let clock = 1_000_000;
    const retrieve = createKnowledgeRetriever({
      store,
      loader,
      syncStore,
      embedder: fakeEmbedder,
      now: () => clock,
    });
    expect((await retrieve.retrieveKnowledge(DEMO_TENANT.id, 'cost')).mode).toBe('lexical');

    // The sync embeds after the document lands, so a turn can arrive first.
    await embedAll(syncStore, index.chunks);
    const reads = vi.spyOn(syncStore, 'getEmbeddings');
    expect((await retrieve.retrieveKnowledge(DEMO_TENANT.id, 'cost')).mode).toBe('lexical');
    expect(reads).not.toHaveBeenCalled();

    clock += EMBEDDING_REFRESH_MS;
    expect((await retrieve.retrieveKnowledge(DEMO_TENANT.id, 'cost')).mode).toBe('hybrid');
  });
});

// ─── uploads and scheduling ──────────────────────────────────────────────────

describe('upload checks', () => {
  it("refuses an uploaded customer bill, and flags an uploaded template's placeholders", async () => {
    const { app, store } = await harness();
    const bill = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/sources',
      headers: auth,
      payload: {
        tenantId: DEMO_TENANT.id,
        title: 'scan.txt',
        version: '1',
        text: 'Customer name: Jane Example\n14 Acacia Avenue LS1 4AB\nAccount number 12345678 sort code 20-00-00\nAmount due £143 by Direct Debit\njane@gmail.com',
      },
    });
    const refused = bill.json<KnowledgeSourceResponse>();
    expect(refused.source).toBeNull();
    expect(refused.job.issues[0]?.code).toBe('quarantined-pii');
    expect(await store.listKnowledgeSources(DEMO_TENANT.id)).toEqual([]);

    const template = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/sources',
      headers: auth,
      payload: {
        tenantId: DEMO_TENANT.id,
        title: 'FAQ',
        version: '1',
        text: '# Contact\n\nCall us on XXXXX XXXXXX or visit [insert support link].',
      },
    });
    const accepted = template.json<KnowledgeSourceResponse>();
    expect(accepted.source?.warnings?.map((w) => w.text)).toEqual([
      'XXXXX XXXXXX',
      '[insert support link]',
    ]);
    expect(accepted.job.issues.map((i) => i.code)).toContain('placeholder');
  });
});

describe('scheduling', () => {
  it('runs a website weekly and a Drive folder every fifteen minutes', async () => {
    let clock = 1_760_000_000_000;
    const drive = new FakeDrive();
    drive.add('doc_a', 'A', '# A\n\nAlpha.');
    const dir = await mkdtemp(join(tmpdir(), 'sunny-sched-'));
    dirs.push(dir);
    const store = new FileStore(dir);
    const pipeline = createKnowledgePipeline(
      { config: makeConfig(dir), store, now: () => clock },
      {
        syncStore: new MemoryKnowledgeSyncStore(),
        fetcher: fakeSite({ 'https://n.test/': { body: html('N', '<h1>N</h1><p>Hello.</p>') } }),
        driveClient: () => drive,
        embedder: null,
        rerank: null,
      },
    );
    await (
      await pipeline.sync.connect({
        tenantId: DEMO_TENANT.id,
        kind: 'website',
        url: 'https://n.test/',
      })
    ).done;
    await (
      await pipeline.sync.connect({
        tenantId: DEMO_TENANT.id,
        kind: 'drive',
        folderId: 'root_folder',
        mode: 'service_account',
      })
    ).done;

    clock += 10 * 60 * 1000;
    expect(await pipeline.sync.runDue()).toHaveLength(0);
    clock += 10 * 60 * 1000;
    expect((await pipeline.sync.runDue()).map((j) => j.kind)).toEqual(['drive']);
    clock += 7 * 24 * 60 * 60 * 1000;
    expect((await pipeline.sync.runDue()).map((j) => j.kind).sort()).toEqual(['drive', 'website']);
  });
});
