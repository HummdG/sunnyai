import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TOKENS } from '@sunny/character';

import { UI_TOKENS, cssVariables } from '../src/index.js';

const tokensCssPath = fileURLToPath(new URL('../src/tokens.css', import.meta.url));

describe('design tokens', () => {
  it('keeps the generated stylesheet in step with the source', () => {
    // If this fails, someone edited `tokens.css` by hand, or changed a token and
    // did not run `npm run build:tokens`. Either way the file on disk is no
    // longer what the code says it is.
    const onDisk = readFileSync(tokensCssPath, 'utf8');
    expect(onDisk).toBe(cssVariables());
  });

  it('takes its colours from the character rather than restating them', () => {
    const css = cssVariables();

    // Every canonical colour appears...
    for (const value of Object.values(TOKENS)) {
      expect(css).toContain(value);
    }

    // ...and the brand orange appears exactly once, as the character's own
    // token. A second occurrence would be a second copy of the colour, which is
    // exactly the drift the character package's comment promises cannot happen.
    const occurrences = css.split(TOKENS.brandOrange).length - 1;
    expect(occurrences).toBe(1);
  });

  it('names colour variables after the character tokens', () => {
    const css = cssVariables();
    expect(css).toContain('--sunny-brand-orange:');
    expect(css).toContain('--sunny-warm-white:');
    expect(css).toContain('--sunny-ink:');
  });

  it('emits the space scale as indexed custom properties', () => {
    const css = cssVariables();
    expect(css).toContain(`--space-0: ${UI_TOKENS.space[0]}px;`);
    expect(css).toContain(`--space-4: ${UI_TOKENS.space[4]}px;`);
    // Index 4 is the first step a reader would reach for; assert it is 16px so a
    // reordered scale is a deliberate change rather than an accident.
    expect(UI_TOKENS.space[4]).toBe(16);
  });

  it('is a self-contained :root block', () => {
    const css = cssVariables();
    expect(css.trimStart().startsWith('/*')).toBe(true);
    expect(css).toContain(':root {');
    expect(css.trimEnd().endsWith('}')).toBe(true);

    // Balanced braces, which is the one syntax error a string-built stylesheet
    // can make that a browser will silently swallow.
    const opens = css.split('{').length - 1;
    const closes = css.split('}').length - 1;
    expect(opens).toBe(closes);
  });
});
