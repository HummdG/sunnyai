'use client';

import { SunnyCameo } from './cameo/sunny-cameo.js';

/** Puzzled, on a loop: the 404's one animated character (guidelines C2). */
export function NotFoundSunny(): React.JSX.Element {
  return (
    <div className="not-found-cameo">
      <SunnyCameo
        pose="shrug"
        sequence="confused-tilt"
        loop
        size={240}
        bubble="This page has gone off-grid."
        bubbleSide="right"
        priority={4}
      />
    </div>
  );
}
