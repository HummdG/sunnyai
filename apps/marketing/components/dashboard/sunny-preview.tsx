'use client';

import { SunnyAnimator } from '@sunny/animation-engine';
import { cartoonClock, createSunnyView, defaultRig, SUNNY_THEME } from '@sunny/character';
import { useEffect, useRef } from 'react';

/**
 * The live Sunny in Sunny Studio and onboarding: the real animator and renderer
 * the widget uses, re-themed as the installer picks a colour.
 */
export function SunnyPreview({ colour, size = 220 }: { colour: string; size?: number }) {
  const stage = useRef<HTMLDivElement | null>(null);
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
    const view = createSunnyView(node, { decorative: true });
    let frame = 0;
    const step = (now: number): void => {
      const clock = reduced ? { time: now, boil: undefined } : cartoonClock(now);
      const result = sunny.frame(clock.time, { reducedMotion: reduced });
      view.draw(result.rig, clock.boil === undefined ? {} : { boil: clock.boil });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      view.destroy();
      animator.current = null;
    };
  }, []);

  useEffect(() => {
    animator.current?.setBase({
      ...defaultRig(),
      theme: { ...SUNNY_THEME, body: colour, ray: colour },
    });
  }, [colour]);

  return (
    <div
      className="sunny-preview"
      ref={stage}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Preview of Sunny in your colour"
    />
  );
}
