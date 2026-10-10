/**
 * Colour maths for one job: making a tenant's brand colour legible.
 *
 * The widget paints with a colour a customer chose, and customers choose oranges.
 * White text on `#FF7900` is 2.64:1, against the 4.5:1 WCAG AA wants for body
 * text -- and that is the *default* brand, before anyone picks anything. It was
 * the visitor's own chat bubbles, the send button, and the suggestion chips. A
 * fixed palette cannot fix that, because the offending colour is not ours.
 *
 * So the readable tone is derived from the brand colour at mount. The hue is
 * kept, only the lightness moves, so the widget still looks like the installer's
 * and no longer fails for a colour nobody has chosen yet.
 *
 * This is deliberately not a general colour library: it is the smallest thing
 * that answers "what is the darkest legible version of this?".
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** WCAG AA for normal-size text. Large or bold text may use 3:1; these are not. */
export const AA_NORMAL_TEXT = 4.5;

/** `#abc`, `#aabbcc`, with or without the hash. */
export function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => character + character)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** The WCAG relative luminance of a colour. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The contrast ratio between two colours, from 1 (identical) to 21 (black on
 * white). Order does not matter: the formula is symmetric.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const [red, green, blue] = [r / 255, g / 255, b / 255] as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
  else if (max === green) hue = ((blue - red) / delta + 2) / 6;
  else hue = ((red - green) / delta + 4) / 6;
  return { h: hue, s: saturation, l: lightness };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const value = l * 255;
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number): number => {
    let t = h + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: channel(1 / 3) * 255, g: channel(0) * 255, b: channel(-1 / 3) * 255 };
}

/**
 * A legible version of `color` for text and fills that sit on `backgrounds`.
 *
 * Returns the colour unchanged when it already meets the target, so a tenant who
 * chose a deep navy gets their exact navy. Otherwise the lightness steps down in
 * 2% increments until every background clears the ratio, preserving hue and
 * saturation -- the result reads as "their colour, darker" rather than as a
 * different colour.
 *
 * Black is the floor, and it always passes against white and near-white, so the
 * loop terminates with a legible answer for every input. An unparseable colour
 * is returned untouched: inventing a colour for a value we could not read would
 * hide the tenant's typo rather than surface it.
 */
export function legibleInk(
  color: string,
  backgrounds: readonly string[],
  target: number = AA_NORMAL_TEXT,
): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const parsedBackgrounds = backgrounds
    .map(parseHex)
    .filter((value): value is Rgb => value !== null);
  if (parsedBackgrounds.length === 0) return color;

  const clears = (candidate: Rgb): boolean =>
    parsedBackgrounds.every((background) => contrastRatio(candidate, background) >= target);

  if (clears(rgb)) return toHex(rgb);

  const hsl = toHsl(rgb);
  for (let lightness = hsl.l - 0.02; lightness > 0; lightness -= 0.02) {
    const candidate = fromHsl({ ...hsl, l: lightness });
    if (clears(candidate)) return toHex(candidate);
  }
  return '#000000';
}
