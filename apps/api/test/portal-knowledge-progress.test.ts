import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IngestionJob } from '@sunny/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

/**
 * The knowledge page's sync state comes from the job, not only from the
 * tenant record: a running sync reports how far it has got, and a finished or
 * failed one stops saying "syncing".
 */

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-knowledge-progress';
const JOB_ID = 'job_progress_1';

function config(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-knowledge-progress',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: { enabled: false, trustProxyHops: 0, rules: {}, maxKeys: 1000 },
  } as unknown as ServerConfig;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}` });

function job(tenantId: string, over: Partial<IngestionJob>): IngestionJob {
  return {
    id: JOB_ID,
    tenantId,
    sourceId: null,
    status: 'running',
    documents: 0,
    chunks: 0,
    issues: [],
    startedAt: new Date(NOW).toISOString(),
    finishedAt: '',
    kind: 'website',
    connectionId: 'kc_1',
    ...over,
  };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-knowledge-progress-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: config(),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    knowledgeSync: { syncWebsite: () => Promise.resolve({ jobId: JOB_ID }) },
  });
  await app.ready();
  const signup = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as('owner@k.test'),
    payload: { companyName: 'Brightside Solar' },
  });
  const tenantId = signup.json<{ tenant: { id: string } }>().tenant.id;
  const connect = await app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/knowledge/website`,
    headers: as('owner@k.test'),
    payload: { url: 'https://brightside.test' },
  });
  expect(connect.statusCode).toBe(200);
  return { app, store, tenantId };
}

type Website = {
  status: string;
  error: string | null;
  progress: { phase: string; done: number; total: number | null } | null;
};

async function website(app: Awaited<ReturnType<typeof setup>>['app'], tenantId: string) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/portal/tenants/${tenantId}/knowledge`,
    headers: as('owner@k.test'),
  });
  return response.json<{ website: Website }>().website;
}

describe('knowledge sync progress in the portal', () => {
  it('reports how far a running sync has got', async () => {
    const { app, store, tenantId } = await setup();
    await store.saveIngestionJob(job(tenantId, { status: 'queued' }));
    expect((await website(app, tenantId)).progress).toEqual({
      phase: 'reading',
      done: 0,
      total: null,
    });

    await store.saveIngestionJob(
      job(tenantId, { progress: { phase: 'indexing', done: 42, total: 120 } }),
    );
    const running = await website(app, tenantId);
    expect(running.status).toBe('syncing');
    expect(running.progress).toEqual({ phase: 'indexing', done: 42, total: 120 });
  });

  it('stops saying "syncing" once the job has finished or failed', async () => {
    const { app, store, tenantId } = await setup();
    await store.saveIngestionJob(
      job(tenantId, { status: 'succeeded', finishedAt: new Date(NOW + 60_000).toISOString() }),
    );
    const done = await website(app, tenantId);
    expect(done.status).toBe('connected');
    expect(done.progress).toBeNull();

    await store.saveIngestionJob(
      job(tenantId, {
        status: 'failed',
        finishedAt: new Date(NOW + 90_000).toISOString(),
        issues: [
          {
            code: 'fetch-failed',
            severity: 'error',
            message: 'The sync failed.',
            detail: 'No readable pages were found on the site.',
          },
        ] as IngestionJob['issues'],
      }),
    );
    const failed = await website(app, tenantId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('No readable pages were found on the site.');
  });
});
