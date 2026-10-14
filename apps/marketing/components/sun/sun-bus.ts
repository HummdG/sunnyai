/**
 * The website's one Sunny, as a shared fact.
 *
 * The site shows a single Sunny -- the guide -- and lets everything else on the
 * page react to it rather than drawing Sunnys of its own: dividers made of rays
 * lean towards it, cards cast shadows away from it, the page warms near it.
 * This module is how those pieces learn where the sun is, and how any button
 * on the page can ask the guide to do something, without importing the guide.
 */

/** Something the page can ask the guide to act out. */
export type SunnyAct =
  | 'book'
  | 'laptop'
  | 'magnifier'
  | 'point'
  | 'peace'
  | 'cheer'
  | 'wave'
  | 'impress'
  | 'deckchair'
  /** Another Sunny has the stage here (the Meet Sunny gallery): step aside. */
  | 'away'
  | 'none';

export interface SunPosition {
  /** The guide's centre, in viewport pixels. */
  x: number;
  y: number;
  /** Its drawn size in pixels. */
  size: number;
  /** How high the sun is over the page: 1 at the top, 0 at the very bottom. */
  elevation: number;
}

type Listener = (sun: SunPosition) => void;

const listeners = new Set<Listener>();
let current: SunPosition | null = null;

/** Called by the guide every frame it moves. */
export function publishSun(sun: SunPosition): void {
  current = sun;
  for (const listener of listeners) listener(sun);
}

/** Follow the sun. Called at once with the last known position, if any. */
export function onSun(listener: Listener): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => listeners.delete(listener);
}

const ACT_EVENT = 'sunny:act';

/** Ask the guide to act something out (a button in the hero, say). */
export function sunnyAct(act: SunnyAct | 'attention' | 'celebrate'): void {
  window.dispatchEvent(new CustomEvent(ACT_EVENT, { detail: act }));
}

export function onSunnyAct(
  listener: (act: SunnyAct | 'attention' | 'celebrate') => void,
): () => void {
  const handler = (event: Event): void => {
    listener((event as CustomEvent<SunnyAct | 'attention' | 'celebrate'>).detail);
  };
  window.addEventListener(ACT_EVENT, handler);
  return () => window.removeEventListener(ACT_EVENT, handler);
}
