'use client';

import { SUNNY_THEME, safePaint, type SunnyTheme } from '@sunny/character';

/**
 * The site-wide Sunny colour.
 *
 * The colour switcher publishes here; every Sunny on the page (the hero, the
 * gallery) subscribes, and so does the embedded widget. A module-level store
 * rather than React context, because the subscribers are animation loops, not
 * components that should re-render.
 */

type Listener = (theme: SunnyTheme) => void;

let theme: SunnyTheme = SUNNY_THEME;
const listeners = new Set<Listener>();

export function currentTheme(): SunnyTheme {
  return theme;
}

export function onThemeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set the brand colour for every Sunny on the page, including the widget. */
export function setSunnyColour(colour: string): void {
  const safe = safePaint(colour, SUNNY_THEME.body);
  theme = { ...SUNNY_THEME, body: safe, ray: safe };
  for (const listener of listeners) listener(theme);
  // The hero's glow and other page accents follow the chosen colour too.
  document.documentElement.style.setProperty('--sunny-live', safe);
  themeWidget(safe);
}

interface WidgetHandle {
  setTheme?: (colour: string) => void;
}

/**
 * Re-theme the live widget.
 *
 * If the widget exposes `setTheme`, use it: that recolours the launcher
 * character as well as the panel. Otherwise set the two custom properties the
 * widget reads its accent from on its host element, which recolours the panel
 * (buttons, bubbles, suggestion chips) without touching its internals.
 */
function themeWidget(colour: string): void {
  const sunny = (window as unknown as { sunny?: { widgets?: WidgetHandle[] } }).sunny;
  const widgets = sunny?.widgets ?? [];
  let handled = false;
  for (const widget of widgets) {
    if (typeof widget.setTheme === 'function') {
      widget.setTheme(colour);
      handled = true;
    }
  }
  if (handled) return;

  for (const host of document.querySelectorAll<HTMLElement>('[data-sunny-widget]')) {
    host.style.setProperty('--sunny-primary-color', colour);
    host.style.setProperty('--sunny-accent-ink', legibleOnWhite(colour));
  }
}

/**
 * Darken a colour until white text on it clears WCAG AA (4.5:1), which is the
 * role the widget's `--sunny-accent-ink` plays.
 */
export function legibleOnWhite(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#B34700';
  let [r, g, b] = rgb;
  for (let i = 0; i < 40 && contrast([r, g, b], [255, 255, 255]) < 4.6; i++) {
    r *= 0.92;
    g *= 0.92;
    b *= 0.92;
  }
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
