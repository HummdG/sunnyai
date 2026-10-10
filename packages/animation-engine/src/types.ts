import type { SunnyRig } from '@sunny/character';

/**
 * Sunny's states. Exactly one is active at a time; the machine decides which.
 *
 * These are *behavioural* states, not animations. Several animations can play
 * inside one state (idle blinks while gaze-tracking), and one animation can span
 * a state change (a eureka pose settles into idle).
 */
export const STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'guiding',
  'celebrating',
  'confused',
  'relaxing',
  'playing',
  'error',
] as const;
export type SunnyState = (typeof STATES)[number];

/** How much animation a tenant has asked for. */
export const INTENSITIES = ['off', 'minimal', 'balanced', 'playful'] as const;
export type Intensity = (typeof INTENSITIES)[number];

/** Ordered weakest to strongest; a sequence declares the floor it needs. */
const INTENSITY_RANK: Readonly<Record<Intensity, number>> = {
  off: 0,
  minimal: 1,
  balanced: 2,
  playful: 3,
};

export function intensityAllows(tenant: Intensity, required: Intensity): boolean {
  return INTENSITY_RANK[tenant] >= INTENSITY_RANK[required];
}

/**
 * Scheduler priority. Higher wins. The bands are deliberately far apart so a new
 * sequence can be slotted into a band without renumbering its neighbours.
 *
 *   1000+  direct interaction: the visitor just did something, answer immediately
 *    800+  accessibility and error: never suppress a recovery or an alert
 *    600+  chat and guidance: the assistant is actually talking to someone
 *    400+  success: celebrating a completed task
 *    200+  user-invoked play: games the visitor asked for
 *    0+    idle: the resting layer, always available, always interruptible
 */
export const PRIORITY = {
  idle: 0,
  play: 200,
  success: 400,
  chat: 600,
  accessibility: 800,
  interaction: 1000,
} as const;
export type Priority = number;

/**
 * A sequence is a pure function from progress to pose.
 *
 * That single constraint is what makes the whole character testable: replaying a
 * sequence at a fixed set of `t` values reproduces the same rigs, so a
 * screenshot test can pin every flagship animation without a video harness.
 *
 * Because `pose` derives from the caller's base rig and never mutates it, and
 * because the engine renders only the rig returned by the winning sequence,
 * props and arm morphs cannot survive a sequence ending. Cleanup is structural
 * rather than a callback that might be forgotten.
 */
export interface Sequence {
  id: string;
  /**
   * The behavioural moment this sequence serves -- `celebrate`, `think`,
   * `open`. Several sequences can share a group at different intensity floors,
   * which is how a tenant on `minimal` still gets a celebration: the caller asks
   * for the moment, and the scheduler picks the strongest variant that tenant's
   * setting allows.
   *
   * Asking by group rather than by id is what stops an intensity setting from
   * silently deleting a whole behaviour. A group with no eligible member is a
   * test failure; an id that happens to be above the floor is invisible.
   */
  group: string;
  /** Higher wins the scheduler. See PRIORITY. */
  priority: Priority;
  /** Natural length in milliseconds. Ignored when `loop` is true. */
  duration: number;
  /** Whether a higher-priority sequence may cut this one off mid-flight. */
  canInterrupt: boolean;
  /** Whether the sequence repeats until cancelled. */
  loop: boolean;
  /** Minimum tenant intensity for this to be eligible at all. */
  intensity: Intensity;
  /** Prop ids this sequence can draw. Used to assert nothing leaks. */
  assets: readonly string[];
  /**
   * The sequence to substitute under `prefers-reduced-motion`. `null` means the
   * sequence is dropped and the base pose holds instead.
   */
  reducedMotionFallback: string | null;
  /** The states this sequence is eligible to play in. */
  states: readonly SunnyState[];
  /**
   * The pose at progress `t` in 0..1 (or, when looping, the phase in 0..1).
   * Must be pure: same inputs, same rig, every time.
   */
  pose: (base: SunnyRig, t: number) => SunnyRig;
}

/** Everything the engine needs to know about the world to choose a sequence. */
export interface EngineContext {
  state: SunnyState;
  intensity: Intensity;
  reducedMotion: boolean;
  /** The tab is hidden or the window is not focused: drop to the cheapest layer. */
  hidden: boolean;
  /** The visitor has paused Sunny explicitly. Nothing plays. */
  paused: boolean;
  /** Battery saver or a low-power hint from the host. */
  lowPower: boolean;
}
