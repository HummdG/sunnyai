import type { SunnyState } from './types.js';

/**
 * The events that can move Sunny between states. They come from the application,
 * never from the model: the chat layer translates tool and stream events into
 * these, so the character's behaviour is a function of what the *system* knows,
 * not of prose the model produced.
 */
export type MachineEvent =
  /** The visitor opened the panel or started typing. */
  | { type: 'attention' }
  /** The visitor's message was received and sent upstream. */
  | { type: 'turn_started' }
  /** The first token arrived. */
  | { type: 'speaking_started' }
  /** The turn finished normally. */
  | { type: 'turn_finished' }
  /** The turn failed. */
  | { type: 'turn_failed' }
  /** The assistant is pointing at something on the host page. */
  | { type: 'guiding_started' }
  | { type: 'guiding_finished' }
  /** Something worth celebrating happened: a lead was saved. */
  | { type: 'celebrate' }
  /**
   * Sunny did something well and knows it: a recommendation is ready, a
   * question was answered cleanly. Distinct from `celebrate` because the two
   * moments read differently -- a celebration is for the visitor, this is
   * Sunny's own quiet confidence -- and because a deployment should be able to
   * turn one off without the other.
   */
  | { type: 'impress' }
  /** A question was misunderstood, or the answer is genuinely uncertain. */
  | { type: 'confused' }
  /** The visitor started a game. */
  | { type: 'play_started' }
  | { type: 'play_finished' }
  /**
   * A wave was cleared in an arcade game, so Sunny spins (A10).
   *
   * **A cue, not a transition.** It is the one event in this union the machine
   * never sees: the engine plays the spin in place, from whatever state the
   * character is already in, and deliberately does not move her. The obvious
   * alternative -- treat it as another `celebrate` -- was tried on paper and is
   * wrong, because `celebrating` settles back to `idle` after four seconds and a
   * wave cleared happens *inside* a game: she would leave the playing state to
   * spin, settle to idle, and spend the rest of the visitor's game breathing at
   * nothing while the fleet kept moving. A moment that ends the thing it is
   * celebrating is not a moment worth having.
   */
  | { type: 'spin' }
  /** Nothing is happening. */
  | { type: 'idle' }
  /** The visitor dismissed or minimised Sunny. */
  | { type: 'dismissed' };

const TABLE: Readonly<Record<SunnyState, Partial<Record<MachineEvent['type'], SunnyState>>>> = {
  // `confused` and `celebrate` are deliberately reachable from anywhere: they are
  // reactions, and gating them behind a particular prior state would mean the
  // most expressive moments land only by luck.
  idle: {
    attention: 'listening',
    turn_started: 'thinking',
    speaking_started: 'speaking',
    guiding_started: 'guiding',
    celebrate: 'celebrating',
    impress: 'celebrating',
    confused: 'confused',
    play_started: 'playing',
    dismissed: 'relaxing',
  },
  listening: {
    turn_started: 'thinking',
    impress: 'celebrating',
    idle: 'idle',
    dismissed: 'relaxing',
    confused: 'confused',
  },
  thinking: {
    speaking_started: 'speaking',
    impress: 'celebrating',
    celebrate: 'celebrating',
    turn_failed: 'error',
    turn_finished: 'idle',
    idle: 'idle',
    confused: 'confused',
  },
  speaking: {
    turn_finished: 'idle',
    turn_failed: 'error',
    guiding_started: 'guiding',
    celebrate: 'celebrating',
    impress: 'celebrating',
    idle: 'idle',
    dismissed: 'relaxing',
  },
  guiding: {
    guiding_finished: 'idle',
    turn_finished: 'idle',
    idle: 'idle',
    dismissed: 'relaxing',
  },
  celebrating: {
    idle: 'idle',
    turn_finished: 'idle',
    dismissed: 'relaxing',
  },
  confused: {
    idle: 'idle',
    turn_started: 'thinking',
    dismissed: 'relaxing',
  },
  relaxing: {
    attention: 'listening',
    idle: 'idle',
  },
  playing: {
    play_finished: 'idle',
    idle: 'idle',
    turn_started: 'thinking',
    dismissed: 'relaxing',
  },
  error: {
    idle: 'idle',
    attention: 'listening',
    turn_started: 'thinking',
  },
};

/**
 * States and the states they may settle into when their timer expires. A state
 * with an entry here is transient: it cannot be the resting state, so the
 * machine always returns to something quiet without an external nudge.
 */
const SETTLE: Partial<Record<SunnyState, { afterMs: number; to: SunnyState }>> = {
  listening: { afterMs: 60_000, to: 'idle' },
  thinking: { afterMs: 45_000, to: 'error' },
  speaking: { afterMs: 90_000, to: 'idle' },
  guiding: { afterMs: 20_000, to: 'idle' },
  celebrating: { afterMs: 4_000, to: 'idle' },
  confused: { afterMs: 3_500, to: 'idle' },
};

export interface TransitionResult {
  state: SunnyState;
  /** Whether anything actually changed; the engine skips work when false. */
  changed: boolean;
}

/**
 * A tiny deterministic state machine.
 *
 * Deliberately not a general-purpose FSM library: the whole transition table is
 * one literal above, which is what lets a test assert every reachable state and
 * every illegal move without reading a framework's docs.
 */
export class SunnyMachine {
  #state: SunnyState;
  #enteredAt: number;

  constructor(initial: SunnyState = 'idle', now = 0) {
    this.#state = initial;
    this.#enteredAt = now;
  }

  get state(): SunnyState {
    return this.#state;
  }

  get enteredAt(): number {
    return this.#enteredAt;
  }

  /**
   * Apply an event. An event with no transition from the current state is
   * ignored rather than throwing: the world is allowed to be noisy, and a
   * dropped event must never take the character down.
   */
  send(event: MachineEvent, now: number): TransitionResult {
    const next = TABLE[this.#state][event.type];
    if (next === undefined || next === this.#state) {
      return { state: this.#state, changed: false };
    }
    this.#state = next;
    this.#enteredAt = now;
    return { state: next, changed: true };
  }

  /**
   * Let a transient state expire. Call on every tick; it is a no-op until the
   * state's budget is spent.
   */
  tick(now: number): TransitionResult {
    const settle = SETTLE[this.#state];
    if (!settle || now - this.#enteredAt < settle.afterMs) {
      return { state: this.#state, changed: false };
    }
    this.#state = settle.to;
    this.#enteredAt = now;
    return { state: settle.to, changed: true };
  }

  /** States reachable from here in one move. Exposed for testing and tooling. */
  reachable(): SunnyState[] {
    const row = TABLE[this.#state];
    return [...new Set(Object.values(row))] as SunnyState[];
  }

  /** Every state that can ever be reached from the initial state. */
  static allReachable(): SunnyState[] {
    const seen = new Set<SunnyState>(['idle']);
    const queue: SunnyState[] = ['idle'];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of Object.values(TABLE[current])) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return [...seen];
  }
}
