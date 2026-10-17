import { describe, expect, it } from 'vitest';

import {
  defaultRig,
  EXPRESSION_NAMES,
  EYE_SHAPES,
  lerpRig,
  MOUTH_SHAPES,
  renderSunny,
  withExpression,
} from '../src/index.js';
import {
  glance,
  LOOK_BACK,
  SMILE_DEPTH_RANGE,
  tracedEyePart,
  tracedMouthPart,
} from '../src/traced-render.js';

const PAINT = { body: '#f70', ray: '#f70', ink: '#111', highlight: '#fff' };

/** The vertical scale in a part transform's `scale(sx sy)`. */
const scaleY = (transform: string): number => Number(/scale\(\S+ (\S+)\)/.exec(transform)?.[1]);

describe('faces', () => {
  it('leaves the rest face exactly the logo', () => {
    const rig = defaultRig();
    expect(rig.smile.shape).toBe('smile');
    expect(rig.eyes.left.shape).toBe('open');
    expect(rig.eyes.right.shape).toBe('open');
  });

  it('never stretches the traced smile into a grimace', () => {
    for (const depth of [-3, 0.2, 0.7, 1, 1.3, 2, 2.5]) {
      const rig = defaultRig();
      rig.smile.depth *= depth;
      const sy = Math.abs(scaleY(tracedMouthPart(rig, PAINT).transform));
      expect(sy).toBeGreaterThanOrEqual(SMILE_DEPTH_RANGE[0]);
      expect(sy).toBeLessThanOrEqual(SMILE_DEPTH_RANGE[1]);
    }
  });

  it('draws every mouth and eye shape', () => {
    for (const shape of MOUTH_SHAPES) {
      const rig = defaultRig();
      rig.smile.shape = shape;
      expect(tracedMouthPart(rig, PAINT).inner).toContain('<path');
    }
    for (const shape of EYE_SHAPES) {
      const rig = defaultRig();
      rig.eyes.left.shape = shape;
      expect(tracedEyePart('left', rig.eyes.left, PAINT, 'u').inner).toContain('<path');
    }
  });

  it('never moves the pupils: the eyes stay the reference drawing', () => {
    const rest = tracedEyePart('left', defaultRig().eyes.left, PAINT, 'u').inner;
    for (const [x, y] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0.6, 0.8],
    ] as const) {
      const rig = defaultRig();
      rig.eyes.left.gaze = { x, y };
      expect(tracedEyePart('left', rig.eyes.left, PAINT, 'u').inner).toBe(rest);
    }
  });

  it('shows a look by moving the whole face toward it', () => {
    const rig = defaultRig();
    rig.eyes.left.gaze = rig.eyes.right.gaze = { x: 1, y: -1 };
    const g = glance(rig);
    expect(g.x).toBeGreaterThan(0);
    expect(g.y).toBeLessThan(0);
    expect(glance(defaultRig())).toEqual({ x: 0, y: 0 });
  });

  it('looks only up, down and to his own side in every expression', () => {
    for (const name of EXPRESSION_NAMES) {
      const face = withExpression(defaultRig(), name);
      expect(face.eyes.left.gaze.x, name).toBeGreaterThanOrEqual(LOOK_BACK);
    }
  });

  it('renders every expression, and none of them leaves the rig it was given changed', () => {
    for (const name of EXPRESSION_NAMES) {
      const base = defaultRig();
      const face = withExpression(base, name);
      expect(base).toEqual(defaultRig());
      expect(renderSunny(face, { decorative: true })).toContain('<svg');
    }
  });

  it('swaps a drawing at the midpoint of a blend rather than morphing it', () => {
    const a = defaultRig();
    const b = withExpression(defaultRig(), 'laughing');
    expect(lerpRig(a, b, 0.49).smile.shape).toBe('smile');
    expect(lerpRig(a, b, 0.5).smile.shape).toBe('laugh');
    expect(lerpRig(a, b, 0.5).eyes.left.shape).toBe('happy');
  });
});
