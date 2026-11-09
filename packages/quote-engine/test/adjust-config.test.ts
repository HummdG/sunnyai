import { describe, expect, it } from 'vitest';

import { buildOptionSet } from '../src/recommend/buildOptionSet.js';
import type { SystemConfig } from '../src/pricing/types.js';
import { makeInput } from './recommend/catalogueFixture.js';

describe('adjustConfig: a hook over every package before it is priced', () => {
  it('a hook that drops the battery recalculates every option without one', () => {
    const plain = buildOptionSet(makeInput());
    const adjusted = buildOptionSet({
      ...makeInput(),
      adjustConfig: (config: SystemConfig) => ({ ...config, battery: null }),
    });
    expect(plain.options.some((o) => o.batteryType !== null)).toBe(true);
    for (const option of adjusted.options) {
      expect(option.batteryType).toBeNull();
      expect(option.config.battery).toBeNull();
    }
    expect(adjusted.options.map((o) => o.results.annualSavingsPounds)).not.toEqual(
      plain.options.map((o) => o.results.annualSavingsPounds),
    );
    // The slider's ladder is built from the same adjusted kit.
    for (const step of adjusted.ladder!.steps) expect(step.hasBattery).toBe(false);
  });

  it('without the hook the result is exactly what it was', () => {
    const before = JSON.stringify(buildOptionSet(makeInput()));
    const identity = JSON.stringify(
      buildOptionSet({ ...makeInput(), adjustConfig: (config: SystemConfig) => config }),
    );
    expect(identity).toBe(before);
    expect(JSON.stringify(buildOptionSet(makeInput()))).toBe(before);
  });
});
