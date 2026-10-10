import type { ChatChunk, ChatProvider, ChatTurnRequest } from '../src/agent/provider.js';

/**
 * A provider that replays a fixed script, including tool calls, so the tool
 * layer runs for real without a credential or a network.
 *
 * Shared by the test files that drive a chat turn: a second copy would be a
 * second definition of what a tool call looks like on the wire, and the two
 * would drift the moment either is adjusted.
 */
export class ScriptedProvider implements ChatProvider {
  readonly kind = 'scripted';
  readonly model = 'scripted-1';
  #script: (request: ChatTurnRequest) => ChatChunk[];
  #lastRequest: ChatTurnRequest | null = null;

  constructor(script: (request: ChatTurnRequest) => ChatChunk[]) {
    this.#script = script;
  }

  get lastRequest(): ChatTurnRequest | null {
    return this.#lastRequest;
  }

  async *stream(request: ChatTurnRequest): AsyncIterable<ChatChunk> {
    this.#lastRequest = request;
    for (const chunk of this.#script(request)) {
      if (chunk.type === 'tool_started') {
        yield chunk;
        // The real provider executes tools as it streams; the script must too,
        // or the test would not cover the tool layer at all.
        const declaration = request.tools.find((t) => t.name === chunk.call.name);
        if (declaration) {
          try {
            const result = await request.execute(chunk.call);
            yield { type: 'tool_finished', call: chunk.call, ok: true, result };
          } catch (error) {
            yield {
              type: 'tool_finished',
              call: chunk.call,
              ok: false,
              result: error instanceof Error ? error.message : String(error),
            };
          }
        }
      } else {
        yield chunk;
      }
    }
  }
}
