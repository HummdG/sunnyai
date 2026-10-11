import { TOKENS } from '@sunny/character';

/**
 * The design tokens the marketing site and the dashboard share.
 *
 * Colour is **imported, not restated**. `@sunny/character` already holds the
 * canonical Sunny palette and says, in its own comment, that it is the single
 * source of truth "so the rig, the widget and the marketing site cannot drift
 * apart". A second copy of `#FF7900` in this file would make that sentence false
 * the first time anyone changed one of them, so there is no second copy: a test
 * asserts that the generated stylesheet contains the character's values and no
 * hard-coded brand colour of its own.
 *
 * Everything below colour is genuinely new here, because the character package
 * has no opinion about spacing or type.
 */

/**
 * The one typeface the product is set in, named once.
 *
 * The plan asked for an evaluation of Plus Jakarta Sans, DM Sans and Manrope and
 * **one** primary family. All three are variable, all three are OFL 1.1 with no
 * reserved font name, and all three cover the Latin the product is written in --
 * so the choice was made on measurements taken off the files themselves
 * (`packages/ui/fonts/PROVENANCE.md` records how to reproduce them):
 *
 * - **Legibility where the widget actually sets text.** The widget's smallest
 *   text is 10.5px and most of it is 12–14px. Plus Jakarta Sans has an x-height
 *   of 0.536 em and a cap height of 0.745 em; Manrope is 0.540 / 0.720 and DM
 *   Sans is 0.504 / 0.700. DM Sans gives up a twentieth of an em of x-height
 *   against the other two at every size, which is the direction that costs
 *   legibility rather than buys it.
 * - **Fewer glyph substitutions.** The Latin subset holds 229 codepoints against
 *   DM Sans's 222 and Manrope's 218, and every codepoint outside a subset falls
 *   back per glyph — which in a run of text is visibly a different typeface. The
 *   widest subset is the one that substitutes least.
 * - **Weight.** The widget sets 600, 650 and 700, and the marketing site 600 and
 *   700. **650 cannot be served by static weights at all** — a browser picks the
 *   nearer of two — so all three candidates are committed as the variable file,
 *   where the whole 200–800 axis is present. Plus Jakarta Sans's shared default
 *   of 400 (Manrope's is 200) means an unstyled string lands on regular rather
 *   than on a hairline.
 * - **Transfer.** 27,348 bytes for the Latin subset, between Manrope's 24,836
 *   and DM Sans's 36,932. DM Sans is both the largest file and the least legible
 *   at the sizes the widget uses.
 *
 * The judgement left over is design, and it goes the same way: this is a
 * humanist-geometric face with slightly rounded terminals — warm at the sizes a
 * chat panel uses, still confident in the caps a price is set in. Manrope reads
 * more technical, and the plan asks the type to be friendly before it is
 * technical.
 */
export const FONT_FAMILY = 'Plus Jakarta Sans';

/** What every surface falls back to, and what the widget names second. */
export const SYSTEM_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * The family followed by the system stack.
 *
 * Naming a family nothing has declared an `@font-face` for is not an error: the
 * browser skips it and takes the next entry. That is what makes this value safe
 * to put on `:root` for a page that never loads the file, and it is why the
 * widget can use one string whether or not it decided to declare the face.
 */
export const FONT_STACK = `"${FONT_FAMILY}", ${SYSTEM_FONT_STACK}`;

/** Layout, space and type. Named by role rather than by value. */
export const UI_TOKENS = {
  /** A 4px-based space scale. `space[4]` rather than `16px` in a stylesheet. */
  space: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96],

  radius: {
    sm: '8px',
    md: '14px',
    lg: '22px',
    pill: '999px',
  },

  shadow: {
    /** Cards and panels at rest. */
    raised: '0 1px 2px rgba(23, 23, 23, 0.06), 0 8px 24px rgba(23, 23, 23, 0.08)',
    /** The hero card, which is allowed to feel like it is floating. */
    floating: '0 24px 60px rgba(23, 23, 23, 0.14)',
  },

  font: {
    sans: FONT_STACK,
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  },

  /** A 1.25 modular scale, from `step[0]` at 1rem. */
  type: {
    step: [1, 1.25, 1.5625, 1.953, 2.441, 3.052],
    leading: { tight: '1.15', normal: '1.6' },
  },

  /** The breakpoint at which the site stops being a single column. */
  wide: '900px',
} as const;

/** The directory the committed `woff2` files sit in, relative to a bundle's own. */
export const FONT_DIRECTORY = 'fonts';

/** The declared axis. The files carry 200–800; this is the part the product uses. */
export const FONT_WEIGHT = '400 800';

/**
 * The combining marks the files hold that Google's published ranges do not claim.
 *
 * `U+0304`, `U+0308` and `U+0329` are in the published ranges already, so they
 * are absent here rather than repeated; these five are not, and each of them is
 * in both files. Measured off the committed bytes, not assumed from the subset
 * name — a range that does not claim a mark the file holds leaves that mark to
 * the system font, which is a different weight from the letter under it.
 */
const ADDED_COMBINING_MARKS = 'U+0300, U+0301, U+0303, U+0309, U+0323';

export interface FontFace {
  /** File name inside `FONT_DIRECTORY`. */
  readonly file: string;
  /** Which Google subset it is, for provenance and for test failure messages. */
  readonly subset: 'latin' | 'latin-ext';
  /**
   * Bytes on disk.
   *
   * Here so the size claim in the documentation has somewhere to come from, and
   * so a truncated replacement fails a test rather than a page.
   */
  readonly bytes: number;
  /** The published `unicode-range`, plus `ADDED_COMBINING_MARKS`. */
  readonly unicodeRange: string;
}

/**
 * The two subsets, in the order they are declared.
 *
 * `latin` first because it is the one nearly every page needs and the browser
 * walks the list in order for a codepoint both could serve. Two subsets rather
 * than one file because `unicode-range` is what makes a European installer's
 * `Łódź` cost 21,728 bytes and a page with only ASCII cost none of it.
 */
export const FONT_FACES: readonly FontFace[] = [
  {
    file: 'plus-jakarta-sans-latin.woff2',
    subset: 'latin',
    bytes: 27_348,
    unicodeRange: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD, ${ADDED_COMBINING_MARKS}`,
  },
  {
    file: 'plus-jakarta-sans-latin-ext.woff2',
    subset: 'latin-ext',
    bytes: 21_728,
    unicodeRange: `U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF, ${ADDED_COMBINING_MARKS}`,
  },
];

/**
 * The absolute URL of one subset, given the directory the caller's files sit in.
 *
 * Absolute rather than relative, and the caller has to say where its own files
 * came from: the fonts are published beside the widget's script, so the widget
 * passes the directory *its script* was loaded from —
 * `new URL('.', script.src).href` — and gets a URL that is right even when the
 * page's own base is somewhere else entirely. There is no such thing as a
 * "reasonable default" here; a relative path is a path on the customer's site.
 *
 * The marketing site does not use this: it goes through `next/font/local`, which
 * rewrites `src` to a hashed build URL of its own.
 */
export function fontFileUrl(directoryUrl: string, face: FontFace): string {
  const directory = directoryUrl.endsWith('/') ? directoryUrl : `${directoryUrl}/`;
  return new URL(`${FONT_DIRECTORY}/${face.file}`, directory).href;
}

/**
 * The stylesheet text, generated rather than written.
 *
 * `src/tokens.css` is the output of this function, written by
 * `npm run build:tokens`. Keeping the value in one place and the file as an
 * artefact means the CSS cannot quietly disagree with the TypeScript -- which is
 * the failure mode of every hand-maintained token file there has ever been.
 */
export function cssVariables(): string {
  const lines: string[] = [];

  lines.push('/* GENERATED by `npm run build:tokens` — do not edit by hand. */');
  lines.push('/* Source: packages/ui/src/index.ts. */');
  lines.push(':root {');

  lines.push('  /* Colour — imported from @sunny/character, not restated. */');
  for (const [name, value] of Object.entries(TOKENS)) {
    lines.push(`  --sunny-${kebab(name)}: ${value};`);
  }

  lines.push('');
  lines.push('  /* Space */');
  UI_TOKENS.space.forEach((value, index) => {
    lines.push(`  --space-${index}: ${value}px;`);
  });

  lines.push('');
  lines.push('  /* Radius */');
  for (const [name, value] of Object.entries(UI_TOKENS.radius)) {
    lines.push(`  --radius-${kebab(name)}: ${value};`);
  }

  lines.push('');
  lines.push('  /* Shadow */');
  for (const [name, value] of Object.entries(UI_TOKENS.shadow)) {
    lines.push(`  --shadow-${kebab(name)}: ${value};`);
  }

  lines.push('');
  lines.push('  /* Type */');
  lines.push(`  --font-sans: ${UI_TOKENS.font.sans};`);
  lines.push(`  --font-mono: ${UI_TOKENS.font.mono};`);
  UI_TOKENS.type.step.forEach((value, index) => {
    lines.push(`  --type-${index}: ${value}rem;`);
  });
  lines.push(`  --leading-tight: ${UI_TOKENS.type.leading.tight};`);
  lines.push(`  --leading-normal: ${UI_TOKENS.type.leading.normal};`);

  lines.push('');
  lines.push(`  --wide: ${UI_TOKENS.wide};`);
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/** `brandOrangeDeep` -> `brand-orange-deep`, so a token name reads like CSS. */
function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
