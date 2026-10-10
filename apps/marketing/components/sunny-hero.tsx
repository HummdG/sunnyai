'use client';

import { SunnyAnimator } from '@sunny/animation-engine';
import { defaultRig, renderSunny } from '@sunny/character';
import { useCallback, useEffect, useRef } from 'react';

/**
 * The animated Sunny that greets a visitor on the marketing page.
 *
 * This is the same character, the same rig and the same machine the widget runs
 * — the hero is not a video, a lottie file or a second implementation. It is
 * `SunnyAnimator` driven by a `requestAnimationFrame` loop, exactly as
 * `packages/widget/src/widget.ts` drives the launcher. That is deliberate: a
 * marketing animation that has drifted from the product is a lie told slowly,
 * and reusing the engine is the only way to be sure it has not.
 *
 * What differs from the widget is only the traffic. The widget feeds the
 * machine events from a chat stream; here the visitor's own mouse and keyboard
 * do it, through the same compiled-in vocabulary. There is no code path from a
 * URL parameter or a model response to an animation, and there should not be.
 */

/** 30 FPS, matching the widget. See D-7 for why this is not 60 yet. */
const FRAME_MS = 1000 / 30;

/**
 * The first frame, rendered on the server as well as in the browser.
 *
 * Both sides must produce identical markup or React reports a hydration
 * mismatch, so this is the *default* rig with no randomness and no unique ids —
 * both of which would differ between the two renders by construction. The loop
 * replaces it on the first tick, a few milliseconds later.
 */
const FIRST_FRAME = renderSunny(defaultRig(), { decorative: true });

export function SunnyHero(): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const animator = useRef<SunnyAnimator | null>(null);

  useEffect(() => {
    const node = stage.current;
    if (!node) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sunny = new SunnyAnimator(defaultRig(), {
      intensity: 'balanced',
      reducedMotion: reduced,
    });
    animator.current = sunny;

    // The visitor arriving is the first thing Sunny reacts to. It is dispatched
    // on mount rather than held as an initial state, so there is exactly one
    // path into the machine.
    sunny.dispatch({ type: 'attention' }, performance.now());

    let handle = 0;
    let last = 0;
    let previous = '';

    const step = (time: number): void => {
      handle = requestAnimationFrame(step);
      if (time - last < FRAME_MS) return;
      last = time;

      const result = sunny.frame(time, {
        hidden: document.visibilityState === 'hidden',
        reducedMotion: reduced,
      });

      // An idle character holds some frames exactly. Re-writing identical SVG
      // markup is pure garbage, and this loop runs on the marketing homepage.
      const markup = renderSunny(result.rig, { decorative: true, uniqueIds: true });
      if (markup === previous) return;
      previous = markup;
      node.innerHTML = markup;
    };

    handle = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(handle);
      animator.current = null;
    };
  }, []);

  /**
   * Let the visitor make Sunny do something.
   *
   * These are the same events the widget dispatches when a conversation starts
   * or a lead is saved, so pressing them here shows the real behaviour rather
   * than a demo one.
   */
  const react = useCallback((event: 'attention' | 'celebrate' | 'impress') => {
    animator.current?.dispatch({ type: event }, performance.now());
  }, []);

  return (
    <div className="hero-card">
      <div
        className="stage"
        ref={stage}
        data-testid="hero-stage"
        dangerouslySetInnerHTML={{ __html: FIRST_FRAME }}
      />

      <div className="controls">
        <button type="button" className="chip" onClick={() => react('attention')}>
          Say hello
        </button>
        <button type="button" className="chip" onClick={() => react('celebrate')}>
          Celebrate
        </button>
        <button type="button" className="chip" onClick={() => react('impress')}>
          Show off
        </button>
      </div>

      <p className="hint">
        This is Sunny, running the same animation engine as the widget below — not a video.
      </p>
    </div>
  );
}
