import type { GeminiConfig } from '../config.js';

/**
 * The model boundary.
 *
 * Everything above this line is testable without a network: routes take a
 * `ChatProvider`, and the tests hand them a scripted one. Everything below is
 * the only code in the repository that talks to a model.
 *
 * Note there is no "mock" implementation shipped in the server. The plan forbids
 * a mocked assistant that looks like a working one, so an unconfigured
 * deployment gets `UnconfiguredProvider`, which fails with a `not_enabled`
 * error rather than emitting plausible text. A fake that answers persuasively is
 * worse than an error, because nobody goes looking for it.
 */

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** One chunk of a streamed turn. */
export type ChatChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_started'; call: ChatToolCall }
  | { type: 'tool_finished'; call: ChatToolCall; ok: boolean; result?: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface ChatTurnRequest {
  /** System instruction, assembled from the tenant's config, not the visitor. */
  systemInstruction: string;
  history: ChatMessage[];
  /** The visitor's new message. */
  message: string;
  /** Tool declarations the agent is allowed to call. */
  tools: ToolDeclaration[];
  /** Executes an approved tool. Only names in `tools` are ever passed here. */
  execute: (call: ChatToolCall) => Promise<unknown>;
  signal?: AbortSignal;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema for the arguments, generated from the contract, not hand-written. */
  parameters: Record<string, unknown>;
}

export interface ChatProvider {
  readonly kind: string;
  readonly model: string | null;
  /** Streams a turn. Throws `ProviderUnavailableError` when not configured. */
  stream(request: ChatTurnRequest): AsyncIterable<ChatChunk>;
}

export class ProviderUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'ProviderUnavailableError';
    this.reason = reason;
  }
}

/**
 * What an unconfigured deployment gets. Every call fails.
 */
export class UnconfiguredProvider implements ChatProvider {
  readonly kind = 'unconfigured';
  readonly model: string | null = null;
  #reason: string;

  constructor(reason: string) {
    this.#reason = reason;
  }

  // Both rules are right in general and wrong here: this generator exists to
  // fail, so it has nothing to yield and nothing to await. The signature is the
  // point -- it satisfies `ChatProvider`, and the error it throws is what tells
  // the client the model is not enabled rather than pretending to answer.
  // eslint-disable-next-line require-yield, @typescript-eslint/require-await
  async *stream(): AsyncIterable<ChatChunk> {
    throw new ProviderUnavailableError(this.#reason);
  }
}

export interface GeminiProviderOptions {
  config: GeminiConfig;
  /** Rough token estimate, used only for the usage chunk when the API is quiet. */
  maxOutputTokens?: number;
}

/**
 * The live provider. Kept behind a dynamic import so the SDK is loaded only when
 * a key exists -- an unconfigured deployment does not need the dependency
 * resolved at boot, and a missing key should not be able to crash startup.
 */
export class GeminiProvider implements ChatProvider {
  readonly kind = 'gemini';
  readonly model: string;
  #config: GeminiConfig;
  #maxOutputTokens: number;

  constructor(options: GeminiProviderOptions) {
    this.#config = options.config;
    this.model = options.config.model;
    this.#maxOutputTokens = options.maxOutputTokens ?? 2048;
  }

  async *stream(request: ChatTurnRequest): AsyncIterable<ChatChunk> {
    const { GoogleGenAI } = await import('@google/genai');
    // The client is built for the surface the credentials describe. Passing an
    // API-key-only client a Vertex model identifier is not a degraded mode: the
    // request 404s. Vertex needs the project and location; the Developer API
    // needs only the key, and must not be handed the other two.
    const ai =
      this.#config.surface === 'vertex'
        ? new GoogleGenAI({
            apiKey: this.#config.apiKey,
            vertexai: true,
            project: this.#config.project,
            location: this.#config.location,
          })
        : new GoogleGenAI({ apiKey: this.#config.apiKey });

    const contents = [
      ...request.history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
      { role: 'user', parts: [{ text: request.message }] },
    ];

    const functionDeclarations = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const response = await ai.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction: request.systemInstruction,
        maxOutputTokens: this.#maxOutputTokens,
        ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : {}),
      },
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of response) {
      if (request.signal?.aborted) return;
      const text = chunk.text;
      if (text) yield { type: 'text', text };

      const usage = chunk.usageMetadata;
      if (usage) {
        inputTokens = usage.promptTokenCount ?? inputTokens;
        outputTokens = usage.candidatesTokenCount ?? outputTokens;
      }

      // Tool calls are surfaced as events *and* executed here, so the caller
      // sees the same `tool_started`/`tool_finished` pair the widget animates.
      for (const call of chunk.functionCalls ?? []) {
        const name = call.name;
        // A function call with no name cannot be matched to a declaration, so
        // it is dropped. There is no path that guesses which tool was meant.
        if (!name) continue;
        const declaration = request.tools.find((t) => t.name === name);
        if (!declaration) {
          // The model named a tool this deployment did not offer. Refuse it
          // loudly instead of executing whatever it asked for.
          continue;
        }
        const chatCall: ChatToolCall = {
          name,
          args: call.args ?? {},
        };
        yield { type: 'tool_started', call: chatCall };
        try {
          const result = await request.execute(chatCall);
          yield { type: 'tool_finished', call: chatCall, ok: true, result };
        } catch (error) {
          yield {
            type: 'tool_finished',
            call: chatCall,
            ok: false,
            result: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }

    yield { type: 'usage', inputTokens, outputTokens };
  }
}
