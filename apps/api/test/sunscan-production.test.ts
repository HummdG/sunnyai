import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createSunScanService,
  MemoryArtefactStore,
  MemoryAssessmentRepository,
  type AssessmentJob,
  type EngineOutcome,
  type SunScanEngine,
} from '@sunny/sunscan-adapter';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createOidcVerifier } from '../src/google/auth.js';
import { registerSunScanRoutes } from '../src/routes/sunscan.js';
import { cloudTasksDispatcher, RUN_PATH } from '../src/sunscan/cloud-tasks.js';
import { GcsArtefactStore } from '../src/sunscan/gcs-artefacts.js';

/** A tiny local HTTP server for one test: the handler sees the method, URL, headers and body. */
interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}
const servers: Server[] = [];
async function fakeServer(
  handler: (req: Recorded, res: ServerResponse) => void,
): Promise<{ url: string; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const recorded = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A fake GCS: objects in memory, the JSON API's media upload and alt=media read. */
async function fakeGcs() {
  const objects = new Map<string, Buffer>();
  const server = await fakeServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const upload = /^\/upload\/storage\/v1\/b\/([^/]+)\/o$/.exec(url.pathname);
    const read = /^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
    if (req.method === 'POST' && upload && url.searchParams.get('uploadType') === 'media') {
      objects.set(`${decodeURIComponent(upload[1]!)}/${url.searchParams.get('name')}`, req.body);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (req.method === 'GET' && read && url.searchParams.get('alt') === 'media') {
      const key = `${decodeURIComponent(read[1]!)}/${decodeURIComponent(read[2]!)}`;
      const bytes = objects.get(key);
      if (!bytes) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(bytes);
      return;
    }
    res.writeHead(400).end();
  });
  return { ...server, objects };
}

describe('Cloud Storage artefact store', () => {
  it('round-trips model files in the private bucket, keyed by tenant and assessment', async () => {
    const gcs = await fakeGcs();
    const store = new GcsArtefactStore({
      bucket: 'sunny-artefacts',
      endpoint: gcs.url,
      token: () => Promise.resolve('test-token'),
    });
    await store.put('t_a', 'ss_1', 'model.glb', new Uint8Array([1, 2, 3]));
    expect(await store.get('t_a', 'ss_1', 'model.glb')).toEqual(new Uint8Array([1, 2, 3]));
    expect([...gcs.objects.keys()]).toEqual(['sunny-artefacts/sunscan/t_a/ss_1/model.glb']);
    // Authenticated as the runtime identity, with the file's content type.
    expect(gcs.requests[0]!.headers.authorization).toBe('Bearer test-token');
    expect(gcs.requests[0]!.headers['content-type']).toBe('model/gltf-binary');
  });

  it('never reaches another tenant’s objects, even through a crafted id', async () => {
    const gcs = await fakeGcs();
    const store = new GcsArtefactStore({ bucket: 'b', endpoint: gcs.url, token: null });
    await store.put('t_a', 'ss_1', 'model.glb', new Uint8Array([9]));
    expect(await store.get('t_b', 'ss_1', 'model.glb')).toBeNull();
    expect(await store.get('t_b', '../t_a/ss_1', 'model.glb')).toBeNull();
    // A slash in an id is text in the object name, not a path step.
    expect(store.objectName('t_b', '../t_a/ss_1', 'model.glb')).toBe(
      'sunscan/t_b/..%2Ft_a%2Fss_1/model.glb',
    );
  });

  it('reports a missing object as null and a failing bucket as an error', async () => {
    const gcs = await fakeGcs();
    const store = new GcsArtefactStore({ bucket: 'b', endpoint: gcs.url, token: null });
    expect(await store.get('t', 'nope', 'spec.json')).toBeNull();
    const broken = await fakeServer((_req, res) => res.writeHead(503).end());
    const failing = new GcsArtefactStore({ bucket: 'b', endpoint: broken.url, token: null });
    await expect(failing.get('t', 'x', 'spec.json')).rejects.toThrow(/503/);
    await expect(failing.put('t', 'x', 'spec.json', new Uint8Array([1]))).rejects.toThrow(/503/);
  });
});

describe('Cloud Tasks dispatcher', () => {
  const options = {
    project: 'sunny-prod',
    location: 'europe-west2',
    queue: 'sunscan',
    targetUrl: 'https://api.sunny.example',
    serviceAccountEmail: 'tasks-invoker@sunny-prod.iam.gserviceaccount.com',
  };

  it('creates one named HTTP task per assessment, signed for the worker route', async () => {
    const api = await fakeServer((_req, res) => res.writeHead(200).end('{}'));
    const dispatch = cloudTasksDispatcher({
      ...options,
      endpoint: api.url,
      token: () => Promise.resolve('ct-token'),
    });
    await dispatch({ tenantId: 't_demo0001', assessmentId: 'ss_abc' });
    const req = api.requests[0]!;
    expect(req.url).toBe('/v2/projects/sunny-prod/locations/europe-west2/queues/sunscan/tasks');
    expect(req.headers.authorization).toBe('Bearer ct-token');
    const { task } = JSON.parse(req.body.toString()) as {
      task: {
        name: string;
        httpRequest: {
          url: string;
          body: string;
          oidcToken: { serviceAccountEmail: string; audience: string };
        };
      };
    };
    expect(task.name).toMatch(/\/tasks\/t_demo0001-ss_abc$/);
    expect(task.httpRequest.url).toBe(`https://api.sunny.example${RUN_PATH}`);
    expect(task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: options.serviceAccountEmail,
      audience: 'https://api.sunny.example',
    });
    expect(JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString())).toEqual({
      tenantId: 't_demo0001',
      assessmentId: 'ss_abc',
    });
  });

  it('treats an already-queued task as queued, and a refusal as an error', async () => {
    const dup = await fakeServer((_req, res) => res.writeHead(409).end());
    await expect(
      cloudTasksDispatcher({ ...options, endpoint: dup.url, token: null })({
        tenantId: 't',
        assessmentId: 'a',
      }),
    ).resolves.toBeUndefined();
    const down = await fakeServer((_req, res) => res.writeHead(500).end('boom'));
    await expect(
      cloudTasksDispatcher({ ...options, endpoint: down.url, token: null })({
        tenantId: 't',
        assessmentId: 'a',
      }),
    ).rejects.toThrow(/500/);
  });
});

// ── the service and the worker route ────────────────────────────────────────

const OUTCOME: EngineOutcome = {
  summary: {
    address: 'Test House',
    postcode: 'L18 9TN',
    builtForm: 'mid-terrace',
    era: '1930s',
    storeys: 2,
    roofType: 'gabled',
    eaveHeightM: 5,
    roofPlanes: [],
    suitableRoofAreaM2: 0,
    usableRoofAreaM2: 0,
    estimatedMaxPanels: 0,
    mainPlaneId: null,
    obstructions: { chimneys: 0 },
    shadingFlags: ['shading-not-assessed'],
    bestFacing: null,
    confidence: { geocode: 'high', footprint: 'high', heights: 'measured', roof: 'high' },
    reliable: true,
    flags: [],
    notes: [],
    sources: [],
    label: 'Indicative — subject to an on-site survey',
  },
  specJson: '{}',
  glb: new Uint8Array([103, 108, 84, 70]),
};

function countingEngine() {
  const engine = {
    runs: 0,
    version: 'fake/1',
    assess() {
      engine.runs++;
      return Promise.resolve(OUTCOME);
    },
  };
  return engine satisfies SunScanEngine & { runs: number };
}

describe('the service with an external queue', () => {
  it('hands the job to the queue instead of running it, then runs it once when called back', async () => {
    const engine = countingEngine();
    const jobs: AssessmentJob[] = [];
    const service = createSunScanService({
      engine,
      repository: new MemoryAssessmentRepository(),
      artefacts: new MemoryArtefactStore(),
      dispatch: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    });
    const record = await service.startAssessment('t_a', { address: 'Test House' });
    await service.idle();
    expect(record.status).toBe('queued');
    expect(engine.runs).toBe(0);
    expect(jobs).toEqual([{ tenantId: 't_a', assessmentId: record.id }]);

    const done = await service.runAssessment('t_a', record.id);
    expect(done?.status).toBe('succeeded');
    expect(await service.getArtefact('t_a', record.id, 'model.glb')).toEqual(OUTCOME.glb);
    // A queue retry of a finished job is a no-op.
    await service.runAssessment('t_a', record.id);
    expect(engine.runs).toBe(1);
    // The worker route cannot run another tenant's job by naming it.
    expect(await service.runAssessment('t_b', record.id)).toBeNull();
  });

  it('records a job the queue refused as failed instead of leaving it queued forever', async () => {
    const service = createSunScanService({
      engine: countingEngine(),
      repository: new MemoryAssessmentRepository(),
      artefacts: new MemoryArtefactStore(),
      dispatch: () => Promise.reject(new Error('queue unavailable')),
    });
    const record = await service.startAssessment('t_a', { address: 'Test House' });
    expect(record.status).toBe('failed');
    expect(record.error?.code).toBe('provider-unavailable');
  });

  it('leaves a run in progress alone, and takes over one that went stale', async () => {
    let clock = Date.parse('2026-10-13T12:00:00Z');
    const repository = new MemoryAssessmentRepository();
    const engine = countingEngine();
    const service = createSunScanService({
      engine,
      repository,
      artefacts: new MemoryArtefactStore(),
      dispatch: () => Promise.resolve(),
      now: () => new Date(clock),
      staleAfterMs: 60_000,
    });
    const record = await service.startAssessment('t_a', { address: 'Test House' });
    await repository.save({
      ...record,
      status: 'running',
      updatedAt: new Date(clock).toISOString(),
    });
    expect((await service.runAssessment('t_a', record.id))?.status).toBe('running');
    expect(engine.runs).toBe(0);
    clock += 120_000; // the worker that was running it died
    expect((await service.runAssessment('t_a', record.id))?.status).toBe('succeeded');
    expect(engine.runs).toBe(1);
  });
});

/** A Google-style OIDC setup: an RSA key served as a JWKS, and tokens signed with it. */
async function oidc() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwks = await fakeServer((_req, res) =>
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] })),
  );
  const sign = (claims: Record<string, unknown>, key: KeyObject = privateKey) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString(
      'base64url',
    );
    const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${h}.${c}`);
    return `${h}.${c}.${signer.sign(key).toString('base64url')}`;
  };
  return { jwksUrl: jwks.url, sign };
}

const AUDIENCE = 'https://api.sunny.example';
const INVOKER = 'tasks-invoker@sunny-prod.iam.gserviceaccount.com';
const nowSeconds = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({
  iss: 'https://accounts.google.com',
  aud: AUDIENCE,
  email: INVOKER,
  email_verified: true,
  exp: nowSeconds() + 600,
  iat: nowSeconds(),
});

describe('OIDC verification of queue callbacks', () => {
  it('accepts only Google-signed tokens for our audience, from our service account, unexpired', async () => {
    const { jwksUrl, sign } = await oidc();
    const verify = createOidcVerifier({ audience: AUDIENCE, email: INVOKER, jwksUrl });
    expect(await verify(sign(goodClaims()))).toBe(true);
    expect(await verify(sign({ ...goodClaims(), aud: 'https://evil.example' }))).toBe(false);
    expect(
      await verify(sign({ ...goodClaims(), email: 'someone@else.iam.gserviceaccount.com' })),
    ).toBe(false);
    expect(await verify(sign({ ...goodClaims(), email_verified: false }))).toBe(false);
    expect(await verify(sign({ ...goodClaims(), exp: nowSeconds() - 5 }))).toBe(false);
    expect(await verify(sign({ ...goodClaims(), iss: 'https://evil.example' }))).toBe(false);
    const { privateKey: stranger } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(await verify(sign(goodClaims(), stranger))).toBe(false);
    expect(await verify('not.a.token')).toBe(false);
  });
});

describe('the worker route', () => {
  async function worker(taskVerifier: ((token: string) => Promise<boolean>) | null) {
    const engine = countingEngine();
    const service = createSunScanService({
      engine,
      repository: new MemoryAssessmentRepository(),
      artefacts: new MemoryArtefactStore(),
      dispatch: () => Promise.resolve(),
    });
    const app = Fastify();
    app.setErrorHandler((error, _req, reply) => {
      const code = (error as { code?: string }).code;
      const status =
        code === 'unauthorized'
          ? 401
          : code === 'not_found'
            ? 404
            : code === 'bad_request'
              ? 400
              : 500;
      void reply.code(status).send({ error: { code } });
    });
    registerSunScanRoutes(app, {
      service,
      sessionSecret: 's',
      now: () => Date.now(),
      taskVerifier,
    });
    await app.ready();
    return { app, service, engine };
  }

  it('runs the queued assessment for a valid queue token', async () => {
    const { jwksUrl, sign } = await oidc();
    const { app, service, engine } = await worker(
      createOidcVerifier({ audience: AUDIENCE, email: INVOKER, jwksUrl }),
    );
    const record = await service.startAssessment('t_a', { address: 'Test House' });
    const res = await app.inject({
      method: 'POST',
      url: RUN_PATH,
      headers: { authorization: `Bearer ${sign(goodClaims())}` },
      payload: { tenantId: 't_a', assessmentId: record.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: record.id, status: 'succeeded' });
    expect(engine.runs).toBe(1);
    await app.close();
  });

  it('refuses callers without the queue’s token, and does not exist without a queue', async () => {
    const { jwksUrl, sign } = await oidc();
    const { app } = await worker(
      createOidcVerifier({ audience: AUDIENCE, email: INVOKER, jwksUrl }),
    );
    const payload = { tenantId: 't_a', assessmentId: 'ss_x' };
    expect((await app.inject({ method: 'POST', url: RUN_PATH, payload })).statusCode).toBe(401);
    const forged = sign({ ...goodClaims(), aud: 'https://other.example' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: RUN_PATH,
          headers: { authorization: `Bearer ${forged}` },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    await app.close();

    const { app: inProcess } = await worker(null);
    expect((await inProcess.inject({ method: 'POST', url: RUN_PATH, payload })).statusCode).toBe(
      404,
    );
    await inProcess.close();
  });
});
