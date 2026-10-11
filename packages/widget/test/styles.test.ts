import { describe, expect, it } from 'vitest';

import { FONT_FAMILY, SYSTEM_FONT_STACK } from '@sunny/ui';

import { styles } from '../src/styles.js';

/**
 * The device cutout, pinned in the stylesheet.
 *
 * `env(safe-area-inset-*)` is not something a test can make a browser report, so
 * what is checked here is the arithmetic the widget performs with it -- plus one
 * invariant that is the reason this file exists: **every `inset` in the sheet
 * carries its cutout term**. A fifth corner, or a breakpoint that restates the
 * shorthands with plain pixels, is the realistic way this regresses, and both
 * fail the invariant rather than shipping a launcher under a home indicator. The
 * browser-side half (the gap really moves) is in
 * `tests/e2e/resilience.spec.ts`.
 */
const css = styles().replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `inset:` declaration's value, whitespace collapsed to one line. */
function insetValues(sheet: string): string[] {
  return [...sheet.matchAll(/inset:\s*([^;]+);/g)].map((match) =>
    match[1]!.replace(/\s+/g, ' ').trim(),
  );
}

describe('the widget stylesheet and the device cutout', () => {
  it('reads the four platform insets, each defaulting to nothing', () => {
    // The fallback is 0px rather than a pixel guess: on the overwhelming
    // majority of screens there is no cutout, and the widget must be unmoved
    // there. A nonzero fallback would be the widget inventing a cutout.
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`env(safe-area-inset-${side}, 0px)`);
    }
  });

  it('adds the cutout to the gutter rather than replacing the gutter with it', () => {
    // The shipped gutters are 20px, which the WordPress fixture measures as the
    // exact distance from the viewport edge -- so these two must agree.
    expect(css).toContain('--sunny-gutter-x: 20px');
    expect(css).toContain('--sunny-gutter-y: 20px');
    expect(css).toContain('calc(var(--sunny-gutter-x) + var(--sunny-safe-right))');
    expect(css).toContain('calc(var(--sunny-gutter-y) + var(--sunny-safe-bottom))');
  });

  it('anchors each corner on its own two edges, cutout included', () => {
    const values = insetValues(css);
    // One per position: bottom-right (the default), bottom-left, top-right,
    // top-left. `inset` is top/right/bottom/left, so each rule's first safe-area
    // term is the edge it is pinned by.
    expect(values).toHaveLength(4);

    const edges = [
      ['--sunny-safe-right', '--sunny-safe-bottom'],
      ['--sunny-safe-bottom', '--sunny-safe-left'],
      ['--sunny-safe-top', '--sunny-safe-right'],
      ['--sunny-safe-top', '--sunny-safe-left'],
    ];
    values.forEach((value, index) => {
      const [first, second] = edges[index]! as [string, string];
      const at = value.indexOf(first);
      expect(at, `inset ${index} is missing ${first}: ${value}`).toBeGreaterThanOrEqual(0);
      expect(
        value.indexOf(second),
        `inset ${index} is missing ${second} after ${first}: ${value}`,
      ).toBeGreaterThan(at);
    });
  });

  it('never states an inset without its cutout term, or without !important', () => {
    // The `!important` half is D-36's lesson: on the host element a page's
    // normal declaration beats the shadow root's, so an inset the page can take
    // away is an inset that does not hold on the site the widget is embedded in.
    for (const value of insetValues(css)) {
      expect(value, value).toMatch(/var\(--sunny-gutter-[xy]\)/);
      expect(value, value).toMatch(/var\(--sunny-safe-/);
      expect(value, value).toContain('!important');
    }
  });

  it('keeps the panel itself out from under the cutout', () => {
    // The launcher's gutter is not the only place a cutout matters: a panel
    // sized only against the viewport puts its last card under the home
    // indicator, on the one kind of screen that has one.
    expect(css).toContain('calc(100vh - 140px - var(--sunny-safe-top) - var(--sunny-safe-bottom))');
    expect(css).toContain('calc(100vw - 40px - var(--sunny-safe-left) - var(--sunny-safe-right))');
  });

  it('narrows the gutter on a small screen without dropping the cutout', () => {
    expect(css).toContain('--sunny-gutter-x: 12px');
    expect(css).toContain('--sunny-gutter-y: 12px');
    // That the breakpoint adds no `inset` of its own is what the four-value
    // count above already holds -- and is the whole point of narrowing the
    // gutter through a custom property instead of restating the shorthands.
  });
});

/**
 * The typeface, as far as a stylesheet is concerned.
 *
 * Which is not very far, and that is the finding these tests encode. The face is
 * registered with the document through the Font Loading API (`fonts.ts`), not
 * declared in this sheet, because Chromium does not use an `@font-face` that
 * lives in a shadow tree — it parses the rule and then never matches it, so the
 * font is never requested and the panel silently renders in the fallback.
 *
 * What the sheet still owns is the family name and where it sits in the stack,
 * and both have to hold whether or not a face was ever registered: a face that
 * 404s, is blocked, or arrives late must degrade to the system fonts rather than
 * to the browser's default serif.
 */
describe('the widget stylesheet and the typeface', () => {
  it('names the brand family first, ahead of the system stack', () => {
    expect(css).toContain(`font-family: "${FONT_FAMILY}", ${SYSTEM_FONT_STACK} !important;`);
  });

  it('declares no face of its own', () => {
    // A regression guard with a specific failure behind it. An `@font-face` here
    // is not merely redundant: it is a rule the browser parses and ignores, so
    // someone reading this file would believe the font was wired up.
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('unicode-range');
  });

  it('sets the family in exactly one place, on the host', () => {
    // One primary family is the requirement, and this is what makes it
    // checkable: a descendant rule that restates `font-family` is how a second
    // family gets in.
    expect(css.match(/font-family:/g)).toHaveLength(1);
    expect(css).toContain(':host {');
  });
});
