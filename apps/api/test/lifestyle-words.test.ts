import { describe, expect, it } from 'vitest';

import { extractAnswers } from '../src/journey/extract.js';

const lifestyle = (text: string) =>
  extractAnswers(text, 'lifestyle').find((p) => p.questionId === 'lifestyle')?.value ?? null;

describe('the lifestyle question in the visitor’s own words', () => {
  it.each([
    "We're out at work in the day, two of us",
    'we both work full time',
    'Out during the day mostly',
    'nobody is home during the day',
    'at work all day',
    'Mostly evenings',
  ])('"%s" is evening use', (text) => {
    expect(lifestyle(text)).toBe('evening_use');
  });

  it('working from home is daytime, not evening use', () => {
    expect(lifestyle('we work from home')).toBe('home_daytime');
  });

  it('a question about how something works is not a lifestyle', () => {
    expect(lifestyle('how does it all work?')).toBeNull();
  });

  it('an electric car joins evening use', () => {
    expect(lifestyle('out at work in the day and we have an electric car')).toBe(
      'ev_now,evening_use',
    );
  });
});
