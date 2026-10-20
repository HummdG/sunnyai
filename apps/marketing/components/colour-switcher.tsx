'use client';

import { THEME_PRESETS } from '@sunny/character';
import { useId, useState } from 'react';

import { setSunnyColour } from './theme-bus.js';

const PRESETS = Object.entries(THEME_PRESETS).map(([name, theme]) => ({
  name: name[0]?.toUpperCase() + name.slice(1),
  colour: theme.body,
}));

/**
 * Pick Sunny's colour and watch every Sunny on the page — the hero, the
 * gallery and the live assistant in the corner — change with it.
 */
export function ColourSwitcher(): React.JSX.Element {
  const [active, setActive] = useState(PRESETS[0]?.colour ?? '#FF7900');
  const customId = useId();

  const choose = (colour: string): void => {
    setActive(colour);
    setSunnyColour(colour);
  };

  return (
    <div className="switcher">
      <div className="swatches" role="radiogroup" aria-label="Sunny's colour">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            role="radio"
            aria-checked={active.toLowerCase() === preset.colour.toLowerCase()}
            className="swatch"
            style={{ '--swatch': preset.colour }}
            onClick={() => choose(preset.colour)}
          >
            <span className="dot" aria-hidden="true" />
            {preset.name}
          </button>
        ))}
        <label className="swatch custom" htmlFor={customId}>
          <input
            id={customId}
            type="color"
            value={active}
            onChange={(event) => choose(event.target.value)}
          />
          Your brand
        </label>
      </div>
      <p className="switcher-note">Try it: the assistant in the corner of this page changes too.</p>
    </div>
  );
}
