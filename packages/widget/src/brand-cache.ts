import type { Brand, LogoEffect } from '@sunny/contracts';
import type { LogoArt } from '@sunny/logo-effects';

/**
 * The installer's logo, remembered between visits, and the guard in front of it.
 *
 * A returning visitor sees the logo on the launcher before the config has
 * answered, drawn from what was kept last time: a tenant with a logo never
 * flashes Sunny up first. The config is fetched again on every visit and
 * replaces what was kept, so a logo taken away is gone by the visit after.
 *
 * The guard is the contracts' `brandSchema` written out by hand. The widget does
 * not carry zod (it is larger than the whole widget, gzipped), so this repeats
 * the schema's rules the way `PUBLIC_WIDGET_ID` repeats the id's, and
 * `test/brand-cache.test.ts` pins the two to the same answers.
 */

export interface RememberedBrand {
  brand: Brand;
  assistantName: string;
}

const KEY = 'sunny:brand:';

const ASSET_PATH = /^\/v1\/widget\/brand\/w_[a-z0-9]{10,40}\/[a-f0-9]{16}(-mask)?\.png$/;
/** The outline's characters, and its 60 000 limit, in one pattern. */
const OUTLINE = /^[MLZ0-9 .-]{0,60000}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ASSISTANT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,39}$/u;
const EFFECT = /^(comet|draw|charge|shimmer|rings|march|segments)$/;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const matches = (pattern: RegExp, value: unknown): value is string =>
  typeof value === 'string' && pattern.test(value);
const isPath = (value: unknown): value is string => matches(ASSET_PATH, value);
const isSize = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;

/** A brand that passes the contracts' rules, copied field by field; anything else is null. */
export function safeBrand(value: unknown): Brand | null {
  if (!isObject(value)) return null;
  const { icon, wordmark, effects, colors } = value;

  if (!isObject(icon)) return null;
  const { path, maskPath, width, height, outline } = icon;
  if (!isPath(path) || !(maskPath === null || isPath(maskPath))) return null;
  if (!isSize(width, 512) || !isSize(height, 512)) return null;
  if (!(outline === null || matches(OUTLINE, outline))) return null;

  let mark: Brand['wordmark'] = null;
  if (wordmark !== null) {
    if (!isObject(wordmark)) return null;
    if (!isPath(wordmark.path) || !isSize(wordmark.width, 1200) || !isSize(wordmark.height, 300)) {
      return null;
    }
    mark = { path: wordmark.path, width: wordmark.width, height: wordmark.height };
  }

  if (!Array.isArray(effects) || effects.length > 7) return null;
  if (!effects.every((effect) => matches(EFFECT, effect))) return null;

  if (!isObject(colors) || !matches(HEX, colors.primary) || !matches(HEX, colors.glow)) {
    return null;
  }

  return {
    icon: { path, maskPath, width, height, outline },
    wordmark: mark,
    effects: [...effects] as LogoEffect[],
    colors: { primary: colors.primary, glow: colors.glow },
  };
}

/** The assistant's name if it is one the contracts allow, otherwise Sunny. */
export function safeAssistantName(value: unknown): string {
  return matches(ASSISTANT_NAME, value) ? value : 'Sunny';
}

/**
 * What a returning visitor saw last time with no logo: Sunny. Kept as a value of
 * its own, rather than as no value, so that only a first visit waits for the
 * config before showing the launcher.
 */
export const SUNNY = 'sunny';

/**
 * What was kept for this widget: its brand, `SUNNY` when it had none, or null
 * when nothing usable was kept (a first visit, junk, or storage refused).
 */
export function readBrand(
  storage: Storage | null,
  publicId: string,
): RememberedBrand | typeof SUNNY | null {
  try {
    const raw = storage?.getItem(KEY + publicId);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value === SUNNY) return SUNNY;
    if (!isObject(value)) return null;
    const brand = safeBrand(value.brand);
    return brand ? { brand, assistantName: safeAssistantName(value.assistantName) } : null;
  } catch {
    return null;
  }
}

/** Keep this widget's brand (or `SUNNY`) for the next visit; null forgets it. Never throws. */
export function writeBrand(
  storage: Storage | null,
  publicId: string,
  value: RememberedBrand | typeof SUNNY | null,
): void {
  try {
    if (value === null) storage?.removeItem(KEY + publicId);
    else storage?.setItem(KEY + publicId, JSON.stringify(value));
  } catch {
    // Storage full or switched off: the logo still shows, from the config.
  }
}

/** What the logo view draws from, with the image paths resolved against the API. */
export function toArt(brand: Brand, apiUrl: string): LogoArt {
  const base = apiUrl.replace(/\/+$/, '');
  return {
    src: base + brand.icon.path,
    maskSrc: brand.icon.maskPath === null ? null : base + brand.icon.maskPath,
    width: brand.icon.width,
    height: brand.icon.height,
    outline: brand.icon.outline,
    colors: brand.colors,
  };
}
