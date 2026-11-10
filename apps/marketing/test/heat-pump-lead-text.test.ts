import { describe, expect, it } from 'vitest';

import {
  heatPumpGrantText,
  heatPumpSavingsText,
} from '../components/dashboard/heat-pump-lead-text.js';

describe('the heat pump option on the lead page', () => {
  it('shows the grant in three states', () => {
    expect(heatPumpGrantText(true, 7500)).toBe('Boiler Upgrade Scheme £7,500');
    expect(heatPumpGrantText('unsure', 0)).toBe('Boiler Upgrade Scheme may apply');
    expect(heatPumpGrantText(false, 0)).toBe('No Boiler Upgrade Scheme grant');
    // A row without the verdict reads from the amount.
    expect(heatPumpGrantText(undefined, 6500)).toBe('Boiler Upgrade Scheme £6,500');
    expect(heatPumpGrantText(undefined, 0)).toBe('No Boiler Upgrade Scheme grant');
  });

  it('says a dearer running cost is higher than now', () => {
    expect(heatPumpSavingsText(-180)).toBe('About £180 a year higher than now');
    expect(heatPumpSavingsText(250)).toBe('About £250 a year less than now');
    expect(heatPumpSavingsText(0.3)).toBe('About the same as now');
  });
});
