'use client';

import { useEffect, useRef } from 'react';

import { onSun } from './sun-bus.js';

/**
 * A section divider made of Sunny's own rays: a row of inked triangles that
 * all lean towards wherever the sun is. As the guide hops down the page the
 * rays swing to follow it -- the character present in the page's structure
 * rather than as another drawing of it.
 *
 * Decorative: hidden from assistive technology, still under reduced motion
 * (the rays point up and stay put).
 */
const RAYS = 13;

export function RayDivider(): React.JSX.Element {
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let written = '';
    return onSun((sun) => {
      const box = el.getBoundingClientRect();
      // Off screen: nothing to look at, nothing to write.
      if (box.bottom < -200 || box.top > window.innerHeight + 200) return;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      // Clockwise from straight up, towards the sun; a ray never lies flat.
      const deg = (Math.atan2(sun.x - cx, -(sun.y - cy)) * 180) / Math.PI;
      const tilt = Math.max(-62, Math.min(62, deg));
      // Closer to the sun, longer rays.
      const reach = Math.hypot(sun.x - cx, sun.y - cy);
      const grow = 1 + Math.max(0, 1 - reach / 900) * 0.45;
      const value = `${tilt.toFixed(1)}|${grow.toFixed(2)}`;
      if (value === written) return;
      written = value;
      el.style.setProperty('--ray-tilt', `${tilt.toFixed(1)}deg`);
      el.style.setProperty('--ray-grow', grow.toFixed(2));
    });
  }, []);

  return (
    <div className="ray-divider" ref={node} aria-hidden="true">
      {Array.from({ length: RAYS }, (_, i) => (
        <span key={i} className="ray" style={{ '--i': i }}>
          <svg viewBox="0 0 20 26" focusable="false">
            <path d="M10 2.2L18 23.6H2Z" />
          </svg>
        </span>
      ))}
    </div>
  );
}
