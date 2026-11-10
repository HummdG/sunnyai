import { BUS_AMOUNT_GBP, BUS_ELIGIBLE_FUELS, BUS_OWNERSHIP } from './data/bus-rules.js';
import { nationOf } from './nation.js';
import type { BusVerdict, HeatPumpInput } from './types.js';

export function busVerdict(input: HeatPumpInput): BusVerdict {
  const nation = nationOf(input.postcode);
  const reasons: string[] = [];
  let eligible: boolean | 'unsure' = true;

  if (nation === 'scotland') {
    eligible = false;
    reasons.push(
      'The Boiler Upgrade Scheme covers England and Wales. Home Energy Scotland offers its own support.',
    );
  } else if (nation === 'northern_ireland' || nation === 'crown_dependency') {
    eligible = false;
    reasons.push('The Boiler Upgrade Scheme covers England and Wales.');
  } else if (nation === 'border') {
    eligible = 'unsure';
    reasons.push('We could not tell from the postcode whether this is in England or Scotland.');
  } else if (nation === 'unknown') {
    eligible = 'unsure';
    reasons.push('We could not tell from the postcode whether this is in England or Wales.');
  }

  if (input.currentFuel === 'heat_pump') {
    eligible = false;
    reasons.push('Already has a heat pump.');
  } else if (!(BUS_ELIGIBLE_FUELS as readonly string[]).includes(input.currentFuel)) {
    eligible = false;
  } else if (input.currentFuel === 'other') {
    // Some other heating (a solid fuel stove, say) may or may not qualify.
    if (eligible === true) eligible = 'unsure';
    reasons.push('Your installer will check whether your current heating qualifies.');
  }

  if (!(BUS_OWNERSHIP as readonly string[]).includes(input.ownership)) {
    eligible = false;
    reasons.push('The grant goes to the property owner.');
  }

  if (input.epcRecommendsInsulation === 'yes') {
    reasons.push(
      'The EPC recommends insulation. This no longer blocks the grant, but an installer will want to check it.',
    );
  }

  return { eligible, amountGbp: BUS_AMOUNT_GBP, reasons };
}
