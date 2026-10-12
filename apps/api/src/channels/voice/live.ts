import WebSocket from 'ws';

import type { ToolDeclaration } from '../../agent/provider.js';

/**
 * The Gemini Live API (bidirectional WebSocket), reduced to what a call needs.
 *
 * Message shapes follow the official reference, checked 2026-10-12:
 * - https://ai.google.dev/api/live (client: `setup`, `realtimeInput`,
 *   `clientContent`, `toolResponse`; server: `setupComplete`, `serverContent`,
 *   `toolCall`, `toolCallCancellation`, `goAway`, `usageMetadata`)
 * - https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 *   (endpoint with `?key=`, `realtimeInput.audio.{data,mimeType}`,
 *   `toolResponse.functionResponses[].{id,name,response}`)
 * - https://ai.google.dev/gemini-api/docs/live-guide (PCM16 LE, 16 kHz in,
 *   24 kHz out; `inputAudioTranscription` / `outputAudioTranscription`;
 *   `serverContent.interrupted` on barge-in)
 *
 * Everything that touches the wire is in this file, so a protocol change is a
 * change here and nowhere else.
 */

export const INPUT_MIME = 'audio/pcm;rate=16000';
export const OUTPUT_RATE = 24000;

export interface LiveSetupOptions {
  model: string;
  systemInstruction: string;
  tools: readonly ToolDeclaration[];
  voiceName?: string;
}

/** The first message of a session (`BidiGenerateContentSetup`). */
export function setupMessage(opts: LiveSetupOptions): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { responseModalities: ['AUDIO'] };
  if (opts.voiceName) {
    generationConfig.speechConfig = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } },
    };
  }
  return {
    setup: {
      model: opts.model.startsWith('models/') ? opts.model : `models/${opts.model}`,
      generationConfig,
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      ...(opts.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: opts.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ],
          }
        : {}),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

/** A chunk of caller audio (base64 PCM16 16 kHz). */
export function audioMessage(pcm16kBase64: string): Record<string, unknown> {
  return { realtimeInput: { audio: { data: pcm16kBase64, mimeType: INPUT_MIME } } };
}

/** The caller stopped sending audio (mic paused or muted). */
export function audioStreamEndMessage(): Record<string, unknown> {
  return { realtimeInput: { audioStreamEnd: true } };
}

export interface FunctionResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

export function toolResponseMessage(
  responses: readonly FunctionResponse[],
): Record<string, unknown> {
  return { toolResponse: { functionResponses: responses } };
}

/** Ask the model to say something (used for the time-limit goodbye). */
export function textTurnMessage(text: string): Record<string, unknown> {
  return {
    clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
  };
}

export interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** A server message, normalised to the cases the bridge acts on. */
export type LiveEvent =
  | { kind: 'setup_complete' }
  | { kind: 'audio'; data: string }
  | { kind: 'input_transcript'; text: string }
  | { kind: 'output_transcript'; text: string }
  | { kind: 'interrupted' }
  | { kind: 'turn_complete' }
  | { kind: 'tool_call'; calls: FunctionCall[] }
  | { kind: 'tool_call_cancellation'; ids: string[] }
  | { kind: 'go_away' }
  | { kind: 'usage'; inputTokens: number; outputTokens: number };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;

/** Parse one server message into zero or more events. Unknown fields are ignored. */
export function parseServerMessage(message: unknown): LiveEvent[] {
  const m = obj(message);
  if (!m) return [];
  const events: LiveEvent[] = [];
  if ('setupComplete' in m) events.push({ kind: 'setup_complete' });
  const content = obj(m.serverContent);
  if (content) {
    const turn = obj(content.modelTurn);
    const parts = Array.isArray(turn?.parts) ? turn.parts : [];
    for (const part of parts) {
      const inline = obj(obj(part)?.inlineData);
      if (inline && typeof inline.data === 'string')
        events.push({ kind: 'audio', data: inline.data });
    }
    const input = obj(content.inputTranscription);
    if (input && typeof input.text === 'string' && input.text) {
      events.push({ kind: 'input_transcript', text: input.text });
    }
    const output = obj(content.outputTranscription);
    if (output && typeof output.text === 'string' && output.text) {
      events.push({ kind: 'output_transcript', text: output.text });
    }
    if (content.interrupted === true) events.push({ kind: 'interrupted' });
    if (content.turnComplete === true) events.push({ kind: 'turn_complete' });
  }
  const toolCall = obj(m.toolCall);
  if (toolCall && Array.isArray(toolCall.functionCalls)) {
    const calls: FunctionCall[] = [];
    for (const raw of toolCall.functionCalls) {
      const c = obj(raw);
      if (!c || typeof c.name !== 'string') continue;
      calls.push({
        id: typeof c.id === 'string' ? c.id : '',
        name: c.name,
        args: obj(c.args) ?? {},
      });
    }
    if (calls.length > 0) events.push({ kind: 'tool_call', calls });
  }
  const cancel = obj(m.toolCallCancellation);
  if (cancel && Array.isArray(cancel.ids)) {
    events.push({
      kind: 'tool_call_cancellation',
      ids: cancel.ids.filter((id): id is string => typeof id === 'string'),
    });
  }
  if ('goAway' in m) events.push({ kind: 'go_away' });
  const usage = obj(m.usageMetadata);
  if (usage) {
    events.push({
      kind: 'usage',
      inputTokens: Number(usage.promptTokenCount ?? 0),
      outputTokens: Number(usage.responseTokenCount ?? 0),
    });
  }
  return events;
}

/** A `ws` message payload as text, whichever buffer shape it arrived in. */
export function rawText(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
}

/** A connection to a Live session, real or fake. */
export interface LiveConnection {
  send(message: Record<string, unknown>): void;
  close(): void;
}

export interface LiveHandlers {
  onEvent(event: LiveEvent): void;
  onClose(reason: string): void;
  onError(error: Error): void;
}

/** Opens Live sessions. The real one dials Google; tests inject a fake. */
export type LiveConnector = (handlers: LiveHandlers) => LiveConnection;

/**
 * The real connector. The API key goes in the query string of a server-side
 * connection and never reaches the browser.
 */
export function geminiLiveConnector(url: string, apiKey: string): LiveConnector {
  return (handlers) => {
    const socket = new WebSocket(`${url}?key=${encodeURIComponent(apiKey)}`);
    const queue: string[] = [];
    socket.on('open', () => {
      for (const frame of queue.splice(0)) socket.send(frame);
    });
    socket.on('message', (data) => {
      try {
        const text = rawText(data);
        for (const event of parseServerMessage(JSON.parse(text))) handlers.onEvent(event);
      } catch (error) {
        handlers.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on('close', (code, reason) => handlers.onClose(`${code} ${reason.toString()}`.trim()));
    socket.on('error', (error) => handlers.onError(error));
    return {
      send(message) {
        const frame = JSON.stringify(message);
        if (socket.readyState === WebSocket.OPEN) socket.send(frame);
        else if (socket.readyState === WebSocket.CONNECTING) queue.push(frame);
      },
      close() {
        socket.close();
      },
    };
  };
}
