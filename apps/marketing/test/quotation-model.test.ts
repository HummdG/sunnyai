import { describe, expect, it } from 'vitest';

import {
  countPdfPages,
  inputFrom,
  pagesOf,
  type QuotationDraft,
} from '../components/dashboard/quotation/model.js';
import type { BrandAssetView } from '../lib/portal-api.js';

const draft = (extra: Partial<QuotationDraft> = {}): QuotationDraft => ({
  logo: null,
  signer: { name: '', role: '', phone: '', email: '' },
  mcsNumber: '',
  accreditations: [],
  sections: { system: true, performance: true, savings: true, terms: false },
  depositKind: 'none',
  percent: '',
  amount: '',
  balanceDue: 'within 7 days of completion',
  validity: '30',
  opening: '',
  closing: '',
  terms: '',
  rail: null,
  accent: null,
  ...extra,
});

const asset = (id: string) => ({ id }) as BrandAssetView;

describe('inputFrom', () => {
  it("sends null, never '', for Your brand's logo, and null for a blank signer", () => {
    const input = inputFrom(draft())!;
    expect(input.logoAssetId).toBeNull();
    expect(input.signer).toBeNull();
    expect(input.deposit).toEqual({ kind: 'none' });
    expect(input.validityDays).toBe(30);
  });

  it('sends the chosen logo and accreditation ids and a whole-number deposit', () => {
    const input = inputFrom(
      draft({
        logo: asset('aaaa'),
        accreditations: [asset('bbbb')],
        depositKind: 'percent',
        percent: '25',
      }),
    )!;
    expect(input.logoAssetId).toBe('aaaa');
    expect(input.accreditations.logoAssetIds).toEqual(['bbbb']);
    expect(input.deposit).toEqual({ kind: 'percent', percent: 25 });
  });

  it('gives nothing while a field is out of range', () => {
    expect(inputFrom(draft({ depositKind: 'percent', percent: '' }))).toBeNull();
    expect(inputFrom(draft({ depositKind: 'percent', percent: '101' }))).toBeNull();
    expect(inputFrom(draft({ depositKind: 'fixed', amount: '2.5' }))).toBeNull();
    expect(inputFrom(draft({ validity: '0' }))).toBeNull();
    expect(inputFrom(draft({ validity: '366' }))).toBeNull();
  });
});

describe('pagesOf', () => {
  const all = inputFrom(
    draft({
      terms: 'PAYMENT',
      sections: { system: true, performance: true, savings: true, terms: true },
    }),
  )!;

  it('numbers each present section in order', () => {
    expect(pagesOf(all, 9)).toEqual([
      { name: 'Cover', page: 1 },
      { name: 'System', page: 2 },
      { name: 'Performance', page: 3 },
      { name: 'Savings', page: 4 },
      { name: 'Quotation', page: 5 },
      { name: 'Terms', page: 6 },
    ]);
  });

  it('leaves out switched-off sections, and Terms with blank text', () => {
    const some = inputFrom(
      draft({
        terms: '  ',
        sections: { system: false, performance: false, savings: true, terms: true },
      }),
    )!;
    expect(pagesOf(some, 3).map((p) => p.name)).toEqual(['Cover', 'Savings', 'Quotation']);
  });

  it('never points past the end, and treats an unknown count as no limit', () => {
    expect(pagesOf(all, 4).map((p) => p.page)).toEqual([1, 2, 3, 4, 4, 4]);
    expect(pagesOf(all, 0).map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pagesOf(all, null).map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('countPdfPages', () => {
  it('counts page objects, not the page tree', () => {
    const pdf =
      '%PDF-1.3\n1 0 obj\n<< /Type /Pages /Count 2 /Kids [2 0 R 3 0 R] >>\nendobj\n' +
      '2 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n' +
      '3 0 obj\n<</Type/Page/Parent 1 0 R>>\nendobj\n';
    expect(countPdfPages(new TextEncoder().encode(pdf))).toBe(2);
    expect(countPdfPages(new Uint8Array([0, 1, 2]))).toBe(0);
  });
});
