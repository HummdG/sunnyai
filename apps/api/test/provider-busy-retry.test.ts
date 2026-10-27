/* eslint-disable @typescript-eslint/require-await -- the fakes implement async calls and have nothing to await */
import { describe, expect, it } from 'vitest';

import { isBusyError, withBusyRetry } from '../src/agent/provider.js';

const busy = () =>
  Object.assign(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'), { status: 429 });

describe('busy model retry', () => {
  it('recognises the busy answers and nothing else', () => {
    expect(isBusyError(busy())).toBe(true);
    expect(isBusyError(new Error('got status: 503 UNAVAILABLE'))).toBe(true);
    expect(isBusyError(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isBusyError(new Error('model not found'))).toBe(false);
  });

  it('retries a busy call until it goes through', async () => {
    let calls = 0;
    const result = await withBusyRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw busy();
        return 'ok';
      },
      undefined,
      [1, 1, 1],
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after the last delay, and never retries other errors', async () => {
    let calls = 0;
    await expect(
      withBusyRetry(
        async () => {
          calls += 1;
          throw busy();
        },
        undefined,
        [1, 1],
      ),
    ).rejects.toThrow(/429/);
    expect(calls).toBe(3);

    let other = 0;
    await expect(
      withBusyRetry(
        async () => {
          other += 1;
          throw new Error('bad request');
        },
        undefined,
        [1, 1],
      ),
    ).rejects.toThrow('bad request');
    expect(other).toBe(1);
  });
});
