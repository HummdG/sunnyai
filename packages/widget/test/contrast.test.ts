import { describe, expect, it } from 'vitest';

import { contrastRatio, legibleInk, parseHex, relativeLuminance } from '../src/contrast.js';

/**
 * The colour maths, pinned against values that can be checked by hand.
 *
 * The reference points are the ones WCAG itself uses: white against black is 21,
 * any colour against itself is 1, and #767676 is the well-known darkest grey that
 * still passes 4.5:1 on white. If the luminance formula drifts, those stop being
 * true, and the widget starts shipping unreadable text for every tenant at once.
 */

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it('weights green above red above blue', () => {
    // The ordering is the whole point of the coefficients: a viewer reads a
    // change in green as a far larger change in brightness than one in blue.
    const red = relativeLuminance({ r: 255, g: 0, b: 0 });
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio({ r: 12, g: 34, b: 56 }, { r: 12, g: 34, b: 56 })).toBeCloseTo(1, 10);
  });

  it('does not care about argument order', () => {
    const a = { r: 255, g: 121, b: 0 };
    const b = { r: 255, g: 241, b: 229 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('reproduces the failure the audit found', () => {
    // #FF6500 on #FFF1E5, the suggestion chip as it shipped. Recorded as a test
    // because "is this still broken?" should be answerable without a browser.
    const ratio = contrastRatio({ r: 255, g: 101, b: 0 }, { r: 255, g: 241, b: 229 });
    expect(ratio).toBeCloseTo(2.666, 2);
    expect(ratio).toBeLessThan(4.5);
  });
});

describe('parseHex', () => {
  it('accepts six digits, with or without the hash, in either case', () => {
    const expected = { r: 255, g: 121, b: 0 };
    expect(parseHex('#FF7900')).toEqual(expected);
    expect(parseHex('ff7900')).toEqual(expected);
    expect(parseHex('  #Ff7900 ')).toEqual(expected);
  });

  it('expands the three-digit shorthand', () => {
    expect(parseHex('#f70')).toEqual({ r: 255, g: 119, b: 0 });
  });

  it('refuses anything else rather than guessing', () => {
    expect(parseHex('rebeccapurple')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('rgb(1,2,3)')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('legibleInk', () => {
  it('returns the colour untouched when it already passes', () => {
    // A tenant who chose a deep navy gets their navy, not a corrected version of
    // it. The function is a floor, not a colour-picker.
    expect(legibleInk('#101a3a', ['#FFFFFF'])).toBe('#101a3a');
  });

  it('darkens the shipped brand until it passes on white', () => {
    const ink = legibleInk('#FF7900', ['#FFFFFF']);
    const parsed = parseHex(ink);
    expect(parsed).not.toBeNull();
    expect(contrastRatio(parsed!, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5);
  });

  it('clears every background it is given, not just the first', () => {
    // The chip background is the harder of the two, and passing white alone would
    // leave the chips failing.
    const ink = legibleInk('#FF7900', ['#FFFFFF', '#FFF1E5']);
    expect(contrastRatio(parseHex(ink)!, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseHex(ink)!, { r: 255, g: 241, b: 229 })).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the hue', () => {
    // Darkening must not turn the brand grey. Orange stays orange: red is still
    // the dominant channel and blue is still the smallest.
    const { r, g, b } = parseHex(legibleInk('#FF7900', ['#FFF1E5']))!;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('finds a legible answer for an arbitrary brand colour', () => {
    // The real requirement: tenants pick colours we have never seen.
    for (const brand of ['#FFE600', '#00C2FF', '#7CFC00', '#FF00FF', '#FFFFFF', '#FFB066']) {
      const ink = parseHex(legibleInk(brand, ['#FFFFFF', '#FFF1E5']));
      expect(ink, brand).not.toBeNull();
      expect(contrastRatio(ink!, { r: 255, g: 255, b: 255 }), brand).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink!, { r: 255, g: 241, b: 229 }), brand).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('finds the darkest legible tone of white rather than jumping to black', () => {
    // White has no hue to preserve, so the loop just walks lightness down until
    // the ratio clears -- stopping at the *lightest* value that passes rather
    // than at black. That is the property worth pinning: the result stays as
    // close to the tenant's colour as the contrast allows.
    const ink = legibleInk('#FFFFFF', ['#FFFFFF']);
    const parsed = parseHex(ink)!;
    expect(ink).not.toBe('#FFFFFF');
    expect(contrastRatio(parsed, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5);
    // Anything much darker than necessary is the loop overshooting.
    expect(relativeLuminance(parsed)).toBeGreaterThan(0.1);
  });

  it('leaves an unparseable colour alone rather than inventing one', () => {
    // A typo in the tenant's config should stay visible as their typo.
    expect(legibleInk('not-a-colour', ['#FFFFFF'])).toBe('not-a-colour');
  });
});
