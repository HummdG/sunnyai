import {
  blendLimbs,
  limbPose,
  type LimbPoseName,
  type LimbsRig,
  type SunnyRig,
} from '@sunny/character';

import type { Sequence } from './types.js';

/**
 * Body acting: what Sunny's arms, hands and legs do in each sequence.
 *
 * The face and ray animation of every sequence lives in `sequences.ts`; this
 * adds the rubber-hose acting from `reference_poses.png` on top, in one place,
 * so a pose (a wave, a hand on the chin, a cheer) looks the same wherever it is
 * used. Every once-only sequence hands the limbs back to the base pose by its
 * last frame, so nothing is left mid-gesture when the next sequence starts.
 */

type Director = (r: SunnyRig, t: number, base: SunnyRig) => void;

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

const pose = (name: LimbPoseName): LimbsRig => limbPose(name);

/** Act `limbs` with strength `w` over the base pose. */
function act(r: SunnyRig, base: SunnyRig, limbs: LimbsRig, w: number): void {
  r.limbs = blendLimbs(base.limbs, limbs, w);
}

function findProp(r: SunnyRig, id: string): SunnyRig['props'][number] | undefined {
  return r.props.find((p) => p.id === id && p.opacity > 0.05);
}

/** Hide the limbs while the body turns past `limit` degrees (a tucked roll). */
function tuckWhileSpinning(r: SunnyRig, base: SunnyRig, limit = 20): void {
  const turn = ((((r.rotation - base.rotation) % 360) + 540) % 360) - 180;
  if (Math.abs(turn) > limit) r.limbs.visible = false;
}

const wavingHello: Director = (r, t, base) => {
  const w = envelope(t, 0.2, 0.25);
  const limbs = pose('wave');
  limbs.arms.left.handRotation += wave(t * 3) * 28;
  limbs.arms.left.hand.x += wave(t * 3) * 3;
  act(r, base, limbs, w);
};

const DIRECTORS: Readonly<Record<string, Director>> = {
  'idle-breathe': (r, t) => {
    // Elbows pump a little with each bounce; the feet stay planted, so the
    // rubber legs take up the bob.
    r.limbs.arms.left.bend += wave(t * 6) * 0.18;
    r.limbs.arms.right.bend -= wave(t * 6) * 0.18;
  },

  'listening-perk': wavingHello,
  'bubble-open': (r, t, base) => {
    const w = t < 0.3 ? 0 : Math.sin(((t - 0.3) / 0.7) * Math.PI);
    const limbs = pose('wave');
    limbs.arms.left.handRotation += wave(t * 2) * 30;
    act(r, base, limbs, w);
  },

  'thinking-whirr': (r, t, base) => {
    const limbs = pose('chin');
    // A finger tapping the chin on the clock's beat.
    limbs.arms.left.hand.y += Math.abs(Math.sin(t * 4 * Math.PI)) * 1.6;
    act(r, base, limbs, 1);
  },
  'thinking-still': (r, _t, base) => act(r, base, pose('chin'), 1),

  'thinking-eureka': (r, t, base) => {
    // Hand on chin while the question hangs, then the finger shoots up.
    const lit = t < 0.45 ? 0 : overshoot((t - 0.45) / 0.18);
    const limbs = blendLimbs(pose('chin'), pose('idea'), lit);
    act(r, base, limbs, Math.min(1, ease((1 - t) / 0.15)));
  },
  'eureka-still': (r, t, base) => act(r, base, pose('idea'), envelope(t, 0.2, 0.2)),

  'speaking-pulse': (r, t, base) => {
    // One hand talks: it opens palm-up on each syllable.
    const beat = Math.sin(((t * 2) % 1) * Math.PI);
    const limbs = blendLimbs(pose('hips'), pose('shrug'), 0.45 + beat * 0.3);
    limbs.arms.right = pose('hips').arms.right;
    act(r, base, limbs, 1);
  },

  'guiding-point': (r, t, base) => {
    const limbs = pose('point');
    limbs.arms.left = pose('hips').arms.left;
    limbs.arms.right.hand.x += wave(t * 2) * 2.5;
    act(r, base, limbs, 1);
    // A quick wink while pointing (sheet: top row, right).
    const wink = t > 0.1 && t < 0.3 ? Math.sin(((t - 0.1) / 0.2) * Math.PI) : 0;
    r.eyes.right.closed = Math.max(r.eyes.right.closed, wink);
    r.smile.depth *= 1 + wink * 0.25;
  },
  'guiding-still': (r, _t, base) => {
    const limbs = pose('point');
    limbs.arms.left = pose('hips').arms.left;
    act(r, base, limbs, 1);
  },

  'celebrate-bounce': (r, t, base) => {
    // Cheering, and in the air the legs tuck and the hands fly open.
    const air = Math.max(0, base.y - r.y);
    const flying = clamp01(air / 6);
    const limbs = blendLimbs(pose('cheer'), pose('jump'), flying);
    for (const side of ['left', 'right'] as const) limbs.legs[side].foot.y -= air;
    limbs.arms.left.handRotation += wave(t * 3) * 12;
    limbs.arms.right.handRotation -= wave(t * 3) * 12;
    act(r, base, limbs, envelope(t, 0.1, 0.12));
  },
  'celebrate-still': (r, t, base) => act(r, base, pose('thumbsUp'), envelope(t, 0.2, 0.2)),
  'celebrate-spin': (r, t, base) => {
    act(r, base, pose('cheer'), envelope(t, 0.1, 0.1));
    tuckWhileSpinning(r, base);
  },

  'confused-tilt': (r, t, base) => {
    const limbs = pose('shrug');
    limbs.arms.left.hand.y -= Math.abs(Math.sin(t * Math.PI * 3)) * 3;
    limbs.arms.right.hand.y -= Math.abs(Math.sin(t * Math.PI * 3)) * 3;
    act(r, base, limbs, envelope(t, 0.25, 0.25));
  },
  'confused-still': (r, t, base) => act(r, base, pose('shrug'), envelope(t, 0.3, 0.3) * 0.6),

  'error-deflate': (r, t, base) => act(r, base, pose('droop'), envelope(t, 0.3, 0.3)),
  'error-still': (r, t, base) => act(r, base, pose('droop'), envelope(t, 0.3, 0.3) * 0.6),

  'cool-still': (r, t, base) => act(r, base, pose('thumbsUp'), envelope(t, 0.2, 0.2)),

  'charging-panel': (r, t, base) => {
    const battery = findProp(r, 'battery');
    const limbs = pose('hips');
    if (battery) {
      limbs.arms.right.hand = { x: battery.x - 2, y: battery.y + 12 };
      limbs.arms.right.shape = 'open';
      limbs.arms.right.bend = 0.4;
      limbs.arms.right.handRotation = -20;
    }
    act(r, base, limbs, envelope(t, 0.12, 0.12));
  },

  'play-shuffle': (r, t, base) => walk(r, t, base, 3, 0.6),
  'play-run': (r, t, base) => walk(r, t, base, 4, 1),
  'play-dance': (r, t, base) => {
    walk(r, t, base, 4, 0.8);
    const w = envelope(t, 0.1, 0.12);
    const limbs = blendLimbs(r.limbs, pose('cheer'), 0.6 * w);
    limbs.legs = r.limbs.legs;
    r.limbs = limbs;
  },

  'balloon-rise': (r, t, base) => holdBalloon(r, t, base),
  'balloon-sway': (r, t, base) => holdBalloon(r, t, base),
  'balloon-wander': (r, t, base) => holdBalloon(r, t, base),

  'pop-burst': (r, t, base) => act(r, base, pose('jump'), envelope(t, 0.08, 0.4)),
  'pop-flinch': (r, t, base) => act(r, base, pose('jump'), envelope(t, 0.08, 0.4)),
  'pop-shower': (r, t, base) => act(r, base, pose('cheer'), envelope(t, 0.1, 0.3)),

  'arcade-tuck': (r, _t, base) => tuckWhileSpinning(r, base),
  'arcade-roll': (r, _t, base) => tuckWhileSpinning(r, base),
  'arcade-spin': (r, _t, base) => tuckWhileSpinning(r, base),

  'bloom-seed': (r, t, base) => act(r, base, pose('point'), envelope(t, 0.15, 0.15) * 0.5),
  'bloom-grow': (r, t, base) => act(r, base, pose('cheer'), Math.max(0, envelope(t, 0.6, 0.12))),
  'bloom-showcase': (r, t, base) =>
    act(r, base, pose('cheer'), Math.max(0, envelope(t, 0.6, 0.12))),
};

/** A stepping cycle: feet lift and swap, arms swing against them. */
function walk(r: SunnyRig, t: number, base: SunnyRig, steps: number, size: number): void {
  // Legs grow from the lower rays and stride; the side rays become swinging
  // arms, pumping against the legs.
  const limbs = pose('stand');
  const p = t * steps * 0.5;
  const stride = wave(p) * 12 * size;
  limbs.legs.left.foot = { x: -22 + stride, y: 86 - Math.max(0, wave(p)) * 10 * size };
  limbs.legs.right.foot = { x: 22 - stride, y: 86 - Math.max(0, -wave(p)) * 10 * size };
  limbs.legs.left.bend = -0.25 - Math.max(0, wave(p)) * 0.4;
  limbs.legs.right.bend = 0.25 + Math.max(0, -wave(p)) * 0.4;
  limbs.arms.left = {
    ...limbs.arms.left,
    hand: { x: -62 - stride * 0.9, y: 36 - Math.max(0, -wave(p)) * 14 * size },
    bend: -0.35,
    shape: 'fist',
    morph: 1,
  };
  limbs.arms.right = {
    ...limbs.arms.right,
    hand: { x: 62 - stride * 0.9, y: 36 - Math.max(0, wave(p)) * 14 * size },
    bend: 0.35,
    shape: 'fist',
    morph: 1,
  };
  act(r, base, limbs, envelope(t, 0.1, 0.12));
}

/**
 * The arm on the balloon's side holds its string out clear of the body, below
 * the balloon wherever it has drifted (sheet: third row, first).
 */
function holdBalloon(r: SunnyRig, t: number, base: SunnyRig): void {
  const balloon = findProp(r, 'balloon');
  const limbs = pose('hips');
  if (balloon) {
    const side = balloon.x < 0 ? 'left' : 'right';
    const sign = side === 'left' ? -1 : 1;
    limbs.arms[side] = {
      ...limbs.arms[side],
      shoulderDeg: side === 'left' ? 255 : 105,
      hand: {
        x: sign * Math.max(56, Math.abs(balloon.x) + 6),
        y: Math.min(14, Math.max(-24, balloon.y + 34)),
      },
      bend: sign * -0.35,
      shape: 'fist',
      handRotation: 0,
    };
  }
  act(r, base, limbs, envelope(t, 0.1, 0.1));
}

/** Add the body acting to a sequence. */
export function withLimbActing(sequence: Sequence): Sequence {
  const director = DIRECTORS[sequence.id];
  if (!director) return sequence;
  return {
    ...sequence,
    pose: (base, t, anchor) => {
      const r = sequence.pose(base, t, anchor);
      director(r, t, base);
      return r;
    },
  };
}
