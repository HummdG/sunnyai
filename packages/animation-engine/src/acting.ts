import {
  blendLimbs,
  cloneRig,
  limbPose,
  type LimbPoseName,
  type PropRig,
  type SunnyRig,
} from '@sunny/character';

import { PRIORITY, type Sequence } from './types.js';

/**
 * The acting a conversation asks for, beyond the core states.
 *
 * The core sequences give each state one loop, which is why Sunny used to look
 * the same for the whole of a chat: thinking was always the hand on the chin,
 * speaking was always one pulse. These are the moments the director
 * (`engine.ts`) mixes in on top, all from `reference_poses.png`:
 *
 * - **Looking things up** while a tool runs: a book for the knowledge base, a
 *   laptop for quotes and estimates, a magnifying glass for searches. They loop
 *   for as long as the tool does and blend out when it finishes.
 * - **Gestures** while the answer streams: an open palm, a finger-gun, a nod,
 *   picked so the same one never plays twice in a row.
 * - **Listening** while the visitor types: a lean in and a nod.
 * - **Fidgets** when nothing has happened for a while, and finally the
 *   **lounge**: the deckchair comes out and Sunny waits in it until someone
 *   types.
 *
 * Every pose here is a pure function of `t`, like the rest of the vocabulary.
 */

const TAU = Math.PI * 2;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const ease = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const wave = (p: number, phase = 0): number => Math.sin((p + phase) * TAU);
/** 0 at both ends, 1 in the middle: ramp in over `a`, out over the last `b`. */
const envelope = (t: number, a: number, b: number): number =>
  t <= 0 || t >= 1 ? 0 : Math.min(ease(t / a), ease((1 - t) / b));
const overshoot = (t: number, s = 1.9): number => {
  const c = clamp01(t) - 1;
  return 1 + c * c * ((s + 1) * c + s);
};

/** Act a library pose over the base limbs with strength `w`. */
function act(r: SunnyRig, base: SunnyRig, name: LimbPoseName, w: number): void {
  r.limbs = blendLimbs(base.limbs, limbPose(name), w);
}

/** A gentle breath for a held pose: a slow lift and a ray ripple. */
function breathe(r: SunnyRig, base: SunnyRig, p: number, amount = 1): void {
  r.y += -Math.sin(p * TAU) * 1.2 * amount;
  for (const [i, ray] of r.rays.entries()) {
    ray.lengthScale = base.rays[i]!.lengthScale * (1 + wave(p, -i / 8) * 0.03 * amount);
  }
}

const held = (id: PropRig['id'], x: number, y: number, rotation = 0, scale = 1): PropRig => ({
  id,
  x,
  y,
  rotation,
  scale,
  opacity: 1,
});

// ─── looking things up ───────────────────────────────────────────────────────

/** Reading: the book held up in front, eyes on the page. */
function readPose(base: SunnyRig, t: number, still: boolean): SunnyRig {
  const r = cloneRig(base);
  r.y = base.y + 3;
  r.squash = 0.04;
  r.stretch = 0.03;
  act(r, base, 'read', 1);
  // Eyes run along the lines and flick back, twice a loop; a page turns.
  const line = still ? 0.3 : ((t * 4) % 1) * 1.2 - 0.6;
  r.eyes.left.gaze = { x: line, y: 0.75 };
  r.eyes.right.gaze = { x: line, y: 0.75 };
  r.eyes.left.scaleY = 0.86;
  r.eyes.right.scaleY = 0.86;
  r.brows.left.y = base.brows.left.y + 1.5;
  r.brows.right.y = base.brows.right.y + 1.5;
  r.faceTilt = still ? -3 : -3 + wave(t) * 2;
  if (!still) breathe(r, base, t, 0.6);
  const turn = still ? 0 : Math.max(0, Math.sin(clamp01((t - 0.55) / 0.2) * Math.PI));
  r.props = [held('book', 0, 40, 0, 1.05)];
  if (turn > 0.01)
    r.props.push({ ...held('book', 0, 40, 0, 1.05), id: 'book-page', opacity: turn });
  return r;
}

/** Typing on a laptop, glancing up at the visitor now and then. */
function typePose(base: SunnyRig, t: number, still: boolean): SunnyRig {
  const r = cloneRig(base);
  r.y = base.y + 3;
  r.squash = 0.04;
  r.stretch = 0.03;
  act(r, base, 'type', 1);
  if (!still) {
    // Fingers tapping: each hand bobs on its own beat.
    r.limbs.arms.left.hand.y += Math.abs(Math.sin(t * 9 * Math.PI)) * -1.8;
    r.limbs.arms.right.hand.y += Math.abs(Math.sin(t * 9 * Math.PI + 1.3)) * -1.8;
    breathe(r, base, t, 0.5);
  }
  // A glance up at the visitor in the second half of the loop.
  const up = still ? 0 : ease((t - 0.6) / 0.08) * (1 - ease((t - 0.82) / 0.08));
  const gaze = { x: 0.15, y: 0.7 - up * 0.9 };
  r.eyes.left.gaze = gaze;
  r.eyes.right.gaze = { ...gaze };
  r.smile.depth = base.smile.depth * (1 + up * 0.2);
  r.props = [held('laptop', 4, 44, 0, 1.05)];
  return r;
}

/** A magnifying glass up to one eye, the eye huge behind it, scanning. */
function magnifyPose(base: SunnyRig, t: number, still: boolean): SunnyRig {
  const r = cloneRig(base);
  act(r, base, 'magnify', 1);
  const scan = still ? 0 : wave(t);
  const x = -15 + scan * 6;
  const y = -9 + Math.abs(scan) * 2;
  r.faceTilt = scan * 4;
  r.rotation = scan * 2;
  r.eyes.left.scaleX = 1.35;
  r.eyes.left.scaleY = 1.35;
  r.eyes.left.gaze = { x: scan * 0.5, y: 0 };
  r.eyes.right.scaleY = 0.8;
  r.eyes.right.gaze = { x: scan * 0.5, y: 0 };
  r.brows.left.y = base.brows.left.y - 4;
  r.limbs.arms.left.hand = { x: x - 22, y: y + 22 };
  if (!still) breathe(r, base, t, 0.5);
  r.props = [held('magnifier', x, y, 0, 1)];
  return r;
}

const lookup = (
  id: string,
  group: string,
  pose: (base: SunnyRig, t: number, still: boolean) => SunnyRig,
  asset: PropRig['id'][],
): [Sequence, Sequence] => {
  const moving: Sequence = {
    id,
    group,
    priority: PRIORITY.chat + 10,
    duration: 3200,
    canInterrupt: true,
    loop: true,
    intensity: 'minimal',
    assets: asset,
    reducedMotionFallback: `${id}-still`,
    // Idle too: a host page can stage a prop outside a conversation (the
    // website's guide reads up on the knowledge-base section).
    states: ['thinking', 'idle'],
    blendInMs: 420,
    pose: (base, t) => pose(base, t, false),
  };
  const still: Sequence = {
    ...moving,
    id: `${id}-still`,
    intensity: 'off',
    assets: asset.filter((a) => a !== 'book-page'),
    reducedMotionFallback: null,
    pose: (base) => pose(base, 0, true),
  };
  return [moving, still];
};

const [lookupBook, lookupBookStill] = lookup('lookup-book', 'lookup-book', readPose, [
  'book',
  'book-page',
]);
const [lookupLaptop, lookupLaptopStill] = lookup('lookup-laptop', 'lookup-laptop', typePose, [
  'laptop',
]);
const [lookupMagnify, lookupMagnifyStill] = lookup(
  'lookup-magnify',
  'lookup-magnify',
  magnifyPose,
  ['magnifier'],
);

// ─── gestures while speaking ─────────────────────────────────────────────────

const gesture = (
  id: string,
  intensity: Sequence['intensity'],
  duration: number,
  pose: (r: SunnyRig, base: SunnyRig, t: number) => void,
): Sequence => ({
  id,
  group: 'gesture',
  priority: PRIORITY.chat + 5,
  duration,
  canInterrupt: true,
  loop: false,
  intensity,
  assets: [],
  reducedMotionFallback: null,
  // Idle as well, so a host page can ask for one by name.
  states: ['speaking', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    pose(r, base, t);
    return r;
  },
});

/** A small, sure nod: down, up, settle. */
const gestureNod = gesture('gesture-nod', 'minimal', 900, (r, base, t) => {
  const w = envelope(t, 0.2, 0.3);
  r.faceTilt = base.faceTilt + Math.sin(t * TAU * 2) * 3 * w;
  r.y = base.y + Math.max(0, Math.sin(t * TAU * 2)) * 2 * w;
  r.eyes.left.closed = 0.25 * w;
  r.eyes.right.closed = 0.25 * w;
  r.smile.depth = base.smile.depth * (1 + 0.2 * w);
});

/** "Here's the thing": a palm opens out to the visitor, the other on the hip. */
const gesturePalm = gesture('gesture-palm', 'balanced', 1500, (r, base, t) => {
  const w = envelope(t, 0.18, 0.25);
  const limbs = limbPose('hips');
  limbs.arms.left = {
    ...limbs.arms.left,
    hand: { x: -60, y: 8 - Math.sin(t * Math.PI) * 6 },
    bend: 0.5,
    shape: 'open',
    handRotation: -70 + wave(t * 1.5) * 8,
    front: false,
  };
  r.limbs = blendLimbs(base.limbs, limbs, w);
  r.rotation = base.rotation - 3 * w;
  r.faceTilt = base.faceTilt - 4 * w;
  r.brows.left.y = base.brows.left.y - 2.5 * w;
  r.brows.right.y = base.brows.right.y - 2.5 * w;
});

/** "That one": a finger-gun with a wink (sheet: top right). */
const gesturePoint = gesture('gesture-point', 'balanced', 1300, (r, base, t) => {
  const w = envelope(t, 0.15, 0.28);
  const shot = overshoot(clamp01((t - 0.05) / 0.25));
  const limbs = limbPose('hips');
  limbs.arms.right = {
    ...limbPose('point').arms.right,
    hand: { x: 58 + shot * 8, y: 4 - shot * 4 },
  };
  r.limbs = blendLimbs(base.limbs, limbs, w);
  const wink = t > 0.3 && t < 0.55 ? Math.sin(((t - 0.3) / 0.25) * Math.PI) : 0;
  r.eyes.right.closed = wink;
  r.smile.depth = base.smile.depth * (1 + 0.3 * w);
  r.smile.rotation = base.smile.rotation - 4 * w;
  r.rotation = base.rotation + 3 * w;
});

/** Counting off a point: the raised index, a little bob on each beat. */
const gestureIndex = gesture('gesture-index', 'balanced', 1400, (r, base, t) => {
  const w = envelope(t, 0.18, 0.25);
  r.limbs = blendLimbs(base.limbs, limbPose('idea'), w);
  r.limbs.arms.left.hand.y -= Math.abs(Math.sin(t * TAU * 1.5)) * 3 * w;
  r.brows.left.y = base.brows.left.y - 3 * w;
  r.faceTilt = base.faceTilt + 3 * w;
});

// ─── listening, nodding, settling ────────────────────────────────────────────

/** The visitor is typing: lean in, eyes down to the message box, a nod. */
const leanIn: Sequence = {
  id: 'lean-in',
  group: 'lean',
  priority: PRIORITY.interaction - 10,
  duration: 1600,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['listening'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const w = envelope(t, 0.2, 0.3);
    r.rotation = base.rotation + 4 * w;
    r.y = base.y + 2 * w;
    r.faceTilt = base.faceTilt + 5 * w + Math.max(0, Math.sin(t * TAU * 2)) * 2 * w;
    r.eyes.left.gaze = { x: 0.35 * w, y: 0.6 * w };
    r.eyes.right.gaze = { x: 0.35 * w, y: 0.6 * w };
    r.brows.left.y = base.brows.left.y - 2 * w;
    r.brows.right.y = base.brows.right.y - 2 * w;
    r.limbs = blendLimbs(base.limbs, limbPose('chin'), w * 0.8);
    return r;
  },
};

/** An answer delivered: a satisfied nod as Sunny settles. */
const settleNod: Sequence = {
  id: 'settle-nod',
  group: 'nod',
  priority: PRIORITY.chat - 10,
  duration: 1100,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const w = envelope(t, 0.15, 0.35);
    r.faceTilt = base.faceTilt + Math.sin(t * TAU * 1.5) * 3 * w;
    r.eyes.left.closed = 0.35 * w;
    r.eyes.right.closed = 0.35 * w;
    r.smile.depth = base.smile.depth * (1 + 0.3 * w);
    r.limbs = blendLimbs(base.limbs, limbPose('hips'), w);
    return r;
  },
};

// ─── fidgets, when nothing has happened for a while ─────────────────────────

const fidget = (
  id: string,
  intensity: Sequence['intensity'],
  duration: number,
  pose: (r: SunnyRig, base: SunnyRig, t: number) => void,
): Sequence => ({
  id,
  group: 'fidget',
  priority: PRIORITY.idle + 30,
  duration,
  canInterrupt: true,
  loop: false,
  intensity,
  assets: [],
  reducedMotionFallback: null,
  states: ['idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    pose(r, base, t);
    return r;
  },
});

/** Looking round: left, right, back -- is anyone there? */
const fidgetLook = fidget('fidget-look', 'minimal', 2600, (r, base, t) => {
  const w = envelope(t, 0.1, 0.15);
  const k = ease(t < 0.5 ? (t - 0.1) / 0.15 : (t - 0.5) / 0.15);
  const x = (t < 0.5 ? -k : -1 + 2 * k) * w;
  r.eyes.left.gaze = { x: x * 0.9, y: 0 };
  r.eyes.right.gaze = { x: x * 0.9, y: 0 };
  r.faceTilt = base.faceTilt + x * 6;
  r.rotation = base.rotation + x * 2;
  r.limbs = blendLimbs(base.limbs, limbPose('hips'), w);
});

/** A big stretch: arms up, up on the toes, a yawn. */
const fidgetStretch = fidget('fidget-stretch', 'balanced', 2400, (r, base, t) => {
  const w = envelope(t, 0.3, 0.3);
  r.limbs = blendLimbs(base.limbs, limbPose('cheer'), w);
  r.limbs.arms.left.shape = 'open';
  r.limbs.arms.right.shape = 'open';
  r.y = base.y - 4 * w;
  r.squash = -0.06 * w;
  r.stretch = -0.04 * w;
  r.eyes.left.closed = 0.8 * w;
  r.eyes.right.closed = 0.8 * w;
  r.smile.depth = base.smile.depth * (1 - 0.6 * w);
  r.smile.span = base.smile.span * (1 - 0.35 * w);
  for (const [i, ray] of r.rays.entries()) {
    ray.lengthScale = base.rays[i]!.lengthScale * (1 + 0.12 * w);
  }
});

/** A peace sign and a grin, for nobody in particular (sheet: bottom left). */
const fidgetPeace = fidget('fidget-peace', 'balanced', 1800, (r, base, t) => {
  const w = envelope(t, 0.18, 0.25);
  r.limbs = blendLimbs(base.limbs, limbPose('peace'), w);
  r.limbs.arms.left.handRotation += wave(t * 2) * 10 * w;
  r.faceTilt = base.faceTilt - 5 * w;
  r.smile.depth = base.smile.depth * (1 + 0.35 * w);
  r.eyes.right.closed =
    Math.max(0, Math.sin(((t - 0.4) / 0.25) * Math.PI)) * (t > 0.4 && t < 0.65 ? 1 : 0);
});

/** A little hop on the spot, landing with a squash (sheet: bottom row, second). */
const fidgetHop = fidget('fidget-hop', 'playful', 1200, (r, base, t) => {
  const air = t > 0.2 && t < 0.7 ? Math.sin(((t - 0.2) / 0.5) * Math.PI) : 0;
  const crouch = Math.max(
    t < 0.2 ? Math.sin((t / 0.2) * Math.PI) : 0,
    t > 0.7 && t < 0.9 ? Math.sin(((t - 0.7) / 0.2) * Math.PI) : 0,
  );
  r.y = base.y - air * 9 + crouch * 3;
  r.squash = crouch * 0.1 - air * 0.05;
  r.stretch = -crouch * 0.06 + air * 0.03;
  const limbs = blendLimbs(limbPose('hips'), limbPose('jump'), air);
  for (const side of ['left', 'right'] as const) limbs.legs[side].foot.y -= air * 9;
  r.limbs = blendLimbs(base.limbs, limbs, envelope(t, 0.1, 0.12));
});

// ─── the lounge: waiting in the deckchair ────────────────────────────────────

/**
 * A04's chair, but for waiting rather than a break: after a long quiet spell
 * the chair comes out and Sunny stays in it -- shades on, slow breath, the
 * odd glance over the top of the lenses -- until the visitor does anything.
 * It is finite only in principle (ten minutes); in practice the state change
 * the visitor's next keystroke causes retires it, and the compositor blends
 * Sunny back up out of it.
 */
const LOUNGE_MS = 600_000;
function loungePose(base: SunnyRig, t: number, still: boolean): SunnyRig {
  const r = cloneRig(base);
  const ms = t * LOUNGE_MS;
  const seated = still ? 1 : ease(ms / 900);
  const breath = still ? 0 : wave(ms / 4200) * seated;
  r.rotation = base.rotation + seated * 16;
  r.x = base.x + seated * 8;
  r.y = base.y + seated * 6 - breath * 0.8;
  r.faceTilt = base.faceTilt - seated * 4;
  r.smile.depth = base.smile.depth * (1 + seated * 0.35);
  for (const ray of r.rays) ray.lengthScale = 1 - seated * 0.04 + breath * 0.04;
  const limbs = limbPose('recline');
  limbs.legs.left = { ...limbs.legs.left, foot: { x: -50, y: 78 }, bend: -0.25, footRotation: -32 };
  limbs.legs.right = { ...limbs.legs.right, foot: { x: -74, y: 62 }, bend: 0.3, footRotation: -10 };
  // A foot taps along to nothing, every so often.
  const tap = still ? 0 : Math.max(0, Math.sin((ms / 700) * Math.PI)) * (Math.floor(ms / 5600) % 2);
  limbs.legs.right.footRotation -= tap * 12;
  r.limbs = blendLimbs(base.limbs, limbs, seated);

  // The chair is given back the body's move, so it stays planted (see A04).
  const back = (-r.rotation * Math.PI) / 180;
  const dx = base.x - r.x;
  const dy = base.y - r.y;
  const shades = still ? 1 : ease((ms - 600) / 500);
  // Every twenty seconds or so, a peek over the top of the shades.
  const peek = still ? 0 : Math.max(0, Math.sin((((ms % 21_000) - 18_000) / 1200) * Math.PI));
  r.props = [
    {
      id: 'deckchair',
      x: dx * Math.cos(back) - dy * Math.sin(back),
      y: dx * Math.sin(back) + dy * Math.cos(back),
      rotation: -r.rotation + (1 - seated) * 18,
      scale: 0.55 + 0.45 * seated,
      opacity: seated,
    },
    {
      id: 'sunglasses',
      x: 1.8,
      y: -5.4 - 40 * (1 - shades) + peek * 6,
      rotation: -11.4,
      scale: 1,
      opacity: shades,
    },
  ];
  r.eyes.left.closed = 0.35 * shades * (1 - peek);
  r.eyes.right.closed = 0.35 * shades * (1 - peek);
  r.brows.left.y = base.brows.left.y - peek * 3;
  return r;
}

const lounge: Sequence = {
  id: 'lounge-deckchair',
  group: 'lounge',
  priority: PRIORITY.idle + 40,
  duration: LOUNGE_MS,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: ['deckchair', 'sunglasses'],
  reducedMotionFallback: 'lounge-still',
  states: ['relaxing'],
  blendInMs: 500,
  pose: (base, t) => loungePose(base, t, false),
};

const loungeStill: Sequence = {
  ...lounge,
  id: 'lounge-still',
  // A held pose: it loops on one frame until the state it belongs to ends.
  loop: true,
  duration: 1,
  intensity: 'off',
  reducedMotionFallback: null,
  pose: (base) => loungePose(base, 0, true),
};

export const ACTING: readonly Sequence[] = [
  lookupBookStill,
  lookupBook,
  lookupLaptopStill,
  lookupLaptop,
  lookupMagnifyStill,
  lookupMagnify,
  gestureNod,
  gesturePalm,
  gesturePoint,
  gestureIndex,
  leanIn,
  settleNod,
  fidgetLook,
  fidgetStretch,
  fidgetPeace,
  fidgetHop,
  loungeStill,
  lounge,
];

/** The speaking gestures the director picks between, by id. */
export const GESTURES = ['gesture-nod', 'gesture-palm', 'gesture-point', 'gesture-index'] as const;
/** The idle fidgets the director picks between, by id or group. */
export const FIDGETS = [
  'fidget-look',
  'fidget-stretch',
  'fidget-peace',
  'fidget-hop',
  'balloon',
] as const;

/** What a tool call looks like while it runs. */
export type LookupKind = 'book' | 'laptop' | 'magnifier';
export const LOOKUP_GROUP: Readonly<Record<LookupKind, string>> = {
  book: 'lookup-book',
  laptop: 'lookup-laptop',
  magnifier: 'lookup-magnify',
};
