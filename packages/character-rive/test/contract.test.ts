import { readFileSync } from 'node:fs';

import { INTENSITIES, STATES } from '@sunny/animation-engine';
import { describe, expect, it } from 'vitest';

import {
  APP_TRIGGERS,
  ARTBOARD,
  CORE_MOMENTS,
  LIBRARY_MOMENTS,
  MOMENT_NAME_PROPERTY,
  PROPERTIES,
  RIVE_STATES,
  SEASONS,
  SIGNALS,
  STATE_MACHINE,
  VIEW_MODEL,
  isMoment,
  parseHexColor,
} from '../src/contract.js';

const brief = readFileSync(
  new URL('../../../docs/design/rive-animator-brief.md', import.meta.url),
  'utf8',
);

describe('contract', () => {
  it('covers every behavioural state and intensity the engine has', () => {
    expect(RIVE_STATES).toEqual(STATES);
    expect([...INTENSITIES]).toEqual(['off', 'minimal', 'balanced', 'playful']);
  });

  it('has no duplicate names across properties, triggers and signals', () => {
    const all = [...Object.keys(PROPERTIES), ...APP_TRIGGERS, ...SIGNALS, MOMENT_NAME_PROPERTY];
    expect(new Set(all).size).toBe(all.length);
  });

  it('names every moment as an app trigger', () => {
    for (const moment of [...CORE_MOMENTS, ...LIBRARY_MOMENTS]) {
      expect(APP_TRIGGERS).toContain(moment);
      expect(isMoment(moment)).toBe(true);
    }
    expect(APP_TRIGGERS).toContain('interrupt');
    expect(isMoment('interrupt')).toBe(false);
  });

  // The brief is what the animator builds from. A name in the code that the
  // brief does not mention would never exist in the delivered file.
  it('is written out in full in the animator brief', () => {
    const names = [
      ARTBOARD,
      STATE_MACHINE,
      VIEW_MODEL,
      ...Object.keys(PROPERTIES),
      ...APP_TRIGGERS,
      ...SIGNALS,
      MOMENT_NAME_PROPERTY,
      ...STATES,
      ...SEASONS,
    ];
    const absent = names.filter((name) => !brief.includes(`\`${name}\``));
    expect(absent).toEqual([]);
  });
});

describe('parseHexColor', () => {
  it('accepts #rgb and #rrggbb as opaque ARGB', () => {
    expect(parseHexColor('#FF7900')).toBe(0xffff7900);
    expect(parseHexColor('#f70')).toBe(0xffff7700);
    expect(parseHexColor(' #000000 ')).toBe(0xff000000);
  });

  it('rejects anything else', () => {
    for (const bad of ['FF7900', '#ff790080', 'red', 'url(#x)', '#gg0000', '', 'var(--c)']) {
      expect(parseHexColor(bad)).toBeNull();
    }
  });
});
