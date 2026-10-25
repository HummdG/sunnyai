import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider, type ChatChunk } from '../src/agent/provider.js';

/**
 * The live provider against a stand-in for `@google/genai`.
 *
 * Every other test drives the agent with a scripted provider, which is why a
 * turn that called a tool and then said nothing went unnoticed until the first
 * real model ran: the tool's result was never sent back, so the model never got
 * to answer. These tests hold the provider to the round trip.
 */

interface Part {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
}
interface Content {
  role: string;
  parts: Part[];
}

const calls: Content[][] = [];
/** Whether each request let the model call tools. */
const offeredTools: boolean[] = [];
let rounds: Part[][][] = [];

function chunk(parts: Part[]) {
  const text = parts.map((p) => p.text ?? '').join('');
  const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
  return {
    candidates: [{ content: { role: 'model', parts } }],
    text: text === '' ? undefined : text,
    functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
  };
}

vi.mock('@google/genai', () => ({
  FunctionCallingConfigMode: { NONE: 'NONE' },
  GoogleGenAI: class {
    models = {
      generateContentStream: (request: {
        contents: Content[];
        config: { tools?: unknown[]; toolConfig?: { functionCallingConfig?: { mode?: string } } };
      }) => {
        calls.push(structuredClone(request.contents));
        offeredTools.push(
          (request.config.tools ?? []).length > 0 &&
            request.config.toolConfig?.functionCallingConfig?.mode !== 'NONE',
        );
        const round = rounds.shift() ?? [];
        // `for await` reads a plain array too, which is all the provider does.
        return Promise.resolve(round.map(chunk));
      },
    };
  },
}));

const provider = new GeminiProvider({
  config: {
    apiKey: undefined,
    surface: 'vertex',
    model: 'gemini-test',
    escalationModel: undefined,
    location: 'global',
    project: 'p',
  },
});

const TOOL = { name: 'retrieve_knowledge', description: 'Look it up.', parameters: {} };

async function run(execute = vi.fn(() => Promise.resolve({ ok: true, note: 'found it' }))) {
  const out: ChatChunk[] = [];
  for await (const c of provider.stream({
    systemInstruction: 'be helpful',
    history: [],
    message: 'Is solar worth it?',
    tools: [TOOL],
    execute,
  })) {
    out.push(c);
  }
  return { out, execute };
}

beforeEach(() => {
  calls.length = 0;
  offeredTools.length = 0;
  rounds = [];
});

describe('GeminiProvider', () => {
  it('sends a tool result back to the model, and streams the answer that follows', async () => {
    rounds = [
      [
        [
          {
            functionCall: { name: 'retrieve_knowledge', args: { q: 'solar' } },
            thoughtSignature: 'sig',
          },
        ],
      ],
      [[{ text: 'Yes, ' }], [{ text: 'for most homes.' }]],
    ];
    const { out, execute } = await run();

    expect(execute).toHaveBeenCalledWith({ name: 'retrieve_knowledge', args: { q: 'solar' } });
    expect(out.filter((c) => c.type === 'text').map((c) => c.text)).toEqual([
      'Yes, ',
      'for most homes.',
    ]);
    expect(calls).toHaveLength(2);
    const [, second] = calls;
    // The model's own call goes back exactly as it was made (Gemini 3 refuses a
    // replayed call without its thought signature), then the result.
    expect(second!.at(-2)).toEqual({
      role: 'model',
      parts: [
        {
          functionCall: { name: 'retrieve_knowledge', args: { q: 'solar' } },
          thoughtSignature: 'sig',
        },
      ],
    });
    expect(second!.at(-1)).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'retrieve_knowledge',
            response: { ok: true, note: 'found it' },
          },
        },
      ],
    });
  });

  it('adds up the tokens of every round', async () => {
    rounds = [
      [[{ functionCall: { name: 'retrieve_knowledge', args: {} } }]],
      [[{ text: 'Done.' }]],
    ];
    const { out } = await run();
    expect(out.at(-1)).toEqual({ type: 'usage', inputTokens: 200, outputTokens: 20 });
  });

  it('stops after a few rounds rather than looping on tools forever', async () => {
    const forever = [[{ functionCall: { name: 'retrieve_knowledge', args: {} } }]];
    rounds = Array.from({ length: 20 }, () => forever);
    const { execute } = await run();
    expect(calls.length).toBeLessThanOrEqual(5);
    expect(execute.mock.calls.length).toBeLessThan(5);
  });

  it('forbids tool calls on the last round, so the turn ends in words', async () => {
    // A model still calling tools when the rounds run out used to end the turn
    // with nothing said. On the last request it may not call one: it can only
    // answer.
    const forever = [[{ functionCall: { name: 'retrieve_knowledge', args: {} } }]];
    rounds = [forever, forever, forever, [[{ text: 'Here is what I found.' }]]];
    const { out } = await run();
    expect(offeredTools.at(-1)).toBe(false);
    expect(offeredTools.slice(0, -1).every(Boolean)).toBe(true);
    expect(out.filter((c) => c.type === 'text').map((c) => c.text)).toEqual([
      'Here is what I found.',
    ]);
  });

  it('asks once more, tools off, when the model stops without a word', async () => {
    // Seen live: after its tools ran, the model sometimes ended the turn with
    // no text at all, and the visitor saw nothing.
    rounds = [
      [[{ functionCall: { name: 'retrieve_knowledge', args: {} } }]],
      [[{ text: '' }]],
      [[{ text: 'Your roof faces south.' }]],
    ];
    const { out } = await run();
    expect(out.filter((c) => c.type === 'text').map((c) => c.text)).toEqual([
      'Your roof faces south.',
    ]);
    expect(offeredTools).toEqual([true, true, false]);
  });

  it('does not ask again once the model has said something', async () => {
    rounds = [[[{ text: 'Hello.' }]], [[{ text: 'never asked for' }]]];
    await run();
    expect(calls).toHaveLength(1);
  });

  it('tells the model when a tool failed, rather than hiding it', async () => {
    rounds = [
      [[{ functionCall: { name: 'retrieve_knowledge', args: {} } }]],
      [[{ text: 'Sorry.' }]],
    ];
    await run(vi.fn(() => Promise.reject(new Error('index offline'))));
    expect(calls[1]!.at(-1)!.parts[0]!.functionResponse).toEqual({
      name: 'retrieve_knowledge',
      response: { ok: false, error: 'index offline' },
    });
  });
});
