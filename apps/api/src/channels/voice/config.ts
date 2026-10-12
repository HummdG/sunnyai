/**
 * Voice & Phone add-on settings, read from the environment.
 *
 * Kept beside the add-on rather than in the API's main config so a deployment
 * without the add-on carries none of it. Secrets (the Gemini key, the Twilio
 * auth token) come from the environment, which Cloud Run fills from Secret
 * Manager; tenants only ever hold references and numbers.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The number SMS links are sent from when a tenant has none of its own. */
  fromNumber: string | null;
}

export interface VoiceConfig {
  /** Gemini API key; null means web voice and the phone agent are unavailable. */
  apiKey: string | null;
  /** Live API model id, without the `models/` prefix. */
  liveModel: string;
  /** Live API WebSocket endpoint (overridable for tests and regional routing). */
  liveUrl: string;
  /** Hard cap on a session or call (Blueprint §5 matrix: max 5 minutes). */
  maxSessionSeconds: number;
  /** Default simultaneous voice sessions per tenant. */
  defaultConcurrency: number;
  twilio: TwilioConfig | null;
  /**
   * The public https base URL of this API, as Twilio reaches it. Needed to
   * validate `X-Twilio-Signature` (which signs the full URL) and to tell Twilio
   * where the media stream WebSocket is.
   */
  publicBaseUrl: string | null;
}

export const LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** Blueprint §5 matrix: "Max 5 min call duration". */
export const MAX_SESSION_SECONDS = 300;

export function loadVoiceConfig(env: Record<string, string | undefined>): VoiceConfig {
  const value = (name: string): string | null => {
    const v = env[name];
    return v === undefined || v.trim() === '' ? null : v.trim();
  };
  const accountSid = value('TWILIO_ACCOUNT_SID');
  const authToken = value('TWILIO_AUTH_TOKEN');
  const requested = Number(value('SUNNY_VOICE_MAX_SECONDS') ?? MAX_SESSION_SECONDS);
  return {
    apiKey: value('GEMINI_API_KEY'),
    liveModel: value('GEMINI_LIVE_MODEL') ?? 'gemini-3.8-live',
    liveUrl: value('GEMINI_LIVE_URL') ?? LIVE_ENDPOINT,
    // Never above the blueprint's cap, whatever the environment says.
    maxSessionSeconds: Number.isFinite(requested)
      ? Math.max(10, Math.min(MAX_SESSION_SECONDS, requested))
      : MAX_SESSION_SECONDS,
    defaultConcurrency: Math.max(1, Number(value('SUNNY_VOICE_CONCURRENCY') ?? 2) || 2),
    twilio:
      accountSid && authToken
        ? { accountSid, authToken, fromNumber: value('TWILIO_FROM_NUMBER') }
        : null,
    publicBaseUrl: value('SUNNY_PUBLIC_BASE_URL')?.replace(/\/+$/, '') ?? null,
  };
}
