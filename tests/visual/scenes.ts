/**
 * The scenes the visual baselines are taken from, and the pipeline that turns
 * one into a PNG.
 *
 * Kept apart from the test so that exactly one thing writes a baseline and one
 * thing compares it. If the test could also generate the expectation, a passing
 * run would only prove the renderer agrees with itself.
 */
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import { SunnyAnimator, type Intensity, type MachineEvent } from '@sunny/animation-engine';
import { defaultRig, renderSunny } from '@sunny/character';

/** The edge length of every baseline, in pixels. */
export const SIZE = 256;

export interface Scene {
  name: string;
  /** Dispatched in order; `at` is the time passed to `dispatch`. */
  events: Array<{ at: number; event: MachineEvent }>;
  /** The frame to capture. */
  at: number;
  intensity?: Intensity;
  reducedMotion?: boolean;
}

/**
 * One scene per visually distinct state, at a fixed frame.
 *
 * The times are arbitrary but fixed, chosen by looking at the frames rather than
 * by reasoning about the sequences: what matters is that each scene catches a
 * different part of the character, not that any particular frame is special.
 */
export const SCENES: readonly Scene[] = [
  { name: 'idle-rest', events: [], at: 0 },
  { name: 'idle-breathing', events: [], at: 1_400 },
  { name: 'listening', events: [{ at: 0, event: { type: 'attention' } }], at: 420 },
  { name: 'thinking', events: [{ at: 0, event: { type: 'turn_started' } }], at: 700 },
  { name: 'speaking', events: [{ at: 0, event: { type: 'speaking_started' } }], at: 760 },
  { name: 'guiding', events: [{ at: 0, event: { type: 'guiding_started' } }], at: 820 },
  { name: 'celebrating', events: [{ at: 0, event: { type: 'celebrate' } }], at: 900 },
  { name: 'confused', events: [{ at: 0, event: { type: 'confused' } }], at: 640 },
  { name: 'failed', events: [{ at: 0, event: { type: 'turn_failed' } }], at: 780 },
  // The play move is a finite burst, so the capture time is the middle of it
  // rather than an arbitrary moment: at 950 ms the run is already tapering back
  // towards the resting pose, and the baseline would show a character standing
  // still with slightly lowered brows.
  { name: 'playing', events: [{ at: 0, event: { type: 'play_started' } }], at: 550 },
  // The play group is the one group where the intensity setting chooses a
  // different *move* rather than a quieter version of the same one -- a shuffle,
  // a run or a dance -- so its extreme is a scene of its own rather than a
  // repetition, captured at the peak of the swing. There is no `playing-off` and
  // no `playing-reduced-motion` for the same reason: both resolve to a held
  // still, which is the resting pose, and a baseline for that already exists.
  {
    name: 'playing-playful',
    events: [{ at: 0, event: { type: 'play_started' } }],
    at: 650,
    intensity: 'playful',
  },
  // The same moment at the extremes of the intensity setting, which is the
  // tenant's choice and the one thing a visitor never sees anyone change.
  {
    name: 'celebrating-off',
    events: [{ at: 0, event: { type: 'celebrate' } }],
    at: 900,
    intensity: 'off',
  },
  {
    name: 'celebrating-playful',
    events: [{ at: 0, event: { type: 'celebrate' } }],
    at: 900,
    intensity: 'playful',
  },
  // Reduced motion is a request, not a preference, so it gets its own baseline
  // rather than being assumed identical to the `off` intensity.
  {
    name: 'celebrating-reduced-motion',
    events: [{ at: 0, event: { type: 'celebrate' } }],
    at: 900,
    reducedMotion: true,
  },
  // The break Sunny takes when the visitor closes the chat (A04). Captured in
  // the middle of the hold rather than during the unfold: the chair unfolding is
  // over inside a second, and what a visitor actually looks at for the next nine
  // is her lying in it.
  {
    name: 'relaxing',
    events: [
      { at: 0, event: { type: 'attention' } },
      { at: 400, event: { type: 'dismissed' } },
    ],
    at: 4_600,
  },
  // The same moment where the intensity setting changes the *moment* rather than
  // its strength: at the playful setting she dozes off, which is a different
  // picture and not a louder version of this one. The `off` setting is
  // deliberately not given a scene: it resolves to the resting pose, which is
  // what the reduced-motion baseline below already pins.
  {
    name: 'relaxing-playful',
    events: [
      { at: 0, event: { type: 'attention' } },
      { at: 400, event: { type: 'dismissed' } },
    ],
    at: 6_100,
    intensity: 'playful',
  },
  {
    name: 'relaxing-reduced-motion',
    events: [
      { at: 0, event: { type: 'attention' } },
      { at: 400, event: { type: 'dismissed' } },
    ],
    at: 4_600,
    reducedMotion: true,
  },
];

/** The frame cadence the widget runs at, and therefore the one used here. */
const FRAME_MS = 1000 / 30;

/**
 * The rig at a scene's fixed moment.
 *
 * **Advanced frame by frame, not jumped to.** A sequence's instance is anchored
 * to the first frame that observes it, so `frame(1400)` on a fresh animator
 * renders the sequence's *start* — its elapsed time is zero, because it began
 * when it was first looked at. This harness originally did exactly that and
 * produced thirteen baselines, of which the two idle ones were byte-identical:
 * "breathing" was the rest pose, twice.
 *
 * The widget has never had this problem, because it drives the animator from a
 * `requestAnimationFrame` loop and a frame always follows a previous frame. So
 * this walks the same cadence, from zero to the capture time, with events
 * dispatched as they come due — which is the only way the frames captured here
 * are the frames the product actually draws.
 */
export function rigFor(scene: Scene) {
  const reducedMotion = scene.reducedMotion ?? false;
  const context = { reducedMotion };

  const animator = new SunnyAnimator(defaultRig(), {
    intensity: scene.intensity ?? 'balanced',
    reducedMotion,
    // Fixed, so a replayed scene is byte-identical. The engine's blink cadence
    // is the only randomness it has, and this is where it is pinned.
    seed: 0x5eed_1234,
  });

  const pending = [...scene.events].sort((a, b) => a.at - b.at);
  const dispatchDue = (now: number): void => {
    while (pending.length > 0 && pending[0]!.at <= now) {
      const next = pending.shift()!;
      animator.dispatch(next.event, next.at);
    }
  };

  dispatchDue(0);
  let result = animator.frame(0, context);

  for (let i = 1; i * FRAME_MS < scene.at; i++) {
    const now = i * FRAME_MS;
    dispatchDue(now);
    result = animator.frame(now, context);
  }

  // The capture time itself, so a scene can name a moment between frames.
  dispatchDue(scene.at);
  result = animator.frame(scene.at, context);

  return result.rig;
}

/** The scene's SVG, as the renderer emits it. */
export function svgFor(scene: Scene): string {
  return renderSunny(rigFor(scene), { size: SIZE });
}

/** The scene's rasterised image. */
export function pngFor(scene: Scene): Buffer {
  const resvg = new Resvg(svgFor(scene), { fitTo: { mode: 'width', value: SIZE } });
  return resvg.render().asPng();
}

/** Where the committed expectations live. */
export const BASELINE_DIR = fileURLToPath(new URL('./__baselines__', import.meta.url));

/** Where a mismatching render is written for review. Gitignored. */
export const ACTUAL_DIR = fileURLToPath(new URL('../../.data-visual/actual', import.meta.url));
