// @sunny/animation-engine — behaviour for the character.
//
// The split is deliberate: `machine` decides *what Sunny is doing*, the
// `scheduler` decides *what is drawn*, and `sequences` is the vocabulary both
// draw from. Nothing in here reads the DOM or the clock on its own, so the whole
// package can be replayed frame by frame in a test.

export * from './types.js';
export * from './machine.js';
export * from './scheduler.js';
export * from './compositor.js';
export { FIDGETS, GESTURES, LOOKUP_GROUP, type LookupKind } from './acting.js';
export * from './sequences.js';
export * from './catalogue.js';
export * from './engine.js';

import type { LookupKind } from './acting.js';
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
    // The first words of the answer: from thinking this is the eureka. Every
    // later delta maps the same way and is a no-op once Sunny is speaking.
    case 'text_delta':
      return { type: 'speaking_started' };
    case 'tool_started':
      return event.tool === POINTING_TOOL
        ? { type: 'guiding_started' }
        : { type: 'lookup', kind: lookupKindForTool(event.tool ?? '') };
    case 'tool_finished':
      return event.tool === POINTING_TOOL
        ? { type: 'guiding_finished' }
        : { type: 'lookup_finished' };
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

/** The one tool whose job is to point at the host page. */
const POINTING_TOOL = 'suggest_page_action';

/**
 * What Sunny holds while a tool runs, by what the tool is doing: reading the
 * knowledge base is a book, searching is a magnifying glass, working out a
 * price or filling something in is the laptop. An unknown tool gets the
 * laptop, the most neutral of the three.
 */
export function lookupKindForTool(tool: string): LookupKind {
  if (/knowledge|questionnaire|faq|retrieve/.test(tool)) return 'book';
  if (/search|validate|sunscan|find|lookup/.test(tool)) return 'magnifier';
  return 'laptop';
}

/** The subset of a stream event this mapping needs; kept structural on purpose. */
export interface StreamEventLike {
  type: string;
  /** The tool's name, on tool events. */
  tool?: string;
}
export * from './face-rules.js';
