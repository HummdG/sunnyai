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
import { armTo, defaultRig, rayTip, renderSunny, type SunnyRig } from '@sunny/character';

/** The edge length of every baseline, in pixels. */
export const SIZE = 256;

export interface Scene {
  name: string;
  /** Dispatched in order; `at` is the time passed to `dispatch`. */
  events: Array<{ at: number; event: MachineEvent }>;
  /**
   * Pointer gestures, in viewBox coordinates, applied the same way the lab
   * applies them. A tap is not an event: it carries a position, and it is the
   * only input this engine takes that does. Scenes that do not tap anything leave
   * it out.
   */
  taps?: Array<{ at: number; point: { x: number; y: number } }>;
  /** The frame to capture. */
  at: number;
  intensity?: Intensity;
  reducedMotion?: boolean;
  /**
   * A last edit to the rig the animator produced, for the parts of the character
   * the machine cannot reach.
   *
   * Every other scene here is a *state*: an event goes in and the rig comes out,
   * which is the whole contract between the engine and the renderer. The paddle
   * is not a state. It is the game's, asked for by a rally rather than by the
   * conversation (A09), and the ray-to-arm morph that carries it is a rig control
   * the catalogue never uses -- so there is no event to send that would produce
   * one, and a baseline for it has to pose the rig.
   *
   * That makes this the one scene whose image is not something the product draws
   * on its own. It is still worth having: the `paddle` prop is a painting, and a
   * painting that has never been looked at is the thing this suite exists to
   * catch.
   */
  pose?: (rig: SunnyRig) => SunnyRig;
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
  // The balloon (A05), captured once it has finished rising rather than during
  // the rise: the travel is over inside a fifth of the loop, and what the visitor
  // looks at for the rest of it is a balloon hanging there while she watches it.
  // The tap point is the body centre, which is the whole of what a tap needs to
  // land on her.
  {
    name: 'balloon-float',
    events: [],
    taps: [{ at: 0, point: { x: 100, y: 100 } }],
    at: 2_400,
  },
  // The burst, caught a fifth of a second after the second tap -- near the peak
  // of the flinch, with the shards out far enough to read as a burst rather than
  // as a sparkle left over from something else. The second tap is at the balloon's
  // resting place, which is where it is by then.
  {
    name: 'balloon-pop',
    events: [],
    taps: [
      { at: 0, point: { x: 100, y: 100 } },
      { at: 2_000, point: { x: 134, y: 38 } },
    ],
    at: 2_180,
  },
  // A visitor who asked for less motion gets a balloon that does not move, not
  // the absence of one: unlike the deckchair, there is an honest still of a
  // balloon at rest. This baseline is the record of that decision -- a third
  // image in a suite where the other two reduced-motion scenes fall back to the
  // resting pose.
  {
    name: 'balloon-reduced-motion',
    events: [],
    taps: [{ at: 0, point: { x: 100, y: 100 } }],
    at: 2_400,
    reducedMotion: true,
  },
  // The arcade spin (A10), caught in the middle of the turn. A wave cleared does
  // not move the machine -- it is the one cue in the engine that plays *on top
  // of* the state rather than replacing it -- so the scene dispatches the cue
  // from rest, which is also how the lab's gallery asks for it.
  //
  // 700 ms is deliberately not a quarter or a half of the 1.3 s sequence: the
  // turn completes two whole revolutions, and at exactly one half it is back at
  // zero degrees, so a baseline taken there would show a character standing
  // still with her rays folded and none of the spin that the row is about.
  {
    name: 'arcade-spin-playful',
    events: [{ at: 0, event: { type: 'spin' } }],
    at: 700,
    intensity: 'playful',
  },
  // What a visitor who asked for less motion gets instead. Unlike the deckchair
  // this is not the resting pose: the tuck is a small squash and a narrowing of
  // the eyes that returns to rest, so a reduced-motion visitor still sees that
  // something happened -- they just do not see a spin. This baseline is the
  // record of that choice, and of the fallback actually being *used* rather than
  // merely declared (D-25).
  {
    name: 'arcade-spin-reduced-motion',
    events: [{ at: 0, event: { type: 'spin' } }],
    at: 400,
    reducedMotion: true,
  },
  // The paddle, held on the end of a ray (A09). The morph aims one of the eight
  // rays at a point and stretches it until its tip is there; the prop hangs off
  // the tip. Nothing about the character's own state changes, which is why this
  // is the one scene posed by hand rather than driven by an event -- and the
  // target is inside the viewBox on purpose, because the arm of a character
  // reaching past the edge of the picture is a second, different bug.
  {
    name: 'paddle-from-ray',
    events: [],
    pose: (rig) => {
      const arm = armTo(rig.rays[2]!, { x: 86, y: -22 });
      const tip = rayTip(arm);
      rig.rays[2] = arm;
      rig.props = [{ id: 'paddle', x: tip.x, y: tip.y, rotation: 0, scale: 1, opacity: 1 }];
      return rig;
    },
    at: 0,
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

  const steps = [
    ...scene.events.map((e) => ({ at: e.at, run: () => animator.dispatch(e.event, e.at) })),
    ...(scene.taps ?? []).map((tap) => ({
      at: tap.at,
      run: () => animator.tap(tap.point, tap.at),
    })),
  ].sort((a, b) => a.at - b.at);
  const runDue = (now: number): void => {
    while (steps.length > 0 && steps[0]!.at <= now) {
      steps.shift()!.run();
    }
  };

  runDue(0);
  let result = animator.frame(0, context);

  for (let i = 1; i * FRAME_MS < scene.at; i++) {
    const now = i * FRAME_MS;
    runDue(now);
    result = animator.frame(now, context);
  }

  // The capture time itself, so a scene can name a moment between frames.
  runDue(scene.at);
  result = animator.frame(scene.at, context);

  return scene.pose ? scene.pose(result.rig) : result.rig;
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
