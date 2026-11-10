/**
 * The words on a heat pump option on the lead page, as plain strings, so the
 * tests read them without a browser.
 */

/** Money per guidelines H3: £6,500 (pence only under £100). */
export function money(gbp: number): string {
  return gbp < 100 ? `£${gbp.toFixed(2)}` : `£${Math.round(gbp).toLocaleString('en-GB')}`;
}

/**
 * The grant in its three states. `eligible` is the quote's verdict; a row
 * without one reads from the amount alone.
 */
export function heatPumpGrantText(
  eligible: boolean | 'unsure' | undefined,
  grantGbp: number,
): string {
  if (eligible === 'unsure') return 'Boiler Upgrade Scheme may apply';
  const yes = eligible === undefined ? grantGbp > 0 : eligible === true && grantGbp > 0;
  return yes ? `Boiler Upgrade Scheme ${money(grantGbp)}` : 'No Boiler Upgrade Scheme grant';
}

/** The yearly running cost against now: a saving, about the same, or higher. */
export function heatPumpSavingsText(annualSavingsGbp: number): string {
  const savings = Math.round(annualSavingsGbp);
  if (savings > 0) return `About ${money(savings)} a year less than now`;
  if (savings < 0) return `About ${money(-savings)} a year higher than now`;
  return 'About the same as now';
}
