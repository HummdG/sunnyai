'use client';

import { SEQUENCE_BY_ID } from '@sunny/animation-engine';
import { cartoonClock, createSunnyView, type SunnyRig } from '@sunny/character';
import { useEffect, useRef } from 'react';

import { currentTheme, onThemeChange } from '../theme-bus.js';
import { stillRig, type SunnyDirection } from './still.js';

/**
 * The Sunny inside a scene.
 *
 * Drawn as a still on the server, so the page is finished before any script
 * runs. In the browser it plays its moment once when the scene comes into
 * view -- and again on hover -- then settles back on the still. Only one scene
 * performs at a time, so a page full of illustrations never becomes a page
 * full of motion; under reduced motion nothing plays at all.
 */

/** The scene currently performing; anyone else waits their turn or skips. */
let performing: symbol | null = null;

/** How long a looping moment is shown before Sunny settles. */
const LOOP_SHOWN_MS = 3200;

export function SceneSunny({
  direction,
  markup,
  testId,
}: {
  direction: SunnyDirection;
  /** The still, rendered on the server. */
  markup: string;
  testId?: string;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const view = createSunnyView(node, { decorative: true });
    let theme = currentTheme();
    const still = (): SunnyRig => ({ ...stillRig(direction), theme });
    view.draw(still());

    const sequence = direction.play ? SEQUENCE_BY_ID.get(direction.play) : undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const me = Symbol(direction.play ?? 'scene');
    let frame = 0;

    const perform = (): void => {
      if (!sequence || reduced || performing !== null) return;
      performing = me;
      const length = sequence.loop ? LOOP_SHOWN_MS : sequence.duration;
      let start: number | null = null;
      const step = (now: number): void => {
        start ??= now;
        const elapsed = now - start;
        const { boil } = cartoonClock(now);
        if (elapsed >= length) {
          view.draw(still());
          performing = null;
          return;
        }
        const t = sequence.loop
          ? (elapsed % sequence.duration) / sequence.duration
          : elapsed / sequence.duration;
        // The moment plays over the scene's own pose and props.
        const base = { ...stillRig({ ...direction, act: undefined }), theme };
        view.draw(sequence.pose(base, t), { boil });
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    let seen = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || seen) return;
        seen = true;
        // A beat after arriving, so the visitor sees it start.
        window.setTimeout(perform, 250);
      },
      { threshold: 0.55 },
    );
    io.observe(node);
    const scene = node.closest('.scene') ?? node;
    scene.addEventListener('pointerenter', perform);

    const offTheme = onThemeChange((next) => {
      theme = next;
      if (performing !== me) view.draw(still());
    });

    return () => {
      cancelAnimationFrame(frame);
      if (performing === me) performing = null;
      io.disconnect();
      scene.removeEventListener('pointerenter', perform);
      offTheme();
      view.destroy();
    };
  }, [direction]);

  return (
    <div
      ref={host}
      className="scene-sunny-art"
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
