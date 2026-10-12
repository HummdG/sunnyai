/**
 * Audio plumbing between the three formats a voice call touches.
 *
 * - **Twilio Media Streams**: G.711 mu-law, 8 kHz, mono, base64, no header.
 * - **Gemini Live API input**: raw 16-bit little-endian PCM, 16 kHz, mono
 *   (`audio/pcm;rate=16000`).
 * - **Gemini Live API output**: raw 16-bit little-endian PCM, 24 kHz, mono.
 *
 * Sources: https://www.twilio.com/docs/voice/media-streams/websocket-messages
 * and https://ai.google.dev/gemini-api/docs/live-guide (checked 2026-10-12).
 *
 * The resampler is linear interpolation. That is deliberate: telephone audio is
 * band-limited to ~3.4 kHz already, so a polyphase filter would buy nothing a
 * caller can hear, and the call path has to stay cheap per frame.
 */

const BIAS = 0x84;
const CLIP = 32635;

/** Encode one signed 16-bit sample as G.711 mu-law. */
export function linearToMulaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Decode one G.711 mu-law byte to a signed 16-bit sample. */
export function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -magnitude : magnitude;
}

/** Bytes of little-endian PCM16 to samples. */
export function pcm16FromBytes(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length >> 1);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Samples to little-endian PCM16 bytes. */
export function pcm16ToBytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i]!, true);
  return out;
}

/** Linear-interpolation resample between integer rates. */
export function resample(samples: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || samples.length === 0) return samples.slice();
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Int16Array(length);
  const step = fromRate / toRate;
  for (let i = 0; i < length; i++) {
    const pos = i * step;
    const left = Math.floor(pos);
    const right = Math.min(samples.length - 1, left + 1);
    const frac = pos - left;
    const a = samples[Math.min(left, samples.length - 1)]!;
    const b = samples[right]!;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

/** A Twilio media payload (base64 mu-law 8 kHz) as Live API input (base64 PCM16 16 kHz). */
export function twilioToLive(payloadBase64: string): string {
  const mulaw = Buffer.from(payloadBase64, 'base64');
  const pcm8k = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) pcm8k[i] = mulawToLinear(mulaw[i]!);
  return Buffer.from(pcm16ToBytes(resample(pcm8k, 8000, 16000))).toString('base64');
}

/** Live API output (base64 PCM16 24 kHz) as a Twilio media payload (base64 mu-law 8 kHz). */
export function liveToTwilio(pcmBase64: string, fromRate = 24000): string {
  const pcm = pcm16FromBytes(Buffer.from(pcmBase64, 'base64'));
  const pcm8k = resample(pcm, fromRate, 8000);
  const out = Buffer.alloc(pcm8k.length);
  for (let i = 0; i < pcm8k.length; i++) out[i] = linearToMulaw(pcm8k[i]!);
  return out.toString('base64');
}

/** Duration in milliseconds of a run of PCM16 bytes at `rate`. */
export function pcmDurationMs(byteLength: number, rate: number): number {
  return (byteLength / 2 / rate) * 1000;
}
