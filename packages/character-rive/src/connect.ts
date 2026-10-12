import type { SunnyState } from './contract.js';
import type { RiveSunnyController } from './mount.js';

/** What the adapter needs from `SunnyAnimator`: its current behavioural state. */
export interface AnimatorLike {
  readonly state: SunnyState;
}

export interface AnimatorConnection {
  /**
   * Forward the animator's state to Rive if it changed since the last call.
   * Call once per frame (or after every `dispatch`); unchanged states cost one
   * comparison and write nothing.
   */
  sync(): void;
}

/**
 * Keep the application in charge of behaviour while Rive owns the drawing.
 *
 * `SunnyAnimator` has no subscription hook — it is a pure, clock-driven object
 * the host polls each frame — so the connection is polled the same way. The
 * animator's machine still decides *what* Sunny is doing (ADR-007 §2); this
 * only tells the Rive state machine.
 */
export function connectAnimator(
  controller: Pick<RiveSunnyController, 'setState'>,
  animator: AnimatorLike,
): AnimatorConnection {
  let last: SunnyState | null = null;
  const sync = (): void => {
    const state = animator.state;
    if (state === last) return;
    last = state;
    controller.setState(state);
  };
  sync();
  return { sync };
}
