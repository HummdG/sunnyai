/**
 * The words and figures of the quotation PDF, kept apart from the drawing so
 * they can be tested as text. Every sentence here is fixed: the letter is
 * assembled from these sentences, the stored reasons (used exactly as stored)
 * and the installer's own opening and closing lines, never free-written.
 *
 * The estimate wording is fixed and cannot be switched off.
 */

import type { QuoteRecord } from '../journey/quote.js';

import type { ProposalDoc } from './doc.js';

export const ESTIMATE = {
  title: 'Estimated quotation',
  totalLabel: 'Estimated total',
  notice:
    'This is an estimate, not a final price. It is based on a 3D model of your roof and the ' +
    'answers you gave us. Your final price will be confirmed after a survey of your property, ' +
    'and it may go up or down.',
  coverNotice: 'Estimate. Final price confirmed after a survey.',
  depositLabel: 'Deposit, payable once your survey has confirmed the final price',
  letter: 'Every figure here is an estimate until we survey your property.',
} as const;

/** The MCS-required performance wording, verbatim from the original proposal. */
export const MCS_DISCLAIMER =
  'The performance of a solar PV system cannot be predicted with certainty: sunlight varies ' +
  'from place to place and year to year. This estimate follows the MCS method and is ' +
  'guidance only, not a guarantee. Orientation, inclination and shading are estimated ' +
  'from a 3D model of your roof and what you told us; actual performance may be higher or ' +
  'lower once they are confirmed at survey.';

export const PRICED_BY_INSTALLER = 'Priced by your installer';

// ---- Formats -------------------------------------------------------------

/** Whole pounds, `£13,277`; a negative reads `-£12,348`. */
export function gbp(n: number): string {
  const whole = Math.round(n);
  const s = `£${Math.abs(whole).toLocaleString('en-GB')}`;
  return whole < 0 ? `-${s}` : s;
}

/** A number with up to `dp` decimal places, en-GB grouping. */
export function num(n: number, dp = 0): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: dp });
}

/** `9 December 2026` (UTC, so the date never depends on the server's zone). */
export function longDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `Q-` and the last eight characters of the quote id, without its `q_` prefix. */
export function referenceFor(quote: Pick<QuoteRecord, 'id'>): string {
  return `Q-${quote.id.replace(/^q_/i, '').toUpperCase().slice(-8)}`;
}

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/** `ten` for 10; digits beyond twenty. */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n]! : String(n);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- The system in plain words --------------------------------------------

/** The roof's facing word (`South`, `North-east`, `Flat`), or null when unknown. */
export function facingOf(doc: ProposalDoc): string | null {
  const raw = doc.roofPlan?.mainFacing ?? doc.roofFacts?.bestFacing ?? null;
  if (!raw) return null;
  return /^flat/i.test(raw) ? 'Flat' : raw;
}

/** `your south-facing roof`, `your flat roof`, or `your roof`. */
export function roofPhrase(doc: ProposalDoc): string {
  const facing = facingOf(doc);
  if (!facing) return 'your roof';
  if (facing === 'Flat') return 'your flat roof';
  return `your ${facing.toLowerCase()}-facing roof`;
}

const hasBattery = (doc: ProposalDoc) =>
  !!doc.option.batteryType && doc.option.batteryCapacityKwh > 0;

/**
 * The cover headline: a kicker and the plain-words line, light then bold
 * (`Twelve panels,` / `one battery.`). Without a battery the light half is
 * empty and the bold half is `Twelve panels.`.
 */
export function headline(doc: ProposalDoc): { kicker: string; light: string; bold: string } {
  const n = doc.option.panelCount;
  const panels = `${capitalise(numberWord(n))} ${n === 1 ? 'panel' : 'panels'}`;
  return {
    kicker: doc.chosen ? 'Your chosen system' : 'The system we recommend',
    light: hasBattery(doc) ? `${panels},` : '',
    bold: hasBattery(doc) ? 'one battery.' : `${panels}.`,
  };
}

/** `10 panels + 10.2 kWh battery`. */
export function systemLine(doc: ProposalDoc): string {
  const n = doc.option.panelCount;
  const panels = `${n} ${n === 1 ? 'panel' : 'panels'}`;
  return hasBattery(doc)
    ? `${panels} + ${num(doc.option.batteryCapacityKwh, 1)} kWh battery`
    : panels;
}

// ---- The letter -------------------------------------------------------------

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame']);

/** `Sam` for `Sam Patel`; `Dr Patel` for `Dr Sam Patel`; null with no name. */
function salutationName(name: string | null): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]!;
  if (TITLES.has(first.replace(/\.$/, '').toLowerCase()) && parts.length > 1) {
    return `${first} ${parts[parts.length - 1]}`;
  }
  return first;
}

/** The stored reasons for the option's items, in item order, exactly as stored. */
export function reasonSentences(doc: ProposalDoc): string[] {
  const reasons = doc.quote.reasons ?? {};
  const out: string[] = [];
  for (const item of doc.option.lineItems) {
    const r = reasons[item.sku];
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

/** The sign-off: signer name, role, and phone and email. */
export function signOff(doc: ProposalDoc): string[] {
  const s = doc.snapshot.signer;
  return [s.name, s.role, [s.phone, s.email].filter(Boolean).join(' · ')]
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The letter, one string per paragraph: greeting, the installer's opening
 * line, what we recommend and why, the estimate sentence, the installer's
 * closing line. The sign-off is `signOff(doc)`, drawn below the paragraphs.
 */
export function letterParagraphs(doc: ProposalDoc): string[] {
  const name = salutationName(doc.customer.name);
  const battery = hasBattery(doc)
    ? ` with a ${num(doc.option.batteryCapacityKwh, 1)} kWh battery`
    : '';
  const n = doc.option.panelCount;
  // A package the visitor chose over our recommendation is theirs, not ours.
  const lead = doc.chosen && !doc.option.isRecommended ? 'You chose' : "We'd recommend";
  const system = `${lead} ${n} ${n === 1 ? 'panel' : 'panels'} on ${roofPhrase(doc)}${battery}.`;
  const opening = doc.snapshot.letter.opening.trim();
  const closing = doc.snapshot.letter.closing.trim();
  return [
    name ? `Dear ${name},` : 'Hello,',
    ...(opening ? [opening] : []),
    [system, ...reasonSentences(doc)].join(' '),
    ESTIMATE.letter,
    ...(closing ? [closing] : []),
  ];
}

// ---- Money -------------------------------------------------------------------

/** True when every item has a figure, so the total is the whole price. */
export function totalComplete(doc: ProposalDoc): boolean {
  const o = doc.option;
  return (
    doc.quote.priced && o.priceGbp !== null && o.priceGbp > 0 && o.installerPriced.length === 0
  );
}

/**
 * The total the Quotation page shows (inc-VAT when VAT is known), with its VAT
 * wording, the deposit and the balance. Null when the total is not complete:
 * then no total figure, deposit or balance is printed. Deposit and balance are
 * null when the installer takes no deposit. Never negative: a fixed deposit
 * above the total becomes the total, and the balance is £0.
 */
export function money(doc: ProposalDoc): {
  total: number | null;
  totalLabel: string;
  vatNote: string;
  deposit: number | null;
  balance: number | null;
} | null {
  if (!totalComplete(doc)) return null;
  const o = doc.option;
  const vat = doc.quote.pricing?.vatRatePercent ?? null;
  const total = Math.round(o.priceIncVatGbp ?? o.priceGbp!);
  const vatNote =
    o.priceIncVatGbp !== null
      ? `including ${vat}% VAT`
      : vat === null
        ? 'VAT as quoted by your installer'
        : vat === 0
          ? '0% VAT'
          : `including ${vat}% VAT`;
  const rule = doc.snapshot.deposit;
  let deposit: number | null = null;
  if (rule.kind === 'percent') deposit = Math.round((total * rule.percent) / 100);
  else if (rule.kind === 'fixed') deposit = Math.round(rule.amountGbp);
  if (deposit !== null) deposit = Math.min(Math.max(deposit, 0), total);
  return {
    total,
    totalLabel: ESTIMATE.totalLabel,
    vatNote,
    deposit,
    balance: deposit === null ? null : total - deposit,
  };
}

/**
 * The VAT added on top of ex-VAT item prices, so the items add up to the
 * total: `priceIncVatGbp - priceGbp`, both from the stored quote. Null when
 * the total is incomplete, prices already include VAT, or VAT is unknown.
 */
export function vatRow(doc: ProposalDoc): { label: string; amount: number } | null {
  const o = doc.option;
  const rate = doc.quote.pricing?.vatRatePercent ?? null;
  if (!totalComplete(doc) || o.priceIncVatGbp === null || o.priceGbp === null || rate === null) {
    return null;
  }
  return {
    label: `VAT at ${rate}%`,
    amount: Math.round(o.priceIncVatGbp) - Math.round(o.priceGbp),
  };
}

/** `25% of the estimated total`, `Fixed deposit`, or null with no deposit. */
export function depositBasis(doc: ProposalDoc): string | null {
  const rule = doc.snapshot.deposit;
  if (rule.kind === 'percent') return `${rule.percent}% of the estimated total`;
  if (rule.kind === 'fixed') return 'Fixed deposit';
  return null;
}

// ---- Notes -------------------------------------------------------------------

/** The Quotation page's notes: Sentinel, warnings, the roof and budget notes. */
export function notes(doc: ProposalDoc): string[] {
  const o = doc.option;
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  if (o.sentinel) {
    const s = o.sentinel;
    const pct = num(s.upliftPercent, 1);
    const price = s.addedCostGbp >= 1 ? `for ${gbp(s.addedCostGbp)}` : 'at no extra cost';
    add(
      `Optional: Sentinel optimisation could raise your savings by about ${pct}% to ` +
        `${gbp(s.annualSavingsGbp)} a year, ${price}. It is not in the estimated total, ` +
        'and the saving is a modelled, indicative figure.',
    );
  }
  for (const w of o.warnings) add(w);
  for (const w of doc.quote.warnings) add(w);
  if (o.roofLimited && !out.some((w) => /space on your roof/i.test(w))) {
    add('The system size is limited by the space on your roof.');
  }
  if (o.aboveBudget) add('This system costs more than the budget you mentioned.');
  return out;
}

/** `To go ahead, contact <name> on <phone> or <email>.` */
export function goAhead(doc: ProposalDoc): string {
  const s = doc.snapshot.signer;
  const ways = [s.phone, s.email].map((w) => w.trim()).filter(Boolean);
  const name = s.name.trim() || doc.snapshot.companyName;
  return ways.length > 0
    ? `To go ahead, contact ${name} on ${ways.join(' or ')}.`
    : `To go ahead, contact ${name}.`;
}
