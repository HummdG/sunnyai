// Sunny brand tokens. Single source of truth for colour so the rig, the widget
// and the marketing site cannot drift apart. See docs/design/character-reference.md.

export interface SunnyTheme {
  /** Main body and ray fill. */
  body: string;
  /** Ray fill; defaults to `body` but is separable so rays can be tinted. */
  ray: string;
  /** Outlines, eyes, brows, smile. */
  ink: string;
  /** Eye highlight. */
  highlight: string;
}

/** Canonical Sunny palette, sampled from the reference artwork. */
export const SUNNY_THEME: SunnyTheme = {
  body: '#FF7900',
  ray: '#FF7900',
  ink: '#171717',
  highlight: '#FFF3E2',
};

/** Neutral surface tokens for surrounding UI. */
export const TOKENS = {
  brandOrange: '#FF7900',
  brandOrangeDeep: '#FF6500',
  brandOrangeSoft: '#FFB066',
  brandOrangePale: '#FFF1E5',
  warmWhite: '#FFFCF8',
  ink: '#171717',
  muted: '#727272',
} as const;

/**
 * Colour presets offered by the customisation studio (§6.1). Each keeps the ink
 * and highlight constant so the character stays legible on any tenant colour.
 */
export const THEME_PRESETS: Record<string, SunnyTheme> = {
  orange: SUNNY_THEME,
  purple: { body: '#7C4DFF', ray: '#7C4DFF', ink: '#171717', highlight: '#F3EEFF' },
  green: { body: '#1FA463', ray: '#1FA463', ink: '#171717', highlight: '#E8F7EF' },
  blue: { body: '#1A73E8', ray: '#1A73E8', ink: '#171717', highlight: '#E8F1FE' },
};

/** Resolve a theme by preset name, falling back to canonical orange. */
export function themeByName(name: string | undefined): SunnyTheme {
  if (!name) return SUNNY_THEME;
  return THEME_PRESETS[name] ?? SUNNY_THEME;
}
