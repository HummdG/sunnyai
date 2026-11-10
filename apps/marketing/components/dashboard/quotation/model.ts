/**
 * The "Your quotation" draft: the installer's PDF settings as the form edits
 * them (numbers as typed, images as their views), and the settings the API
 * takes from it. A draft with a field out of range gives no settings, so
 * neither the preview nor Save sends something the API would refuse.
 */

import {
  QUOTATION_LIMITS as LIMITS,
  type BrandAssetView,
  type QuotationInput,
  type QuotationView,
} from '../../../lib/portal-api.js';

export type DepositKind = 'none' | 'percent' | 'fixed';
export type SectionKey = 'system' | 'performance' | 'savings' | 'terms';

export interface QuotationDraft {
  /** The PDF's own logo; null uses the logo from Your brand. */
  logo: BrandAssetView | null;
  signer: { name: string; role: string; phone: string; email: string };
  mcsNumber: string;
  accreditations: BrandAssetView[];
  sections: Record<SectionKey, boolean>;
  depositKind: DepositKind;
  /** As typed, so a half-typed number is not lost. */
  percent: string;
  amount: string;
  balanceDue: string;
  validity: string;
  opening: string;
  closing: string;
  terms: string;
  /** `#rrggbb`, or null for "Use my brand colour". */
  rail: string | null;
  accent: string | null;
}

export function draftFrom(view: QuotationView): QuotationDraft {
  const s = view.settings;
  return {
    logo: view.assets.logo,
    signer: s.signer ?? { name: '', role: '', phone: '', email: '' },
    mcsNumber: s.accreditations.mcsNumber,
    accreditations: view.assets.accreditations,
    sections: { ...s.sections },
    depositKind: s.deposit.kind,
    percent: s.deposit.kind === 'percent' ? String(s.deposit.percent) : '',
    amount: s.deposit.kind === 'fixed' ? String(s.deposit.amountGbp) : '',
    balanceDue: s.balanceDue,
    validity: String(s.validityDays),
    opening: s.letter.opening,
    closing: s.letter.closing,
    terms: s.terms,
    rail: s.colours?.rail ?? null,
    accent: s.colours?.accent ?? null,
  };
}

/** What makes two drafts the same for "Unsaved changes": images by id. */
export function draftKey(draft: QuotationDraft): string {
  return JSON.stringify({
    ...draft,
    logo: draft.logo?.id ?? null,
    accreditations: draft.accreditations.map((a) => a.id),
  });
}

export type Problems = Partial<Record<'percent' | 'amount' | 'validity', string>>;

/** A whole number in range, or null. */
function whole(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export function problemsOf(draft: QuotationDraft): Problems {
  const out: Problems = {};
  if (
    draft.depositKind === 'percent' &&
    whole(draft.percent, LIMITS.percentMin, LIMITS.percentMax) === null
  ) {
    out.percent = 'Use a whole number from 1 to 100.';
  }
  if (
    draft.depositKind === 'fixed' &&
    whole(draft.amount, LIMITS.fixedMin, LIMITS.fixedMax) === null
  ) {
    out.amount = 'Use a whole number of pounds from 1 to 1,000,000.';
  }
  if (whole(draft.validity, LIMITS.validityMin, LIMITS.validityMax) === null) {
    out.validity = 'Use a whole number of days from 1 to 365.';
  }
  return out;
}

/** The settings the API takes, or null while a field is out of range. */
export function inputFrom(draft: QuotationDraft): QuotationInput | null {
  if (Object.keys(problemsOf(draft)).length > 0) return null;
  const signer = draft.signer;
  const anySigner = [signer.name, signer.role, signer.phone, signer.email].some(
    (v) => v.trim() !== '',
  );
  const deposit: QuotationInput['deposit'] =
    draft.depositKind === 'percent'
      ? { kind: 'percent', percent: Number(draft.percent.trim()) }
      : draft.depositKind === 'fixed'
        ? { kind: 'fixed', amountGbp: Number(draft.amount.trim()) }
        : { kind: 'none' };
  return {
    // Never '' for "use Your brand's logo": the API wants an id or null.
    logoAssetId: draft.logo?.id ?? null,
    // All four blank: the PDF signs with the company and its contact details.
    signer: anySigner ? { ...signer } : null,
    accreditations: {
      mcsNumber: draft.mcsNumber,
      logoAssetIds: draft.accreditations.map((a) => a.id),
    },
    sections: { ...draft.sections },
    deposit,
    balanceDue: draft.balanceDue,
    validityDays: Number(draft.validity.trim()),
    letter: { opening: draft.opening, closing: draft.closing },
    terms: draft.terms,
    colours: { rail: draft.rail, accent: draft.accent },
  };
}

/** The pages the PDF has, in order, as the preview's chips name them. */
export type PageName = 'Cover' | 'System' | 'Performance' | 'Savings' | 'Quotation' | 'Terms';

/**
 * The first page of each section the settings print. Cover and Quotation are
 * always there; Terms only when switched on with text to print. Each section
 * is counted as one page: a section that runs on (long T&Cs, a long
 * quotation) adds pages after its start, which `pageCount` then clamps.
 */
export function pagesOf(
  input: QuotationInput,
  pageCount: number | null,
): Array<{
  name: PageName;
  page: number;
}> {
  const names: PageName[] = ['Cover'];
  if (input.sections.system) names.push('System');
  if (input.sections.performance) names.push('Performance');
  if (input.sections.savings) names.push('Savings');
  names.push('Quotation');
  if (input.sections.terms && input.terms.trim() !== '') names.push('Terms');
  // No page objects found means the count is unknown, not one page.
  const last = pageCount && pageCount > 0 ? pageCount : Number.POSITIVE_INFINITY;
  return names.map((name, i) => ({ name, page: Math.max(1, Math.min(i + 1, last)) }));
}

/** The number of pages in a PDF: its page objects (`/Type /Page`, not `/Pages`). */
export function countPdfPages(bytes: Uint8Array): number {
  // Latin-1 keeps one character per byte, so binary streams cannot swallow a match.
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

// ── colours, as the PDF adjusts them (apps/api/src/proposal/layout.ts) ─────

type Rgb = [number, number, number];
const DEFAULT_BRAND = '#0f2a3d';

function parse(hex: string): Rgb {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRAND;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}
const toHex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrastOnWhite = (rgb: Rgb) => 1.05 / (luminance(rgb) + 0.05);

/**
 * A colour as the PDF uses it: darkened, keeping its hue, until white text on
 * it (the side panel, 7:1) or it on white (the highlight, 4.5:1) reads well.
 */
export function readable(hex: string, use: 'rail' | 'accent'): { hex: string; adjusted: boolean } {
  const given = parse(hex);
  const ratio = use === 'rail' ? 7 : 4.5;
  let c = given;
  for (let i = 0; i < 60 && contrastOnWhite(c) < ratio; i++) c = c.map((v) => v * 0.93) as Rgb;
  const out = toHex(c);
  return { hex: out, adjusted: out !== toHex(given) };
}
