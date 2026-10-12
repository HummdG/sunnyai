import { join } from 'node:path';

import { ApiError, startSunScanRequestSchema, type SunScanAssessment } from '@sunny/contracts';
import {
  createSunScanEngine,
  createSunScanService,
  FileArtefactStore,
  type ArtefactStore,
  type AssessmentRecord,
  type SunScanService,
} from '@sunny/sunscan-adapter';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { verifySessionToken } from '../sessions.js';
import type { Store } from '../store.js';

/**
 * SunScan roof assessments (the vendored SunScanV2 engine, see
 * docs/integration/sunscan-contract.md).
 *
 *   POST /v1/sunscan/assessments                 start one for an address
 *   GET  /v1/sunscan/assessments/:id             status + roof summary
 *   GET  /v1/sunscan/assessments/:id/model.glb   the 3D model (binary glTF)
 *   GET  /v1/sunscan/assessments/:id/spec.json   the model description the viewer rebuilds from
 *
 * Visitor routes: the widget session token is the credential. A session reaches
 * only the assessments started in that same session -- an address is personal
 * data, and another visitor of the same installer has no business with it. The
 * tenant comes from the token, never from the request body, and an id that is
 * not the caller's is `not_found`, indistinguishable from one that does not
 * exist. (The installer's view of assessments belongs in the portal, behind its
 * own sign-in, not on this visitor surface.)
 */

export interface SunScanRouteDeps {
  service: SunScanService | null;
  sessionSecret: string;
  now: () => number;
}

/** Visitors can start this many assessments per session per window. */
const SESSION_LIMIT = { max: 5, windowMs: 10 * 60_000 } as const;

/**
 * The service a server runs: the vendored engine, records in the Store, model
 * files on disk. `SUNSCAN_ENABLED=0` switches it off; `SUNSCAN_HTTP_MODE`
 * (live | record | replay) chooses how the engine reaches its open-data
 * providers -- replay serves the recorded fixtures with no network.
 */
export function createDefaultSunScan(
  store: Store,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): SunScanService | null {
  if (env['SUNSCAN_ENABLED'] === '0') return null;
  const mode = env['SUNSCAN_HTTP_MODE'];
  const artefacts: ArtefactStore = new FileArtefactStore(
    env['SUNSCAN_ARTEFACT_DIR'] ?? join(dataDir, 'sunscan-artefacts'),
  );
  return createSunScanService({
    engine: createSunScanEngine({
      ...(mode === 'live' || mode === 'record' || mode === 'replay' ? { httpMode: mode } : {}),
      ...(env['SUNSCAN_USER_AGENT'] ? { userAgent: env['SUNSCAN_USER_AGENT'] } : {}),
    }),
    repository: {
      save: (record) => store.saveSunScanAssessment(record),
      get: (tenantId, id) => store.getSunScanAssessment(tenantId, id),
    },
    artefacts,
  });
}

/** The public shape of an assessment: no tenant id, no target, no raw spec. */
export function toPublicAssessment(record: AssessmentRecord): SunScanAssessment {
  const base = `/v1/sunscan/assessments/${encodeURIComponent(record.id)}`;
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    summary: record.summary,
    error: record.error,
    modelUrl: record.artefacts.includes('model.glb') ? `${base}/model.glb` : null,
    specUrl: record.artefacts.includes('spec.json') ? `${base}/spec.json` : null,
  };
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}

interface Caller {
  tenantId: string;
  sessionId: string;
}

export function registerSunScanRoutes(app: FastifyInstance, deps: SunScanRouteDeps): void {
  const starts = new Map<string, number[]>();

  function caller(request: FastifyRequest): Caller {
    const claims = verifySessionToken(bearer(request), deps.sessionSecret, deps.now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');
    return { tenantId: claims.tenantId, sessionId: claims.sessionId };
  }

  function service(): SunScanService {
    if (!deps.service) {
      throw new ApiError('not_enabled', 'Roof assessments are switched off on this deployment.');
    }
    return deps.service;
  }

  /** The caller's own assessment, or not_found. */
  async function owned(who: Caller, id: string): Promise<AssessmentRecord> {
    const record = await service().getAssessment(who.tenantId, id);
    if (!record || record.sessionId !== who.sessionId) {
      throw new ApiError('not_found', 'No such assessment.');
    }
    return record;
  }

  app.post('/v1/sunscan/assessments', async (request, reply) => {
    const who = caller(request);
    const svc = service();
    const body = startSunScanRequestSchema.safeParse(request.body);
    if (!body.success)
      throw new ApiError('bad_request', body.error.issues[0]?.message ?? 'Invalid request.');
    const now = deps.now();
    const key = `${who.tenantId}\u0000${who.sessionId}`;
    const recent = (starts.get(key) ?? []).filter((t) => now - t < SESSION_LIMIT.windowMs);
    if (recent.length >= SESSION_LIMIT.max) {
      throw new ApiError(
        'rate_limited',
        'Too many roof assessments from this session; try again later.',
      );
    }
    starts.set(key, [...recent, now]);
    const record = await svc.startAssessment(
      who.tenantId,
      {
        ...(body.data.address !== undefined ? { address: body.data.address } : {}),
        ...(body.data.postcode !== undefined ? { postcode: body.data.postcode } : {}),
        ...(body.data.lat !== undefined ? { lat: body.data.lat } : {}),
        ...(body.data.lon !== undefined ? { lon: body.data.lon } : {}),
      },
      { sessionId: who.sessionId },
    );
    void reply.code(202);
    return toPublicAssessment(record);
  });

  app.get('/v1/sunscan/assessments/:id', async (request) => {
    const { id } = request.params as { id: string };
    return toPublicAssessment(await owned(caller(request), id));
  });

  for (const [name, type] of [
    ['model.glb', 'model/gltf-binary'],
    ['spec.json', 'application/json; charset=utf-8'],
  ] as const) {
    app.get(`/v1/sunscan/assessments/:id/${name}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const who = caller(request);
      await owned(who, id);
      const bytes = await service().getArtefact(who.tenantId, id, name);
      if (!bytes) throw new ApiError('not_found', 'The model is not ready.');
      void reply.header('content-type', type).header('cache-control', 'private, max-age=3600');
      return reply.send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    });
  }
}
