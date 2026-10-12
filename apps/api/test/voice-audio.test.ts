import { describe, expect, it } from 'vitest';

import {
  linearToMulaw,
  liveToTwilio,
  mulawToLinear,
  pcm16FromBytes,
  pcm16ToBytes,
  resample,
  twilioToLive,
} from '../src/channels/voice/audio.js';

describe('voice audio: G.711 mu-law', () => {
  it('matches the reference encodings at the ends of the range', () => {
    // ITU-T G.711: silence is 0xFF, the positive and negative peaks 0x80 and 0x00.
    expect(linearToMulaw(0)).toBe(0xff);
    expect(linearToMulaw(32767)).toBe(0x80);
    expect(linearToMulaw(-32768)).toBe(0x00);
    expect(mulawToLinear(0xff)).toBe(0);
  });

  it('round-trips within the codec quantisation error', () => {
    for (const sample of [-32000, -12345, -1000, -50, 0, 50, 1000, 12345, 32000]) {
      const back = mulawToLinear(linearToMulaw(sample));
      // mu-law keeps roughly 3% relative precision, plus a small floor near zero.
      expect(Math.abs(back - sample)).toBeLessThanOrEqual(Math.abs(sample) * 0.04 + 8);
    }
  });

  it('decodes every byte to a value that re-encodes to the same byte', () => {
    for (let byte = 0; byte < 256; byte++) {
      // 0x7F and 0xFF are both zero; zero encodes as 0xFF.
      const expected = byte === 0x7f ? 0xff : byte;
      expect(linearToMulaw(mulawToLinear(byte))).toBe(expected);
    }
  });
});

describe('voice audio: PCM and resampling', () => {
  it('packs and unpacks little-endian PCM16', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    const bytes = pcm16ToBytes(samples);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0, 0, 1, 0]);
    expect(Array.from(pcm16FromBytes(bytes))).toEqual(Array.from(samples));
  });

  it('resamples to the right length and preserves a slow signal', () => {
    const tone = Int16Array.from({ length: 800 }, (_, i) =>
      Math.round(8000 * Math.sin((2 * Math.PI * 200 * i) / 8000)),
    );
    const up = resample(tone, 8000, 16000);
    expect(up.length).toBe(1600);
    expect(up[200]).toBeCloseTo(tone[100]!, -2);
    const down = resample(up, 16000, 8000);
    expect(down.length).toBe(800);
    for (let i = 0; i < 800; i += 37) expect(Math.abs(down[i]! - tone[i]!)).toBeLessThan(200);
  });

  it('converts Twilio mu-law 8 kHz to Live PCM16 16 kHz and back', () => {
    const tone = Int16Array.from({ length: 160 }, (_, i) =>
      Math.round(6000 * Math.sin((2 * Math.PI * 300 * i) / 8000)),
    );
    const mulaw = Buffer.from(tone.map((s) => linearToMulaw(s)));
    const live = Buffer.from(twilioToLive(mulaw.toString('base64')), 'base64');
    // 160 samples at 8 kHz (20 ms) become 320 samples at 16 kHz: 640 bytes.
    expect(live.length).toBe(640);

    // Live speaks at 24 kHz; 20 ms is 480 samples, which come back as 160 mu-law bytes.
    const pcm24 = resample(tone, 8000, 24000);
    const back = Buffer.from(
      liveToTwilio(Buffer.from(pcm16ToBytes(pcm24)).toString('base64')),
      'base64',
    );
    expect(back.length).toBe(160);
    for (let i = 0; i < 160; i += 11) {
      expect(Math.abs(mulawToLinear(back[i]!) - tone[i]!)).toBeLessThan(450);
    }
  });
});
