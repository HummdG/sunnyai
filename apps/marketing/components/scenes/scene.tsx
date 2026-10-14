import { renderSunny } from '@sunny/character';

import { SceneSunny } from './scene-sunny.js';
import { stillRig, type SunnyDirection } from './still.js';

/**
 * An illustrated scene: a set drawn from the kit, with the real Sunny standing
 * in it. Framed like a poster panel -- an ink border round a paper ground --
 * unless `bare` asks for the art alone (on a coloured band, say).
 *
 * The set is two layers, `back` behind Sunny and `front` in front (a desk, a
 * window ledge), in the scene's own units (`width` by `height`). Sunny is
 * placed by the top-left corner and size of its square box in the same units;
 * the character fills the box the way it fills its own viewBox, feet near the
 * bottom.
 */
export function Scene({
  width,
  height,
  back,
  front,
  sunny,
  at,
  size,
  label,
  bare = false,
  shadow = true,
  className,
  testId,
}: {
  width: number;
  height: number;
  back?: React.ReactNode;
  front?: React.ReactNode;
  sunny?: SunnyDirection;
  /** Top-left of Sunny's box, in scene units. */
  at?: { x: number; y: number };
  /** Sunny's box size, in scene units. */
  size?: number;
  /** What the picture shows, for anyone who cannot see it. */
  label: string;
  bare?: boolean;
  /** Sunny's shadow on the ground; off when Sunny is floating in the air. */
  shadow?: boolean;
  className?: string;
  testId?: string;
}): React.JSX.Element {
  const box = sunny && at && size;
  const markup = sunny ? renderSunny(stillRig(sunny), { decorative: true }) : '';
  return (
    <figure
      className={`scene${bare ? ' is-bare' : ''}${className ? ` ${className}` : ''}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label={label}
    >
      {back && (
        <svg className="scene-layer" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {back}
        </svg>
      )}
      {box && sunny && shadow && (
        <svg className="scene-layer" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {/* Sunny's shadow on the ground, under the feet. */}
          <ellipse
            cx={at.x + size * 0.5}
            cy={at.y + size * 0.95}
            rx={size * 0.3}
            ry={size * 0.045}
            fill="url(#sk-dots)"
          />
        </svg>
      )}
      {box && sunny && (
        <div
          className={`scene-sunny${sunny.flip ? ' is-flipped' : ''}`}
          style={{
            left: `${(at.x / width) * 100}%`,
            top: `${(at.y / height) * 100}%`,
            width: `${(size / width) * 100}%`,
          }}
        >
          <SceneSunny direction={sunny} markup={markup} testId={testId} />
        </div>
      )}
      {front && (
        <svg className="scene-layer" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {front}
        </svg>
      )}
    </figure>
  );
}
