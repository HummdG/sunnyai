'use client';

import { defaultRig, renderSunny } from '@sunny/character';
import { useCallback, useEffect, useRef, useState } from 'react';

import { filmNow, useSunny } from './use-sunny.js';

/**
 * The hero Sunny: emerges from a fizzy orange bubble, settles, then lives —
 * blinking, glancing at the visitor's pointer, reacting when asked.
 *
 * Same character, rig and engine as the widget; only the staging differs.
 */

/** Identical on server and client, so hydration matches; the loop takes over. */
const FIRST_FRAME = renderSunny(defaultRig(), { decorative: true });

/** How long the bubble swells before Sunny pops out of it. */
const EMERGE_DELAY_MS = 420;

type Phase = 'bubble' | 'emerging' | 'alive';

export function SunnyHero(): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('bubble');
  const animator = useSunny(stage, { greet: false, active: phase !== 'bubble' });

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setPhase('alive');
      return;
    }
    const pop = window.setTimeout(() => setPhase('emerging'), EMERGE_DELAY_MS);
    const settle = window.setTimeout(() => setPhase('alive'), EMERGE_DELAY_MS + 700);
    return () => {
      window.clearTimeout(pop);
      window.clearTimeout(settle);
    };
  }, []);

  // As Sunny breaks out of the bubble, play the bubble-open moment, then greet.
  useEffect(() => {
    if (phase !== 'emerging') return;
    const id = window.setTimeout(() => {
      const now = filmNow();
      animator.current?.play('open', now);
      animator.current?.dispatch({ type: 'attention' }, now);
    }, 16);
    return () => window.clearTimeout(id);
  }, [phase, animator]);

  const react = useCallback(
    (event: 'attention' | 'celebrate' | 'impress') => {
      animator.current?.dispatch({ type: event }, filmNow());
    },
    [animator],
  );

  return (
    <div className="hero-sunny" data-phase={phase}>
      <div className="hero-bubble" aria-hidden="true">
        <span className="fizz f1" />
        <span className="fizz f2" />
        <span className="fizz f3" />
        <span className="fizz f4" />
        <span className="fizz f5" />
      </div>

      <div
        className="hero-stage"
        ref={stage}
        data-testid="hero-stage"
        dangerouslySetInnerHTML={{ __html: FIRST_FRAME }}
      />

      <div className="hero-controls" role="group" aria-label="Make Sunny react">
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
    </div>
  );
}
