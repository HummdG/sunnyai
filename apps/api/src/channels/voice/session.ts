import type { KnowledgeIndex } from '@sunny/knowledge';

import { CHANNEL_POLICIES, assertEntitled, toSpokenText } from '../../agent/channels.js';
import { buildSystemInstruction } from '../../agent/prompt.js';
import {
  classifyIntent,
  detectSafetyConcern,
  safetyResponse,
  supportLine,
  type Intent,
} from '../../agent/support.js';
import { declarationsFor, executeTool, type ToolContext } from '../../agent/tools.js';
import type { Auditor } from '../../audit.js';
import type { Store } from '../../store.js';
import type { Tenant } from '../../tenants.js';
import {
  audioMessage,
  audioStreamEndMessage,
  setupMessage,
  textTurnMessage,
  toolResponseMessage,
  type FunctionResponse,
  type LiveConnection,
  type LiveConnector,
  type LiveEvent,
} from './live.js';
import type { VoiceUsageLedger } from './usage.js';

/**
 * One voice conversation, bridged to a Gemini Live session.
 *
 * Transport-agnostic: the widget's WebSocket and a Twilio media stream both
 * drive the same session through a `VoiceTransport`. The Live API is the model
 * loop (speech in, speech out); everything around it is the same headless core
 * the chat uses -- the voice system instructions from `agent/prompt.ts` (which
 * carry the Blueprint's voice output rule), the voice tool allowlist from
 * `agent/channels.ts`, tool execution through `executeTool`, the safety triage
 * and intent classifier from `agent/support.ts`, and the spoken-text policy
 * (`toSpokenText`) for what is logged and captioned. `runTurn` itself is not
 * used because it drives a text `ChatProvider`; a Live session generates its
 * own audio, so the loop lives here and the parts it is built from do not.
 */

export type VoiceKind = 'web' | 'phone';

export type VoiceState = 'connecting' | 'listening' | 'speaking' | 'ended';

export type VoiceClientEvent =
  | { type: 'ready'; maxSeconds: number }
  | { type: 'state'; state: VoiceState }
  | { type: 'caption'; role: 'user' | 'assistant'; text: string; final: boolean }
  | { type: 'safety'; text: string }
  | { type: 'lead_saved'; leadId: string }
  | { type: 'handoff'; reason: string };

export type EndReason =
  'caller_hangup' | 'time_limit' | 'safety' | 'transferred' | 'upstream_error' | 'upstream_closed';

/** What a session needs from whatever carries the audio. */
export interface VoiceTransport {
  /** Model speech, base64 PCM16 at 24 kHz; the transport converts as it needs. */
  sendAudio(pcm24kBase64: string): void;
  /** Barge-in: drop any speech queued for playback. */
  clear(): void;
  /** Captions, state and notices (the phone transport ignores most of them). */
  event(event: VoiceClientEvent): void;
  /**
   * The session is over. `message` is what the caller should hear last: the
   * web transport speaks it in the browser, the phone transport closes the
   * stream so Twilio plays the TwiML after `<Connect>`, or redirects the call.
   */
  end(reason: EndReason, message: string): void;
}

/** Handles the add-on tools reach a live session through (see `tools.ts`). */
export interface VoiceSessionHandle {
  readonly tenantId: string;
  readonly kind: VoiceKind;
  /** The caller's number, for SMS. Phone sessions only. */
  readonly callerNumber: string | null;
  transfer(reason: string): Promise<{ ok: boolean; note: string }>;
  sendSms(purpose: 'book_survey' | 'quote_request'): Promise<{ ok: boolean; note: string }>;
}

/** Live sessions by session id, for the add-on tool runners and concurrency caps. */
export const activeVoiceSessions = new Map<string, VoiceSessionHandle>();

export function activeCount(tenantId: string): number {
  let n = 0;
  for (const handle of activeVoiceSessions.values()) if (handle.tenantId === tenantId) n++;
  return n;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface VoiceSessionOptions {
  kind: VoiceKind;
  tenant: Tenant;
  store: Store;
  /** The conversation key: the widget's session id, or `call_<CallSid>`. */
  sessionId: string;
  knowledge: KnowledgeIndex;
  connector: LiveConnector;
  model: string;
  maxSeconds: number;
  transport: VoiceTransport;
  usage: VoiceUsageLedger;
  /** Transfer and SMS, supplied by the transport that can do them. */
  transfer?: VoiceSessionHandle['transfer'];
  sendSms?: VoiceSessionHandle['sendSms'];
  callerNumber?: string | null;
  callSid?: string;
  audit?: Auditor;
  origin?: string | null;
  now?: () => number;
  timers?: Timers;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

/** Said near the cap so the model can wrap up before the line goes quiet. */
const WRAP_UP_SECONDS = 20;
/**
 * Past this many spoken words in one answer the rest is cut. The model is told
 * 40 (the Blueprint rule); this is the backstop for a model that ignores it,
 * with headroom so a sentence that runs a word or two over is not chopped.
 */
export const HARD_WORD_CAP = 60;

/** Appended to the voice system instructions. */
export function voiceSessionNote(kind: VoiceKind): string {
  return [
    '<voice_session>',
    kind === 'phone'
      ? 'You are answering a phone call for the installer. The caller has been told they are speaking to an AI assistant.'
      : "You are speaking with a visitor through the microphone on the installer's website.",
    '- Speak naturally and briefly. Never read out a URL, an email address character by character, or a list.',
    kind === 'phone'
      ? '- If the caller wants a person, or you cannot help, use transfer_to_human. Offer send_sms_link to text a booking link, only with their agreement.'
      : '- If the visitor wants a person, use transfer_to_human and tell them the team will be in touch.',
    '- Only record a lead once the caller has agreed to be contacted, and confirm the phone number by repeating it back.',
    '</voice_session>',
  ].join('\n');
}

export class VoiceSession {
  readonly #o: VoiceSessionOptions;
  readonly #now: () => number;
  readonly #timers: Timers;
  #live: LiveConnection | null = null;
  #state: VoiceState = 'connecting';
  #startedAt = 0;
  #ended = false;
  #muted = false;
  #userText = '';
  #assistantText = '';
  #suppress = false;
  #escalated = false;
  #intent: Intent = 'sales';
  #tools: string[] = [];
  #conversationId: string | null = null;
  #capTimer: unknown = null;
  #wrapTimer: unknown = null;
  #pendingWrites: Promise<unknown>[] = [];
  /** Transcript writes run one after another, so turns keep their order. */
  #writeChain: Promise<unknown> = Promise.resolve();
  readonly #allowed: Set<string>;

  constructor(options: VoiceSessionOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#timers = options.timers ?? realTimers;
    this.#allowed = new Set<string>(CHANNEL_POLICIES.voice.tools);
  }

  get state(): VoiceState {
    return this.#state;
  }

  get ended(): boolean {
    return this.#ended;
  }

  /** Open the Live session. Throws `NotEntitledError` before anything is spent. */
  async start(): Promise<void> {
    const { tenant, store, sessionId } = this.#o;
    assertEntitled(tenant, 'voice');
    this.#startedAt = this.#now();
    const existing = await store.getConversation(tenant.id, sessionId);
    this.#conversationId = existing?.id ?? null;

    activeVoiceSessions.set(sessionId, {
      tenantId: tenant.id,
      kind: this.#o.kind,
      callerNumber: this.#o.callerNumber ?? null,
      transfer: async (reason) => {
        if (this.#o.transfer) return this.#o.transfer(reason);
        this.#o.transport.event({ type: 'handoff', reason });
        return {
          ok: true,
          note: `Tell the visitor someone from ${tenant.config.companyName} will be in touch.`,
        };
      },
      sendSms: async (purpose) => {
        if (this.#o.sendSms) return this.#o.sendSms(purpose);
        return { ok: false, note: 'Texting is only available on phone calls.' };
      },
    });

    this.#live = this.#o.connector({
      onEvent: (event) => this.#onLiveEvent(event),
      onClose: () => {
        if (!this.#ended) this.end('upstream_closed', supportLine(tenant));
      },
      onError: (error) => {
        this.#o.log?.('voice live error', { error: error.message });
        if (!this.#ended) this.end('upstream_error', supportLine(tenant));
      },
    });

    const instructions =
      buildSystemInstruction(tenant, 'voice', this.#o.knowledge.sourceCount) +
      '\n' +
      voiceSessionNote(this.#o.kind);
    this.#live.send(
      setupMessage({
        model: this.#o.model,
        systemInstruction: instructions,
        tools: declarationsFor(CHANNEL_POLICIES.voice.tools),
        ...(tenant.config.voice?.voiceName ? { voiceName: tenant.config.voice.voiceName } : {}),
      }),
    );

    const capMs = this.#o.maxSeconds * 1000;
    this.#capTimer = this.#timers.set(() => this.#timeLimit(), capMs);
    if (this.#o.maxSeconds > WRAP_UP_SECONDS * 2) {
      this.#wrapTimer = this.#timers.set(
        () => {
          this.#live?.send(
            textTurnMessage(
              'System note: the call time limit is nearly reached. Politely wrap up in one short sentence.',
            ),
          );
        },
        capMs - WRAP_UP_SECONDS * 1000,
      );
    }
    this.#o.transport.event({ type: 'ready', maxSeconds: this.#o.maxSeconds });
    this.#setState('listening');
  }

  /** Caller audio, base64 PCM16 at 16 kHz. */
  audio(pcm16kBase64: string): void {
    if (this.#ended || this.#muted || !this.#live) return;
    this.#live.send(audioMessage(pcm16kBase64));
  }

  /** Mute stops forwarding the microphone and tells the model the stream paused. */
  mute(muted: boolean): void {
    if (this.#muted === muted) return;
    this.#muted = muted;
    if (muted) this.#live?.send(audioStreamEndMessage());
  }

  /** The caller pressed "stop talking": drop the answer being spoken. */
  interrupt(): void {
    this.#o.transport.clear();
    this.#suppress = true;
    this.#setState('listening');
  }

  /** End the session; idempotent. */
  end(reason: EndReason, message = ''): void {
    if (this.#ended) return;
    this.#ended = true;
    if (this.#capTimer !== null) this.#timers.clear(this.#capTimer);
    if (this.#wrapTimer !== null) this.#timers.clear(this.#wrapTimer);
    this.#flushTurn();
    activeVoiceSessions.delete(this.#o.sessionId);
    try {
      this.#live?.close();
    } catch {
      // Already closed.
    }
    this.#setState('ended');
    this.#o.transport.end(reason, message);
    const endedAt = this.#now();
    const seconds = Math.max(0, Math.round((endedAt - this.#startedAt) / 1000));
    this.#pendingWrites.push(
      this.#o.usage
        .record({
          tenantId: this.#o.tenant.id,
          sessionId: this.#o.sessionId,
          kind: this.#o.kind,
          startedAt: new Date(this.#startedAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          seconds,
          endReason: reason,
          ...(this.#o.callSid ? { callSid: this.#o.callSid } : {}),
        })
        .catch((error: unknown) =>
          this.#o.log?.('voice usage record failed', { error: String(error) }),
        ),
    );
  }

  /** Resolves when every transcript and usage write has settled (for tests and shutdown). */
  async settled(): Promise<void> {
    await Promise.all(this.#pendingWrites);
  }

  #setState(state: VoiceState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#o.transport.event({ type: 'state', state });
  }

  #timeLimit(): void {
    const company = this.#o.tenant.config.companyName;
    this.end(
      'time_limit',
      `I'm afraid we've reached the time limit for this call. Thanks for talking with ${company}, goodbye.`,
    );
  }

  #onLiveEvent(event: LiveEvent): void {
    if (this.#ended) return;
    switch (event.kind) {
      case 'audio':
        if (this.#suppress) return;
        this.#setState('speaking');
        this.#o.transport.sendAudio(event.data);
        return;
      case 'input_transcript':
        this.#userText += event.text;
        this.#o.transport.event({
          type: 'caption',
          role: 'user',
          text: this.#userText.trim(),
          final: false,
        });
        // Safety triage runs on the caller's words as they arrive, before the
        // model's answer is let through (agent/support.ts).
        if (!this.#escalated && detectSafetyConcern(this.#userText)) this.#safety();
        return;
      case 'output_transcript': {
        if (this.#suppress) return;
        this.#assistantText += event.text;
        const spoken = toSpokenText(this.#assistantText);
        this.#o.transport.event({ type: 'caption', role: 'assistant', text: spoken, final: false });
        if (this.#assistantText.trim().split(/\s+/).length > HARD_WORD_CAP) {
          // The model ignored the 40-word rule badly: stop the answer here.
          this.#suppress = true;
          this.#o.transport.clear();
        }
        return;
      }
      case 'interrupted':
        // Barge-in: the caller spoke over Sunny; Live has discarded the rest.
        this.#o.transport.clear();
        this.#setState('listening');
        return;
      case 'turn_complete':
        this.#flushTurn();
        this.#suppress = false;
        this.#setState('listening');
        return;
      case 'tool_call':
        void this.#runTools(event.calls);
        return;
      case 'go_away':
        this.end('upstream_closed', supportLine(this.#o.tenant));
        return;
      default:
        return;
    }
  }

  /** The fixed safety reply: never model-written (agent/support.ts). */
  #safety(): void {
    this.#escalated = true;
    this.#intent = 'support';
    this.#suppress = true;
    this.#o.transport.clear();
    const { tenant } = this.#o;
    const text = `${safetyResponse(tenant, 'voice')} ${supportLine(tenant)}`;
    this.#o.transport.event({ type: 'safety', text });
    this.#o.transport.event({ type: 'caption', role: 'assistant', text, final: true });
    this.#record({ role: 'user', text: this.#userText.trim() });
    this.#record({ role: 'assistant', text });
    this.#userText = '';
    this.#assistantText = '';
    if (this.#o.kind === 'phone' && this.#o.transfer) {
      void this.#o.transfer(`safety: ${text}`);
      return;
    }
    this.end('safety', text);
  }

  async #runTools(calls: readonly { id: string; name: string; args: Record<string, unknown> }[]) {
    const { tenant, store, sessionId, knowledge } = this.#o;
    const ctx: ToolContext = {
      tenant,
      sessionId,
      conversationId: this.#conversationId,
      store,
      answers: {},
      events: [],
      sunscanConnected: false,
      knowledge,
      channel: 'voice',
      ...(this.#o.audit ? { audit: this.#o.audit } : {}),
      ...(this.#o.origin !== undefined ? { origin: this.#o.origin } : {}),
    };
    const responses: FunctionResponse[] = [];
    for (const call of calls) {
      this.#tools.push(call.name);
      if (!this.#allowed.has(call.name)) {
        responses.push({
          id: call.id,
          name: call.name,
          response: { ok: false, error: `${call.name} is not available on this channel.` },
        });
        continue;
      }
      const result = await executeTool({ name: call.name, args: call.args }, ctx);
      responses.push({
        id: call.id,
        name: call.name,
        response: { ok: result.ok, data: result.data, summary: result.summary },
      });
    }
    for (const event of ctx.events) {
      if (event.kind === 'lead_saved') {
        this.#o.transport.event({ type: 'lead_saved', leadId: String(event.detail.leadId) });
      }
      if (event.kind === 'handoff_requested') {
        const reason = event.detail.reason;
        this.#o.transport.event({
          type: 'handoff',
          reason: typeof reason === 'string' ? reason : '',
        });
      }
    }
    if (!this.#ended) this.#live?.send(toolResponseMessage(responses));
  }

  #flushTurn(): void {
    const user = this.#userText.trim();
    const assistant = toSpokenText(this.#assistantText);
    if (user) {
      if (this.#intent === 'sales') this.#intent = classifyIntent(user);
      this.#o.transport.event({ type: 'caption', role: 'user', text: user, final: true });
      this.#record({ role: 'user', text: user });
    }
    if (assistant) {
      this.#o.transport.event({ type: 'caption', role: 'assistant', text: assistant, final: true });
      this.#record({ role: 'assistant', text: assistant });
    }
    this.#userText = '';
    this.#assistantText = '';
    this.#tools = [];
  }

  /** One line of the unified inbox: channel 'voice', with intent and escalation. */
  #record(turn: { role: 'user' | 'assistant'; text: string }): void {
    if (!turn.text) return;
    const { tenant, store, sessionId } = this.#o;
    const write = (): Promise<unknown> =>
      store
        .appendTurn(tenant.id, sessionId, {
          role: turn.role,
          text: turn.text,
          at: new Date(this.#now()).toISOString(),
          channel: 'voice',
          intent: this.#intent,
          ...(this.#escalated ? { escalation: 'safety' as const } : {}),
          ...(turn.role === 'assistant' && this.#tools.length > 0
            ? { tools: [...this.#tools] }
            : {}),
        })
        .catch((error: unknown) =>
          this.#o.log?.('voice transcript write failed', { error: String(error) }),
        );
    this.#writeChain = this.#writeChain.then(write);
    this.#pendingWrites.push(this.#writeChain);
  }
}
