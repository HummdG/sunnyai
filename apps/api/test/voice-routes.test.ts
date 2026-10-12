import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import type { ServerConfig } from '../src/config.js';
import { linearToMulaw } from '../src/channels/voice/audio.js';
import type { VoiceConfig } from '../src/channels/voice/config.js';
import {
  rawText,
  type LiveConnector,
  type LiveEvent,
  type LiveHandlers,
} from '../src/channels/voice/live.js';
import { activeVoiceSessions } from '../src/channels/voice/session.js';
import {
  connectStreamTwiml,
  twilioSignature,
  validateTwilioSignature,
} from '../src/channels/voice/twilio.js';
import { MemoryVoiceUsage } from '../src/channels/voice/usage.js';
import { buildServer } from '../src/server.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants, type Tenant } from '../src/tenants.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-voice';
const AUTH_TOKEN = 'twilio-auth-token';
const BASE = 'https://api.sunny.test';
const INSTALLER_NUMBER = '+441234567890';

function makeConfig(dataDir: string): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir,
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: 'admin-token',
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: false,
      trustProxyHops: 0,
      rules: {
        session: { limit: 1000, windowMs: 60_000 },
        chat: { limit: 1000, windowMs: 60_000 },
        leads: { limit: 1000, windowMs: 60_000 },
        qualification: { limit: 1000, windowMs: 60_000 },
        catalogue: { limit: 1000, windowMs: 60_000 },
        knowledge: { limit: 1000, windowMs: 60_000 },
      },
      maxKeys: 1000,
    },
  } as unknown as ServerConfig;
}

const voiceConfig: VoiceConfig = {
  apiKey: 'unused-with-fake-connector',
  liveModel: 'gemini-3.8-live',
  liveUrl: 'wss://example.invalid',
  maxSessionSeconds: 300,
  defaultConcurrency: 2,
  twilio: { accountSid: 'AC123', authToken: AUTH_TOKEN, fromNumber: null },
  publicBaseUrl: BASE,
};

function voiceTenant(addons: Tenant['config']['addons']): Tenant {
  const base = defaultTenants()[0]!;
  return {
    ...base,
    websiteUrl: 'https://northwind.example',
    config: {
      ...base.config,
      addons,
      supportContact: { phone: INSTALLER_NUMBER },
      voice: { twilioNumbers: ['+441000000001'], maxCallSeconds: 300, concurrency: 2 },
    },
  };
}

class FakeLive {
  sent: Record<string, unknown>[] = [];
  handlers: LiveHandlers | null = null;
  connector: LiveConnector = (handlers) => {
    this.handlers = handlers;
    return { send: (m) => this.sent.push(m), close: () => {} };
  };
  emit(event: LiveEvent): void {
    this.handlers!.onEvent(event);
  }
}

interface FetchCall {
  url: string;
  body: URLSearchParams;
}

let dir: string;
let app: FastifyInstance;
let live: FakeLive;
let usage: MemoryVoiceUsage;
let fetchCalls: FetchCall[];

async function start(addons: Tenant['config']['addons']): Promise<void> {
  const store = new FileStore(dir);
  const tenants = new TenantRegistry([voiceTenant(addons)]);
  app = buildServer({
    config: makeConfig(dir),
    store,
    tenants,
    now: () => NOW,
    voice: {
      voice: voiceConfig,
      connector: live.connector,
      usage,
      now: () => NOW,
      fetch: (url, init) => {
        fetchCalls.push({
          url: url instanceof Request ? url.url : url.toString(),
          body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
        });
        return Promise.resolve(new Response(JSON.stringify({ sid: 'SMxxx' }), { status: 201 }));
      },
    },
  });
  await app.ready();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sunny-voice-routes-'));
  live = new FakeLive();
  usage = new MemoryVoiceUsage();
  fetchCalls = [];
});

afterEach(async () => {
  await app?.close();
  activeVoiceSessions.clear();
  await rm(dir, { recursive: true, force: true });
});

const waitFor = async (check: () => boolean, ms = 2000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('Twilio request signing', () => {
  it("matches Twilio's documented worked example", () => {
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14158675310',
      Digits: '1234',
      From: '+14158675310',
      To: '+18005551212',
    };
    const url = 'https://example.com/myapp.php?foo=1&bar=2';
    expect(twilioSignature(url, params, '12345')).toBe('L/OH5YylLD5NRKLltdqwSvS0BnU=');
    expect(validateTwilioSignature(url, params, 'L/OH5YylLD5NRKLltdqwSvS0BnU=', '12345')).toBe(
      true,
    );
    expect(
      validateTwilioSignature(
        url,
        { ...params, Digits: '9' },
        'L/OH5YylLD5NRKLltdqwSvS0BnU=',
        '12345',
      ),
    ).toBe(false);
    expect(validateTwilioSignature(url, params, undefined, '12345')).toBe(false);
  });

  it('escapes everything it puts into TwiML', () => {
    const xml = connectStreamTwiml({
      streamUrl: 'wss://x/s?a=1&b=2',
      disclosure: 'Hi <there> & "you"',
      goodbye: 'Bye',
      parameters: { token: 'a"b' },
    });
    expect(xml).toContain('Hi &lt;there&gt; &amp; &quot;you&quot;');
    expect(xml).toContain('url="wss://x/s?a=1&amp;b=2"');
    expect(xml).toContain('value="a&quot;b"');
  });
});

describe('voice routes: capabilities', () => {
  it('shows the mic only to an entitled tenant', async () => {
    await start({ web_chat: true, voice_widget: true });
    const on = await app.inject({ method: 'GET', url: '/v1/voice/capabilities/w_demo000001' });
    expect(on.json()).toEqual({ webVoice: true, maxSeconds: 300 });
  });

  it('hides it from a base-package tenant', async () => {
    await start({ web_chat: true });
    const off = await app.inject({ method: 'GET', url: '/v1/voice/capabilities/w_demo000001' });
    expect(off.json().webVoice).toBe(false);
  });
});

describe('voice routes: Twilio incoming webhook', () => {
  async function incoming(params: Record<string, string>, signature?: string) {
    const url = '/v1/voice/twilio/incoming';
    return app.inject({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': signature ?? twilioSignature(BASE + url, params, AUTH_TOKEN),
      },
      payload: new URLSearchParams(params).toString(),
    });
  }
  const call = { CallSid: 'CA1', From: '+447700900123', To: '+441000000001', Direction: 'inbound' };

  it('answers with the AI disclosure and a signed media stream', async () => {
    await start({ phone_agent: true });
    const response = await incoming(call);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    const xml = response.body;
    expect(xml).toMatch(/<Say[^>]*>[^<]*AI assistant/);
    expect(xml).toContain('<Stream url="wss://api.sunny.test/v1/voice/twilio/stream">');
    expect(xml).toMatch(/<Parameter name="token" value="[0-9a-f]{64}"\/>/);
    expect(xml.indexOf('</Connect>')).toBeLessThan(xml.indexOf('Goodbye'));
  });

  it('rejects a forged request', async () => {
    await start({ phone_agent: true });
    const response = await incoming(call, 'forged');
    expect(response.statusCode).toBe(403);
  });

  it('puts a caller straight through to the installer when the add-on is off', async () => {
    await start({ web_chat: true });
    const xml = (await incoming(call)).body;
    expect(xml).toContain(`<Dial>${INSTALLER_NUMBER}</Dial>`);
    expect(xml).not.toContain('<Stream');
  });

  it('turns away a number no installer owns', async () => {
    await start({ phone_agent: true });
    const xml = (await incoming({ ...call, To: '+449999999999' })).body;
    expect(xml).toContain('not in service');
  });
});

describe('voice routes: outbound calls', () => {
  it('needs the admin token and calls Twilio with our webhook', async () => {
    await start({ phone_agent: true });
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/voice/twilio/outbound',
      payload: { tenantId: 't_demo0001', to: '+447700900123' },
    });
    expect(denied.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/voice/twilio/outbound',
      headers: { authorization: 'Bearer admin-token' },
      payload: { tenantId: 't_demo0001', to: '+447700900123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(fetchCalls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json');
    expect(fetchCalls[0]!.body.get('Url')).toBe(`${BASE}/v1/voice/twilio/incoming`);
    expect(fetchCalls[0]!.body.get('From')).toBe('+441000000001');
  });
});

describe('voice routes: WebSockets', () => {
  async function listen(): Promise<string> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    return `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  function collect(ws: WebSocket) {
    const json: Record<string, unknown>[] = [];
    const binary: Buffer[] = [];
    ws.on('message', (data, isBinary) => {
      if (isBinary) binary.push(Buffer.from(data as Buffer));
      else json.push(JSON.parse(rawText(data)) as Record<string, unknown>);
    });
    return { json, binary };
  }

  it('web voice: authenticates with the widget session and bridges audio both ways', async () => {
    await start({ web_chat: true, voice_widget: true });
    const base = await listen();
    const ws = new WebSocket(`${base}/v1/voice`);
    const got = collect(ws);
    await new Promise((r) => ws.on('open', r));
    const token = issueSessionToken(
      { sessionId: 'sess_web_1', tenantId: 't_demo0001', expiresAt: NOW + 60_000, origin: null },
      SECRET,
    );
    ws.send(JSON.stringify({ type: 'start', token }));
    await waitFor(() => got.json.some((m) => m.type === 'ready'));

    ws.send(Buffer.from([1, 2, 3, 4]), { binary: true });
    await waitFor(() => live.sent.length > 1);
    expect(live.sent[1]).toEqual({
      realtimeInput: {
        audio: {
          data: Buffer.from([1, 2, 3, 4]).toString('base64'),
          mimeType: 'audio/pcm;rate=16000',
        },
      },
    });

    live.emit({ kind: 'audio', data: Buffer.from([9, 9]).toString('base64') });
    await waitFor(() => got.binary.length > 0);
    expect(Array.from(got.binary[0]!)).toEqual([9, 9]);
    ws.close();
  });

  it('web voice: refuses a tenant without the add-on', async () => {
    await start({ web_chat: true });
    const base = await listen();
    const ws = new WebSocket(`${base}/v1/voice`);
    const got = collect(ws);
    await new Promise((r) => ws.on('open', r));
    const token = issueSessionToken(
      { sessionId: 's2', tenantId: 't_demo0001', expiresAt: NOW + 60_000, origin: null },
      SECRET,
    );
    ws.send(JSON.stringify({ type: 'start', token }));
    await waitFor(() => got.json.some((m) => m.type === 'error'));
    expect(got.json.find((m) => m.type === 'error')).toMatchObject({ code: 'not_enabled' });
  });

  it('web voice: refuses a bad session token', async () => {
    await start({ voice_widget: true });
    const base = await listen();
    const ws = new WebSocket(`${base}/v1/voice`);
    const got = collect(ws);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'start', token: 'nope' }));
    await waitFor(() => got.json.some((m) => m.type === 'error'));
    expect(got.json[0]).toMatchObject({ code: 'unauthorized' });
  });

  it('phone stream: transcodes audio, texts a link, transfers to the installer, meters the call', async () => {
    await start({ phone_agent: true });
    const xml = (
      await app.inject({
        method: 'POST',
        url: '/v1/voice/twilio/incoming',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': twilioSignature(
            `${BASE}/v1/voice/twilio/incoming`,
            { CallSid: 'CA42', From: '+447700900123', To: '+441000000001' },
            AUTH_TOKEN,
          ),
        },
        payload: 'CallSid=CA42&From=%2B447700900123&To=%2B441000000001',
      })
    ).body;
    const token = /name="token" value="([0-9a-f]+)"/.exec(xml)![1]!;

    const base = await listen();
    const ws = new WebSocket(`${base}/v1/voice/twilio/stream`);
    const got = collect(ws);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ event: 'connected' }));
    ws.send(
      JSON.stringify({
        event: 'start',
        streamSid: 'MZ1',
        start: {
          streamSid: 'MZ1',
          callSid: 'CA42',
          customParameters: {
            tenantId: 't_demo0001',
            caller: '+447700900123',
            called: '+441000000001',
            token,
          },
        },
      }),
    );
    await waitFor(() => live.sent.length > 0);

    // 20 ms of mu-law (160 bytes) in, 20 ms of PCM16 at 16 kHz (640 bytes) to Live.
    const mulaw = Buffer.alloc(160, linearToMulaw(1000));
    ws.send(
      JSON.stringify({
        event: 'media',
        streamSid: 'MZ1',
        media: { track: 'inbound', payload: mulaw.toString('base64') },
      }),
    );
    await waitFor(() => live.sent.length > 1);
    const audio = (live.sent[1] as { realtimeInput: { audio: { data: string } } }).realtimeInput
      .audio.data;
    expect(Buffer.from(audio, 'base64').length).toBe(640);

    // 20 ms of 24 kHz PCM back out as 160 mu-law bytes in a Twilio media frame.
    live.emit({ kind: 'audio', data: Buffer.alloc(960).toString('base64') });
    await waitFor(() => got.json.some((m) => m.event === 'media'));
    const media = got.json.find((m) => m.event === 'media') as {
      streamSid: string;
      media: { payload: string };
    };
    expect(media.streamSid).toBe('MZ1');
    expect(Buffer.from(media.media.payload, 'base64').length).toBe(160);

    live.emit({ kind: 'interrupted' });
    await waitFor(() => got.json.some((m) => m.event === 'clear'));

    live.emit({
      kind: 'tool_call',
      calls: [{ id: 't1', name: 'send_sms_link', args: { purpose: 'book_survey' } }],
    });
    await waitFor(() => fetchCalls.length > 0);
    expect(fetchCalls[0]!.url).toContain('/Messages.json');
    expect(fetchCalls[0]!.body.get('To')).toBe('+447700900123');
    expect(fetchCalls[0]!.body.get('From')).toBe('+441000000001');
    expect(fetchCalls[0]!.body.get('Body')).toContain('https://northwind.example');

    live.emit({
      kind: 'tool_call',
      calls: [{ id: 't2', name: 'transfer_to_human', args: { reason: 'asked for a person' } }],
    });
    await waitFor(() => fetchCalls.length > 1);
    expect(fetchCalls[1]!.url).toContain('/Calls/CA42.json');
    expect(fetchCalls[1]!.body.get('Twiml')).toContain(`<Dial>${INSTALLER_NUMBER}</Dial>`);
    await waitFor(() => usage.entries.length > 0);
    expect(usage.entries[0]).toMatchObject({
      kind: 'phone',
      callSid: 'CA42',
      endReason: 'transferred',
    });
  });

  it('phone stream: refuses a stream whose token does not match the call', async () => {
    await start({ phone_agent: true });
    const base = await listen();
    const ws = new WebSocket(`${base}/v1/voice/twilio/stream`);
    await new Promise((r) => ws.on('open', r));
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.send(
      JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MZ2',
          callSid: 'CA99',
          customParameters: { tenantId: 't_demo0001', token: 'f'.repeat(64) },
        },
      }),
    );
    expect(await closed).toBe(1008);
    expect(live.handlers).toBeNull();
  });
});
