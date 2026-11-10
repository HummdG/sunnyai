/**
 * The battery estimate PDF's document: the stored battery quote, the option
 * it is about, and the parts every quotation PDF shares (snapshot, customer,
 * logos, reference, dates). Assembled by `proposalDocFor` in ../index.ts;
 * drawn by `renderProposal` in ../pdf.ts.
 *
 * The cover's words live here too: the cover page itself is the shared one
 * (pages/cover.ts), told what to say.
 */

import type { BatteryOptionView, BatteryQuoteRecord } from '../../journey/battery/record.js';
import {
  ESTIMATE,
  PRICED_BY_INSTALLER,
  gbp,
  longDate,
  num,
  salutationName,
  signOff,
} from '../copy.js';
import type { ProposalBase } from '../doc.js';
import type { AnyProposalDoc } from '../heat-pump/doc.js';
import type { CoverContent } from '../pages/cover.js';

import { batteryMoney } from './quotation-lines.js';

export interface BatteryProposalDoc extends ProposalBase {
  kind: 'battery';
  quote: BatteryQuoteRecord;
  /** The option the document is about: the visitor's choice, else the recommended one. */
  option: BatteryOptionView;
}

export function isBatteryDoc(doc: AnyProposalDoc): doc is BatteryProposalDoc {
  return 'kind' in doc && doc.kind === 'battery';
}

/** `5 kWh`, `9.5 kWh`. */
export function kwh(n: number): string {
  return `${num(n, 1)} kWh`;
}

/** `8 years`, `8.5 years`, `1 year`. */
export function years(n: number): string {
  return `${num(n, 1)} ${n === 1 ? 'year' : 'years'}`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The letter: greeting, opening, the option in a sentence, the estimate line, closing. */
function letterParagraphs(doc: BatteryProposalDoc): string[] {
  const name = salutationName(doc.customer.name);
  const lead = doc.chosen && !doc.option.isRecommended ? 'You chose' : "We'd recommend";
  const headline = doc.option.headline.trim().replace(/\.?$/, '.');
  const opening = doc.snapshot.letter.opening.trim();
  const closing = doc.snapshot.letter.closing.trim();
  return [
    name ? `Dear ${name},` : 'Hello,',
    ...(opening ? [opening] : []),
    `${lead} ${lowerFirst(headline)}`,
    ESTIMATE.letter,
    ...(closing ? [closing] : []),
  ];
}

/** What the shared cover says for a battery quote. */
export function batteryCover(doc: BatteryProposalDoc): CoverContent {
  const o = doc.option;
  const m = batteryMoney(doc);
  return {
    dateLine: `Battery estimate · ${longDate(new Date(doc.quote.createdAt))}`,
    headline: {
      kicker: doc.chosen ? 'Your chosen option' : 'The option we recommend',
      light: 'Battery',
      bold: 'estimate.',
    },
    roofPlan: null,
    paragraphs: letterParagraphs(doc),
    signOff: signOff(doc),
    postcode: doc.quote.postcode,
    figures: [
      {
        key: doc.chosen ? 'Your choice' : 'Recommended',
        parts: { big: kwh(o.capacityKwh), lines: [o.batteryName] },
      },
      { key: 'Saving', parts: { big: gbp(o.annualSavingsGbp), lines: ['a year, estimated'] } },
      ...(o.paybackYears !== null && m
        ? [{ key: 'Payback', parts: { big: years(o.paybackYears), lines: ['estimated'] } }]
        : []),
    ],
    total: m ? { big: gbp(m.total!), lines: [m.vatNote] } : { lines: [PRICED_BY_INSTALLER] },
  };
}
