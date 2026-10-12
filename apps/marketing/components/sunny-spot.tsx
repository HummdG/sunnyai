'use client';

import { SEQUENCE_BY_ID } from '@sunny/animation-engine';
import {
  cartoonClock,
  createSunnyView,
  defaultRig,
  limbPose,
  type LimbPoseName,
} from '@sunny/character';
import { useEffect, useRef } from 'react';

/**
 * Sunny as a spot illustration (brand guidelines C1–C2): the real character,
 * in a pose that carries the moment's meaning -- wave for welcome, chin for
 * thinking, thumbs-up for success, shrug for empty, droop for an error,
 * cheer for a milestone.
 *
 * With a `sequence`, Sunny performs it on 24 fps film frames with the boiling
 * ink line, once or on a loop. Without one, or under `prefers-reduced-motion`,
 * Sunny holds the still pose of the same meaning. Decorative by default: the
 * text beside Sunny always says the same thing in words.
 */
export function SunnySpot({
  pose = 'hips',
  sequence,
  loop = false,
  size = 96,
  head = false,
  at,
  className,
}: {
  pose?: LimbPoseName;
  /** A sequence id from `@sunny/animation-engine`, e.g. 'thinking-whirr'. */
  sequence?: string;
  loop?: boolean;
  size?: number;
  /** Head only (badge size, guidelines C1). */
  head?: boolean;
  /** Draw one frame (0..1) of `sequence` as a still, e.g. mid-deckchair. */
  at?: number;
  className?: string;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const view = createSunnyView(node, { decorative: true, limbs: !head });
    const base = defaultRig();
    base.limbs = limbPose(pose);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const performance = sequence ? SEQUENCE_BY_ID.get(sequence) : undefined;
    if (performance && at !== undefined) {
      view.draw(performance.pose(base, at));
      return () => view.destroy();
    }
    if (!performance || reduced || performance.duration <= 1) {
      view.draw(base);
      return () => view.destroy();
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const clock = cartoonClock(now - start);
      const elapsed = clock.time;
      const t = loop
        ? (elapsed % performance.duration) / performance.duration
        : Math.min(1, elapsed / performance.duration);
      view.draw(performance.pose(base, t), { boil: clock.boil });
      if (loop || t < 1) frame = requestAnimationFrame(step);
      else view.draw(base);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      view.destroy();
    };
  }, [pose, sequence, loop, head, at]);

  return (
    <div
      ref={host}
      className={`sunny-spot${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
