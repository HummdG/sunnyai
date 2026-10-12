import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { ApiError } from '@sunny/contracts';
import type { KnowledgeIndex } from '@sunny/knowledge';
import type { FastifyInstance } from 'fastify';
import WebSocket, { WebSocketServer } from 'ws';

import { NotEntitledError } from '../agent/channels.js';
import { supportLine } from '../agent/support.js';
import type { Auditor } from '../audit.js';
import { liveToTwilio, twilioToLive } from '../channels/voice/audio.js';
import { loadVoiceConfig, type VoiceConfig } from '../channels/voice/config.js';
import { geminiLiveConnector, rawText, type LiveConnector } from '../channels/voice/live.js';
import {
  VoiceSession,
  activeCount,
  type EndReason,
  type Timers,
  type VoiceClientEvent,
  type VoiceTransport,
} from '../channels/voice/session.js';
import { registerVoiceTools } from '../channels/voice/tools.js';
import {
  connectStreamTwiml,
  parseForm,
  sayAndHangupTwiml,
  sendSms,
  startCall,
  transferTwiml,
  updateCall,
  validateTwilioSignature,
  type Fetch,
} from '../channels/voice/twilio.js';
import { FileVoiceUsage, type VoiceUsageLedger } from '../channels/voice/usage.js';
import { hasEntitlement, type AddonKey } from '../entitlements.js';
import { verifySessionToken } from '../sessions.js';
import type { Store } from '../store.js';
import type { Tenant, TenantRegistry } from '../tenants.js';

/**
 * The Voice & Phone add-on's routes (Blueprint §5, Add-On 1; §7 Phase 2).
 *
 *   GET  /v1/voice/capabilities/:publicId  whether the widget shows a mic
 *   WS   /v1/voice                          in-widget web voice
 *   POST /v1/voice/twilio/incoming          Twilio voice webhook -> TwiML
 *   WS   /v1/voice/twilio/stream            Twilio Media Streams
 *   POST /v1/voice/twilio/outbound          place a call (admin token)
 *
 * See docs/integration/voice.md.
 */

export interface VoiceRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  sessionSecret: string;
  allowedOrigins: readonly string[];
  originOnDomains: (origin: string, domains: readonly string[]) => boolean;
  loadKnowledgeIndex: (tenantId: string) => Promise<KnowledgeIndex>;
  dataDir: string;
  adminToken: string | null;
  auditor?: Auditor;
  /** Read from the environment when absent. */
  voice?: VoiceConfig;
  /** The Live API connector; the real Gemini one when absent and a key is set. */
  connector?: LiveConnector;
  usage?: VoiceUsageLedger;
  fetch?: Fetch;
  now?: () => number;
  timers?: Timers;
}

/** Optional voice settings this module reads beyond `VoiceChannelConfig`. */
interface VoiceExtras {
  /** Where `send_sms_link` points; the tenant's website when unset. */
  bookingUrl?: string;
  /** The opening disclosure on calls; a default when unset. */
  disclosure?: string;
}

function extras(tenant: Tenant): VoiceExtras {
  return tenant.config.voice ?? {};
}

function disclosureFor(tenant: Tenant): string {
  return (
    extras(tenant).disclosure ??
    `Hello, you've reached ${tenant.config.companyName}. You're speaking with Sunny, an AI assistant. ` +
      'This call may be transcribed so the team can follow up.'
  );
}

/** HMAC token binding a Twilio stream to the call and tenant the webhook approved. */
function streamToken(secret: string, tenantId: string, callSid: string): string {
  return createHmac('sha256', secret).update(`voice-stream:${tenantId}:${callSid}`).digest('hex');
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const normaliseNumber = (n: string): string => n.replace(/[^\d+]/g, '');
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function registerVoiceRoutes(app: FastifyInstance, deps: VoiceRouteDeps): void {
  const voice = deps.voice ?? loadVoiceConfig(process.env);
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const usage = deps.usage ?? new FileVoiceUsage(deps.dataDir);
  const connector: LiveConnector | null =
    deps.connector ?? (voice.apiKey ? geminiLiveConnector(voice.liveUrl, voice.apiKey) : null);
  const sessions = new Set<VoiceSession>();
  registerVoiceTools();

  const log = (message: string, detail?: Record<string, unknown>): void =>
    app.log.warn(detail ?? {}, message);

  /** Why a session cannot start now, or null. */
  async function refusal(tenant: Tenant, addon: AddonKey): Promise<string | null> {
    if (!connector) return 'unavailable';
    if (!hasEntitlement(tenant, addon, now())) return 'not_enabled';
    const cap = tenant.config.voice?.concurrency ?? voice.defaultConcurrency;
    if (activeCount(tenant.id) >= cap) return 'busy';
    const quotaMinutes = tenant.addonConfig?.[addon]?.monthlyQuota;
    if (typeof quotaMinutes === 'number') {
      const used = await usage.secondsThisMonth(tenant.id, now());
      if (used >= quotaMinutes * 60) return 'quota';
    }
    return null;
  }

  function maxSecondsFor(tenant: Tenant): number {
    const own = tenant.config.voice?.maxCallSeconds;
    return Math.min(voice.maxSessionSeconds, own && own > 0 ? own : voice.maxSessionSeconds);
  }

  // ── capabilities ─────────────────────────────────────────────────────────

  app.get<{ Params: { publicId: string } }>('/v1/voice/capabilities/:publicId', (request) => {
    const tenant = deps.tenants.byPublicId(request.params.publicId);
    if (!tenant) throw new ApiError('not_found', 'Unknown widget.');
    return {
      webVoice: connector !== null && hasEntitlement(tenant, 'voice_widget', now()),
      maxSeconds: maxSecondsFor(tenant),
    };
  });

  // ── Twilio webhooks (form-encoded) ───────────────────────────────────────

  app.register((scope, _options, registered) => {
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, parseForm(String(body))),
    );

    scope.post('/v1/voice/twilio/incoming', async (request, reply) => {
      const twilio = voice.twilio;
      if (!twilio || !voice.publicBaseUrl) {
        throw new ApiError('not_enabled', 'The phone agent is not configured on this deployment.');
      }
      const params = (request.body ?? {}) as Record<string, string>;
      const url = `${voice.publicBaseUrl}${request.url}`;
      const signature = request.headers['x-twilio-signature'];
      if (
        !validateTwilioSignature(
          url,
          params,
          typeof signature === 'string' ? signature : undefined,
          twilio.authToken,
        )
      ) {
        throw new ApiError('forbidden', 'Invalid Twilio signature.');
      }

      const callSid = params.CallSid ?? '';
      const to = normaliseNumber(params.To ?? '');
      const from = normaliseNumber(params.From ?? '');
      // Inbound: the installer's number was called. Outbound: we called from it.
      const tenant =
        tenantForNumber(to) ??
        (params.Direction?.startsWith('outbound') ? tenantForNumber(from) : null);
      reply.type('text/xml');
      if (!tenant) return sayAndHangupTwiml('Sorry, this number is not in service.');

      const reason = await refusal(tenant, 'phone_agent');
      if (reason !== null) {
        // Never strand a caller: put them through to the installer if we can.
        const phone = tenant.config.supportContact?.phone?.trim();
        return phone
          ? transferTwiml(`Connecting you to ${tenant.config.companyName}.`, phone)
          : sayAndHangupTwiml(supportLine(tenant));
      }

      const caller = params.Direction?.startsWith('outbound') ? to : from;
      const streamUrl = `${voice.publicBaseUrl.replace(/^http/, 'ws')}/v1/voice/twilio/stream`;
      return connectStreamTwiml({
        streamUrl,
        disclosure: disclosureFor(tenant),
        goodbye: `Thanks for calling ${tenant.config.companyName}. Goodbye.`,
        parameters: {
          tenantId: tenant.id,
          caller,
          called: params.Direction?.startsWith('outbound') ? from : to,
          token: streamToken(deps.sessionSecret, tenant.id, callSid),
        },
      });
    });
    registered();
  });

  function tenantForNumber(number: string): Tenant | null {
    if (!number) return null;
    return (
      deps.tenants.all.find((t) =>
        (t.config.voice?.twilioNumbers ?? []).some((n) => normaliseNumber(n) === number),
      ) ?? null
    );
  }

  // ── outbound calls ───────────────────────────────────────────────────────

  app.post('/v1/voice/twilio/outbound', async (request) => {
    const auth = request.headers.authorization;
    const presented = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (deps.adminToken === null || !tokenMatches(presented, deps.adminToken)) {
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }
    const twilio = voice.twilio;
    if (!twilio || !voice.publicBaseUrl) {
      throw new ApiError('not_enabled', 'The phone agent is not configured on this deployment.');
    }
    const body = (request.body ?? {}) as { tenantId?: unknown; to?: unknown };
    const tenant = typeof body.tenantId === 'string' ? deps.tenants.byId(body.tenantId) : null;
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    if (!hasEntitlement(tenant, 'phone_agent', now())) {
      throw new ApiError('not_enabled', new NotEntitledError('voice').message);
    }
    const to = typeof body.to === 'string' ? normaliseNumber(body.to) : '';
    if (!/^\+\d{8,15}$/.test(to))
      throw new ApiError('bad_request', 'A number in E.164 form is required.');
    const from = tenant.config.voice?.twilioNumbers?.[0];
    if (!from) throw new ApiError('bad_request', 'This installer has no phone number assigned.');
    const call = await startCall(fetchImpl, twilio, {
      to,
      from,
      url: `${voice.publicBaseUrl}/v1/voice/twilio/incoming`,
    });
    return { callSid: call.sid };
  });

  // ── WebSockets ───────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== '/v1/voice' && path !== '/v1/voice/twilio/stream') return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (path === '/v1/voice') webVoice(ws, request);
      else twilioStream(ws);
    });
  };
  app.server.on('upgrade', onUpgrade);
  app.addHook('onClose', async () => {
    app.server.off('upgrade', onUpgrade);
    for (const session of sessions) session.end('upstream_closed');
    await Promise.all([...sessions].map((s) => s.settled()));
    wss.close();
  });

  async function startSession(session: VoiceSession): Promise<void> {
    sessions.add(session);
    try {
      await session.start();
    } catch (error) {
      sessions.delete(session);
      throw error;
    }
  }

  /** In-widget voice. The first message authenticates with the widget session token. */
  function webVoice(ws: WebSocket, request: IncomingMessage): void {
    let session: VoiceSession | null = null;
    const send = (message: Record<string, unknown>): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const fail = (code: string, message: string): void => {
      send({ type: 'error', code, message });
      ws.close(1008, code);
    };
    const authTimer = setTimeout(() => {
      if (!session) fail('unauthorized', 'No start message.');
    }, 10_000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (session) session.audio(Buffer.from(data as Buffer).toString('base64'));
        return;
      }
      let message: { type?: unknown; token?: unknown; muted?: unknown };
      try {
        message = JSON.parse(rawText(data)) as typeof message;
      } catch {
        return;
      }
      if (message.type === 'start' && !session) {
        void (async () => {
          clearTimeout(authTimer);
          const claims = verifySessionToken(
            typeof message.token === 'string' ? message.token : undefined,
            deps.sessionSecret,
            now(),
          );
          if (!claims) return fail('unauthorized', 'A valid session token is required.');
          const tenant = deps.tenants.byId(claims.tenantId);
          if (!tenant) return fail('not_found', 'Unknown tenant for this session.');
          // The browser's own Origin header must be one the installer registered,
          // as for the chat session (Blueprint §4.6).
          const origin = typeof request.headers.origin === 'string' ? request.headers.origin : null;
          if (
            deps.allowedOrigins.length > 0 &&
            (!origin || !deps.allowedOrigins.includes(origin))
          ) {
            return fail('forbidden', 'This origin is not allowed.');
          }
          if (tenant.domains && tenant.domains.length > 0) {
            if (!origin || !deps.originOnDomains(origin, tenant.domains)) {
              return fail('forbidden', 'This site is not registered for this assistant.');
            }
          }
          const reason = await refusal(tenant, 'voice_widget');
          if (reason !== null) return fail(reason, refusalMessage(reason));

          const transport: VoiceTransport = {
            sendAudio: (b64) => {
              if (ws.readyState === WebSocket.OPEN)
                ws.send(Buffer.from(b64, 'base64'), { binary: true });
            },
            clear: () => send({ type: 'clear' }),
            event: (event: VoiceClientEvent) => send(event),
            end: (endReason: EndReason, text: string) => {
              send({ type: 'ending', reason: endReason, text });
              ws.close(1000, endReason);
            },
          };
          session = new VoiceSession({
            kind: 'web',
            tenant,
            store: deps.store,
            sessionId: claims.sessionId,
            knowledge: await deps.loadKnowledgeIndex(tenant.id),
            connector: connector!,
            model: voice.liveModel,
            maxSeconds: maxSecondsFor(tenant),
            transport,
            usage,
            origin: claims.origin ?? null,
            ...(deps.auditor ? { audit: deps.auditor } : {}),
            now,
            ...(deps.timers ? { timers: deps.timers } : {}),
            log,
          });
          try {
            await startSession(session);
          } catch (error) {
            session = null;
            if (error instanceof NotEntitledError) return fail('not_enabled', error.message);
            return fail('internal', 'Voice could not start.');
          }
        })();
        return;
      }
      if (!session) return;
      if (message.type === 'mute') session.mute(message.muted === true);
      if (message.type === 'interrupt') session.interrupt();
      if (message.type === 'stop') session.end('caller_hangup');
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (session) {
        session.end('caller_hangup');
        sessions.delete(session);
      }
    });
  }

  /** Twilio Media Streams for the phone receptionist. */
  function twilioStream(ws: WebSocket): void {
    let session: VoiceSession | null = null;
    let streamSid = '';
    const send = (message: Record<string, unknown>): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    ws.on('message', (data) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(rawText(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.event === 'start' && !session) {
        const start = (message.start ?? {}) as Record<string, unknown>;
        const params = (start.customParameters ?? {}) as Record<string, string>;
        streamSid = text(start.streamSid) || text(message.streamSid);
        const callSid = text(start.callSid);
        const tenant = deps.tenants.byId(params.tenantId ?? '');
        if (
          !tenant ||
          !tokenMatches(params.token ?? '', streamToken(deps.sessionSecret, tenant.id, callSid))
        ) {
          ws.close(1008, 'unauthorized');
          return;
        }
        void (async () => {
          const reason = await refusal(tenant, 'phone_agent');
          if (reason !== null) {
            ws.close(1000, reason);
            return;
          }
          const twilio = voice.twilio;
          const installerPhone = tenant.config.supportContact?.phone?.trim() ?? '';
          let current: VoiceSession | null = null;
          const transport: VoiceTransport = {
            sendAudio: (b64) =>
              send({ event: 'media', streamSid, media: { payload: liveToTwilio(b64) } }),
            clear: () => send({ event: 'clear', streamSid }),
            event: () => {},
            // Closing the stream lets Twilio carry on with the TwiML after
            // <Connect>: the goodbye and hang-up. A transfer has already
            // replaced the call's instructions.
            end: () => ws.close(1000),
          };
          current = new VoiceSession({
            kind: 'phone',
            tenant,
            store: deps.store,
            sessionId: `call_${callSid}`,
            knowledge: await deps.loadKnowledgeIndex(tenant.id),
            connector: connector!,
            model: voice.liveModel,
            maxSeconds: maxSecondsFor(tenant),
            transport,
            usage,
            callerNumber: params.caller ?? null,
            callSid,
            ...(deps.auditor ? { audit: deps.auditor } : {}),
            now,
            ...(deps.timers ? { timers: deps.timers } : {}),
            log,
            transfer: async (why) => {
              if (!twilio || !installerPhone) {
                return {
                  ok: false,
                  note: 'No installer number is configured. Offer to take their details for a callback instead.',
                };
              }
              const message = why.startsWith('safety: ')
                ? `${why.slice('safety: '.length)} I'll put you through to ${tenant.config.companyName} now.`
                : `Putting you through to ${tenant.config.companyName} now.`;
              await updateCall(fetchImpl, twilio, callSid, transferTwiml(message, installerPhone));
              current?.end('transferred');
              return { ok: true, note: 'The call is being transferred.' };
            },
            sendSms: async (purpose) => {
              const link = extras(tenant).bookingUrl ?? tenant.websiteUrl ?? null;
              const to = params.caller ?? '';
              const from = params.called || twilio?.fromNumber || '';
              if (!twilio || !link || !to || !from) {
                return { ok: false, note: 'A text could not be sent from this line.' };
              }
              const what = purpose === 'quote_request' ? 'Request your quote' : 'Book your survey';
              await sendSms(fetchImpl, twilio, {
                to,
                from,
                body: `${tenant.config.companyName}: ${what} here: ${link}`,
              });
              return { ok: true, note: 'The link has been texted to the caller.' };
            },
          });
          session = current;
          try {
            await startSession(current);
          } catch {
            session = null;
            ws.close(1011, 'voice could not start');
          }
        })();
        return;
      }
      if (message.event === 'media' && session) {
        const media = (message.media ?? {}) as Record<string, unknown>;
        if (media.track === undefined || media.track === 'inbound') {
          if (typeof media.payload === 'string') session.audio(twilioToLive(media.payload));
        }
        return;
      }
      if (message.event === 'stop' && session) session.end('caller_hangup');
    });
    ws.on('close', () => {
      if (session) {
        session.end('caller_hangup');
        sessions.delete(session);
      }
    });
  }
}

function refusalMessage(reason: string): string {
  switch (reason) {
    case 'not_enabled':
      return new NotEntitledError('voice').message;
    case 'busy':
      return 'All voice lines are busy right now. Please try again shortly, or use the chat.';
    case 'quota':
      return "This month's voice minutes have been used. Please use the chat instead.";
    default:
      return 'Voice is not available on this deployment.';
  }
}
