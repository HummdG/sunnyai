# Voice & Phone add-on

**Package:** + Voice & Phone (Blueprint §5 Add-On 1, §6.3: +£199/mo).
**Entitlements:** `voice_widget` (mic in the widget), `phone_agent` (AI phone
receptionist). **Status (2026-10-12):** built and tested against fakes; **not
yet run against a real Gemini Live session or a real Twilio number** — blocked
on owner accounts (see the end).

## Architecture

One Gemini Live session per conversation, held by the API (`apps/api`). The
browser and Twilio both talk to our server; the Gemini API key never leaves it.

```
widget mic ──ws /v1/voice (PCM16 16k)──┐                      ┌── Gemini Live API
                                       ├── VoiceSession ──────┤   (speech in/out,
Twilio call ─ws /v1/voice/twilio/stream┘   (channels/voice)   │    tool calls)
             (mu-law 8k, transcoded)          │               └──
                                              ├─ agent/prompt.ts   buildSystemInstruction(tenant, 'voice')
                                              ├─ agent/channels.ts voice tool allowlist, toSpokenText, entitlement
                                              ├─ agent/tools.ts    executeTool (+ transfer_to_human, send_sms_link)
                                              ├─ agent/support.ts  safety triage, intent, installer support line
                                              └─ store.appendTurn  unified inbox: channel 'voice', intent, escalation
```

The Live API is the model loop, so `runTurn` (which drives a text
`ChatProvider`) is not called; every rule around the model — instructions,
tool allowlist, tool execution, output policy, safety, entitlements, logging —
is the same code the chat uses.

| File                                     | What it does                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/api/src/channels/voice/live.ts`    | Live API wire format: setup, audio, tool responses; parses server messages      |
| `apps/api/src/channels/voice/session.ts` | The bridge: audio both ways, captions, barge-in, tools, safety, 5-min cap, logs |
| `apps/api/src/channels/voice/audio.ts`   | G.711 mu-law codec and 8/16/24 kHz resampling                                   |
| `apps/api/src/channels/voice/twilio.ts`  | Signature validation, TwiML, Messages and Calls REST                            |
| `apps/api/src/channels/voice/tools.ts`   | Registers `transfer_to_human`, `send_sms_link` with the core                    |
| `apps/api/src/channels/voice/usage.ts`   | Voice-minute ledger (per tenant per month)                                      |
| `apps/api/src/routes/voice.ts`           | HTTP + WebSocket routes                                                         |
| `packages/widget/src/voice.ts`           | `sunny-voice.js`, lazily loaded: consent, mic capture, playback, captions       |

## Behaviour

- **Voice output rule** (Blueprint §5, verbatim, from `agent/channels.ts`):
  "Respond in 1 to 2 concise spoken sentences (<40 words). Do not use markdown,
  bullet points, or raw URLs." Captions and transcripts pass through
  `toSpokenText`; an answer that runs past 60 spoken words is cut off.
- **Barge-in:** Live's `interrupted` clears queued playback (web: stops audio
  nodes; phone: Twilio `clear`). The widget also has "Stop Sunny talking".
- **Safety:** the caller's words are checked as they are transcribed. On a
  safety phrase the model's audio is cut, the fixed safety line (and the
  installer's number) is given — spoken by the browser's speech synthesis on
  the web, by Twilio `<Say>` on the phone — the turn is flagged
  `escalation: 'safety'`, and a phone caller is put through to the installer.
- **Limits** (Blueprint §5 matrix): sessions end at 5 minutes (a wrap-up nudge
  20 s before, then a spoken goodbye); per-tenant concurrency
  (`config.voice.concurrency`, default 2); monthly minutes
  (`addonConfig.voice_widget|phone_agent.monthlyQuota`, in minutes).
- **Phone:** inbound calls hear the AI/transcription disclosure first. If the
  tenant lacks `phone_agent`, is over quota or busy, the caller is put straight
  through to the installer's number instead. `transfer_to_human` redirects the
  live call to `<Dial>` the installer (`supportContact.phone`, the owner's
  2026-10-12 decision); `send_sms_link` texts the booking link
  (`config.voice.bookingUrl`, else the website) from the number that was called.
- **Inbox:** every utterance is a conversation turn with `channel: 'voice'`,
  `intent` and `escalation`; web voice joins the visitor's chat conversation,
  a phone call is the conversation `call_<CallSid>`.

## Protocols

**Web (`/v1/voice`)** — client sends `{type:'start', token}` (the widget session
token) first, then binary PCM16 LE 16 kHz mono frames; also `{type:'mute',
muted}`, `{type:'interrupt'}`, `{type:'stop'}`. Server sends binary PCM16 24 kHz
and JSON `ready`, `state`, `caption`, `clear`, `safety`, `lead_saved`,
`handoff`, `ending`, `error`. The browser `Origin` must be on the tenant's
registered domains.

**Twilio** — `POST /v1/voice/twilio/incoming` (form, `X-Twilio-Signature`
checked against `SUNNY_PUBLIC_BASE_URL` + path) returns TwiML:
`<Say>disclosure</Say><Connect><Stream url="wss://…/v1/voice/twilio/stream">`
with `tenantId`, `caller`, `called` and an HMAC `token` binding the stream to the
call; `<Say>goodbye</Say><Hangup/>` play when our stream closes.
`POST /v1/voice/twilio/outbound` (admin token) places a call.

## Sources (checked 2026-10-12)

- Gemini Live API reference: https://ai.google.dev/api/live
- Raw WebSocket guide (endpoint `?key=`, `realtimeInput.audio`, `toolResponse`):
  https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
- Live guide (PCM16 LE, 16 kHz in / 24 kHz out, transcription, interruption,
  `gemini-3.8-live`, 15-minute audio session limit):
  https://ai.google.dev/gemini-api/docs/live-guide
- Twilio request validation (worked example used in tests):
  https://www.twilio.com/docs/usage/security
- Twilio Media Streams messages: https://www.twilio.com/docs/voice/media-streams/websocket-messages

Note: the API reference puts `responseModalities` under `setup.generationConfig`
(used here); the raw WebSocket guide's example puts it directly under `setup`.
Confirm against a real session before launch.

## Configuration

| Variable                  | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `GEMINI_API_KEY`          | Live API (shared with chat)                          |
| `GEMINI_LIVE_MODEL`       | Default `gemini-3.8-live`                            |
| `TWILIO_ACCOUNT_SID`      | Phone agent                                          |
| `TWILIO_AUTH_TOKEN`       | Signature validation and REST calls (Secret Manager) |
| `TWILIO_FROM_NUMBER`      | Fallback SMS sender                                  |
| `SUNNY_PUBLIC_BASE_URL`   | Public https URL of the API, as Twilio reaches it    |
| `SUNNY_VOICE_MAX_SECONDS` | Lower the 300 s cap (never raises it)                |
| `SUNNY_VOICE_CONCURRENCY` | Default per-tenant concurrency                       |

Tenant settings: `config.voice.{twilioNumbers, voiceName, maxCallSeconds,
concurrency}` (portal) and, read if present, `config.voice.bookingUrl` and
`config.voice.disclosure`; `supportContact.phone`; `addonConfig.*.monthlyQuota`.

## Shared state across instances

When the API runs on the Firestore store, voice state is shared by every
instance (chosen automatically in `routes/voice.ts`):

- **Concurrency** (`channels/voice/slots.ts`, `FirestoreVoiceSlots`): one
  `voiceSlots/{tenant}` document holds the live leases. A session claims a slot
  in a transaction when it starts (two instances cannot both take the last
  one), heartbeats every 20 s, and releases it when it ends; a lease not
  heartbeated for 60 s is ignored, so a crashed instance cannot hold slots.
  The `refusal` check before start is only a fast path.
- **Minutes** (`FirestoreVoiceUsage`): each call is kept as a `voiceUsage`
  document (the audit trail) and added atomically to
  `voiceUsageMonthly/{tenant}_{YYYY-MM}`, which the quota check reads.
- Development and single-instance runs use the in-memory slots and the JSONL
  ledger. Tests: `apps/api/test/voice-shared-counters.test.ts`, run against the
  emulator by `npm run test:firestore` (and in CI).

## Known gaps

- **Not run against real providers.** Needs a Gemini API key with Live access,
  and a Twilio account, number and auth token, with the number's voice webhook
  set to `https://<api>/v1/voice/twilio/incoming`.
- **Cloud Run WebSockets** are subject to the request timeout (set it above
  5 minutes) and need session affinity for the media stream.
