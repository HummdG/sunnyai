// Sunny's expressions: the faces the character pulls, by name.
//
// Each is a pure rig -> rig preset over whatever pose it is given, so the same
// vocabulary serves a website illustration (a still face that fits the scene)
// and the chat (a face to settle on after a moment). They change which mouth and
// eyes are drawn and move the brows, gaze and head -- never the traced smile's
// depth beyond what the renderer allows -- so none of them can become the
// stretched grin that the old "bigger smile" produced.
//
// Looks: `look` asks for a direction and the renderer decides how to show
// it -- the pupils slide only as far as they stay the reference's drawing,
// and the rest of the look moves the whole face toward it (`glance` in
// traced-render.ts). The eyes are never resized to make a point.
//
// Brow notes, since the rig's numbers are not obvious: a brow's `y` going down
// (negative) raises it; the left brow is the long steep one over the big eye,
// and rotating it clockwise drops its inner (right-hand) end, while the right
// brow's inner end drops when it rotates anticlockwise.

import { cloneRig, type SunnyRig } from './rig.js';

type Preset = (r: SunnyRig) => void;

const lift = (r: SunnyRig, left: number, right = left): void => {
  r.brows.left.y -= left;
  r.brows.right.y -= right;
};

const look = (r: SunnyRig, x: number, y: number): void => {
  r.eyes.left.gaze = { x, y };
  r.eyes.right.gaze = { x, y };
};

const PRESETS = {
  /** The logo, settled: the reference smile and an easy tilt of the head. */
  content: (r) => {
    r.faceTilt += 3;
    lift(r, -0.5);
  },
  /** Hello there: an open smile, brows up, eyes bright. */
  hello: (r) => {
    r.smile.shape = 'open';
    lift(r, 3);
  },
  /** Something lovely just happened: open smile, eyes squeezed happy. */
  delighted: (r) => {
    r.smile.shape = 'open';
    r.eyes.left.shape = r.eyes.right.shape = 'happy';
    lift(r, 3);
  },
  /** A proper laugh: the big open mouth, eyes shut with it, head thrown. */
  laughing: (r) => {
    r.smile.shape = 'laugh';
    r.eyes.left.shape = r.eyes.right.shape = 'happy';
    lift(r, 4);
    r.faceTilt -= 4;
  },
  /** Ooh: a little round mouth, eyes wide, brows high. */
  wonder: (r) => {
    r.smile.shape = 'o';
    // A touch rounder, and no more: these are the reference's eyes.
    r.eyes.left.scaleY = r.eyes.right.scaleY = 1.05;
    lift(r, 5, 4);
  },
  /** What's this? One brow up, a small smile, head cocked. */
  curious: (r) => {
    r.smile.shape = 'soft';
    r.brows.left.y -= 4.5;
    r.brows.left.rotation -= 6;
    r.brows.right.y += 0.5;
    r.faceTilt -= 6;
  },
  /** Concentrating: brows drawn in, the mouth a flat line pushed to one side. */
  focused: (r) => {
    r.smile.shape = 'flat';
    r.smile.x += 3;
    r.smile.rotation -= 6;
    r.brows.left.rotation += 9;
    r.brows.right.rotation -= 8;
    lift(r, -1.5);
  },
  /**
   * Thinking it over: eyes up to the corner, one brow raised, a "hmm" of a
   * half-smile. Up and to his own side, so the pupils stay the reference's
   * drawing -- the version that looked up and away the other way read as dazed.
   */
  thinking: (r) => {
    r.smile.shape = 'smirk';
    r.smile.span *= 0.65;
    r.smile.x -= 2.5;
    r.smile.y += 1;
    look(r, 0.55, -0.85);
    r.brows.left.y -= 5;
    r.brows.right.y += 0.5;
    r.brows.right.rotation -= 6;
    r.faceTilt += 5;
  },
  /** Turning it over: a long sideways look, one brow up, mouth pressed small. */
  pondering: (r) => {
    r.smile.shape = 'flat';
    r.smile.span *= 0.6;
    r.smile.x += 3;
    look(r, 0.8, 0.05);
    r.brows.right.y -= 4;
    r.brows.left.y += 1;
    r.brows.left.rotation += 6;
    r.faceTilt -= 3;
  },
  /** That doesn't add up: brows at odds, a small wavering line. */
  puzzled: (r) => {
    r.smile.shape = 'flat';
    r.smile.span *= 0.8;
    r.smile.rotation += 10;
    look(r, 0.4, -0.35);
    r.brows.left.y -= 6;
    r.brows.left.rotation -= 8;
    r.brows.right.y += 1.5;
    r.brows.right.rotation -= 8;
    r.faceTilt -= 9;
  },
  /** Mulling it over: eyes shut, brows knitted, mouth pressed flat. */
  mulling: (r) => {
    r.eyes.left.shape = r.eyes.right.shape = 'shut';
    r.smile.shape = 'flat';
    r.smile.x += 2;
    r.brows.left.rotation += 8;
    r.brows.right.rotation -= 7;
    lift(r, -1);
    r.faceTilt -= 3;
  },
  /** Ooh, an idea: eyes up to it, brows high, a little round mouth. */
  idea: (r) => {
    r.smile.shape = 'o';
    look(r, 0.3, -0.9);
    lift(r, 5);
    r.faceTilt += 2;
  },
  /** I know just the one: a lopsided smile and a wink. */
  knowing: (r) => {
    r.smile.shape = 'smirk';
    r.eyes.right.shape = 'happy';
    r.brows.left.y -= 3;
    r.faceTilt += 4;
  },
  /** Pleased with a job well done: the reference smile, eyes closed happy. */
  proud: (r) => {
    r.eyes.left.shape = r.eyes.right.shape = 'happy';
    r.smile.depth *= 1.1;
    lift(r, 2);
    r.faceTilt -= 3;
  },
  /** Kind and attentive: a gentle smile, brows soft at their inner ends. */
  kind: (r) => {
    r.smile.shape = 'soft';
    r.brows.left.rotation -= 6;
    r.brows.right.rotation += 6;
    lift(r, 1);
    r.faceTilt += 5;
  },
  /** Calm and sure: eyes gently shut, a soft smile. */
  serene: (r) => {
    r.eyes.left.shape = r.eyes.right.shape = 'shut';
    r.smile.shape = 'soft';
    lift(r, -0.5);
    r.faceTilt += 3;
  },
  /** Leave it with me: the reference smile and one brow up. */
  reassuring: (r) => {
    r.brows.right.y -= 3;
    r.faceTilt += 3;
  },
  /** Mid-sentence: the mouth open on a word. */
  talking: (r) => {
    r.smile.shape = 'open';
    r.smile.span *= 0.8;
    lift(r, 2);
  },
  /** Oops: a small worried line, brows up at the middle. */
  worried: (r) => {
    r.smile.shape = 'frown';
    r.smile.span *= 0.75;
    r.smile.rotation += 6;
    r.brows.left.rotation -= 8;
    r.brows.right.rotation += 8;
    lift(r, 2);
  },
} satisfies Record<string, Preset>;

export type ExpressionName = keyof typeof PRESETS;

/** Every expression, in the order a model sheet lays them out. */
export const EXPRESSION_NAMES = Object.keys(PRESETS) as ExpressionName[];

/** `rig` wearing the expression `name`. Pure: the input is not changed. */
export function withExpression(rig: SunnyRig, name: ExpressionName): SunnyRig {
  const r = cloneRig(rig);
  PRESETS[name](r);
  return r;
}
