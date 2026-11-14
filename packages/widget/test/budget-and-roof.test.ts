import { budgetLadderSchema } from '@sunny/contracts';
import { describe, expect, it } from 'vitest';

import { parseBudgetLadder, stepFor, systemWords, type BudgetStep } from '../src/budget-slider.js';
import { parseRoofPicture } from '../src/roof-image.js';

const step = (priceGbp: number, panelCount: number, batteryKwh = 0): BudgetStep => ({
  priceGbp,
  panelCount,
  systemKwp: Math.round(panelCount * 0.43 * 100) / 100,
  batteryKwh,
  annualGenerationKwh: panelCount * 380,
  annualSavingsGbp: panelCount * 60,
  paybackYears: 9.5,
  twentyFiveYearSavingsGbp: panelCount * 1800,
});

const LADDER = {
  minGbp: 5200,
  maxGbp: 14800,
  initialGbp: 10000,
  fromAnswer: true,
  steps: [step(5200, 8), step(7400, 12), step(9900, 12, 5.2), step(14800, 16, 10.4)],
};

describe('the budget slider', () => {
  it('lands on the most capable system the budget affords', () => {
    expect(stepFor(LADDER.steps, 9900).priceGbp).toBe(9900);
    expect(stepFor(LADDER.steps, 9899).priceGbp).toBe(7400);
    expect(stepFor(LADDER.steps, 50_000).priceGbp).toBe(14800);
    // Below the smallest system: the smallest, which the card says is over.
    expect(stepFor(LADDER.steps, 1000).priceGbp).toBe(5200);
  });

  it('reads a ladder the contract accepts, and nothing it cannot slide', () => {
    expect(budgetLadderSchema.safeParse(LADDER).success).toBe(true);
    expect(parseBudgetLadder(LADDER)).not.toBeNull();
    expect(parseBudgetLadder({ ...LADDER, steps: [LADDER.steps[0]] })).toBeNull();
    expect(parseBudgetLadder({ ...LADDER, maxGbp: LADDER.minGbp })).toBeNull();
    expect(
      parseBudgetLadder({
        ...LADDER,
        steps: [{ ...LADDER.steps[0], priceGbp: 'lots' }, step(1, 1)],
      }),
    ).toBeNull();
    expect(parseBudgetLadder(undefined)).toBeNull();
  });

  it('says what the budget buys in plain words', () => {
    expect(systemWords(step(5200, 8))).toBe('8 panels (3.44 kWp)');
    expect(systemWords(step(9900, 12, 5.2))).toBe('12 panels (5.16 kWp) with a 5.2 kWh battery');
  });
});

describe('the roof picture', () => {
  const picture = {
    width: 180,
    height: 160,
    image: 'data:image/jpeg;base64,AAAA',
    imageryYear: 2023,
    faces: [
      {
        facing: 'south',
        pitchDeg: 35,
        areaM2: 40,
        panelCount: 1,
        colour: '#f2a93b',
        panels: [[90, 100, 10.5, 15.4, 180]],
      },
    ],
  };

  it('accepts the shape the API sends', () => {
    expect(parseRoofPicture(picture)).not.toBeNull();
  });

  it('refuses anything that is not a JPEG data URL or a plain colour', () => {
    expect(parseRoofPicture({ ...picture, image: 'https://evil.example/x.jpg' })).toBeNull();
    expect(
      parseRoofPicture({ ...picture, faces: [{ ...picture.faces[0], colour: 'red;x' }] }),
    ).toBeNull();
    expect(
      parseRoofPicture({ ...picture, faces: [{ ...picture.faces[0], panels: [[1, 2, 3]] }] }),
    ).toBeNull();
  });
});
