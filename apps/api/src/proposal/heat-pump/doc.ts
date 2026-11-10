/**
 * The heat pump estimate PDF's document: the stored heat pump quote, the
 * option it is about, and the parts every quotation PDF shares (snapshot,
 * customer, logos, reference, dates). Assembled by `proposalDocFor` in
 * ../index.ts; drawn by `renderProposal` in ../pdf.ts.
 *
 * The cover's words live here too: the cover page itself is the shared one
 * (pages/cover.ts), told what to say.
 */

import type { Fuel } from '@sunny/heat-pump-engine';

import type { HeatPumpOptionView, HeatPumpQuoteRecord } from '../../journey/heat-pump/record.js';
import type { BatteryProposalDoc } from '../battery/doc.js';
import {
  ESTIMATE,
  PRICED_BY_INSTALLER,
  gbp,
  longDate,
  num,
  salutationName,
  signOff,
} from '../copy.js';
import type { ProposalBase, ProposalDoc } from '../doc.js';
import type { CoverContent } from '../pages/cover.js';

import { heatPumpMoney } from './quotation-lines.js';

export interface HeatPumpProposalDoc extends ProposalBase {
  kind: 'heat_pump';
  quote: HeatPumpQuoteRecord;
  /** The option the document is about: the visitor's choice, else the recommended one. */
  option: HeatPumpOptionView;
  /**
   * How the home was heated when the quote was made, as stored on the quote.
   * Null when it cannot be known (an old row with no stored fuel and no answer).
   */
  currentFuel: Fuel | null;
}

/** Any kind of quotation document: solar, heat pump or battery. */
export type AnyProposalDoc = ProposalDoc | HeatPumpProposalDoc | BatteryProposalDoc;

export function isHeatPumpDoc(doc: AnyProposalDoc): doc is HeatPumpProposalDoc {
  return 'kind' in doc && doc.kind === 'heat_pump';
}

const FUEL_WORDS: Record<Fuel, string> = {
  gas: 'Gas boiler',
  oil: 'Oil boiler',
  lpg: 'LPG boiler',
  electric_storage: 'Electric storage heaters',
  electric_direct: 'Electric heaters',
  heat_pump: 'Your existing heat pump',
  other: 'Your current heating',
};

/** `Gas boiler`, `Electric storage heaters`, and so on; `Your current heating` when unknown. */
export function fuelWords(fuel: Fuel | null): string {
  return fuel ? FUEL_WORDS[fuel] : 'Your current heating';
}

const FUELS = Object.keys(FUEL_WORDS) as Fuel[];

/** A stored answer as a fuel, or null when it is missing or not one. Never guessed. */
export function fuelOf(answer: unknown): Fuel | null {
  return FUELS.find((f) => f === answer) ?? null;
}

/** `7 kW`, `8.5 kW`. */
export function kw(n: number): string {
  return `${num(n, 1)} kW`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The letter: greeting, opening, the option in a sentence, the estimate line, closing. */
function letterParagraphs(doc: HeatPumpProposalDoc): string[] {
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

/** What the shared cover says for a heat pump quote. */
export function heatPumpCover(doc: HeatPumpProposalDoc): CoverContent {
  const o = doc.option;
  const m = heatPumpMoney(doc);
  return {
    dateLine: `Heat pump estimate · ${longDate(new Date(doc.quote.createdAt))}`,
    headline: {
      kicker: doc.chosen ? 'Your chosen option' : 'The option we recommend',
      light: 'Heat pump',
      bold: 'estimate.',
    },
    roofPlan: null,
    paragraphs: letterParagraphs(doc),
    signOff: signOff(doc),
    postcode: doc.quote.postcode,
    figures: [
      {
        key: doc.chosen ? 'Your choice' : 'Recommended',
        parts: { big: kw(o.outputKw), lines: [o.unitName] },
      },
      { key: 'Running cost', parts: { big: gbp(o.runningCostGbp), lines: ['a year, estimated'] } },
      ...(o.grantGbp > 0
        ? [
            {
              key: 'Boiler Upgrade Scheme',
              parts: { big: gbp(o.grantGbp), lines: ['grant, off your invoice'] },
            },
          ]
        : []),
    ],
    total: m ? { big: gbp(m.total!), lines: [m.vatNote] } : { lines: [PRICED_BY_INSTALLER] },
  };
}
