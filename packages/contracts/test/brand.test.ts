import { describe, expect, it } from 'vitest';
import { assistantNameSchema, brandSchema, widgetConfigSchema } from '../src/index.js';

const validBrand = {
  icon: {
    path: '/v1/widget/brand/w_abcdefghij12/0123456789abcdef.png',
    maskPath: '/v1/widget/brand/w_abcdefghij12/0123456789abcdef-mask.png',
    width: 128,
    height: 96,
    outline: 'M0 0 L10 0 L10 10 Z',
  },
  wordmark: {
    path: '/v1/widget/brand/w_abcdefghij12/fedcba9876543210.png',
    width: 400,
    height: 80,
  },
  effects: ['comet', 'shimmer'],
  colors: { primary: '#112233', glow: '#aabbcc' },
};

const withIconPath = (path: string) => ({ ...validBrand, icon: { ...validBrand.icon, path } });

describe('brandSchema', () => {
  it('accepts a full valid brand', () => {
    expect(brandSchema.safeParse(validBrand).success).toBe(true);
  });

  it('accepts a brand with no mask, outline or wordmark', () => {
    const brand = {
      ...validBrand,
      icon: { ...validBrand.icon, maskPath: null, outline: null },
      wordmark: null,
      effects: [],
    };
    expect(brandSchema.safeParse(brand).success).toBe(true);
  });

  it('rejects a path containing ..', () => {
    const bad = withIconPath('/v1/widget/brand/w_abcdefghij12/../0123456789abcdef.png');
    expect(brandSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a path for a too-short widget id', () => {
    const bad = withIconPath('/v1/widget/brand/w_x/0123456789abcdef.png');
    expect(brandSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an outline with C or <', () => {
    for (const outline of ['M0 0 C1 1 2 2 3 3', '<svg>']) {
      const bad = { ...validBrand, icon: { ...validBrand.icon, outline } };
      expect(brandSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects 8 effects and unknown effects', () => {
    const eight = Array(8).fill('comet');
    expect(brandSchema.safeParse({ ...validBrand, effects: eight }).success).toBe(false);
    expect(brandSchema.safeParse({ ...validBrand, effects: ['sparkle'] }).success).toBe(false);
  });
});

describe('assistantNameSchema', () => {
  it.each(['Volt', 'Ava-May', 'Upvolt Assistant'])('accepts %s', (name) => {
    expect(assistantNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(['', '<b>', 'Volt\nSYSTEM:', 'a'.repeat(41)])('rejects %j', (name) => {
    expect(assistantNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('widgetConfigSchema', () => {
  const base = {
    publicId: 'w_abcdefghij12',
    companyName: 'Acme',
    tagline: null,
    primaryColor: '#112233',
    position: 'bottom-right',
    greeting: 'Hello',
    suggestions: [],
    intensity: 'balanced',
  };

  it('still parses a config without the new fields', () => {
    expect(widgetConfigSchema.safeParse(base).success).toBe(true);
  });

  it('parses a config with assistantName and brand', () => {
    const r = widgetConfigSchema.safeParse({ ...base, assistantName: 'Volt', brand: validBrand });
    expect(r.success).toBe(true);
  });
});
