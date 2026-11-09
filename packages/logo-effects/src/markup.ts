import type { LogoEffect } from '@sunny/contracts';

/**
 * The contracts' `OUTLINE_EFFECTS`, repeated: importing the value would bring
 * zod with it, which is most of `sunny-logo.js`'s weight for one short list.
 * `test/markup.test.ts` checks every effect against the contracts' lists.
 */
const OUTLINE_EFFECTS: readonly LogoEffect[] = ['comet', 'draw', 'rings', 'march'];

/**
 * The seven approved busy animations, drawn over an installer's own logo.
 *
 * The logo is never redrawn: every effect paints the uploaded image itself and
 * adds motion on top of it. Stencil effects keep that motion inside the logo's
 * alpha mask; outline effects run along the outline the server traced and
 * verified. Every id and keyframe name carries the caller's `uid`, so several
 * logos on one page (Studio shows eight) never share a definition, and the
 * keyframes live in a `<style>` inside the markup so it works in a Shadow DOM.
 */

/** What an effect is drawn from. `src` and `maskSrc` are URLs; colours are `#rrggbb`. */
export interface LogoArt {
  src: string;
  /** The logo's alpha mask, or null when there is none (no stencil effects). */
  maskSrc: string | null;
  width: number;
  height: number;
  /** One `M… L… Z` subpath per polygon in image pixels, even-odd; null when unverified. */
  outline: string | null;
  colors: { primary: string; glow: string };
}

/** One full pass of each effect, from the approved mockup. */
export const EFFECT_PERIOD_MS: Record<LogoEffect, number> = {
  comet: 1600,
  draw: 2600,
  charge: 4800,
  shimmer: 1500,
  rings: 1800,
  march: 900,
  segments: 1500,
};

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};

function attr(value: string): string {
  return value.replace(/[&"'<>]/g, (c) => ESCAPES[c]!);
}

/** Rounds to two decimals so the markup stays short and stable. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function image(href: string, art: LogoArt, extra = ''): string {
  return `<image href="${attr(href)}" x="0" y="0" width="${art.width}" height="${art.height}"${extra}/>`;
}

/** The logo exactly as uploaded: what a visitor sees whenever nothing is busy. */
export function stillMarkup(art: LogoArt, _uid: string): string {
  return image(art.src, art);
}

/**
 * Wraps effect or still markup in an SVG whose viewBox is the image itself. It
 * does not clip: echo rings grow past the image, and an uploaded logo has only a
 * few pixels of padding to grow into.
 */
export function logoSvg(art: LogoArt, inner: string, label?: string): string {
  const a11y = label ? `role="img" aria-label="${attr(label)}"` : 'aria-hidden="true"';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${art.width} ${art.height}" ` +
    `width="100%" height="100%" preserveAspectRatio="xMidYMid meet" overflow="visible" ` +
    `style="overflow:visible" ${a11y}>${inner}</svg>`
  );
}

/**
 * The enabled effects this art can actually draw: outline effects need a
 * verified outline and stencil effects need a mask. Anything else would throw
 * when its turn came.
 */
export function usableEffects(effects: readonly LogoEffect[], art: LogoArt): LogoEffect[] {
  return effects.filter((e) =>
    OUTLINE_EFFECTS.includes(e) ? art.outline !== null : art.maskSrc !== null,
  );
}

/** An alpha mask of the logo's own shape, for keeping motion inside it. */
function stencil(art: LogoArt, uid: string): { def: string; ref: string } {
  if (art.maskSrc === null) throw new Error('This effect needs the logo mask');
  const id = `m-${uid}`;
  return {
    def:
      `<mask id="${id}" mask-type="alpha" maskUnits="userSpaceOnUse" ` +
      `x="0" y="0" width="${art.width}" height="${art.height}">${image(art.maskSrc, art)}</mask>`,
    ref: `url(#${id})`,
  };
}

function outlineOf(art: LogoArt, effect: LogoEffect): string {
  if (art.outline === null) throw new Error(`The ${effect} effect needs a verified outline`);
  return art.outline;
}

/**
 * The outline's subpaths, one per polygon. A dash pattern restarts at every
 * subpath while `pathLength` spans them all, so dashed effects draw each piece
 * as a path of its own and every piece is traced once per period.
 */
function pieces(outline: string): string[] {
  return outline
    .split(/(?=M)/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/**
 * The markup for one effect, to sit inside `logoSvg`. `periodMs` stretches every
 * timing in proportion; reduced motion uses it to play shimmer at 3 s.
 */
export function effectMarkup(
  effect: LogoEffect,
  art: LogoArt,
  uid: string,
  periodMs: number = EFFECT_PERIOD_MS[effect],
): string {
  const { width: w, height: h } = art;
  const { primary, glow } = art.colors;
  const big = Math.max(w, h);
  const sw = n(big * 0.025);
  const p = `${Math.round(periodMs)}ms`;
  const ms = (fraction: number) => `${Math.round(periodMs * fraction)}ms`;
  // Phase offsets are negative delays: the animation starts part-way through
  // rather than sitting at its unanimated state until the delay runs out, which
  // would flash on every render.
  const lead = (fraction: number) =>
    fraction === 0 ? '0ms' : `-${Math.round(periodMs * fraction)}ms`;
  const k = (name: string) => `${name}-${uid}`;
  const base = image(art.src, art);
  const outline = OUTLINE_EFFECTS.includes(effect) ? outlineOf(art, effect) : '';
  const d = attr(outline);
  const each = (path: (d: string) => string) =>
    pieces(outline)
      .map((piece) => path(attr(piece)))
      .join('');
  const style = (css: string) => `<style>${css}</style>`;

  switch (effect) {
    case 'comet':
      return (
        style(`@keyframes ${k('comet')} { to { stroke-dashoffset: -100; } }`) +
        base +
        each(
          (piece) =>
            `<path d="${piece}" pathLength="100" fill="none" stroke="${glow}" stroke-width="${sw}" ` +
            `stroke-linecap="round" stroke-dasharray="14 86" ` +
            `style="animation:${k('comet')} ${p} linear infinite; filter:drop-shadow(0 0 ${n(big * 0.03)}px ${primary})"/>`,
        )
      );

    case 'draw':
      return (
        style(
          `@keyframes ${k('draw')} { 0% { stroke-dashoffset: 100; } 45%,55% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -100; } }` +
            `@keyframes ${k('fill')} { 0%,30% { opacity: 0; } 45%,58% { opacity: 1; } 72%,100% { opacity: 0; } }`,
        ) +
        image(art.src, art, ` style="animation:${k('fill')} ${p} ease-in-out infinite"`) +
        each(
          (piece) =>
            `<path d="${piece}" pathLength="100" fill="none" stroke="${primary}" stroke-width="${sw}" ` +
            `stroke-linejoin="round" stroke-dasharray="100" ` +
            `style="animation:${k('draw')} ${p} ease-in-out infinite"/>`,
        )
      );

    case 'charge': {
      // The real logo fills from the bottom behind a wave: a luminance mask of
      // the wave reveals the image, and a crest in the brand colour rides on top,
      // held inside the logo by its alpha mask. The wave rises for half a period
      // and falls for the other half.
      const s = stencil(art, uid);
      const wave = w * 0.2;
      const amp = h * 0.06;
      let crest = `M${n(-wave)} ${n(h * 0.88)}`;
      crest += ` q${n(wave / 2)} ${n(-amp)} ${n(wave)} 0`;
      for (let x = 0; x < w * 1.6; x += wave) crest += ` t${n(wave)} 0`;
      const body = `${crest} V${n(h * 3)} H${n(-wave)} Z`;
      const motion = (inner: string) =>
        `<g style="animation:${k('rise')} ${ms(0.5)} ease-in-out infinite alternate">` +
        `<g style="animation:${k('wave')} ${ms(1.1 / 4.8)} linear infinite">${inner}</g></g>`;
      return (
        style(
          `@keyframes ${k('rise')} { 0% { transform: translateY(0); } 100% { transform: translateY(${n(-h * 0.75)}px); } }` +
            `@keyframes ${k('wave')} { to { transform: translateX(${n(-wave * 2)}px); } }`,
        ) +
        `<defs>${s.def}<mask id="w-${uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
        motion(`<path d="${body}" fill="#ffffff"/>`) +
        `</mask></defs>` +
        image(art.src, art, ' opacity="0.22"') +
        `<g mask="url(#w-${uid})">${base}</g>` +
        `<g mask="${s.ref}">${motion(`<path d="${crest}" fill="none" stroke="${glow}" stroke-width="${sw}" stroke-linecap="round"/>`)}</g>`
      );
    }

    case 'shimmer': {
      // A slanted band of light crosses the logo, only inside its shape. The
      // skew leans the bottom of the band left, so the travel allows for it.
      const s = stencil(art, uid);
      const band = w * 0.23;
      const lean = Math.tan((20 * Math.PI) / 180) * h * 1.1;
      return (
        style(
          `@keyframes ${k('sweep')} { 0% { transform: translateX(${n(-band - lean)}px) skewX(-20deg); } ` +
            `100% { transform: translateX(${n(w + lean)}px) skewX(-20deg); } }`,
        ) +
        `<defs>${s.def}</defs>` +
        base +
        `<g mask="${s.ref}"><rect x="0" y="${n(-h * 0.1)}" width="${n(band)}" height="${n(h * 1.2)}" ` +
        `fill="#ffffff" opacity="0.55" style="animation:${k('sweep')} ${p} ease-in-out infinite"/></g>`
      );
    }

    case 'rings': {
      // Copies of the outline ripple out from the centre and fade, half a period
      // apart, with the logo itself in front at its natural size. They show past
      // its edges, which is why `logoSvg` does not clip.
      const origin = `transform-origin:${n(w / 2)}px ${n(h / 2)}px`;
      const ring = (delay: string) =>
        `<path d="${d}" pathLength="100" fill="none" stroke="${primary}" stroke-width="${sw}" ` +
        `style="${origin}; animation:${k('ring')} ${p} ease-out ${delay} infinite"/>`;
      return (
        style(
          `@keyframes ${k('ring')} { 0% { transform: scale(1); opacity: 0.9; } 100% { transform: scale(1.45); opacity: 0; } }`,
        ) +
        ring('0ms') +
        ring(lead(0.5)) +
        base
      );
    }

    case 'march':
      return (
        style(
          `@keyframes ${k('march')} { to { stroke-dashoffset: -20; } }` +
            `@keyframes ${k('faint')} { 0%,100% { opacity: 0.25; } 50% { opacity: 0.45; } }`,
        ) +
        image(art.src, art, ` style="animation:${k('faint')} ${ms(2)} ease-in-out infinite"`) +
        each(
          (piece) =>
            `<path d="${piece}" pathLength="100" fill="none" stroke="${primary}" stroke-width="${sw}" ` +
            `stroke-linecap="round" stroke-dasharray="6 4" style="animation:${k('march')} ${p} linear infinite"/>`,
        )
      );

    case 'segments': {
      // The logo is cut into five vertical bands that light up in turn. Every
      // band is the real image, inside the logo's mask: dim when unlit, at full
      // opacity when lit.
      const s = stencil(art, uid);
      const bandW = w / 5;
      const clips: string[] = [];
      const bands: string[] = [];
      for (let i = 0; i < 5; i++) {
        clips.push(
          `<clipPath id="b${i}-${uid}"><rect x="${n(i * bandW)}" y="0" width="${n(bandW)}" height="${h}"/></clipPath>`,
        );
        bands.push(
          `<g clip-path="url(#b${i}-${uid})" mask="${s.ref}" ` +
            `style="animation:${k('seg')} ${p} ease-in-out ${lead(i * 0.15)} infinite">${base}</g>`,
        );
      }
      return (
        style(`@keyframes ${k('seg')} { 0%,100% { opacity: 0.18; } 20%,40% { opacity: 1; } }`) +
        `<defs>${s.def}${clips.join('')}</defs>` +
        bands.join('')
      );
    }
  }
}
