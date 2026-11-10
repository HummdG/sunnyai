import type { BatteryOptionCard } from '@sunny/contracts';

import { gbp } from './heat-pump-card.js';

/**
 * The words on one battery quote option, as plain strings: the widget builds
 * the card from exactly these (through `el`'s textContent), and the tests read
 * them without a browser.
 *
 * An installer-priced option shows its price label and never a price or a
 * payback (a payback needs a price). Its saving still shows: what a battery
 * saves does not depend on what it costs.
 */
export interface BatteryCardText {
  /** The option carries a price (not one the installer sets at the survey). */
  priced: boolean;
  /** The quote's short line about the option, under its title. */
  headline: string;
  /** `5 kWh battery`. */
  size: string;
  /** The price, or the option's price label when the installer prices it. */
  figure: string;
  figureLabel: string;
  /** The saving and the payback, each only when there is one to show. */
  stats: string[];
  /** What the installer will need to check. */
  notes: string[];
}

/** The options smallest to largest, as the solar cards are. */
export function batteryCardOrder<T extends { capacityKwh: number }>(options: readonly T[]): T[] {
  return [...options].sort((a, b) => a.capacityKwh - b.capacityKwh);
}

export function batteryCardText(o: BatteryOptionCard): BatteryCardText {
  const price = o.installerPriced === true ? null : o.priceGbp;
  const priced = price !== null;
  const saving = Math.round(o.annualSavingsGbp);
  const shift = Math.round(o.shiftSavingGbp);
  const savingLine =
    saving > 0
      ? `Saves about ${gbp(saving)} a year${
          shift > 0 ? `, including about ${gbp(shift)} from cheap-rate charging` : ''
        }`
      : null;
  // As the PDF gives it: to the half year the quote rounds it to.
  const years = priced ? o.paybackYears : null;
  return {
    priced,
    headline: o.headline,
    size: `${o.capacityKwh.toLocaleString('en-GB')} kWh battery`,
    figure: priced ? gbp(price) : o.priceLabel || 'Priced by your installer',
    figureLabel: priced ? o.priceLabel : 'Free survey, no obligation',
    stats: [
      ...(savingLine ? [savingLine] : []),
      ...(years !== null
        ? [
            `Pays back in about ${years.toLocaleString('en-GB', { maximumFractionDigits: 1 })} ${
              years === 1 ? 'year' : 'years'
            }`,
          ]
        : []),
    ],
    notes: [...(o.warnings ?? [])],
  };
}
