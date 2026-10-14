'use client';

import { SunnyAnimator } from '@sunny/animation-engine';
import {
  cartoonClock,
  createSunnyView,
  defaultRig,
  type SunnyRig,
  type SunnyTheme,
} from '@sunny/character';
import { useEffect, useRef, type RefObject } from 'react';

import { currentTheme, onThemeChange } from './theme-bus.js';

/**
 * "Now" on the film clock the frame loop draws on. Dispatch and play with this
 * so a moment starts on the same timeline its frames are sampled from.
 */
export function filmNow(): number {
  return cartoonClock(performance.now()).time;
}

export interface UseSunnyOptions {
  /** Follow the pointer with the eyes. */
  gaze?: boolean;
  /** Dispatch `attention` as soon as the loop starts. */
  greet?: boolean;
  /** Start the loop only when this is true (lets a parent stage an entrance). */
  active?: boolean;
}

/**
 * Drive one Sunny on the page: the real animator, a persistent SVG view, the
 * site-wide theme, and (optionally) eyes that follow the visitor's pointer.
 *
 * Returns a ref to the animator so buttons can dispatch events or play moments.
 */
export function useSunny(
  stage: RefObject<HTMLElement | null>,
  { gaze = true, greet = true, active = true }: UseSunnyOptions = {},
): RefObject<SunnyAnimator | null> {
  const animator = useRef<SunnyAnimator | null>(null);

  useEffect(() => {
    const node = stage.current;
    if (!node || !active) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const base = (theme: SunnyTheme): SunnyRig => ({ ...defaultRig(), theme });
    const sunny = new SunnyAnimator(base(currentTheme()), {
      intensity: 'playful',
      reducedMotion: reduced,
    });
    animator.current = sunny;
    const view = createSunnyView(node, { decorative: true });

    const offTheme = onThemeChange((theme) => sunny.setBase(base(theme)));

    // Where the eyes want to look, in -1..1, eased toward every frame.
    const target = { x: 0, y: 0 };
    const look = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent): void => {
      const box = node.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const reach = Math.max(window.innerWidth, window.innerHeight) / 2;
      target.x = Math.max(-1, Math.min(1, (event.clientX - cx) / reach));
      target.y = Math.max(-1, Math.min(1, (event.clientY - cy) / reach));
    };
    if (gaze && !reduced) window.addEventListener('pointermove', onPointer, { passive: true });

    if (greet) sunny.dispatch({ type: 'attention' }, filmNow());

    // Pause entirely while the character is off-screen (plan A01).
    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(node);

    // Motion runs at the display rate and the ink boils a few times a second
    // (`cartoonClock`): smooth arcs with a hand-inked, living line.
    let handle = 0;
    let lastTime = -1;
    let lastBoil = -1;
    const step = (now: number): void => {
      handle = requestAnimationFrame(step);
      if (!visible) return;
      const { time, boil } = reduced ? { time: now, boil: 0 } : cartoonClock(now);
      if (time === lastTime && boil === lastBoil) return;
      lastTime = time;
      lastBoil = boil;

      const { rig } = sunny.frame(time, {
        hidden: document.visibilityState === 'hidden',
        reducedMotion: reduced,
      });

      if (gaze && !reduced) {
        // Eased once per frame, so the eyes move with the body.
        look.x += (target.x - look.x) * 0.3;
        look.y += (target.y - look.y) * 0.3;
        view.draw(withGaze(rig, look), { boil });
      } else {
        view.draw(rig, { boil });
      }
    };
    handle = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(handle);
      io.disconnect();
      offTheme();
      window.removeEventListener('pointermove', onPointer);
      animator.current = null;
    };
  }, [stage, gaze, greet, active]);

  return animator;
}

/** Add the pointer's pull to whatever gaze the current moment already has. */
function withGaze(rig: SunnyRig, look: { x: number; y: number }): SunnyRig {
  const nudge = (g: { x: number; y: number }): { x: number; y: number } => ({
    x: Math.max(-1, Math.min(1, g.x + look.x * 0.9)),
    y: Math.max(-1, Math.min(1, g.y + look.y * 0.9)),
  });
  return {
    ...rig,
    eyes: {
      left: { ...rig.eyes.left, gaze: nudge(rig.eyes.left.gaze) },
      right: { ...rig.eyes.right, gaze: nudge(rig.eyes.right.gaze) },
    },
  };
}
