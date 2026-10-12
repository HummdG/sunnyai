/**
 * The hand-inked "boil", without an SVG filter.
 *
 * A 1930s cartoon's lines shimmer because every drawing is re-inked. This used
 * to be a feTurbulence + feDisplacementMap filter over the whole character,
 * which the browser re-rasterises every frame -- the main cause of dropped
 * frames at hero size. Instead each path has a few pre-jittered variants:
 * every coordinate pair is nudged by a small deterministic offset, cached, and
 * the boil tick simply swaps which variant is drawn.
 */

/** How far a point moves, in viewBox units (~0.7px at hero size). */
export const BOIL_AMPLITUDE = 0.32;

const cache = new Map<string, string>();
const CACHE_LIMIT = 4000;

/** Deterministic noise in -1..1 for (index, variant). */
export function noise(index: number, variant: number): number {
  const s = Math.sin(index * 12.9898 + variant * 78.233 + 0.5) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * A jittered copy of an absolute-coordinate path (M/L/C/Z with absolute
 * numbers, as the tracers emit). `variant` undefined → the path unchanged.
 */
export function boilPath(
  d: string,
  variant: number | undefined,
  amplitude = BOIL_AMPLITUDE,
): string {
  if (variant === undefined) return d;
  const key = `${variant}|${amplitude}|${d}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let i = 0;
  const out = d.replace(/-?\d*\.?\d+(?:e-?\d+)?/gi, (num) => {
    const v = Number(num);
    // Coordinates come in x,y pairs; nudge each pair by the same point's noise.
    const index = Math.floor(i / 2);
    const axis = i % 2;
    i += 1;
    const shifted = v + noise(index * 2 + axis, variant) * amplitude;
    return String(Math.round(shifted * 100) / 100);
  });
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, out);
  return out;
}
