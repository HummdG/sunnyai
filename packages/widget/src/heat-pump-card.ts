import type { HeatPumpOptionCard } from '@sunny/contracts';

/**
 * The words on one heat pump quote option, as plain strings: the widget builds
 * the card from exactly these (through `el`'s textContent), and the tests read
 * them without a browser.
 *
 * An installer-priced option shows its price label and never a figure: no
 * price, and no grant deducted from a price that does not exist.
 */
export interface HeatPumpCardText {
  /** The option carries a price (not one the installer sets at the survey). */
  priced: boolean;
  /** `8 kW heat pump`. */
  size: string;
  /** The price, or the option's price label when the installer prices it. */
  figure: string;
  figureLabel: string;
  /** The grant line, or null when there is none to show. */
  grant: string | null;
  stats: string[];
  /** What the installer will need to check. */
  notes: string[];
}

/** Whole pounds, as the cards show them: `£12,400`. */
export const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

export function heatPumpCardText(o: HeatPumpOptionCard): HeatPumpCardText {
  const price = o.installerPriced === true ? null : o.priceGbp;
  const priced = price !== null;
  const grant =
    o.grantStatus === 'unsure'
      ? 'The Boiler Upgrade Scheme may apply'
      : o.grantStatus === 'eligible' && o.grantGbp > 0 && priced && o.priceAfterGrantGbp !== null
        ? `After the ${gbp(o.grantGbp)} grant: ${gbp(o.priceAfterGrantGbp)}`
        : null;
  const savings = Math.round(o.annualSavingsGbp);
  return {
    priced,
    size: `${o.outputKw.toLocaleString('en-GB')} kW heat pump`,
    figure: priced ? gbp(price) : o.priceLabel || 'Priced by your installer',
    figureLabel: priced ? o.priceLabel : 'Free survey, no obligation',
    grant,
    stats: [
      `Running cost about ${gbp(o.runningCostGbp)} a year`,
      savings > 0
        ? `About ${gbp(savings)} a year less than now`
        : savings < 0
          ? `About ${gbp(-savings)} a year more than now, but low carbon`
          : 'About the same running cost as now',
    ],
    notes: [...(o.warnings ?? [])],
  };
}
