import { describe, expect, it } from 'vitest';

import { LOGO_EFFECTS, OUTLINE_EFFECTS, STENCIL_EFFECTS } from '@sunny/contracts';

import {
  EFFECT_PERIOD_MS,
  effectMarkup,
  logoSvg,
  stillMarkup,
  usableEffects,
} from '../src/index.js';
import type { LogoArt } from '../src/index.js';

/**
 * The effects are markup, so these tests read the markup. What they guard is the
 * contract the widget and Studio rely on: every effect is isolated by its uid,
 * stencil motion never leans on an outline the server may not have verified,
 * outline motion always uses the outline it was given, and nothing an installer
 * uploaded can break out of an attribute.
 */

const OUTER = 'M10 10 L90 10 L90 90 L10 90 Z';
const INNER = 'M30 30 L70 30 L70 70 L30 70 Z';
const OUTLINE = `${OUTER} ${INNER}`;

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
    if (effect === 'rings') expect(out).toContain(`d="${OUTLINE}"`);
    else for (const piece of [OUTER, INNER]) expect(out).toContain(`d="${piece}"`);
    expect(out).toContain('pathLength="100"');
    expect(out).not.toContain(art().maskSrc!);
  });

  it.each(['comet', 'draw', 'march'] as const)(
    '%s dashes each subpath of the outline as a path of its own',
    (effect) => {
      // One pathLength across two pieces would restart the dash on each, so the
      // small piece blinks and the main one goes dark for most of the period.
      const out = effectMarkup(effect, art(), 'a');
      const dashed = [...out.matchAll(/<path [^>]*stroke-dasharray[^>]*>/g)].map(([p]) => p);
      expect(dashed).toHaveLength(2);
      for (const path of dashed) expect(path).toContain('pathLength="100"');
      expect(dashed[0]).toContain(`d="${OUTER}"`);
      expect(dashed[1]).toContain(`d="${INNER}"`);
    },
  );

  it.each(LOGO_EFFECTS)('%s offsets phases with negative delays only', (effect) => {
    // Markup is rewritten on every render, so a positive delay would show the
    // unanimated state each time before the motion began.
    const out = effectMarkup(effect, art(), 'a');
    expect(out).not.toContain('animation-delay');
    for (const [, decl] of out.matchAll(/animation:([^;"]+)/g)) {
      const times = [...decl!.matchAll(/(-?\d+(?:\.\d+)?)ms/g)].map(([, t]) => Number(t));
      for (const delay of times.slice(1)) expect(delay).toBeLessThanOrEqual(0);
    }
  });

  it.each(LOGO_EFFECTS)('%s never paints a flat colour fill', (effect) => {
    // Any fill a visitor sees is the uploaded image. Only strokes take a brand
    // colour. Allowed: white for the charge wave, which is a mask and never
    // painted itself, and the shimmer's soft-edged light, a gradient of the glow.
    const out = effectMarkup(effect, art(), 'a');
    for (const [, fill] of out.matchAll(/\bfill="([^"]+)"/g)) {
      expect(['none', '#ffffff', 'url(#g-a)']).toContain(fill);
    }
  });

  it('segments lights the logo by screening its own pixels, never covering them', () => {
    const out = effectMarkup('segments', art(), 'a');
    // Screen only ever lightens, so a dark mark lights up in its highlight and a
    // pale one goes paler; the result is clipped back to the logo's own alpha.
    expect(out).toContain(`<feFlood flood-color="${art().colors.primary}"`);
    expect(out).toContain('mode="screen"');
    expect(out).toContain('operator="in"');
    expect(out).not.toContain(`fill="${art().colors.primary}"`);
    expect(out.match(/<g clip-path="url\(#b\d-a\)" mask="url\(#m-a\)"/g)).toHaveLength(5);
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

  it('scales stroke widths to the longer side', () => {
    const wide = art({ width: 200, height: 80 });
    expect(effectMarkup('draw', wide, 'a')).toContain('stroke-width="5"');
    // The comet is a touch heavier so its spark reads at button size.
    expect(effectMarkup('comet', wide, 'a')).toContain('stroke-width="7"');
  });

  it('draw keeps a faint copy of the logo, so its shape is never gone', () => {
    expect(effectMarkup('draw', art(), 'a')).toContain(
      `<image href="${art().src}" x="0" y="0" width="120" height="100" opacity="0.18"/>`,
    );
  });

  it('rings scale about the centre of the image', () => {
    expect(effectMarkup('rings', art(), 'a')).toContain('transform-origin:60px 50px');
  });

  it('segments keeps a tile logo whole beneath the bands, so it never vanishes', () => {
    // Background-mode art: the image is an opaque tile, and the mask only covers the mark on it.
    const tile = art({ src: 'tile.png', maskSrc: 'mark-mask.png' });
    const out = effectMarkup('segments', tile, 'a');
    const still = '<image href="tile.png" x="0" y="0" width="120" height="100"/>';
    // Outside the style, the defs and the band groups, all that is left is the plain image.
    const outside = out
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replace(/<defs>[\s\S]*?<\/defs>/, '')
      .replace(/<g [^>]*>[\s\S]*?<\/g>/g, '');
    expect(outside).toBe(still);
    // Each lit band is the same image brightened, inside the mark's mask.
    const bands = out.match(
      /<g clip-path="url\(#b\d-a\)" mask="url\(#m-a\)"[^>]*><image href="tile\.png"[^>]*filter="url\(#lit-a\)"\/><\/g>/g,
    );
    expect(bands).toHaveLength(5);
    expect(out).toContain('<filter id="lit-a"');
    expect(out).not.toMatch(/<rect[^>]*fill=/);
  });

  it('segments light five vertical bands across the mask', () => {
    const out = effectMarkup('segments', art(), 'a');
    expect(out.match(/<clipPath /g)).toHaveLength(5);
    expect(out).toContain('x="96" y="0" width="24" height="100"');
  });
});

describe('usableEffects', () => {
  it('keeps every effect when the art has both an outline and a mask', () => {
    expect(usableEffects(LOGO_EFFECTS, art())).toEqual([...LOGO_EFFECTS]);
  });

  it('drops outline effects when the outline is unverified', () => {
    expect(usableEffects(LOGO_EFFECTS, art({ outline: null }))).toEqual([...STENCIL_EFFECTS]);
  });

  it('drops stencil effects when there is no mask', () => {
    expect(usableEffects(['comet', 'shimmer', 'march'], art({ maskSrc: null }))).toEqual([
      'comet',
      'march',
    ]);
  });

  it('leaves nothing to throw: every usable effect renders', () => {
    for (const a of [art({ outline: null }), art({ maskSrc: null })]) {
      for (const e of usableEffects(LOGO_EFFECTS, a))
        expect(() => effectMarkup(e, a, 'a')).not.toThrow();
    }
  });
});

describe('stillMarkup', () => {
  it('is only the uploaded image', () => {
    const out = stillMarkup(art(), 'a');
    expect(out).toBe(`<image href="${art().src}" x="0" y="0" width="120" height="100"/>`);
  });
});

describe('logoSvg', () => {
  it('does not clip, so echo rings show past the image', () => {
    const out = logoSvg(art(), effectMarkup('rings', art(), 'a'));
    expect(out).toMatch(/^<svg [^>]*overflow="visible"/);
    expect(out).toMatch(/^<svg [^>]*style="overflow:visible"/);
  });

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
