import { describe, expect, it } from 'vitest';

import { captionText, floatToPcm16k, pcm16ToFloat } from '../src/voice.js';

describe('widget voice: audio helpers', () => {
  it('downsamples 48 kHz microphone audio to 16 kHz PCM16', () => {
    const input = new Float32Array(480).fill(0.5); // 10 ms at 48 kHz
    const out = floatToPcm16k(input, 48000);
    expect(out.length).toBe(160); // 10 ms at 16 kHz
    expect(out[0]).toBe(Math.round(0.5 * 0x7fff));
  });

  it('clips out-of-range samples instead of wrapping', () => {
    const out = floatToPcm16k(Float32Array.from([2, -2, 0]), 16000);
    expect(Array.from(out)).toEqual([0x7fff, -0x8000, 0]);
  });

  it('decodes little-endian PCM16 from the server', () => {
    const bytes = new ArrayBuffer(4);
    const view = new DataView(bytes);
    view.setInt16(0, 0x4000, true);
    view.setInt16(2, -0x8000, true);
    expect(Array.from(pcm16ToFloat(bytes))).toEqual([0.5, -1]);
  });
});

describe('widget voice: captions', () => {
  it('accepts only text, and bounds it', () => {
    expect(captionText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
    expect(captionText({ html: 'x' })).toBe('');
    expect(captionText('a'.repeat(1000))).toHaveLength(600);
  });
});
