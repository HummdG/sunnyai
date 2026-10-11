import type { PackageItem, PriceStatus, RecommendationResponse } from '@sunny/contracts';

import { el } from './dom.js';

/**
 * The product cards, and the line between what a card says and what it refuses
 * to say.
 *
 * Plan §7.4 asks a card to carry four things: what the option is, why it is
 * here, what it does not settle, and what happens next. Every one of those is
 * already in the response -- `title` and `items`, `reasons`, `limitations`,
 * `nextStep` -- so this file adds no facts. It is a *presentation* of a
 * recommendation the engine already decided, and it is a pure function of that
 * response for the same reason the engine is: a card list is a thing that should
 * be checked by reading values rather than by looking at a screenshot.
 *
 * What it must never do is the other half of §7.4. No yield appears anywhere in
 * this file because no yield exists in the response, and none is computed here;
 * `systemPowerW` is the panels' rated DC power, which is a catalogue figure, and
 * it is labelled as such rather than as generation. An unknown price is not
 * shown as a number, and an option whose prices carry no source is labelled
 * indicative however round the total looks.
 */

/** A price, in the catalogue's own money, or null when there is no number. */
function money(minor: number | null, currency: string | null): string | null {
  if (minor === null || currency === null) return null;
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

/**
 * How a price is labelled.
 *
 * `verified` is a claim about provenance, not about magnitude: it means every
 * row behind the figure pointed at a source. Anything else is said plainly, so
 * a visitor is never shown a typed-in number dressed as a quoted one.
 */
const PRICE_LABEL: Readonly<Record<PriceStatus, string>> = {
  verified: 'Verified price',
  indicative: 'Indicative price',
  unknown: 'Price not yet confirmed',
};

export interface CardLine {
  readonly productId: string;
  readonly category: PackageItem['category'];
  /** "9 × Sunbeam SB-430" -- quantity and model, which is what the card is about. */
  readonly label: string;
  /** The specs the catalogue actually carries, or null when it carries none. */
  readonly detail: string | null;
  readonly price: string | null;
  readonly priceLabel: string;
  readonly priceStatus: PriceStatus;
  /** The installer's own record for this row; shown when they gave one. */
  readonly source: string | null;
}

export interface CardView {
  readonly id: string;
  readonly rank: number;
  /** "Best match" for the first, "Option 2" after that. */
  readonly rankLabel: string;
  readonly title: string;
  readonly summary: string;
  /** The total, or a sentence saying why there is none. */
  readonly total: string;
  readonly totalLabel: string;
  readonly totalStatus: PriceStatus;
  readonly lines: readonly CardLine[];
  readonly reasons: readonly string[];
  readonly limitations: readonly string[];
  readonly nextStep: string;
}

export interface OptionsPanelView {
  readonly cards: readonly CardView[];
  /** The engine's own line, shown when there is nothing to price. */
  readonly note: string;
  /** What the rules ruled out, so an empty panel is never unexplained. */
  readonly exclusions: readonly string[];
}

/**
 * The specs of one line, from the fields the catalogue filled in.
 *
 * Each part is guarded rather than formatted with a fallback: an absent
 * warranty is not "0 years" and an absent wattage is not blank-but-implied, so a
 * row that carries nothing gets no detail line instead of a row of dashes.
 */
function lineDetail(item: PackageItem): string | null {
  const parts: string[] = [];
  if (item.powerW !== null) {
    parts.push(item.category === 'panel' ? `${item.powerW} W per panel` : `${item.powerW} W`);
  }
  if (item.capacityWh !== null) parts.push(`${(item.capacityWh / 1000).toFixed(1)} kWh`);
  if (item.warrantyYears !== null) parts.push(`${item.warrantyYears}-year warranty`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function cardLine(item: PackageItem): CardLine {
  const quantity = item.quantity > 1 ? `${item.quantity} × ` : '';
  return {
    productId: item.productId,
    category: item.category,
    label: `${quantity}${item.manufacturer} ${item.model}`,
    detail: lineDetail(item),
    price: money(item.priceMinor, item.currency),
    priceLabel: PRICE_LABEL[item.priceStatus],
    priceStatus: item.priceStatus,
    source: item.sourceRef,
  };
}

/**
 * One option as a card.
 *
 * `totalMinor` is null unless every item is priced in one currency, and that is
 * the case the card has to get right: it says why there is no total instead of
 * showing a subtotal that a visitor would read as a price.
 */
function card(option: RecommendationResponse['packages'][number], index: number): CardView {
  const total = money(option.totalMinor, option.currency);
  return {
    id: option.id,
    rank: option.rank,
    rankLabel: index === 0 ? 'Best match' : `Option ${option.rank}`,
    title: option.title,
    summary: option.summary,
    total: total ?? 'No total yet',
    totalLabel:
      total === null
        ? 'At least one item has no price in the installer’s list.'
        : PRICE_LABEL[option.totalStatus],
    totalStatus: option.totalStatus,
    lines: option.items.map(cardLine),
    reasons: [...option.reasons],
    limitations: [...option.limitations],
    nextStep: option.nextStep,
  };
}

/** Something is being asked for, so a panel that has nothing to show explains itself. */
function wantIsEmpty(want: RecommendationResponse['want']): boolean {
  return Object.values(want).every((value) => value === undefined);
}

/**
 * The panel's view, or null when there is nothing to put in it.
 *
 * Null is the opening state of every conversation: the visitor has asked for
 * nothing, so the engine produced no options, so the widget shows no panel --
 * rather than an empty frame or a "no options" message about a question nobody
 * asked. Once anything *is* being asked for, an empty panel is a real answer and
 * gets the engine's own note and the exclusions that produced it.
 */
export function optionsPanel(response: RecommendationResponse): OptionsPanelView | null {
  if (response.packages.length === 0 && wantIsEmpty(response.want)) return null;
  return {
    cards: response.packages.map(card),
    note: response.note,
    exclusions: response.exclusions.map((exclusion) => exclusion.message).slice(0, 4),
  };
}

// ─── the DOM ──────────────────────────────────────────────────────────────────
//
// Untested here and covered in a browser instead: this repository's unit tests
// run in Node, and the way a card *looks* is a claim only a real layout engine
// can settle. Every value below goes through `el`, so a model-authored string
// renders as characters rather than as markup.

function lineElement(line: CardLine): HTMLElement {
  const specs: (Node | string)[] = [el('span', { class: 'item-label', text: line.label })];
  if (line.detail !== null) {
    specs.push(el('span', { class: 'item-detail', text: line.detail }));
  }
  const price = el('span', { class: `item-price status-${line.priceStatus}` }, [
    el('span', { class: 'price-amount', text: line.price ?? 'No price' }),
    el('span', { class: 'price-status', text: line.priceLabel }),
  ]);
  const children: (Node | string)[] = [el('span', { class: 'item-specs' }, specs), price];
  if (line.source !== null) {
    children.push(el('span', { class: 'item-source', text: `Source: ${line.source}` }));
  }
  return el('li', { class: 'option-item', 'data-category': line.category }, children);
}

function detailBlock(
  className: string,
  count: number,
  label: string,
  entries: readonly string[],
): HTMLElement {
  return el('details', { class: className }, [
    el('summary', { text: `${label} (${count})` }),
    el(
      'ul',
      {},
      entries.map((entry) => el('li', { text: entry })),
    ),
  ]);
}

function cardElement(view: CardView): HTMLElement {
  const body: (Node | string)[] = [
    el('div', { class: 'option-rank', text: view.rankLabel }),
    el('h3', { class: 'option-title', text: view.title }),
    el('div', { class: `option-total status-${view.totalStatus}` }, [
      el('span', { class: 'total-amount', text: view.total }),
      el('span', { class: 'total-label', text: view.totalLabel }),
    ]),
    el('p', { class: 'option-summary', text: view.summary }),
    el(
      'ul',
      { class: 'option-items' },
      view.lines.map((line) => lineElement(line)),
    ),
  ];

  if (view.reasons.length > 0) {
    body.push(detailBlock('option-reasons', view.reasons.length, 'Why this option', view.reasons));
  }
  if (view.limitations.length > 0) {
    body.push(
      detailBlock(
        'option-limits',
        view.limitations.length,
        'What it does not settle',
        view.limitations,
      ),
    );
  }
  body.push(el('p', { class: 'option-next', text: `Next step: ${view.nextStep}` }));

  return el('li', { class: 'option-card', 'data-option-id': view.id }, body);
}

/**
 * The whole panel.
 *
 * `role="region"` with a name rather than `aria-live`, because a refinement
 * replaces the list rather than appending to it: a screen reader that announced
 * every option on every update would read the same three cards aloud each time
 * the visitor changed the budget. The widget's own live region says "Options
 * updated"; this is a place to go and read.
 */
export function cardsElement(panel: OptionsPanelView): HTMLElement {
  const children: (Node | string)[] = [el('h2', { class: 'options-title', text: 'Your options' })];

  if (panel.cards.length > 0) {
    children.push(
      el(
        'ol',
        { class: 'options-list' },
        panel.cards.map((view) => cardElement(view)),
      ),
    );
  } else {
    children.push(el('p', { class: 'options-note', text: panel.note }));
  }

  if (panel.exclusions.length > 0) {
    children.push(
      el('div', { class: 'options-exclusions' }, [
        el('h3', { class: 'options-exclusions-title', text: 'What was ruled out' }),
        el(
          'ul',
          {},
          panel.exclusions.map((message) => el('li', { text: message })),
        ),
      ]),
    );
  }

  return el(
    'div',
    { class: 'options', role: 'region', 'aria-label': 'Package options from this installer' },
    children,
  );
}
