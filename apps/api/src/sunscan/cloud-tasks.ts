import type { AssessmentDispatcher } from '@sunny/sunscan-adapter';

import type { TokenProvider } from '../google/auth.js';

/**
 * Runs SunScan assessments through Cloud Tasks instead of in the request
 * process: the API creates an HTTP task that calls back into
 * `POST /internal/sunscan/run` with the job's keys, signed with an OIDC token
 * for `serviceAccountEmail` so the route can tell the queue from anyone else.
 * Cloud Tasks retries a failed run with backoff; the run is idempotent.
 *
 * The task is named after the assessment, so a duplicate enqueue (a client
 * retry) is rejected by Cloud Tasks itself and treated here as success.
 */
export interface CloudTasksOptions {
  project: string;
  location: string;
  queue: string;
  /** The API's public base URL; the task calls `<targetUrl>/internal/sunscan/run`. */
  targetUrl: string;
  /** The service account Cloud Tasks signs the OIDC token as (the invoker). */
  serviceAccountEmail: string;
  /** `aud` of the OIDC token; defaults to the target URL. */
  audience?: string;
  endpoint?: string;
  token: TokenProvider | null;
  fetch?: typeof fetch;
}

export const RUN_PATH = '/internal/sunscan/run';

export function cloudTasksDispatcher(options: CloudTasksOptions): AssessmentDispatcher {
  const endpoint = (options.endpoint ?? 'https://cloudtasks.googleapis.com').replace(/\/+$/, '');
  const parent = `projects/${options.project}/locations/${options.location}/queues/${options.queue}`;
  const target = `${options.targetUrl.replace(/\/+$/, '')}${RUN_PATH}`;
  const fetchImpl = options.fetch ?? fetch;

  return async (job) => {
    const body = {
      task: {
        // Deduplication: one task per assessment.
        name: `${parent}/tasks/${job.tenantId.replace(/[^A-Za-z0-9_-]/g, '_')}-${job.assessmentId.replace(/[^A-Za-z0-9_-]/g, '_')}`,
        httpRequest: {
          httpMethod: 'POST',
          url: target,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify(job)).toString('base64'),
          oidcToken: {
            serviceAccountEmail: options.serviceAccountEmail,
            audience: options.audience ?? options.targetUrl,
          },
        },
      },
    };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.token) headers['authorization'] = `Bearer ${await options.token()}`;
    const response = await fetchImpl(`${endpoint}/v2/${parent}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    // 409: a task with this name already exists -- the job is already queued.
    if (response.ok || response.status === 409) return;
    const text = await response.text().catch(() => '');
    throw new Error(`Cloud Tasks refused the job (${response.status}) ${text.slice(0, 200)}`);
  };
}
