import { describe, expect, it } from 'vitest';
import {
  QUOTATION_LIMITS,
  defaultQuotationSettings,
  quotationSettingsSchema,
} from '../src/quotation.js';

const valid = () => ({
  version: 3,
  updatedAt: '2026-11-09T10:00:00.000Z',
  logoAssetId: 'logo_1',
  signer: {
    name: 'Ada Lovelace',
    role: 'Director',
    phone: '01234 567890',
    email: 'ada@example.com',
  },
  accreditations: { mcsNumber: 'MCS 12345', logoAssetIds: ['a', 'b'] },
  sections: { system: true, performance: false, savings: true, terms: true },
  deposit: { kind: 'percent' as const, percent: 25 },
  balanceDue: 'within 14 days of completion',
  validityDays: 60,
  letter: { opening: 'Thanks for asking.', closing: 'Speak soon.' },
  terms: 'Our terms.',
});

describe('quotation settings', () => {
  it('defaults match the spec', () => {
    const d = defaultQuotationSettings();
    expect(d.version).toBe(0);
    expect(d.updatedAt).toBe('');
    expect(d.logoAssetId).toBeNull();
    expect(d.signer).toBeNull();
    expect(d.accreditations).toEqual({ mcsNumber: '', logoAssetIds: [] });
    expect(d.sections).toEqual({ system: true, performance: true, savings: true, terms: false });
    expect(d.deposit).toEqual({ kind: 'none' });
    expect(d.balanceDue).toBe('within 7 days of completion');
    expect(d.validityDays).toBe(30);
    expect(d.letter).toEqual({ opening: '', closing: '' });
    expect(d.terms).toBe('');
    expect(quotationSettingsSchema.safeParse(d).success).toBe(true);
  });

  it('refuses terms over 40000 characters', () => {
    const ok = { ...valid(), terms: 'a'.repeat(QUOTATION_LIMITS.terms) };
    expect(quotationSettingsSchema.safeParse(ok).success).toBe(true);
    const bad = { ...valid(), terms: 'a'.repeat(QUOTATION_LIMITS.terms + 1) };
    expect(quotationSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses a percent of 0, 101 or 12.5', () => {
    for (const percent of [0, 101, 12.5]) {
      const r = quotationSettingsSchema.safeParse({
        ...valid(),
        deposit: { kind: 'percent', percent },
      });
      expect(r.success).toBe(false);
    }
  });

  it('refuses a fixed deposit outside 1..1,000,000 or not whole', () => {
    for (const amountGbp of [0, 1000001, 10.5]) {
      const r = quotationSettingsSchema.safeParse({
        ...valid(),
        deposit: { kind: 'fixed', amountGbp },
      });
      expect(r.success).toBe(false);
    }
    const ok = quotationSettingsSchema.safeParse({
      ...valid(),
      deposit: { kind: 'fixed', amountGbp: 500 },
    });
    expect(ok.success).toBe(true);
  });

  it('refuses 9 accreditation logos', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `l${i}`);
    const r = quotationSettingsSchema.safeParse({
      ...valid(),
      accreditations: { mcsNumber: '', logoAssetIds: ids },
    });
    expect(r.success).toBe(false);
  });

  it('refuses validity 0 and 366', () => {
    for (const validityDays of [0, 366]) {
      expect(quotationSettingsSchema.safeParse({ ...valid(), validityDays }).success).toBe(false);
    }
  });

  it('trims text fields', () => {
    const r = quotationSettingsSchema.parse({
      ...valid(),
      terms: '  hello  ',
      balanceDue: '  soon  ',
      letter: { opening: '  hi ', closing: ' bye ' },
      signer: { name: ' A ', role: ' B ', phone: ' C ', email: ' d@e.com ' },
      accreditations: { mcsNumber: ' MCS 1 ', logoAssetIds: [] },
    });
    expect(r.terms).toBe('hello');
    expect(r.balanceDue).toBe('soon');
    expect(r.letter).toEqual({ opening: 'hi', closing: 'bye' });
    expect(r.signer).toEqual({ name: 'A', role: 'B', phone: 'C', email: 'd@e.com' });
    expect(r.accreditations.mcsNumber).toBe('MCS 1');
  });

  it('limits apply after trimming', () => {
    const r = quotationSettingsSchema.safeParse({
      ...valid(),
      letter: { opening: ' ' + 'a'.repeat(200) + ' ', closing: '' },
    });
    expect(r.success).toBe(true);
    const bad = quotationSettingsSchema.safeParse({
      ...valid(),
      letter: { opening: 'a'.repeat(201), closing: '' },
    });
    expect(bad.success).toBe(false);
  });

  it('accepts a full valid settings object', () => {
    expect(quotationSettingsSchema.safeParse(valid()).success).toBe(true);
  });
});
