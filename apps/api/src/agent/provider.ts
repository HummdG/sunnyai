import type { Content, Part } from '@google/genai';

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
/** The nudge for a model that has looked things up and said nothing. */
const ANSWER_NOW =
  'Answer the visitor now, in words, from what you have already found. Do not look anything else up.';

/** Rounds of tool calls one turn may take before it stops asking the model. */
const MAX_TOOL_ROUNDS = 4;

function functionResponse(
  id: string | undefined,
  name: string,
  response: Record<string, unknown>,
): Part {
  return { functionResponse: { ...(id ? { id } : {}), name, response } };
}

/** A function response must be an object; anything else is wrapped. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}

/**
 * Whether a model call failed because the service was busy: Vertex's shared
 * capacity answers 429 RESOURCE_EXHAUSTED (and sometimes 503) under load, and
 * the same request a moment later usually goes through.
 */
export function isBusyError(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = Number(e?.status ?? e?.code);
  if (status === 429 || status === 503) return true;
  const message = typeof e?.message === 'string' ? e.message : String(error);
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(message);
}

/** Waits before each retry of a busy model call (three tries after the first). */
export const BUSY_RETRY_DELAYS_MS = [800, 2000, 4000];

/**
 * Run a model call, retrying it while the service says it is busy. Only the
 * call that opens a stream is retried, before anything has been streamed, so a
 * retry never repeats words or tool calls the visitor has already seen.
 */
export async function withBusyRetry<T>(
  call: () => Promise<T>,
  signal?: AbortSignal,
  delays: readonly number[] = BUSY_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !isBusyError(error) || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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
    const { GoogleGenAI, FunctionCallingConfigMode } = await import('@google/genai');
    // The client is built for the surface the credentials describe. Passing an
    // API-key-only client a Vertex model identifier is not a degraded mode: the
    // request 404s. Vertex needs the project and location; the Developer API
    // needs only the key, and must not be handed the other two.
    const ai =
      this.#config.surface === 'vertex'
        ? new GoogleGenAI({
            // Without a key, the client uses the deployment's own identity
            // (Application Default Credentials: Cloud Run's service account).
            ...(this.#config.apiKey ? { apiKey: this.#config.apiKey } : {}),
            vertexai: true,
            project: this.#config.project,
            location: this.#config.location,
          })
        : new GoogleGenAI({ apiKey: this.#config.apiKey });

    const contents: Content[] = [
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

    let inputTokens = 0;
    let outputTokens = 0;
    // Whether the visitor has been told anything yet, and whether the next
    // round must answer in words.
    let spoke = false;
    let wordsOnly = false;
    // A silent words-only round gets one plain nudge to answer (below).
    let nudged = false;

    // A turn is a loop: the model may ask for tools, their results go back to
    // it, and it answers (or asks again). A turn that stopped after the first
    // call streamed nothing whenever the model looked something up first.
    // One round more than MAX_TOOL_ROUNDS, for the nudge.
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      // On the last round the model may not call tools: one still looking
      // things up when the rounds run out would otherwise end the turn without
      // a word.
      const toolsOff = wordsOnly || round >= MAX_TOOL_ROUNDS - 1;
      const response = await withBusyRetry(
        () =>
          ai.models.generateContentStream({
            model: this.model,
            contents,
            config: {
              systemInstruction: request.systemInstruction,
              maxOutputTokens: this.#maxOutputTokens,
              ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : {}),
              // Declared still (the turn so far calls them), but not callable.
              ...(toolsOff
                ? {
                    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
                  }
                : {}),
            },
          }),
        request.signal,
      );

      // The model's turn as it sent it, parts and all: Gemini 3 refuses a
      // replayed function call that has lost its thought signature.
      const modelParts: Part[] = [];
      const responses: Part[] = [];
      let roundInput = 0;
      let roundOutput = 0;
      // why a round ended, kept for the log when it ends without a word
      let finishReason: string | undefined;
      const partKinds = new Set<string>();

      for await (const chunk of response) {
        if (request.signal?.aborted) return;
        const candidate = chunk.candidates?.[0];
        modelParts.push(...(candidate?.content?.parts ?? []));
        finishReason = candidate?.finishReason ?? finishReason;
        for (const part of candidate?.content?.parts ?? []) {
          for (const key of Object.keys(part)) partKinds.add(key);
        }
        const text = chunk.text;
        if (text) {
          spoke = true;
          yield { type: 'text', text };
        }

        const usage = chunk.usageMetadata;
        if (usage) {
          roundInput = usage.promptTokenCount ?? roundInput;
          roundOutput = usage.candidatesTokenCount ?? roundOutput;
        }

        // Tool calls are surfaced as events *and* executed here, so the caller
        // sees the same `tool_started`/`tool_finished` pair the widget animates.
        // On a words-only round a call is not run: the model was told it could
        // not make one (seen live: it made it anyway, and the turn ran out of
        // rounds without a word).
        for (const call of toolsOff ? [] : (chunk.functionCalls ?? [])) {
          const name = call.name;
          // A function call with no name cannot be matched to a declaration, so
          // it is dropped. There is no path that guesses which tool was meant.
          if (!name) continue;
          const declaration = request.tools.find((t) => t.name === name);
          // The model named a tool this deployment did not offer: refused, and
          // the model is told so rather than left waiting for a result.
          if (!declaration) {
            responses.push(functionResponse(call.id, name, { ok: false, error: 'Unknown tool.' }));
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
            responses.push(functionResponse(call.id, name, asRecord(result)));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield { type: 'tool_finished', call: chatCall, ok: false, result: message };
            responses.push(functionResponse(call.id, name, { ok: false, error: message }));
          }
        }
      }

      inputTokens += roundInput;
      outputTokens += roundOutput;
      if (responses.length === 0 && !spoke) {
        console.warn(
          JSON.stringify({
            severity: 'WARNING',
            message: 'model round ended without words',
            model: this.model,
            round,
            toolsOff,
            finishReason: finishReason ?? null,
            parts: [...partKinds],
            outputTokens: roundOutput,
          }),
        );
      }
      if (responses.length === 0) {
        // Seen live: after its tools ran, the model sometimes stopped without a
        // word. It is asked once more with tools off; its empty turn is not
        // replayed. A words-only round that is silent too gets one plain nudge,
        // and after that the silence is final (the agent says the next step).
        if (spoke) break;
        if (toolsOff) {
          if (nudged) break;
          nudged = true;
          contents.push({ role: 'user', parts: [{ text: ANSWER_NOW }] });
        }
        wordsOnly = true;
        continue;
      }
      contents.push({ role: 'model', parts: modelParts }, { role: 'user', parts: responses });
    }

    yield { type: 'usage', inputTokens, outputTokens };
  }
}
