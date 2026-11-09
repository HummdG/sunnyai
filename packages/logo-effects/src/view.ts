import type { LogoEffect } from '@sunny/contracts';

import { createCycle } from './cycle.js';
import type { LogoMotion } from './cycle.js';
import { effectMarkup, logoSvg, stillMarkup } from './markup.js';
import type { LogoArt } from './markup.js';

/**
 * The logo in a page: the cycle's decisions written into a host element. Kept
 * thin on purpose; the timing lives in `cycle.ts` and the drawing in
 * `markup.ts`, and this is checked end to end in the browser instead.
 */

export interface LogoView {
  setBusy(busy: boolean): void;
  setMotion(m: LogoMotion): void;
  destroy(): void;
}

let views = 0;

export function createLogoView(
  host: HTMLElement,
  art: LogoArt,
  effects: readonly LogoEffect[],
  options: { label?: string; random?: () => number } = {},
): LogoView {
  const uid = `le${(views++).toString(36)}`;
  return createCycle({
    effects,
    ...(options.random ? { random: options.random } : {}),
    render(effect, periodMs) {
      const inner =
        effect === null ? stillMarkup(art, uid) : effectMarkup(effect, art, uid, periodMs);
      host.innerHTML = logoSvg(art, inner, options.label);
      host.dataset.logoEffect = effect ?? 'still';
    },
  });
}
