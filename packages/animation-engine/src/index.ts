// @sunny/animation-engine — behaviour for the character.
//
// The split is deliberate: `machine` decides *what Sunny is doing*, the
// `scheduler` decides *what is drawn*, and `sequences` is the vocabulary both
// draw from. Nothing in here reads the DOM or the clock on its own, so the whole
// package can be replayed frame by frame in a test.

export * from './types.js';
export * from './machine.js';
export * from './scheduler.js';
export * from './sequences.js';
export * from './engine.js';

import type { MachineEvent } from './machine.js';

/**
 * Maps a chat stream event onto the character's machine event.
 *
 * This is the translation layer the plan insists on: the UI reacts to the
 * application's own event vocabulary, so the mapping lives in one auditable
 * function rather than being spread through the widget as `if (type === ...)`.
 * An event with no behavioural meaning returns null and changes nothing.
 */
export function machineEventForStreamEvent(event: StreamEventLike): MachineEvent | null {
  switch (event.type) {
    case 'tool_started':
      return { type: 'guiding_started' };
    case 'tool_finished':
      return { type: 'guiding_finished' };
    // A finished recommendation is Sunny's own good work: the sunglasses.
    case 'recommendation_ready':
      return { type: 'impress' };
    // A saved lead is for the visitor's benefit, and gets the full celebration.
    case 'lead_saved':
      return { type: 'celebrate' };
    case 'error':
      return { type: 'turn_failed' };
    case 'message_finished':
      return { type: 'turn_finished' };
    default:
      return null;
  }
}

/** The subset of a stream event this mapping needs; kept structural on purpose. */
export interface StreamEventLike {
  type: string;
}
