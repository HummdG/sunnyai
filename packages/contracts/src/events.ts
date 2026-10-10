import { z } from 'zod';

/**
 * Application events: the ONLY vocabulary the assistant can use to ask the UI to
 * react.
 *
 * This is a security boundary, not a convenience. The model emits structured
 * events; the client maps each one to an animation that is already approved and
 * already in the build. The model never emits a script, a selector, a URL to
 * fetch, or anything else the client executes. Anything not in this list is
 * dropped by the client rather than rendered.
 *
 * Adding a member means adding an animation that handles it. Adding a member
 * that carries free-form text the client renders as markup is not allowed.
 */
export const APPLICATION_EVENTS = [
  'message_started',
  'tool_started',
  'tool_finished',
  'recommendation_ready',
  'lead_saved',
  'handoff_requested',
  'page_action_suggested',
  'message_finished',
] as const;

export const applicationEventSchema = z.enum(APPLICATION_EVENTS);
export type ApplicationEventKind = z.infer<typeof applicationEventSchema>;

/**
 * Tool names the agent may invoke. The list is closed: a tool name that is not
 * here is rejected server-side before it reaches a handler.
 */
export const TOOL_NAMES = [
  'retrieve_knowledge',
  'get_questionnaire',
  'save_answer',
  'search_catalogue',
  'validate_compatibility',
  'recommend_packages',
  'calculate_approved_estimate',
  'start_sunscan_assessment',
  'get_sunscan_result',
  'create_lead',
  'request_callback',
  'handoff_to_human',
  'suggest_page_action',
] as const;

export const toolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof toolNameSchema>;

/**
 * Host page actions Sunny may *suggest*. The host SDK re-checks these against
 * its own allowlist of named targets before doing anything, so a suggestion is a
 * request, never an instruction.
 */
export const PAGE_ACTIONS = ['highlight', 'scroll', 'navigate', 'focus', 'open_panel'] as const;
export const pageActionSchema = z.enum(PAGE_ACTIONS);
export type PageAction = z.infer<typeof pageActionSchema>;
