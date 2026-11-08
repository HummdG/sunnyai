import type { KnowledgeChunk, Rerank } from '@sunny/knowledge';

/**
 * Embeddings and reranking: the semantic half of hybrid retrieval (Blueprint §3.3).
 *
 * Both are network services and both are optional. Without a Gemini key the
 * pipeline is lexical-only and says so in the capability report; without the
 * ranking API the fused order stands. Nothing here ever fails a visitor's turn:
 * a timeout or an error returns "no vectors" and BM25 answers alone.
 */

export interface Embedder {
  readonly model: string;
  /** Embeddings for passages, in order. */
  embedDocuments(texts: readonly { title: string; text: string }[]): Promise<number[][]>;
  /** One embedding for a visitor's question. */
  embedQuery(text: string): Promise<number[]>;
}

export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
/** Stored dimensionality: a quarter of the default, plenty for passage search. */
export const EMBEDDING_DIMENSIONS = 768;
const BATCH = 100;

/**
 * Gemini embeddings over the Generative Language REST API, keyed by
 * `GEMINI_API_KEY` -- the same key that powers chat, so no second credential.
 */
export class GeminiEmbedder implements Embedder {
  readonly model: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;

  constructor(options: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.#apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
  }

  #url(method: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:${method}`;
  }

  async #post(method: string, body: unknown): Promise<unknown> {
    const response = await fetch(this.#url(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.#apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gemini ${method} failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return response.json();
  }

  async embedDocuments(texts: readonly { title: string; text: string }[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const json = (await this.#post('batchEmbedContents', {
        requests: batch.map((t) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text: t.text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          title: t.title.slice(0, 200),
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      })) as { embeddings?: { values: number[] }[] };
      const embeddings = json.embeddings ?? [];
      if (embeddings.length !== batch.length)
        throw new Error('Gemini returned the wrong number of embeddings');
      out.push(...embeddings.map((e) => e.values));
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const json = (await this.#post('embedContent', {
      model: `models/${this.model}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: EMBEDDING_DIMENSIONS,
    })) as { embedding?: { values: number[] } };
    if (!json.embedding) throw new Error('Gemini returned no embedding');
    return json.embedding.values;
  }
}

/**
 * Gemini embeddings on Vertex AI, as the deployment's own service account.
 *
 * Production reaches the model through Vertex with no API key, and the embedder
 * above needs one, so until this existed every deployed installer had keyword
 * search only: "head of IT" never found "IT Supervisor", "md" never found
 * "managing director". This is the same model and the same vectors, called the
 * way chat is called, so it needs no key and bills the project.
 *
 * Vertex takes one text per request for this model, so documents go a few at
 * a time, and a busy answer (429) is retried after a pause rather than
 * failing the whole sync's batch.
 */
export class VertexEmbedder implements Embedder {
  readonly model: string;
  readonly #url: string;
  readonly #token: () => Promise<string>;
  readonly #timeoutMs: number;
  readonly #concurrency: number;
  readonly #fetch: typeof fetch;

  constructor(options: {
    project: string;
    location: string;
    token: () => Promise<string>;
    model?: string;
    timeoutMs?: number;
    concurrency?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    const host =
      options.location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${options.location}-aiplatform.googleapis.com`;
    this.#url = `https://${host}/v1/projects/${encodeURIComponent(options.project)}/locations/${encodeURIComponent(options.location)}/publishers/google/models/${encodeURIComponent(this.model)}:predict`;
    this.#token = options.token;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#concurrency = options.concurrency ?? 5;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async #embed(instance: Record<string, string>, timeoutMs: number): Promise<number[]> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await this.#token()}`,
        },
        body: JSON.stringify({
          instances: [instance],
          parameters: { outputDimensionality: EMBEDDING_DIMENSIONS, autoTruncate: true },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // A visitor's query is not retried: a turn falls back to keywords instead.
      if (response.status === 429 && attempt < 4 && instance['task_type'] !== 'RETRIEVAL_QUERY') {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Vertex embedding failed (${response.status}): ${text.slice(0, 200)}`);
      }
      const json = (await response.json()) as {
        predictions?: { embeddings?: { values?: number[] } }[];
      };
      const values = json.predictions?.[0]?.embeddings?.values;
      if (!values?.length) throw new Error('Vertex returned no embedding');
      return values;
    }
  }

  async embedDocuments(texts: readonly { title: string; text: string }[]): Promise<number[][]> {
    const out: number[][] = new Array<number[]>(texts.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < texts.length; i = next++) {
        out[i] = await this.#embed(
          {
            content: texts[i]!.text,
            task_type: 'RETRIEVAL_DOCUMENT',
            title: texts[i]!.title.slice(0, 200),
          },
          this.#timeoutMs,
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.#concurrency, texts.length) }, worker));
    return out;
  }

  embedQuery(text: string): Promise<number[]> {
    // Short: this runs before a visitor's answer, and keywords are the fallback.
    return this.#embed({ content: text, task_type: 'RETRIEVAL_QUERY' }, 3_000);
  }
}

/**
 * Vertex AI Ranking API (Discovery Engine `rank`), behind `SUNNY_RERANK=vertex`
 * and `GOOGLE_CLOUD_PROJECT`. On Cloud Run the access token comes from the
 * metadata server, so no key is stored. Not exercised against the real service
 * in this build (no project credentials); off unless configured.
 */
export function vertexReranker(options: {
  project: string;
  token: () => Promise<string>;
  model?: string;
  timeoutMs?: number;
}): Rerank {
  const model = options.model ?? 'semantic-ranker-default@latest';
  return async (
    query: string,
    candidates: readonly KnowledgeChunk[],
  ): Promise<readonly string[]> => {
    const response = await fetch(
      `https://discoveryengine.googleapis.com/v1/projects/${encodeURIComponent(options.project)}/locations/global/rankingConfigs/default_ranking_config:rank`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await options.token()}`,
        },
        body: JSON.stringify({
          model,
          query,
          topN: candidates.length,
          records: candidates.map((c) => ({
            id: c.id,
            title: [c.title, c.heading].filter(Boolean).join(' — ').slice(0, 300),
            content: c.text.slice(0, 2000),
          })),
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      },
    );
    if (!response.ok) throw new Error(`Ranking API failed (${response.status})`);
    const json = (await response.json()) as { records?: { id: string }[] };
    return (json.records ?? []).map((r) => r.id);
  };
}

/** An access token from the Cloud Run / GCE metadata server. */
export function metadataToken(): () => Promise<string> {
  let current: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (current && current.expiresAt > Date.now() + 60_000) return current.token;
    const response = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3_000) },
    );
    const json = (await response.json()) as { access_token: string; expires_in: number };
    current = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return current.token;
  };
}
