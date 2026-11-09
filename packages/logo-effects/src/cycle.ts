import type { LogoEffect } from '@sunny/contracts';

import { EFFECT_PERIOD_MS } from './markup.js';

/**
 * When the logo moves, and which effect it plays. Kept free of the DOM so the
 * timing rules can be tested on their own: `view.ts` only turns each decision
 * into markup.
 */

export type LogoMotion = 'full' | 'reduced' | 'off';

/** How long a busy stretch plays one effect before moving on to another. */
export const SWITCH_AFTER_MS = 4000;
/** Reduced motion plays only shimmer, at this slower period. */
export const REDUCED_SHIMMER_MS = 3000;

/**
 * A random enabled effect, never `last` when there is any other choice. Null
 * when nothing is enabled.
 */
export function pickNextEffect(
  enabled: readonly LogoEffect[],
  last: LogoEffect | null,
  random: () => number,
): LogoEffect | null {
  if (enabled.length === 0) return null;
  const pool = enabled.length > 1 ? enabled.filter((e) => e !== last) : enabled;
  const choices = pool.length > 0 ? pool : enabled;
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  return choices[index]!;
}

export interface CycleOptions {
  effects: readonly LogoEffect[];
  /** Called with the effect to show and its period, or `(null, 0)` for still. */
  render: (effect: LogoEffect | null, periodMs: number) => void;
  random?: () => number;
}

export interface Cycle {
  setBusy(busy: boolean): void;
  /**
   * One pass of one effect while idle, then still: the chat button's hello
   * when the page loads. Only at full motion, and only from a still logo.
   */
  playOnce(): void;
  setMotion(motion: LogoMotion): void;
  destroy(): void;
}

/**
 * Drives the logo between still and animated. An effect always finishes the
 * pass it is in before anything changes, so the logo never jumps mid-motion:
 * going idle, a change of motion preference and the switch to a new effect all
 * wait for the end of the current period.
 */
export function createCycle({ effects, render, random = Math.random }: CycleOptions): Cycle {
  let busy = false;
  let motion: LogoMotion = 'full';
  let current: LogoEffect | null = null;
  let periodMs = 0;
  let busySince = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  /** What the current motion preference allows, with the period each plays at. */
  function allowed(): { list: readonly LogoEffect[]; period: (e: LogoEffect) => number } {
    if (motion === 'off') return { list: [], period: () => 0 };
    if (motion === 'reduced') {
      return {
        list: effects.includes('shimmer') ? ['shimmer'] : [],
        period: () => REDUCED_SHIMMER_MS,
      };
    }
    return { list: effects, period: (e) => EFFECT_PERIOD_MS[e] };
  }

  function show(effect: LogoEffect | null): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    current = effect;
    periodMs = effect === null ? 0 : allowed().period(effect);
    render(effect, periodMs);
    if (effect !== null) schedule();
  }

  function schedule(): void {
    timer = setTimeout(endOfPeriod, periodMs);
  }

  function start(): void {
    busySince = Date.now();
    show(pickNextEffect(allowed().list, current, random));
  }

  function endOfPeriod(): void {
    timer = null;
    if (destroyed) return;
    const { list, period } = allowed();
    if (!busy || list.length === 0) return show(null);
    if (current === null || !list.includes(current) || period(current) !== periodMs) {
      return start();
    }
    if (Date.now() - busySince >= SWITCH_AFTER_MS) return start();
    schedule();
  }

  render(null, 0);

  return {
    setBusy(next) {
      if (destroyed || next === busy) return;
      busy = next;
      // Going idle, or busy again before the pass ended, is settled when the
      // pass ends; only a still logo starts moving at once.
      if (busy && timer === null) {
        if (allowed().list.length > 0) start();
      }
    },
    playOnce() {
      if (destroyed || busy || timer !== null || motion !== 'full') return;
      // Not busy, so the end of this pass settles the logo (see endOfPeriod).
      if (allowed().list.length > 0) start();
    },
    setMotion(next) {
      if (destroyed || next === motion) return;
      motion = next;
      if (busy && timer === null && allowed().list.length > 0) start();
    },
    destroy() {
      destroyed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
