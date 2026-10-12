'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { prefersReducedMotion } from './stage.js';
import { SunnyCameo, type BubbleSide } from './sunny-cameo.js';

/**
 * Sunny peeking over an edge (a card, a heading): hidden below the edge until
 * the spot scrolls into view, then pops up with a wave and a word. Place it
 * inside a positioned parent; `className` sets where (see cameo.css).
 */
export function PeekingSunny({
  bubble,
  bubbleSide = 'left',
  size = 88,
  className,
}: {
  bubble?: ReactNode;
  bubbleSide?: BubbleSide;
  size?: number;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [up, setUp] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      setUp(true);
      return;
    }
    let timer = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          timer = window.setTimeout(() => setUp(true), 350);
          io.disconnect();
        }
      },
      { threshold: 0.6, rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={ref} className={`cameo-peek${up ? ' is-up' : ''}${className ? ` ${className}` : ''}`}>
      <SunnyCameo
        pose="wave"
        sequence="listening-perk"
        size={size}
        bubble={up ? bubble : undefined}
        bubbleSide={bubbleSide}
        bubbleDelayMs={500}
      />
    </div>
  );
}
