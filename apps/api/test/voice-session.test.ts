import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { NotEntitledError, VOICE_OUTPUT_RULE } from '../src/agent/channels.js';
import type { LiveConnector, LiveEvent, LiveHandlers } from '../src/channels/voice/live.js';
import {
  HARD_WORD_CAP,
  VoiceSession,
  activeVoiceSessions,
  type EndReason,
  type Timers,
  type VoiceClientEvent,
  type VoiceSessionOptions,
  type VoiceTransport,
} from '../src/channels/voice/session.js';
import { registerVoiceTools } from '../src/channels/voice/tools.js';
import { MemoryVoiceUsage } from '../src/channels/voice/usage.js';
import { FileStore } from '../src/store.js';
import { defaultTenants, type Tenant } from '../src/tenants.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

function tenant(
  addons: Tenant['config']['addons'] = { voice_widget: true, phone_agent: true },
): Tenant {
  const base = defaultTenants()[0]!;
  return {
    ...base,
    config: { ...base.config, addons, supportContact: { phone: '01234 567890' } },
  };
}

class FakeLive {
  sent: Record<string, unknown>[] = [];
  handlers: LiveHandlers | null = null;
  closed = false;
  opened = 0;
  connector: LiveConnector = (handlers) => {
    this.opened++;
    this.handlers = handlers;
    return {
      send: (message) => this.sent.push(message),
      close: () => {
        this.closed = true;
      },
    };
  };
  emit(event: LiveEvent): void {
    this.handlers!.onEvent(event);
  }
}

class FakeTransport implements VoiceTransport {
  audio: string[] = [];
  clears = 0;
  events: VoiceClientEvent[] = [];
  ended: { reason: EndReason; message: string } | null = null;
  sendAudio(b64: string): void {
    this.audio.push(b64);
  }
  clear(): void {
    this.clears++;
  }
  event(event: VoiceClientEvent): void {
    this.events.push(event);
  }
  end(reason: EndReason, message: string): void {
    this.ended = { reason, message };
  }
}

class FakeTimers implements Timers {
  pending: { fn: () => void; ms: number; cleared: boolean }[] = [];
  set(fn: () => void, ms: number): unknown {
    const handle = { fn, ms, cleared: false };
    this.pending.push(handle);
    return handle;
  }
  clear(handle: unknown): void {
    (handle as { cleared: boolean }).cleared = true;
  }
  fire(ms: number): void {
    for (const t of this.pending) if (t.ms === ms && !t.cleared) t.fn();
  }
}

let dir: string;
let store: FileStore;
let live: FakeLive;
let transport: FakeTransport;
let timers: FakeTimers;
let usage: MemoryVoiceUsage;
let clock: number;

beforeAll(() => registerVoiceTools());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sunny-voice-'));
  store = new FileStore(dir);
  live = new FakeLive();
  transport = new FakeTransport();
  timers = new FakeTimers();
  usage = new MemoryVoiceUsage();
  clock = NOW;
});

afterEach(async () => {
  activeVoiceSessions.clear();
  await rm(dir, { recursive: true, force: true });
});

function session(over: Partial<VoiceSessionOptions> = {}): VoiceSession {
  return new VoiceSession({
    kind: 'web',
    tenant: tenant(),
    store,
    sessionId: 'sess_voice_1',
    knowledge: EMPTY_KNOWLEDGE,
    connector: live.connector,
    model: 'gemini-3.8-live',
    maxSeconds: 300,
    transport,
    usage,
    now: () => clock,
    timers,
    ...over,
  });
}

describe('voice session: setup', () => {
  it('opens Live with the voice instructions, the voice tools only, and transcription', async () => {
    await session().start();
    const setup = live.sent[0]!.setup as Record<string, unknown>;
    expect(setup.model).toBe('models/gemini-3.8-live');
    expect((setup.generationConfig as Record<string, unknown>).responseModalities).toEqual([
      'AUDIO',
    ]);
    const text = (setup.systemInstruction as { parts: { text: string }[] }).parts[0]!.text;
    // The core's voice prompt, with the Blueprint's voice rule verbatim.
    expect(text).toContain('<system_instructions>');
    expect(text).toContain(VOICE_OUTPUT_RULE);
    expect(text).toContain('<voice_session>');
    const tools = (
      setup.tools as { functionDeclarations: { name: string }[] }[]
    )[0]!.functionDeclarations
      .map((d) => d.name)
      .sort();
    expect(tools).toEqual([
      'create_lead',
      'retrieve_knowledge',
      'send_sms_link',
      'transfer_to_human',
    ]);
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(transport.events).toContainEqual({ type: 'ready', maxSeconds: 300 });
  });

  it('refuses a tenant without the voice add-on before opening Live', async () => {
    await expect(session({ tenant: tenant({ web_chat: true }) }).start()).rejects.toBeInstanceOf(
      NotEntitledError,
    );
    expect(live.opened).toBe(0);
    expect(activeVoiceSessions.size).toBe(0);
  });
});

describe('voice session: audio and turns', () => {
  it('forwards caller audio to Live and model audio to the caller', async () => {
    const s = session();
    await s.start();
    s.audio('AAAA');
    expect(live.sent[1]).toEqual({
      realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } },
    });
    live.emit({ kind: 'audio', data: 'BBBB' });
    expect(transport.audio).toEqual(['BBBB']);
    expect(s.state).toBe('speaking');
  });

  it('stops forwarding while muted and tells Live the stream paused', async () => {
    const s = session();
    await s.start();
    s.mute(true);
    s.audio('AAAA');
    expect(live.sent.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } });
    expect(live.sent.some((m) => JSON.stringify(m).includes('AAAA'))).toBe(false);
  });

  it('logs both sides as voice turns, spoken-text policy applied, with intent', async () => {
    const s = session();
    await s.start();
    live.emit({ kind: 'input_transcript', text: 'My inverter is showing ' });
    live.emit({ kind: 'input_transcript', text: 'a grid fault.' });
    live.emit({
      kind: 'output_transcript',
      text: "**Sorry** to hear that. See https://example.com [S1]. It's usually the grid side; your inverter manufacturer can advise.",
    });
    live.emit({ kind: 'turn_complete' });
    await s.settled();
    const conversation = await store.getConversation('t_demo0001', 'sess_voice_1');
    const turns = conversation!.turns;
    expect(turns.map((t) => [t.role, t.channel, t.intent])).toEqual([
      ['user', 'voice', 'support'],
      ['assistant', 'voice', 'support'],
    ]);
    expect(turns[0]!.text).toBe('My inverter is showing a grid fault.');
    expect(turns[1]!.text).not.toMatch(/\*|https?:|\[S1\]/);
    expect(transport.events).toContainEqual({
      type: 'caption',
      role: 'user',
      text: 'My inverter is showing a grid fault.',
      final: true,
    });
  });

  it('cuts an answer that runs far past the word limit', async () => {
    const s = session();
    await s.start();
    live.emit({ kind: 'output_transcript', text: 'word '.repeat(HARD_WORD_CAP + 5) });
    expect(transport.clears).toBe(1);
    live.emit({ kind: 'audio', data: 'LATE' });
    expect(transport.audio).not.toContain('LATE');
    live.emit({ kind: 'turn_complete' });
    await s.settled();
    const turns = (await store.getConversation('t_demo0001', 'sess_voice_1'))!.turns;
    expect(turns[0]!.text.split(' ').length).toBeLessThanOrEqual(40);
  });

  it('clears queued speech when the caller barges in', async () => {
    const s = session();
    await s.start();
    live.emit({ kind: 'audio', data: 'BBBB' });
    live.emit({ kind: 'interrupted' });
    expect(transport.clears).toBe(1);
    expect(s.state).toBe('listening');
  });
});

describe('voice session: tools', () => {
  it('runs an allowed tool through the core and answers Live with its id', async () => {
    const transfers: string[] = [];
    const s = session({
      kind: 'phone',
      callerNumber: '+447700900123',
      transfer: (reason) => {
        transfers.push(reason);
        return Promise.resolve({ ok: true, note: 'transferring' });
      },
    });
    await s.start();
    live.emit({
      kind: 'tool_call',
      calls: [{ id: 'call-1', name: 'transfer_to_human', args: { reason: 'wants a person' } }],
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(transfers).toEqual(['wants a person']);
    const response = live.sent.at(-1) as {
      toolResponse: { functionResponses: Record<string, unknown>[] };
    };
    expect(response.toolResponse.functionResponses[0]).toMatchObject({
      id: 'call-1',
      name: 'transfer_to_human',
      response: { ok: true },
    });
  });

  it('refuses a tool outside the voice allowlist without running it', async () => {
    await session().start();
    live.emit({ kind: 'tool_call', calls: [{ id: 'c2', name: 'search_catalogue', args: {} }] });
    await new Promise((r) => setTimeout(r, 10));
    const response = live.sent.at(-1) as {
      toolResponse: { functionResponses: Record<string, unknown>[] };
    };
    expect(response.toolResponse.functionResponses[0]).toMatchObject({
      id: 'c2',
      response: { ok: false },
    });
  });

  it('cannot text a web visitor: send_sms_link is phone-only', async () => {
    await session().start();
    live.emit({
      kind: 'tool_call',
      calls: [{ id: 'c3', name: 'send_sms_link', args: { purpose: 'book_survey' } }],
    });
    await new Promise((r) => setTimeout(r, 10));
    const response = live.sent.at(-1) as {
      toolResponse: { functionResponses: { response: { ok: boolean } }[] };
    };
    expect(response.toolResponse.functionResponses[0]!.response.ok).toBe(false);
  });
});

describe('voice session: safety', () => {
  it('answers a safety phrase with the fixed line, silences the model and ends a web session', async () => {
    const s = session();
    await s.start();
    live.emit({ kind: 'input_transcript', text: "There's smoke coming out of the inverter" });
    const safety = transport.events.find((e) => e.type === 'safety') as { text: string };
    expect(safety.text).toContain('999');
    expect(safety.text).toContain('01234 567890');
    live.emit({ kind: 'audio', data: 'MODEL' });
    expect(transport.audio).not.toContain('MODEL');
    expect(transport.ended?.reason).toBe('safety');
    await s.settled();
    const turns = (await store.getConversation('t_demo0001', 'sess_voice_1'))!.turns;
    expect(turns.every((t) => t.escalation === 'safety')).toBe(true);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  it('transfers a phone caller to the installer after the safety line', async () => {
    const transfers: string[] = [];
    const s = session({
      kind: 'phone',
      transfer: (reason) => {
        transfers.push(reason);
        return Promise.resolve({ ok: true, note: '' });
      },
    });
    await s.start();
    live.emit({ kind: 'input_transcript', text: 'I can smell burning near the battery' });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatch(/^safety: .*999/);
    // The transfer handler ends the session (routes/voice.ts); here it is a fake.
    s.end('transferred');
    await s.settled();
  });
});

describe('voice session: limits and metering', () => {
  it('asks the model to wrap up, then ends at the cap with a goodbye and meters the time', async () => {
    const s = session({ maxSeconds: 300 });
    await s.start();
    timers.fire(280_000);
    expect(JSON.stringify(live.sent.at(-1))).toContain('wrap up');
    clock = NOW + 300_000;
    timers.fire(300_000);
    expect(transport.ended?.reason).toBe('time_limit');
    expect(transport.ended?.message).toMatch(/goodbye/i);
    expect(live.closed).toBe(true);
    await s.settled();
    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0]).toMatchObject({
      tenantId: 't_demo0001',
      seconds: 300,
      endReason: 'time_limit',
    });
    expect(await usage.secondsThisMonth('t_demo0001', NOW)).toBe(300);
    expect(await usage.secondsThisMonth('t_demo0001', Date.parse('2026-11-02T00:00:00Z'))).toBe(0);
  });

  it('registers while live and unregisters on end', async () => {
    const s = session();
    await s.start();
    expect(activeVoiceSessions.get('sess_voice_1')?.tenantId).toBe('t_demo0001');
    s.end('caller_hangup');
    s.end('caller_hangup');
    expect(activeVoiceSessions.has('sess_voice_1')).toBe(false);
    await s.settled();
    expect(usage.entries).toHaveLength(1);
  });

  it('ends cleanly when Live drops', async () => {
    await session().start();
    live.handlers!.onClose('1011 internal');
    expect(transport.ended?.reason).toBe('upstream_closed');
  });
});
