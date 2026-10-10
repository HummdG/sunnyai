import { newId, type ConversationTurn, type Store } from '../store.js';
import type { Tenant } from '../tenants.js';
import type { ChatProvider } from './provider.js';
import { TOOL_DECLARATIONS, executeTool, type ToolContext, type ToolEvent } from './tools.js';

/**
 * The assistant's behaviour, assembled from the tenant's own configuration.
 *
 * The system instruction is built here rather than stored per tenant so that the
 * safety rules cannot be edited away by whoever writes the installer's copy. The
 * tenant supplies facts -- its name, its greeting, its answers to check -- and
 * the server supplies the constraints.
 */
export function buildSystemInstruction(tenant: Tenant, knowledgeSourceCount: number): string {
  const { config } = tenant;
  return [
    `You are Sunny, the assistant on ${config.companyName}'s website.`,
    `You help homeowners understand solar for their own home and, when they want one, arrange a quote or a survey.`,
    '',
    'How you speak:',
    '- Warm, brief and concrete. Two or three sentences unless asked for detail.',
    '- Never use a marketing superlative you cannot point to a source for.',
    '- Ask at most one question at a time, and only questions from get_questionnaire.',
    '- If the visitor is not a fit, say so plainly and helpfully rather than pushing.',
    '',
    'What you must not do:',
    `- Never invent a price, a saving, a payback period, a warranty term or a timescale. If you do not have one from a tool, say you will get it confirmed.`,
    '- Never quote a figure that did not come from a tool call in this conversation.',
    '- Never ask for a password, a payment card, or a full bank detail.',
    '- Never promise an outcome the installer has not authorised.',
    '- Never claim to be human. If asked, say you are an assistant.',
    "- Never discuss another installer, or anyone else's enquiry.",
    '',
    'Tools:',
    "- Use retrieve_knowledge before answering anything about this installer's own policies or process.",
    '- Use save_answer as soon as the visitor gives an answer, so the installer gets it even if they leave.',
    '- Use create_lead or request_callback only once the visitor has agreed to be contacted.',
    '- Use suggest_page_action to point at something on the page rather than describing where it is.',
    '- Use handoff_to_human when you cannot help, or the visitor asks for a person.',
    '',
    knowledgeSourceCount === 0
      ? 'Note: this installer has no knowledge sources connected, so you cannot quote their documents. Say so if asked rather than guessing.'
      : `You have ${knowledgeSourceCount} knowledge source(s) available through retrieve_knowledge.`,
  ].join('\n');
}

export interface TurnInput {
  tenant: Tenant;
  provider: ChatProvider;
  store: Store;
  sessionId: string;
  conversationId: string | null;
  history: ConversationTurn[];
  message: string;
  clientMessageId: string;
  sunscanConnected: boolean;
  signal?: AbortSignal;
}

/** A stream event, in the contract's vocabulary. */
export type TurnEvent =
  | { type: 'message_started'; messageId: string }
  | { type: 'text_delta'; messageId: string; text: string }
  | { type: 'tool_started'; messageId: string; tool: string }
  | { type: 'tool_finished'; messageId: string; tool: string; ok: boolean }
  | { type: 'page_action_suggested'; messageId: string; action: string; target: string }
  | { type: 'lead_saved'; messageId: string; leadId: string }
  | { type: 'handoff_requested'; messageId: string; reason: string }
  | { type: 'recommendation_ready'; messageId: string; recommendationId: string }
  | {
      type: 'message_finished';
      messageId: string;
      usage?: { inputTokens: number; outputTokens: number };
      text: string;
      tools: string[];
    };

/**
 * Run one turn, yielding contract events.
 *
 * The transcript is written as the turn completes rather than as it streams: a
 * half-written assistant turn that survives a dropped connection would show the
 * visitor a sentence that stops mid-word the next time they open the widget.
 */
export async function* runTurn(input: TurnInput): AsyncGenerator<TurnEvent> {
  const messageId = newId('msg');
  yield { type: 'message_started', messageId };

  const events: ToolEvent[] = [];
  const ctx: ToolContext = {
    tenant: input.tenant,
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    store: input.store,
    answers: answersFromHistory(input.history),
    events,
    sunscanConnected: input.sunscanConnected,
    knowledgeSourceCount: input.tenant.knowledgeSourceIds.length,
  };

  let text = '';
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  const toolsUsed: string[] = [];
  const declaredTools = new Set(TOOL_DECLARATIONS.map((t) => t.name));

  {
    const stream = input.provider.stream({
      systemInstruction: buildSystemInstruction(input.tenant, ctx.knowledgeSourceCount),
      history: input.history.map((t) => ({ role: t.role, text: t.text })),
      message: input.message,
      tools: TOOL_DECLARATIONS,
      // The model sees the tool's data plus its one-line summary; the events
      // the summary produces are drained into the stream between chunks, so a
      // page action reaches the widget during the turn rather than after it.
      execute: async (call) => {
        const result = await executeTool(call, ctx);
        return { ok: result.ok, ...(result.data as object), note: result.summary };
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });

    for await (const chunk of stream) {
      for (const event of drain(events, messageId)) yield event;
      if (chunk.type === 'text') {
        text += chunk.text;
        yield { type: 'text_delta', messageId, text: chunk.text };
      } else if (chunk.type === 'tool_started') {
        // The declared-tool check lives here rather than in the provider, so it
        // holds for *every* provider. When it sat in the Gemini implementation
        // it protected the live path only, and a scripted or future provider
        // could push an undeclared tool name straight into the client's event
        // stream. One guard, at the one place all providers pass through.
        if (!declaredTools.has(chunk.call.name)) {
          continue;
        }
        toolsUsed.push(chunk.call.name);
        yield { type: 'tool_started', messageId, tool: chunk.call.name };
      } else if (chunk.type === 'tool_finished') {
        if (!declaredTools.has(chunk.call.name)) continue;
        yield { type: 'tool_finished', messageId, tool: chunk.call.name, ok: chunk.ok };
      } else if (chunk.type === 'usage') {
        usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
      }
    }

    for (const event of drain(events, messageId)) yield event;
  }

  // Persist both halves of the turn together. The user turn is written first so
  // that a failure mid-answer still leaves the visitor's own words recorded.
  await input.store.appendTurn(input.tenant.id, input.sessionId, {
    role: 'user',
    text: input.message,
    at: new Date().toISOString(),
    clientMessageId: input.clientMessageId,
  });
  await input.store.appendTurn(input.tenant.id, input.sessionId, {
    role: 'assistant',
    text,
    at: new Date().toISOString(),
    ...(toolsUsed.length > 0 ? { tools: toolsUsed } : {}),
    ...(Object.keys(ctx.answers).length > 0 ? { answers: { ...ctx.answers } } : {}),
  });

  yield {
    type: 'message_finished',
    messageId,
    text,
    tools: toolsUsed,
    ...(usage ? { usage } : {}),
  };
}

function drain(events: ToolEvent[], messageId: string): TurnEvent[] {
  const out: TurnEvent[] = [];
  while (events.length > 0) {
    const event = events.shift()!;
    if (event.kind === 'page_action') {
      out.push({
        type: 'page_action_suggested',
        messageId,
        action: String(event.detail['action']),
        target: String(event.detail['target']),
      });
    } else if (event.kind === 'lead_saved') {
      out.push({ type: 'lead_saved', messageId, leadId: String(event.detail['leadId']) });
    } else if (event.kind === 'handoff_requested') {
      out.push({
        type: 'handoff_requested',
        messageId,
        reason: String(event.detail['reason']),
      });
    } else if (event.kind === 'recommendation_ready') {
      out.push({
        type: 'recommendation_ready',
        messageId,
        recommendationId: String(event.detail['recommendationId']),
      });
    }
  }
  return out;
}

/**
 * Recover the answers already given, from the transcript.
 *
 * Read from the structured `answers` map each turn stores, never re-parsed out
 * of the assistant's prose. Merging forward means a resumed session does not
 * re-ask a visitor something they already told us -- the failure that most
 * reliably makes an assistant feel stupid.
 */
function answersFromHistory(history: ConversationTurn[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const turn of history) {
    if (turn.answers) Object.assign(answers, turn.answers);
  }
  return answers;
}
