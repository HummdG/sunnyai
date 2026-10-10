import { PAGE_ACTIONS, TOOL_NAMES } from '@sunny/contracts';

import { newId, type LeadRecord, type Store } from '../store.js';
import type { Tenant } from '../tenants.js';
import type { ChatToolCall, ToolDeclaration } from './provider.js';

/**
 * The approved tool surface.
 *
 * Every tool the model may call is declared here, with arguments that are
 * validated before the implementation runs. Two rules hold throughout:
 *
 *   1. The model's arguments are *input*, never authorisation. A tool that needs
 *      a tenant, a session or a price takes it from the server-side context, not
 *      from the arguments, so a prompt-injected visitor cannot ask for another
 *      tenant's catalogue or talk a price down.
 *   2. A tool that depends on a service this deployment cannot reach says so. It
 *      does not return a plausible invention. Where that leaves a capability
 *      missing, the honest failure is the product: a visitor told "I can't reach
 *      the pricing service" is better served than one shown a made-up number.
 */

/** What a tool may change or report during a turn. */
export interface ToolEvent {
  kind: 'page_action' | 'lead_saved' | 'handoff_requested' | 'recommendation_ready';
  detail: Record<string, unknown>;
}

export interface ToolContext {
  tenant: Tenant;
  sessionId: string;
  conversationId: string | null;
  store: Store;
  /** Answers collected so far this session, keyed by question id. */
  answers: Record<string, string>;
  /** Emitted events, drained by the route and forwarded to the widget. */
  events: ToolEvent[];
  /** True when a SunScan adapter is configured for this tenant. */
  sunscanConnected: boolean;
  /** Knowledge sources available to this tenant. */
  knowledgeSourceCount: number;
}

export interface ToolResult {
  ok: boolean;
  /** Serialised straight back to the model, so it must be JSON-safe. */
  data: unknown;
  /** One line for the transcript, in the assistant's voice. */
  summary: string;
}

interface ToolDefinition {
  name: (typeof TOOL_NAMES)[number];
  description: string;
  parameters: Record<string, unknown>;
  required: string[];
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

// ─── the questionnaire, as extracted from SunScan ────────────────────────────
//
// The question set, the step order and the option values are SunScan's, taken
// from its journey module rather than invented. Keeping them in a versioned
// constant is what lets Sunny ask the same questions the host site's own wizard
// asks, so an answer given to Sunny is an answer the installer can use.

export const QUESTIONNAIRE_VERSION = 'sunscan-2026-01';

export const QUESTIONS: Readonly<
  Record<string, { step: string; prompt: string; options?: readonly string[] }>
> = {
  address: { step: 'address', prompt: 'What is the address you would like assessed?' },
  roof_confidence: {
    step: 'roof',
    prompt: 'How confident are you about your roof details?',
    options: ['high', 'medium', 'low'],
  },
  roof_size: {
    step: 'roof',
    prompt: 'Roughly how much roof space is available?',
    options: ['small', 'medium', 'large', 'unsure'],
  },
  roof_direction: {
    step: 'roof',
    prompt: 'Which way does the main roof face?',
    options: ['south', 'south_east', 'south_west', 'east', 'west', 'east_west', 'north', 'unsure'],
  },
  roof_shading: {
    step: 'roof',
    prompt: 'Is the roof shaded by trees or buildings?',
    options: ['none', 'trees', 'buildings', 'heavy', 'unsure'],
  },
  property_type: {
    step: 'property',
    prompt: 'What kind of property is it?',
    options: ['detached', 'semi', 'terraced', 'bungalow', 'flat', 'other'],
  },
  ownership: {
    step: 'property',
    prompt: 'Do you own the property?',
    options: ['own', 'mortgage', 'rent', 'social', 'landlord', 'other'],
  },
  usage_source: {
    step: 'usage',
    prompt: 'How would you like to tell me about your electricity use?',
    options: ['bill_ocr', 'manual_kwh', 'monthly_cost', 'household'],
  },
  annual_kwh: { step: 'usage', prompt: 'Roughly how many kWh do you use in a year?' },
  tariff_type: {
    step: 'tariff',
    prompt: 'What kind of electricity tariff are you on?',
    options: ['standard', 'economy7', 'smart_tou', 'import_export', 'already_exports', 'unknown'],
  },
  existing_system: {
    step: 'existing',
    prompt: 'Do you already have solar or a battery?',
    options: ['none', 'solar', 'battery', 'solar_battery', 'unsure'],
  },
  motivation: {
    step: 'motivation',
    prompt: 'What matters most to you about going solar?',
    options: [
      'reduce_bills',
      'price_protection',
      'cheap_tariffs',
      'earn_export',
      'independence',
      'carbon',
      'home_value',
      'exploring',
    ],
  },
  budget_band: {
    step: 'motivation',
    prompt: 'What budget did you have in mind?',
    options: ['under_6k', '6k_10k', '10k_15k', '15k_plus', 'unsure'],
  },
  finance_interest: {
    step: 'motivation',
    prompt: 'Would finance be of interest?',
    options: ['yes', 'no', 'maybe', 'learn_more'],
  },
};

export const STEP_ORDER = [
  'address',
  'roof',
  'property',
  'usage',
  'tariff',
  'existing',
  'motivation',
] as const;

// ─── the tool implementations ────────────────────────────────────────────────

const DEFINITIONS: ToolDefinition[] = [
  {
    name: 'retrieve_knowledge',
    description:
      "Search this installer's own documents and pages for an answer. Use it before answering any question about the installer's policies, warranties, areas served or process.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look up.' } },
      required: ['query'],
    },
    required: ['query'],
    async run(args, ctx) {
      const query = str(args, 'query') ?? '';
      if (ctx.knowledgeSourceCount === 0) {
        // The honest answer. Inventing text here would be the single most
        // damaging failure mode in the product: a warranty term that sounds
        // authoritative and is not.
        return {
          ok: false,
          data: { sources: [], configured: false },
          summary:
            'No knowledge sources are connected for this installer, so I cannot quote their documents.',
        };
      }
      return {
        ok: false,
        data: { sources: [], configured: true, query, pending: 'ingestion-not-implemented' },
        summary: 'Knowledge retrieval is not implemented in this build yet.',
      };
    },
  },
  {
    name: 'get_questionnaire',
    description:
      'Return the qualification questions still to be answered. Call it before asking anything, and ask at most one question per turn.',
    parameters: {
      type: 'object',
      properties: {
        includeAnswered: {
          type: 'boolean',
          description: 'Include questions already answered this session.',
        },
      },
    },
    required: [],
    async run(args, ctx) {
      const includeAnswered = args['includeAnswered'] === true;
      const remaining = Object.entries(QUESTIONS)
        .filter(([id]) => includeAnswered || ctx.answers[id] === undefined)
        .map(([id, q]) => ({ id, step: q.step, prompt: q.prompt, options: q.options ?? [] }));
      return {
        ok: true,
        data: { version: QUESTIONNAIRE_VERSION, stepOrder: STEP_ORDER, questions: remaining },
        summary: remaining.length
          ? `${remaining.length} question(s) outstanding, next is "${remaining[0]!.prompt}"`
          : 'Nothing left to ask.',
      };
    },
  },
  {
    name: 'save_answer',
    description:
      "Record the visitor's answer to one qualification question. Use the ids from get_questionnaire.",
    parameters: {
      type: 'object',
      properties: {
        questionId: { type: 'string' },
        value: { type: 'string', description: 'The answer, using one of the listed options.' },
      },
      required: ['questionId', 'value'],
    },
    required: ['questionId', 'value'],
    async run(args, ctx) {
      const questionId = str(args, 'questionId');
      const value = str(args, 'value');
      if (!questionId || !value) {
        return {
          ok: false,
          data: { error: 'questionId and value are required' },
          summary: 'Not saved.',
        };
      }
      const question = QUESTIONS[questionId];
      if (!question) {
        return {
          ok: false,
          data: { error: 'unknown question', known: Object.keys(QUESTIONS) },
          summary: `"${questionId}" is not a question I ask.`,
        };
      }
      if (question.options && !question.options.includes(value)) {
        return {
          ok: false,
          data: { error: 'value not among the allowed options', allowed: question.options },
          summary: `"${value}" is not one of the options for that question.`,
        };
      }
      ctx.answers[questionId] = value;
      return {
        ok: true,
        data: { questionId, value, answered: Object.keys(ctx.answers).length },
        summary: `Saved ${questionId} = ${value}.`,
      };
    },
  },
  {
    name: 'validate_compatibility',
    description:
      "Check whether a proposed system makes sense for the answers given so far, using Sunny's own rules of thumb. Report any warnings verbatim; they are not advisory.",
    parameters: {
      type: 'object',
      properties: {
        panelCount: { type: 'number' },
        batteryKwh: { type: 'number' },
      },
      required: ['panelCount'],
    },
    required: ['panelCount'],
    async run(args, ctx) {
      const panelCount = num(args, 'panelCount');
      if (panelCount === null) {
        return {
          ok: false,
          data: { error: 'panelCount is required' },
          summary: 'No panel count given.',
        };
      }
      const warnings: string[] = [];
      const notes: string[] = [];

      const size = ctx.answers['roof_size'];
      const direction = ctx.answers['roof_direction'];
      const shading = ctx.answers['roof_shading'];

      if (panelCount > 20 && (size === 'small' || size === 'unsure')) {
        warnings.push(
          `${panelCount} panels is likely more than a ${size ?? 'small'} roof will take.`,
        );
      }
      if (direction === 'north' && panelCount > 6) {
        warnings.push('A north-facing roof will generate materially less than the model assumes.');
      }
      if (shading === 'heavy') {
        warnings.push('Heavy shading needs an on-site survey before any figure is quoted.');
      }
      if (direction === 'unsure' || size === 'unsure') {
        notes.push('Roof orientation or size is uncertain; figures are indicative until surveyed.');
      }

      return {
        ok: true,
        data: { panelCount, warnings, notes, ruleSource: 'sunny-rules-of-thumb' },
        summary: warnings.length ? warnings.join(' ') : 'No compatibility problems detected.',
      };
    },
  },
  {
    name: 'search_catalogue',
    description:
      "Look up products from this installer's catalogue. Only use products returned here.",
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'panel, battery, inverter, or all' },
        maxResults: { type: 'number' },
      },
    },
    required: [],
    async run(args, ctx) {
      // The catalogue is the installer's commercial data and lives in SunScan.
      // Until the adapter is connected, say so rather than inventing prices.
      if (!ctx.sunscanConnected) {
        return {
          ok: false,
          data: { products: [], connected: false },
          summary:
            "I cannot reach this installer's catalogue in this environment, so I will not quote specific products or prices.",
        };
      }
      return {
        ok: false,
        data: { products: [], connected: true, pending: 'catalogue-sync-not-implemented' },
        summary: 'Catalogue sync is not implemented in this build yet.',
      };
    },
  },
  {
    name: 'recommend_packages',
    description:
      'Produce up to three system options with indicative sizes and payback, given the answers so far.',
    parameters: {
      type: 'object',
      properties: { annualKwh: { type: 'number' } },
    },
    required: [],
    async run(args, ctx) {
      return {
        ok: false,
        data: {
          connected: ctx.sunscanConnected,
          answers: ctx.answers,
          reason:
            "Recommendations are priced by the installer's own engine. Sunny does not produce an " +
            'independent figure, because two different prices for the same roof is worse than none.',
        },
        summary:
          'I cannot produce priced options here; I can pass you to the installer for a quote.',
      };
    },
  },
  {
    name: 'calculate_approved_estimate',
    description:
      'Return an approved estimate. Only available where the installer has an approved calculator connected.',
    parameters: {
      type: 'object',
      properties: { annualKwh: { type: 'number' }, panelCount: { type: 'number' } },
    },
    required: [],
    async run(_args, ctx) {
      return {
        ok: false,
        data: {
          connected: ctx.sunscanConnected,
          reason: 'No approved estimate calculator is connected to this deployment.',
        },
        summary: 'I am not able to give an approved estimate in this environment.',
      };
    },
  },
  {
    name: 'start_sunscan_assessment',
    description:
      'Begin a SunScan roof assessment for an address. Requires the visitor to have given an address.',
    parameters: {
      type: 'object',
      properties: { address: { type: 'string' } },
      required: ['address'],
    },
    required: ['address'],
    async run(args, ctx) {
      const address = str(args, 'address') ?? ctx.answers['address'] ?? null;
      if (!address) {
        return {
          ok: false,
          data: { error: 'address required' },
          summary: 'I need an address first.',
        };
      }
      if (!ctx.sunscanConnected) {
        return {
          ok: false,
          data: { connected: false, address },
          summary:
            'The roof assessment service is not connected in this environment, so I cannot run one.',
        };
      }
      return {
        ok: false,
        data: { connected: true, pending: 'assessment-not-implemented' },
        summary: 'Assessment dispatch is not implemented in this build yet.',
      };
    },
  },
  {
    name: 'get_sunscan_result',
    description: 'Fetch a previously started SunScan assessment.',
    parameters: {
      type: 'object',
      properties: { assessmentId: { type: 'string' } },
      required: ['assessmentId'],
    },
    required: ['assessmentId'],
    async run() {
      return {
        ok: false,
        data: { reason: 'No assessment service is connected.' },
        summary: 'I have no assessment to look up.',
      };
    },
  },
  {
    name: 'create_lead',
    description:
      'Save the visitor as a lead for the installer. Only call it after the visitor has explicitly agreed to be contacted.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        postcode: { type: 'string' },
        consent: { type: 'boolean', description: 'The visitor agreed to be contacted.' },
        summary: { type: 'string', description: 'One line on what they want.' },
      },
      required: ['consent'],
    },
    required: ['consent'],
    async run(args, ctx) {
      // Consent is enforced here, not merely asked for in the prompt. A model
      // that decides to file a lead anyway gets a refusal.
      if (args['consent'] !== true) {
        return {
          ok: false,
          data: { error: 'consent-required' },
          summary: 'I need their agreement before I can pass their details on.',
        };
      }
      const lead: LeadRecord = {
        id: newId('lead'),
        // Tenant comes from the context, never from the model's arguments.
        tenantId: ctx.tenant.id,
        sessionId: ctx.sessionId,
        conversationId: ctx.conversationId,
        name: str(args, 'name'),
        email: str(args, 'email'),
        phone: str(args, 'phone'),
        postcode: str(args, 'postcode'),
        summary: str(args, 'summary') ?? 'Enquiry from the website assistant',
        score: null,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.saveLead(lead);
      ctx.events.push({ kind: 'lead_saved', detail: { leadId: lead.id } });
      return {
        ok: true,
        data: { leadId: lead.id },
        summary: 'Saved their details for the installer.',
      };
    },
  },
  {
    name: 'request_callback',
    description: 'Ask the installer to call the visitor back. Requires consent.',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        when: { type: 'string' },
        consent: { type: 'boolean' },
      },
      required: ['consent'],
    },
    required: ['consent'],
    async run(args, ctx) {
      if (args['consent'] !== true) {
        return {
          ok: false,
          data: { error: 'consent-required' },
          summary: 'I need their agreement first.',
        };
      }
      const lead: LeadRecord = {
        id: newId('lead'),
        tenantId: ctx.tenant.id,
        sessionId: ctx.sessionId,
        conversationId: ctx.conversationId,
        name: null,
        email: null,
        phone: str(args, 'phone'),
        postcode: null,
        summary: `Callback requested${str(args, 'when') ? ` (${str(args, 'when')})` : ''}`,
        score: null,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.saveLead(lead);
      ctx.events.push({ kind: 'lead_saved', detail: { leadId: lead.id, callback: true } });
      return { ok: true, data: { leadId: lead.id }, summary: 'Asked the installer to call them.' };
    },
  },
  {
    name: 'handoff_to_human',
    description:
      'Hand the conversation to a person at the installer. Use when asked something you cannot answer, or when the visitor asks for a human.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
    required: ['reason'],
    async run(args, ctx) {
      const reason = str(args, 'reason') ?? 'visitor requested';
      ctx.events.push({ kind: 'handoff_requested', detail: { reason } });
      return {
        ok: true,
        data: { queued: true, reason },
        summary: 'Flagged this conversation for a person to pick up.',
      };
    },
  },
  {
    name: 'suggest_page_action',
    description:
      'Highlight or scroll to something on the host page. Use it instead of describing where something is.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...PAGE_ACTIONS] },
        target: {
          type: 'string',
          description: 'A named landmark such as "quote-form" or "savings-calculator".',
        },
      },
      required: ['action', 'target'],
    },
    required: ['action', 'target'],
    async run(args, ctx) {
      const action = str(args, 'action');
      const target = str(args, 'target');
      if (!action || !target) {
        return {
          ok: false,
          data: { error: 'action and target are required' },
          summary: 'Nothing to do.',
        };
      }
      if (!(PAGE_ACTIONS as readonly string[]).includes(action)) {
        return {
          ok: false,
          data: { error: 'unknown action', allowed: [...PAGE_ACTIONS] },
          summary: 'That is not something I can do to the page.',
        };
      }
      // The widget maps a target to its own DOM lookup. A selector or URL from
      // the model would be an injection point; a named landmark is not.
      ctx.events.push({ kind: 'page_action', detail: { action: action, target } });
      return {
        ok: true,
        data: { action, target },
        summary: `Pointed at ${target}.`,
      };
    },
  },
];

const BY_NAME = new Map(DEFINITIONS.map((d) => [d.name, d]));

export const TOOL_DECLARATIONS: ToolDeclaration[] = DEFINITIONS.map((d) => ({
  name: d.name,
  description: d.description,
  parameters: d.parameters,
}));

/** Every declared tool must be one the plan approved. Asserted, not assumed. */
export function assertToolSurfaceClosed(): string[] {
  const approved = new Set<string>(TOOL_NAMES);
  return DEFINITIONS.map((d) => d.name).filter((name) => !approved.has(name));
}

export async function executeTool(call: ChatToolCall, ctx: ToolContext): Promise<ToolResult> {
  const definition = BY_NAME.get(call.name as (typeof TOOL_NAMES)[number]);
  if (!definition) {
    return {
      ok: false,
      data: { error: 'unknown tool' },
      summary: `There is no tool called ${call.name}.`,
    };
  }
  try {
    return await definition.run(call.args, ctx);
  } catch (error) {
    return {
      ok: false,
      data: { error: error instanceof Error ? error.message : String(error) },
      summary: 'That tool failed.',
    };
  }
}

export function toolNames(): string[] {
  return DEFINITIONS.map((d) => d.name);
}
