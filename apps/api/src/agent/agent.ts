import { EMPTY_KNOWLEDGE, type KnowledgeIndex } from '@sunny/knowledge';
import type { QuoteCard } from '@sunny/contracts';
import type { AssessmentSummary, SunScanService, SunScanStatus } from '@sunny/sunscan-adapter';

import { newId, type ConversationTurn, type ModelCall, type Store } from '../store.js';
import type { Auditor } from '../audit.js';
import type { QuoteToolContext } from '../journey/agent-tools.js';
import type { Tenant } from '../tenants.js';
import type { ChatProvider } from './provider.js';
import { CHANNEL_POLICIES, assertEntitled, finalizeOutput, type Channel } from './channels.js';
import { buildSystemInstruction, sandwich, userQuery } from './prompt.js';
import {
  PlaceholderGuard,
  classifyIntent,
  detectSafetyConcern,
  safetyResponse,
} from './support.js';
import {
  CONTEXT_PASSAGES,
  CitationLedger,
  lexicalSearch,
  safeLink,
  type PassageSearch,
} from './retrieval.js';
import { declarationsFor, executeTool, type ToolContext, type ToolEvent } from './tools.js';

// The prompt lives in `prompt.ts`; re-exported for callers that import it from here.
export { buildSystemInstruction } from './prompt.js';

export interface TurnInput {
  tenant: Tenant;
  provider: ChatProvider;
  store: Store;
  sessionId: string;
  conversationId: string | null;
  history: ConversationTurn[];
  /**
   * The conversation's standing answer map, if it has one.
   *
   * Authoritative where it overlaps `answersFromHistory`, because it is newer by
   * construction: every turn folds its answers back into it (below), and the
   * qualification route writes to it directly. The per-turn maps are still merged
   * in underneath so a conversation written before the field existed resumes
   * with its answers intact.
   */
  standingAnswers?: Record<string, string>;
  message: string;
  clientMessageId: string;
  sunscanConnected: boolean;
  /** The SunScan roof assessment service, when this deployment runs one. */
  sunscan?: SunScanService;
  /**
   * The installer's documents, chunked by the caller.
   *
   * Optional so a caller with no knowledge surface -- a test, an older adapter --
   * gets the empty index rather than an error, and so the absence is the same
   * state as a tenant that has connected nothing.
   */
  knowledge?: KnowledgeIndex;
  /**
   * Where an effectful tool call is recorded.
   *
   * Passed down to the tool context rather than written here, because the tool
   * surface is what decides which tools have an effect -- see
   * `EFFECTFUL_TOOL_NAMES`. Absent in a test that does not care, which is why it
   * is optional rather than required.
   */
  audit?: Auditor;
  /**
   * The page origin this session was opened from, when it named one.
   *
   * Read from the signed session claims by the route and threaded down so a lead
   * filed by a tool records it as consent provenance. Absent means the session
   * named no origin, which is a legitimate state and different from a request that
   * simply did not carry the field.
   */
  origin?: string | null;
  /**
   * Which channel adapter is calling (Blueprint §1). Absent means chat, which is
   * every caller written before the core served other channels.
   */
  channel?: Channel;
  /** How passages are found; see `retrieval.ts` for the adapter point. */
  search?: PassageSearch;
  /** The quote journey's pricing; absent turns have no quote tools to run. */
  quote?: QuoteToolContext;
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
      type: 'sources';
      messageId: string;
      sources: { ref: string; title: string; url: string | null; chunkId: string }[];
    }
  | { type: 'disclaimer'; messageId: string; kind: 'estimate'; text: string }
  | { type: 'escalation'; messageId: string; kind: 'safety' }
  | {
      type: 'sunscan';
      messageId: string;
      assessmentId: string;
      status: SunScanStatus;
      summary: AssessmentSummary | null;
    }
  | { type: 'quote'; messageId: string; quote: QuoteCard }
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
  const channel: Channel = input.channel ?? 'chat';
  // Before anything is spent: a channel the installer has not paid for is
  // refused outright (Blueprint §5, `tenant_addons`).
  assertEntitled(input.tenant, channel);
  const policy = CHANNEL_POLICIES[channel];
  const allowedTools = new Set<string>(policy.tools);

  const messageId = newId('msg');
  yield { type: 'message_started', messageId };

  const intent = classifyIntent(input.message);

  // Safety triage, before the model (support knowledge base §13). The reply is
  // fixed text from the server, and the conversation is escalated for the
  // installer; the model is not consulted at all.
  if (detectSafetyConcern(input.message)) {
    const reply = safetyResponse(input.tenant, channel);
    yield { type: 'text_delta', messageId, text: reply };
    yield { type: 'escalation', messageId, kind: 'safety' };
    await input.store.appendTurn(input.tenant.id, input.sessionId, {
      role: 'user',
      text: input.message,
      at: new Date().toISOString(),
      clientMessageId: input.clientMessageId,
      channel,
      intent: 'support',
    });
    await input.store.appendTurn(input.tenant.id, input.sessionId, {
      role: 'assistant',
      text: reply,
      at: new Date().toISOString(),
      channel,
      intent: 'support',
      escalation: 'safety',
    });
    yield { type: 'message_finished', messageId, text: reply, tools: [] };
    return;
  }

  const search = input.search ?? lexicalSearch;
  const knowledgeIndex = input.knowledge ?? EMPTY_KNOWLEDGE;
  const ledger = new CitationLedger();
  // Retrieved up front, into <verified_context> (Blueprint §4.3); the tool is
  // there for a second lookup, and shares the markers through the ledger.
  const contextPassages = ledger.add(await search(knowledgeIndex, input.message, CONTEXT_PASSAGES));

  const events: ToolEvent[] = [];
  const ctx: ToolContext = {
    tenant: input.tenant,
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    store: input.store,
    // Standing answers outrank the per-turn maps: they are the conversation's
    // current state, and a turn is the thing that is about to change it.
    answers: { ...answersFromHistory(input.history), ...input.standingAnswers },
    events,
    sunscanConnected: input.sunscanConnected,
    ...(input.sunscan ? { sunscan: input.sunscan } : {}),
    knowledge: knowledgeIndex,
    ...(input.audit ? { audit: input.audit } : {}),
    origin: input.origin ?? null,
    channel,
    search,
    ledger,
    ...(input.quote ? { quote: input.quote } : {}),
  };

  let text = '';
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  const toolsUsed: string[] = [];
  // The channel's allowlist is the declared surface: a tool outside it is
  // neither offered to the model nor run if the model names it anyway.
  const declaredTools = allowedTools;
  let disclaimerSent = false;
  // No unfilled `XXXX` placeholder from a knowledge base ever reaches a visitor,
  // even split across two deltas.
  const guard = new PlaceholderGuard(input.tenant);

  // A monotonic clock, not `Date.now()`.
  //
  // A duration subtracted from two wall-clock readings is wrong whenever the
  // clock steps -- NTP correcting a drifting VM, a laptop resuming from sleep --
  // and wrong in the direction that produces a negative or absurd latency on the
  // dashboard. `performance.now()` only moves forward, which is the only property
  // a stopwatch needs.
  const startedAt = performance.now();
  // Set by the first chunk the provider produces, whatever kind it is. A tool
  // runs only once a function-call chunk has arrived, so at this instant nothing
  // but the model has taken any time -- see `ModelCall`.
  let firstChunkAt: number | null = null;

  // What the answers looked like before this turn ran.
  //
  // Kept so the turn can persist the *delta* rather than the whole map. The map a
  // turn starts with is every answer ever given, and copying all of it onto each
  // assistant turn would make the transcript's answer record a series of
  // increasingly long repeats rather than a record of what was said when.
  const answersBefore = { ...ctx.answers };

  {
    const stream = input.provider.stream({
      systemInstruction: buildSystemInstruction(input.tenant, channel, ctx.knowledge.sourceCount),
      // Earlier visitor turns are wrapped too: an instruction smuggled into
      // message one is as untrusted as one in the current message.
      history: input.history.map((t) => ({
        role: t.role,
        text: t.role === 'user' ? userQuery(t.text) : t.text,
      })),
      message: sandwich(contextPassages, input.message),
      tools: declarationsFor(policy.tools),
      // The model sees the tool's data plus its one-line summary; the events
      // the summary produces are drained into the stream between chunks, so a
      // page action reaches the widget during the turn rather than after it.
      execute: async (call) => {
        if (!allowedTools.has(call.name)) {
          return { ok: false, note: `${call.name} is not available on this channel.` };
        }
        const result = await executeTool(call, ctx);
        return { ok: result.ok, ...(result.data as object), note: result.summary };
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });

    for await (const chunk of stream) {
      firstChunkAt ??= performance.now();
      for (const event of drain(events, messageId)) {
        if (event.type === 'disclaimer') {
          if (disclaimerSent) continue;
          disclaimerSent = true;
        }
        yield event;
      }
      if (chunk.type === 'text') {
        const safe = guard.push(chunk.text);
        text += safe;
        if (safe !== '') yield { type: 'text_delta', messageId, text: safe };
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

    for (const event of drain(events, messageId)) {
      if (event.type === 'disclaimer') {
        if (disclaimerSent) continue;
        disclaimerSent = true;
      }
      yield event;
    }
  }

  const rest = guard.flush();
  if (rest !== '') {
    text += rest;
    yield { type: 'text_delta', messageId, text: rest };
  }

  // The channel's output policy, enforced on what is kept and handed on.
  const finalText = finalizeOutput(channel, text);

  // Citations: only the passages the answer actually cited by marker.
  const cited = ledger.cited(text);
  if (cited.length > 0) {
    yield {
      type: 'sources',
      messageId,
      sources: cited.slice(0, 8).map((p) => ({
        ref: p.ref,
        title: p.chunk.title.slice(0, 200),
        url: safeLink(p.chunk.url),
        chunkId: p.chunk.id.slice(0, 200),
      })),
    };
  }

  const totalMs = performance.now() - startedAt;
  // The stream is spent by here, so this is the call's whole duration -- tool
  // execution included, because tools run inside the stream. A stream that
  // produced no chunk at all has no time-to-first-token to report; falling back
  // to the total keeps `ttfbMs` a real measurement of a real wait rather than a
  // zero that would read as instant.
  const call: ModelCall = {
    model: input.provider.model,
    provider: input.provider.kind,
    ttfbMs: Math.round((firstChunkAt ?? startedAt + totalMs) - startedAt),
    totalMs: Math.round(totalMs),
    ...(usage ? { usage } : {}),
  };

  // Persist both halves of the turn together. The user turn is written first so
  // that a failure mid-answer still leaves the visitor's own words recorded.
  await input.store.appendTurn(input.tenant.id, input.sessionId, {
    role: 'user',
    text: input.message,
    at: new Date().toISOString(),
    clientMessageId: input.clientMessageId,
    channel,
    intent,
  });
  // Only the answers this turn set or changed. A key present before with the same
  // value is not something this turn did.
  const answersChanged: Record<string, string> = {};
  for (const [questionId, value] of Object.entries(ctx.answers)) {
    if (answersBefore[questionId] !== value) answersChanged[questionId] = value;
  }
  // A correction in the turn can also take an answer *away*: `save_answer`
  // reconciles the context as it writes, so an answer that no longer applies is
  // simply gone from `ctx.answers`. Nothing "set" it, so it never appears in
  // `answersChanged` -- but a merge alone could not remove it, and the store
  // would keep an answer the visitor had just withdrawn. So the turn's diff has
  // two halves, and this is the second (D-31).
  const answersRemoved = Object.keys(answersBefore).filter((id) => !(id in ctx.answers));

  await input.store.appendTurn(input.tenant.id, input.sessionId, {
    role: 'assistant',
    text: finalText,
    at: new Date().toISOString(),
    channel,
    intent,
    ...(toolsUsed.length > 0 ? { tools: toolsUsed } : {}),
    ...(Object.keys(answersChanged).length > 0 ? { answers: answersChanged } : {}),
    call,
  });

  // Fold this turn's answers into the conversation's standing map.
  //
  // Written *after* the turns rather than instead of them, so the record keeps
  // both facts: the standing map is what is currently true, and the per-turn map
  // is which turn changed it. The alternative -- letting the route and the chat
  // each keep their own map and merging them on read -- leaves no principled way
  // to decide which of two contradictory answers wins.
  //
  // The per-turn record carries the set, not the removal, and that is deliberate:
  // a removal is not an independent fact to log, it is what the question set
  // makes of the set. Anyone replaying the turns has the answer that caused it
  // and the module's rules, so the removal is derivable; duplicating it onto the
  // turn would be a second copy of the question set's logic, free to disagree.
  if (Object.keys(answersChanged).length > 0 || answersRemoved.length > 0) {
    await input.store.mergeAnswers(
      input.tenant.id,
      input.sessionId,
      answersChanged,
      answersRemoved,
    );
  }

  yield {
    type: 'message_finished',
    messageId,
    text: finalText,
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
    } else if (event.kind === 'estimate_disclaimer') {
      out.push({
        type: 'disclaimer',
        messageId,
        kind: 'estimate',
        text: String(event.detail['text']),
      });
    } else if (event.kind === 'sunscan') {
      const detail = event.detail as {
        assessmentId: string;
        status: SunScanStatus;
        summary: AssessmentSummary | null;
      };
      out.push({ type: 'sunscan', messageId, ...detail });
    } else if (event.kind === 'quote') {
      out.push({ type: 'quote', messageId, quote: event.detail['quote'] as QuoteCard });
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
