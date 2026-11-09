import { describe, expect, it } from 'vitest';

import { LOGO_EFFECTS, OUTLINE_EFFECTS, STENCIL_EFFECTS } from '@sunny/contracts';

import { EFFECT_PERIOD_MS, effectMarkup, logoSvg, stillMarkup } from '../src/index.js';
import type { LogoArt } from '../src/index.js';

/**
 * The effects are markup, so these tests read the markup. What they guard is the
 * contract the widget and Studio rely on: every effect is isolated by its uid,
 * stencil motion never leans on an outline the server may not have verified,
 * outline motion always uses the outline it was given, and nothing an installer
 * uploaded can break out of an attribute.
 */

const OUTLINE = 'M10 10 L90 10 L90 90 L10 90 Z M30 30 L70 30 L70 70 L30 70 Z';

function art(overrides: Partial<LogoArt> = {}): LogoArt {
  return {
    src: '/v1/widget/brand/w_abcdefghij/0123456789abcdef.png',
    maskSrc: '/v1/widget/brand/w_abcdefghij/0123456789abcdef-mask.png',
    width: 120,
    height: 100,
    outline: OUTLINE,
    colors: { primary: '#b4e51f', glow: '#f4ffd0' },
    ...overrides,
  };
}

describe('effectMarkup', () => {
  it.each(LOGO_EFFECTS)('%s carries the uid and no undefined or NaN', (effect) => {
    const out = effectMarkup(effect, art(), 'u7x');
    expect(out).toContain('u7x');
    expect(out).not.toMatch(/undefined|NaN|null/);
  });

  it.each(LOGO_EFFECTS)('%s suffixes every id and keyframe name with the uid', (effect) => {
    const out = effectMarkup(effect, art(), 'u7x');
    for (const [, id] of out.matchAll(/\bid="([^"]+)"/g)) expect(id).toMatch(/-u7x$/);
    for (const [, name] of out.matchAll(/@keyframes\s+([\w-]+)/g)) expect(name).toMatch(/-u7x$/);
    for (const [, ref] of out.matchAll(/url\(#([^)]+)\)/g)) expect(ref).toMatch(/-u7x$/);
    expect(out).toContain('<style>');
  });

  it.each(LOGO_EFFECTS)('%s draws the real image as its base', (effect) => {
    const out = effectMarkup(effect, art(), 'a');
    expect(out).toContain(`<image href="${art().src}"`);
  });

  it.each(OUTLINE_EFFECTS)('%s draws the given outline', (effect) => {
    const out = effectMarkup(effect, art(), 'a');
    expect(out).toContain(`d="${OUTLINE}"`);
    expect(out).toContain('pathLength="100"');
    expect(out).not.toContain(art().maskSrc!);
  });

  it.each(OUTLINE_EFFECTS)('%s fills the outline, if at all, even-odd', (effect) => {
    const out = effectMarkup(effect, art(), 'a');
    for (const [path] of out.matchAll(/<path [^>]*>/g)) {
      if (!/fill="none"/.test(path)) expect(path).toContain('fill-rule="evenodd"');
    }
  });

  it.each(STENCIL_EFFECTS)('%s is stencilled by the mask and never uses the outline', (effect) => {
    const out = effectMarkup(effect, art(), 'a');
    expect(out).toContain(`<image href="${art().maskSrc}"`);
    expect(out).toContain('mask-type="alpha"');
    expect(out).not.toContain(OUTLINE);
  });

  it.each(OUTLINE_EFFECTS)('%s throws without an outline', (effect) => {
    expect(() => effectMarkup(effect, art({ outline: null }), 'a')).toThrow();
  });

  it.each(STENCIL_EFFECTS)('%s throws without a mask', (effect) => {
    expect(() => effectMarkup(effect, art({ maskSrc: null }), 'a')).toThrow();
  });

  it('works for a stencil effect when there is no outline', () => {
    expect(() => effectMarkup('shimmer', art({ outline: null }), 'a')).not.toThrow();
  });

  it('escapes quotes and markup in the image sources', () => {
    const out = effectMarkup('shimmer', art({ src: 'a"b<c>&d', maskSrc: 'm\'"x' }), 'a');
    expect(out).not.toContain('a"b');
    expect(out).toContain('a&quot;b&lt;c&gt;&amp;d');
    expect(out).toContain('m&#39;&quot;x');
  });

  it('uses each effect period by default and the one given otherwise', () => {
    expect(effectMarkup('shimmer', art(), 'a')).toContain(`${EFFECT_PERIOD_MS.shimmer}ms`);
    expect(effectMarkup('shimmer', art(), 'a', 3000)).toContain('3000ms');
  });

  it('scales stroke widths to 2.5 % of the longer side', () => {
    expect(effectMarkup('comet', art({ width: 200, height: 80 }), 'a')).toContain(
      'stroke-width="5"',
    );
  });

  it('rings scale about the centre of the image', () => {
    expect(effectMarkup('rings', art(), 'a')).toContain('transform-origin:60px 50px');
  });

  it('segments light five vertical bands across the mask', () => {
    const out = effectMarkup('segments', art(), 'a');
    expect(out.match(/<clipPath /g)).toHaveLength(5);
    expect(out).toContain('x="96" y="0" width="24" height="100"');
  });
});

describe('stillMarkup', () => {
  it('is only the uploaded image', () => {
    const out = stillMarkup(art(), 'a');
    expect(out).toBe(`<image href="${art().src}" x="0" y="0" width="120" height="100"/>`);
  });
});

describe('logoSvg', () => {
  it('wraps markup in a viewBox matching the image', () => {
    const out = logoSvg(art(), stillMarkup(art(), 'a'), 'Acme');
    expect(out).toMatch(/^<svg [^>]*viewBox="0 0 120 100"/);
    expect(out).toContain('aria-label="Acme"');
    expect(out).toContain('role="img"');
  });

  it('hides a decorative logo from assistive technology', () => {
    expect(logoSvg(art(), '', undefined)).toContain('aria-hidden="true"');
  });
});

describe('EFFECT_PERIOD_MS', () => {
  it('matches the approved timings', () => {
    expect(EFFECT_PERIOD_MS).toEqual({
      comet: 1600,
      draw: 2600,
      charge: 4800,
      shimmer: 1500,
      rings: 1800,
      march: 900,
      segments: 1500,
    });
  });
});
