import { describe, expect, it } from 'vitest';

import {
  PROP_IDS,
  cloneRig,
  defaultRig,
  lerpRig,
  renderSunny,
  type PropId,
  type SunnyRig,
} from '../src/index.js';
import { SUNNY_THEME, THEME_PRESETS } from '../src/tokens.js';

/**
 * The renderer is where the character becomes pixels, and it is the one part of
 * this repository with a canonical reference: `sunny.png`. These tests pin the
 * properties that make it trustworthy -- determinism, that a colour never
 * arrives through string interpolation, and that the scene contains exactly the
 * props the rig asked for and no others.
 *
 * The snapshots are the visual regression net the plan asks for. They are
 * deterministic because the renderer is a pure function of the rig: no
 * timestamps, no random ids, no iteration-order dependence.
 */

function withProp(
  id: PropId,
  at: Partial<{ x: number; y: number; opacity: number }> = {},
): SunnyRig {
  const rig = defaultRig();
  rig.props = [
    {
      id,
      x: at.x ?? 0,
      y: at.y ?? -40,
      rotation: 0,
      scale: 1,
      opacity: at.opacity ?? 1,
    },
  ];
  return rig;
}

describe('renderer', () => {
  it('is deterministic: the same rig renders byte-identical SVG', () => {
    const rig = defaultRig();
    expect(renderSunny(rig)).toBe(renderSunny(rig));
    // And through a clone, so nothing is hidden in object identity.
    expect(renderSunny(cloneRig(rig))).toBe(renderSunny(rig));
  });

  it('does not vary with the order the rig was built in', () => {
    const a = defaultRig();
    const b = defaultRig();
    b.rays = [...b.rays].reverse();
    // Rays are drawn in array order, so reversing them *is* a visible change --
    // which is exactly right. The claim being tested is narrower: the renderer
    // reads the array it is given and does not re-sort it behind the caller.
    expect(renderSunny(b)).not.toBe(renderSunny(a));
  });

  it('renders a well-formed svg with the accessible title when asked for one', () => {
    const svg = renderSunny(defaultRig(), { title: 'Sunny' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<title>Sunny</title>');
    // Not marked decorative when it carries a title: the two are opposites.
    expect(svg).not.toContain('aria-hidden="true"');
  });

  it('carries the size, viewBox and class it was asked for', () => {
    const svg = renderSunny(defaultRig(), { size: 96, className: 'sunny sunny--sm' });
    expect(svg).toContain('width="96"');
    expect(svg).toContain('height="96"');
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('class="sunny sunny--sm"');
  });

  it('marks the decorative variant aria-hidden, because a title is the accessible path', () => {
    const svg = renderSunny(defaultRig(), { decorative: true });
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain('<title>');
  });

  it('is decorative by default and an image once it is named', () => {
    expect(renderSunny(defaultRig())).toContain('aria-hidden="true"');
    expect(renderSunny(defaultRig())).not.toContain('role="img"');
    expect(renderSunny(defaultRig(), { title: 'Sunny' })).toContain('role="img"');
  });

  it('never emits a title that assistive technology cannot reach', () => {
    // The contradiction this forbids: `aria-hidden` on an element carrying a
    // <title>. An explicit `decorative: true` alongside a title is resolved by
    // dropping the title, because a label nothing can read is worse than none.
    const svg = renderSunny(defaultRig(), { title: 'Sunny', decorative: true });
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain('<title>');

    // And the reverse: a labelled image always has something to label it with.
    const labelled = renderSunny(defaultRig(), { decorative: false });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Sunny"');
  });

  it('emits literal hex by default and custom properties only when asked', () => {
    const literal = renderSunny(defaultRig());
    const tokens = renderSunny(defaultRig(), { cssVariables: true });

    // The default matters: @resvg/resvg-js does not resolve custom properties,
    // so a rasteriser fed the token form renders a blank character. That was a
    // real bug, and the default is what prevents it coming back.
    expect(literal).not.toContain('var(--sunny');
    expect(tokens).toContain('var(--sunny');
    expect(literal).toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('is not injectable through the accessible title', () => {
    // The title is the one string a caller supplies, and it can reach the DOM.
    // A title is text, so a `<` in it must not become an element.
    const svg = renderSunny(defaultRig(), { title: '<script>alert(1)</script>' });
    expect(svg).not.toContain('<script>alert(1)</script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('renders every declared prop, and only the ones the rig carries', () => {
    for (const id of PROP_IDS) {
      const bare = renderSunny(defaultRig());
      const worn = renderSunny(withProp(id));
      expect(worn, `prop ${id} produced no output`).not.toBe(bare);
      expect(worn, `prop ${id} is not labelled`).toContain(`data-prop="${id}"`);
    }
  });

  it('keeps the prop vocabulary closed', () => {
    // A prop that the renderer can draw but the scheduler cannot name would be
    // unreachable; one the scheduler can name but the renderer cannot draw would
    // be a silent no-op. The list is the single source of both.
    expect(new Set(PROP_IDS).size).toBe(PROP_IDS.length);
    expect(PROP_IDS).toContain('sunglasses');
  });

  it('drops a prop once it has fully faded, and keeps it while it is fading', () => {
    // Mid-fade the prop is present and translucent: that is what makes the fade
    // read as a fade. At zero it is gone entirely, so a resting character's
    // markup is identical to one that never had props.
    const mid = renderSunny(withProp('sparkle', { opacity: 0.5 }));
    expect(mid).toContain('data-prop="sparkle"');
    expect(mid).toMatch(/data-prop="sparkle"[^>]*opacity="0\.5"/);

    expect(renderSunny(withProp('sparkle', { opacity: 0 }))).not.toContain('data-prop="sparkle"');
    expect(renderSunny(defaultRig())).not.toContain('data-prop=');
  });

  it('paints a surface prop as an outline around a theme colour, not as ink', () => {
    // The character's own language is a black outline around a flat fill, and a
    // prop that is an object has to be drawn the same way or it reads as a hole
    // in the scene. The fill comes from the rig's theme, so it re-tints with the
    // tenant's colour rather than being a second hard-coded palette.
    const drawn = renderSunny(withProp('deckchair'));
    const group = drawn.slice(drawn.indexOf('data-prop="deckchair"'));
    expect(group).toContain(`fill="${SUNNY_THEME.highlight}"`);
    expect(group).toContain(`stroke="${SUNNY_THEME.ink}"`);

    const purple = withProp('deckchair');
    purple.theme = THEME_PRESETS.purple!;
    const purpleGroup = renderSunny(purple).slice(
      renderSunny(purple).indexOf('data-prop="deckchair"'),
    );
    expect(purpleGroup).toContain(`fill="${THEME_PRESETS.purple!.highlight}"`);
    expect(purpleGroup).not.toContain(SUNNY_THEME.highlight);
  });

  it('keeps the marks that are not objects as strokes or ink', () => {
    // The two other paintings, pinned so a future prop cannot quietly claim the
    // surface treatment: a mark is an ink stroke and a small sign is an ink mass.
    const ask = renderSunny(withProp('question-mark'));
    expect(ask.slice(ask.indexOf('data-prop="question-mark"'))).toContain('fill="none"');

    const sparkle = renderSunny(withProp('sparkle')).slice(
      renderSunny(withProp('sparkle')).indexOf('data-prop="sparkle"'),
    );
    expect(sparkle).toContain(`fill="${SUNNY_THEME.ink}"`);
    expect(sparkle).not.toContain(`fill="${SUNNY_THEME.highlight}"`);
  });

  it('interpolates between two poses without leaving the rig shape', () => {
    const a = defaultRig();
    const b = defaultRig();
    b.eyes.left.closed = 1;
    b.smile.depth = -6;

    const mid = lerpRig(a, b, 0.5);
    expect(Object.keys(mid).sort()).toEqual(Object.keys(a).sort());
    expect(mid.eyes.left.closed).toBeGreaterThan(a.eyes.left.closed);
    expect(mid.eyes.left.closed).toBeLessThan(b.eyes.left.closed);
    expect(mid.smile.depth).toBeLessThan(a.smile.depth);
    // The endpoints are exact: a sequence that ends at t=1 lands on its target
    // rather than near it. A half-step short would leave a visible residue.
    expect(lerpRig(a, b, 1).eyes.left.closed).toBe(b.eyes.left.closed);
    expect(lerpRig(a, b, 0).smile.depth).toBe(a.smile.depth);
  });

  it('renders a deep-frozen reference pose', () => {
    // Sunny has a canonical resting pose -- the one measured from the reference
    // artwork -- and everything else is a departure from it. This snapshot is
    // that pose, so an accidental change to the geometry is visible as a diff
    // rather than as a character that merely looks slightly off.
    expect(renderSunny(defaultRig())).toMatchSnapshot();
  });
});
