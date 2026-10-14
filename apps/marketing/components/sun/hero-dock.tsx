'use client';

import { sunnyAct } from './sun-bus.js';

/**
 * Where the guide rises in the hero: an empty stage over a horizon line. The
 * guide itself (`SunnyGuide`) is drawn by the site layout and finds this by its
 * `data-sunny-dock` attribute, so the hero's Sunny and the one in the corner
 * are the same character rather than two.
 */
export function HeroDock(): React.JSX.Element {
  return (
    <div className="hero-sun">
      <div className="hero-dock" data-sunny-dock>
        <span className="horizon" aria-hidden="true" />
      </div>
      <div className="hero-controls" role="group" aria-label="Make Sunny react">
        <button type="button" className="chip" onClick={() => sunnyAct('attention')}>
          Say hello
        </button>
        <button type="button" className="chip" onClick={() => sunnyAct('celebrate')}>
          Celebrate
        </button>
        <button type="button" className="chip" onClick={() => sunnyAct('impress')}>
          Show off
        </button>
      </div>
    </div>
  );
}
