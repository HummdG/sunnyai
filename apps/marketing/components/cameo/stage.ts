'use client';

import { cartoonClock } from '@sunny/character';

/**
 * The cameo stage: ONE animation loop shared by every Sunny cameo on a page.
 *
 * Brand guidelines B3 allow one animated character per view, so the stage
 * picks a single "lead" among the cameos that want to perform (in view, with
 * something to play) -- the highest priority, then the most visible -- and
 * only the lead is drawn every film frame. Everyone else holds their resting
 * pose, drawn once. When nobody wants to perform, the loop stops entirely.
 *
 * Motion is sampled on the 1930s cartoon clock (24 fps film frames, a boiling
 * ink line), so cameos move like the hero does.
 */

export interface Actor {
  /** Higher wins the lead. Ties go to whichever is more visible. */
  priority: number;
  /** Draw one film frame. `time` is film milliseconds since the stage began. */
  perform(time: number, boil: number): void;
  /** Draw the resting pose (called once when the actor loses the lead). */
  rest(): void;
}

interface Entry {
  actor: Actor;
  wants: boolean;
  visibility: number;
  leading: boolean;
}

const entries = new Map<symbol, Entry>();
let handle = 0;
let lastFrame = -1;
let lastBoil = -1;

function pickLead(): Entry | null {
  let best: Entry | null = null;
  for (const entry of entries.values()) {
    if (!entry.wants || entry.visibility <= 0) continue;
    if (
      !best ||
      entry.actor.priority > best.actor.priority ||
      (entry.actor.priority === best.actor.priority && entry.visibility > best.visibility)
    ) {
      best = entry;
    }
  }
  return best;
}

function tick(now: number): void {
  handle = 0;
  const lead = pickLead();
  for (const entry of entries.values()) {
    if (entry !== lead && entry.leading) {
      entry.leading = false;
      entry.actor.rest();
    }
  }
  if (!lead || document.visibilityState === 'hidden') return;
  handle = requestAnimationFrame(tick);
  lead.leading = true;
  const { time, boil } = cartoonClock(now);
  if (time === lastFrame && boil === lastBoil) return;
  lastFrame = time;
  lastBoil = boil;
  lead.actor.perform(time, boil);
}

function wake(): void {
  if (handle === 0 && typeof window !== 'undefined') handle = requestAnimationFrame(tick);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', wake);
}

/** Join the stage. Returns controls for the cameo and a `leave` to call on unmount. */
export function joinStage(actor: Actor): {
  setWants(wants: boolean): void;
  setVisibility(ratio: number): void;
  leave(): void;
} {
  const id = Symbol('cameo');
  const entry: Entry = { actor, wants: false, visibility: 0, leading: false };
  entries.set(id, entry);
  return {
    setWants(wants) {
      entry.wants = wants;
      if (wants) wake();
    },
    setVisibility(ratio) {
      entry.visibility = ratio;
      if (ratio > 0 && entry.wants) wake();
    },
    leave() {
      entries.delete(id);
      if (entry.leading) wake();
    },
  };
}

/** True when the visitor asked for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Open the live chat widget on this page through its public handle. */
export function openChat(): void {
  (window as unknown as { sunny?: { open?: () => void } }).sunny?.open?.();
}
