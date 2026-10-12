'use client';

import { catalogueEntry } from '@sunny/animation-engine';
import { useRef, useState } from 'react';

import { filmNow, useSunny } from './use-sunny.js';

/** The moments a visitor can ask for, in the order they read best. */
const MOMENTS = [
  'eureka',
  'cool',
  'charge',
  'celebrate',
  'confused',
  'guide',
  'arcade',
  'bloom',
  'balloon',
  'relax',
] as const;

/**
 * The animation gallery. Loaded only when scrolled near (see `LazyGallery`),
 * so the homepage does not pay for it up front.
 */
export default function Gallery(): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const animator = useSunny(stage, { greet: false });
  const [playing, setPlaying] = useState<string | null>(null);

  const play = (group: string): void => {
    const sunny = animator.current;
    if (!sunny) return;
    sunny.reset();
    sunny.play(group, filmNow());
    setPlaying(group);
  };

  return (
    <div className="gallery">
      <div className="gallery-stage" ref={stage} />
      <div className="gallery-moments">
        {MOMENTS.map((group) => {
          const entry = catalogueEntry(group);
          return (
            <button
              key={group}
              type="button"
              className="moment"
              aria-pressed={playing === group}
              onClick={() => play(group)}
            >
              <strong>{entry?.name ?? group}</strong>
              {entry?.description ? <span>{entry.description}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
