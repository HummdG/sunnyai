import { PAGE_ACTIONS, PRODUCT_CATEGORIES, TOOL_NAMES } from '@sunny/contracts';
import type { PackageOption, Product, ProductCategory, RecommendationWant } from '@sunny/contracts';
import { mergeWant, recommend, validateSystem } from '@sunny/solar-rules';

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

/**
 * A boolean argument.
 *
 * Models send `true` as often as `"true"`, and the difference matters here:
 * `requireBattery: "false"` read as truthy would turn "no battery" into "must
 * have a battery". Anything that is not recognisably a boolean is `null` --
 * absent -- rather than a guess, so a malformed argument leaves the standing
 * constraint alone instead of overwriting it.
 */
function bool(args: Record<string, unknown>, key: string): boolean | null {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  return null;
}

/**
 * The model's arguments as a refinement of what the visitor has already asked
 * for. Only the fields it actually set are present, because `mergeWant` reads
 * an absent field as "unchanged" -- and a key set to `undefined` is exactly
 * that, so the two agree without either side having to know the other's rule.
 */
function wantFromArgs(args: Record<string, unknown>): RecommendationWant {
  const want: RecommendationWant = {};
  const targetKwp = num(args, 'targetKwp');
  const panelCount = num(args, 'panelCount');
  const maxBudgetMajor = num(args, 'maxBudgetMajor');
  const minBatteryKwh = num(args, 'minBatteryKwh');
  const currency = str(args, 'currency');

  if (targetKwp !== null && targetKwp > 0) want.targetKwp = targetKwp;
  if (panelCount !== null && panelCount > 0) want.panelCount = Math.round(panelCount);
  if (maxBudgetMajor !== null && maxBudgetMajor > 0) want.maxBudgetMajor = maxBudgetMajor;
  if (minBatteryKwh !== null && minBatteryKwh > 0) want.minBatteryKwh = minBatteryKwh;
  if (currency !== null) want.currency = currency.toUpperCase();

  const requireBattery = bool(args, 'requireBattery');
  if (requireBattery !== null) want.requireBattery = requireBattery;
  const requireEvCharging = bool(args, 'requireEvCharging');
  if (requireEvCharging !== null) want.requireEvCharging = requireEvCharging;
  const preferCheaper = bool(args, 'preferCheaper');
  if (preferCheaper !== null) want.preferCheaper = preferCheaper;
  const reset = bool(args, 'reset');
  if (reset !== null) want.reset = reset;

  return want;
}

/**
 * Minor units as a person reads them, or null.
 *
 * A price with no currency has no label: "180.00" alone would be a figure the
 * model could pair with any currency it liked, which is the invented-price
 * failure this whole engine exists to avoid.
 */
function money(minor: number | null, currency: string | null): string | null {
  return minor === null || currency === null ? null : `${currency} ${(minor / 100).toFixed(2)}`;
}

/**
 * The part of a catalogue row a conversation needs.
 *
 * `compatibility` travels with it because the model has to justify the pairing,
 * and a justification it can only make by inventing a number is not one. Absent
 * fields are null here exactly as they are in the catalogue.
 */
function productCard(product: Product): Record<string, unknown> {
  return {
    id: product.id,
    category: product.category,
    manufacturer: product.manufacturer,
    model: product.model,
    powerW: product.powerW,
    capacityWh: product.capacityWh,
    price:
      product.priceMinor === null
        ? null
        : {
            minor: product.priceMinor,
            currency: product.currency,
            label: money(product.priceMinor, product.currency),
            status: product.priceStatus,
            sourceRef: product.sourceRef,
          },
    warrantyYears: product.warrantyYears,
    compatibility: product.compatibility,
  };
}

/**
 * An option as the model sees it.
 *
 * Prices come back twice: as the integer and as a label. The label exists so
 * the model has something quotable that was produced here rather than by
 * arithmetic of its own, and the integer stays alongside it so nothing about
 * the figure becomes opaque on the way out.
 */
function packageForModel(option: PackageOption): Record<string, unknown> {
  return {
    id: option.id,
    rank: option.rank,
    title: option.title,
    summary: option.summary,
    items: option.items.map((item) => ({
      productId: item.productId,
      name: `${item.manufacturer} ${item.model}`,
      category: item.category,
      quantity: item.quantity,
      powerW: item.powerW,
      capacityWh: item.capacityWh,
      priceMinor: item.priceMinor,
      priceLabel: money(item.priceMinor, item.currency),
      priceStatus: item.priceStatus,
      sourceRef: item.sourceRef,
    })),
    totalMinor: option.totalMinor,
    totalLabel: money(option.totalMinor, option.currency),
    totalStatus: option.totalStatus,
    systemPowerW: option.systemPowerW,
    batteryCapacityWh: option.batteryCapacityWh,
    reasons: option.reasons,
    limitations: option.limitations,
    nextStep: option.nextStep,
  };
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

/**
 * The one place an answer is judged acceptable.
 *
 * Extracted from `save_answer` rather than duplicated for the qualification
 * route, because two copies of "is this a real answer" drift: the tool would
 * keep accepting an option the route had stopped accepting, and the difference
 * would surface only as a question the visitor appears to have answered twice.
 * Both callers now apply the same rule by construction.
 *
 * Pure on purpose -- strings in, verdict out -- so it can be tested without a
 * tenant, a store or a model.
 */
export type AnswerVerdict =
  | { ok: true; questionId: string; value: string }
  | { ok: false; error: string; known?: readonly string[]; allowed?: readonly string[] };

export function validateAnswer(questionId: string, value: string): AnswerVerdict {
  if (!questionId || !value) {
    return { ok: false, error: 'questionId and value are required' };
  }
  const question = QUESTIONS[questionId];
  if (!question) {
    return { ok: false, error: 'unknown question', known: Object.keys(QUESTIONS) };
  }
  if (question.options && !question.options.includes(value)) {
    return { ok: false, error: 'value not among the allowed options', allowed: question.options };
  }
  return { ok: true, questionId, value };
}

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
      const verdict = validateAnswer(questionId ?? '', value ?? '');
      if (!verdict.ok) {
        // The step is kept short: the model reads it to decide what to do next,
        // and the structured detail it needs is in `data`.
        const summary =
          verdict.error === 'unknown question'
            ? `"${questionId}" is not a question I ask.`
            : verdict.error === 'value not among the allowed options'
              ? `"${value}" is not one of the options for that question.`
              : 'Not saved.';
        return {
          ok: false,
          data: {
            error: verdict.error,
            ...(verdict.known ? { known: verdict.known } : {}),
            ...(verdict.allowed ? { allowed: verdict.allowed } : {}),
          },
          summary,
        };
      }
      ctx.answers[verdict.questionId] = verdict.value;
      return {
        ok: true,
        data: {
          questionId: verdict.questionId,
          value: verdict.value,
          answered: Object.keys(ctx.answers).length,
        },
        summary: `Saved ${verdict.questionId} = ${verdict.value}.`,
      };
    },
  },
  {
    name: 'validate_compatibility',
    description:
      "Check a system the visitor has described against this installer's own catalogue: whether the panel count is within the inverter's DC input limit, whether a panel fits its string voltage, and whether a battery is one the inverter is listed with. Each answer says which rule ran and which could not, because a rule that could not run is not a pass. Also reports the caveats that follow from the visitor's own roof answers. Never state a compatibility verdict of your own.",
    parameters: {
      type: 'object',
      properties: {
        panelCount: { type: 'number' },
        panelProductId: {
          type: 'string',
          description: 'From search_catalogue, when a panel was chosen.',
        },
        inverterProductId: {
          type: 'string',
          description: 'From search_catalogue, when an inverter was chosen.',
        },
        batteryProductId: {
          type: 'string',
          description: 'From search_catalogue, when a battery was chosen.',
        },
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

      const products = await ctx.store.listProducts(ctx.tenant.id);
      const verdict = validateSystem(
        { products, answers: ctx.answers, want: {} },
        {
          panelCount,
          panelProductId: str(args, 'panelProductId'),
          inverterProductId: str(args, 'inverterProductId'),
          batteryProductId: str(args, 'batteryProductId'),
        },
      );

      const notes = [...verdict.notes];
      if (products.length === 0) {
        // The roof caveats still stand, but nothing about the hardware has been
        // checked, and saying "no problems found" here would be a lie of omission.
        notes.push(
          'No product list has been loaded into Sunny, so nothing about the hardware could be checked.',
        );
      }

      return {
        ok: true,
        data: {
          panelCount,
          warnings: verdict.warnings,
          notes,
          constraintsChecked: verdict.checks,
          exclusions: verdict.exclusions,
          catalogueSize: products.length,
          ruleSource: "installer's catalogue",
        },
        summary: verdict.warnings.length
          ? verdict.warnings.join(' ')
          : notes.length
            ? 'No contradictions found. ' + notes.join(' ')
            : 'No compatibility problems found.',
      };
    },
  },
  {
    name: 'search_catalogue',
    description:
      "Look up products from this installer's own catalogue. Only use products returned here, and only " +
      'quote a price a returned row carries. Returns nothing, with a reason, when no catalogue is loaded.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'panel, inverter, battery, ev_charger, mounting, other, or all',
        },
        maxResults: { type: 'number' },
      },
    },
    required: [],
    async run(args, ctx) {
      // From the store, per tenant: the rows the recommendation engine reads and
      // the rows the model reads are the same ones, so a figure the model quotes
      // can be traced back to the row the installer uploaded.
      const products = await ctx.store.listProducts(ctx.tenant.id);
      if (products.length === 0) {
        return {
          ok: false,
          data: { products: [], catalogueSize: 0 },
          summary:
            'No product list has been loaded into Sunny for this installer, so I cannot quote any ' +
            'product or price. I can still pass the enquiry on.',
        };
      }

      const kind = str(args, 'kind');
      const category: ProductCategory | null =
        kind !== null && (PRODUCT_CATEGORIES as readonly string[]).includes(kind)
          ? (kind as ProductCategory)
          : null;
      const maxResults = Math.min(Math.max(Math.trunc(num(args, 'maxResults') ?? 8), 1), 25);

      const matching = products.filter(
        (product) => category === null || product.category === category,
      );
      // A deterministic order, on purpose: the same question in two sessions has
      // to return the same shortlist, or a refinement would be compared against
      // a different catalogue than the one it was given. Priced rows first --
      // they are what a quote is made of -- then cheapest, then by name.
      const ordered = [...matching].sort((a, b) => {
        if ((a.priceMinor !== null) !== (b.priceMinor !== null)) {
          return a.priceMinor !== null ? -1 : 1;
        }
        if (a.priceMinor !== null && b.priceMinor !== null && a.priceMinor !== b.priceMinor) {
          return a.priceMinor - b.priceMinor;
        }
        const byName = `${a.manufacturer} ${a.model}`.localeCompare(`${b.manufacturer} ${b.model}`);
        return byName !== 0 ? byName : a.id.localeCompare(b.id);
      });
      const rows = ordered.slice(0, maxResults);

      return {
        ok: rows.length > 0,
        data: {
          products: rows.map(productCard),
          catalogueSize: products.length,
          matching: matching.length,
          /** True when the shortlist was cut down, rather than the catalogue being this small. */
          truncated: matching.length > rows.length,
          categories: [...new Set(products.map((product) => product.category))].sort(),
        },
        summary:
          rows.length === 0
            ? `This installer's catalogue has no ${category ?? 'products'} rows.`
            : `${rows.length} of ${matching.length} matching rows returned.`,
      };
    },
  },
  {
    name: 'recommend_packages',
    description:
      "Assemble up to three system options from this installer's catalogue for what the visitor has " +
      'asked for, and check each against the compatibility rules. State the size the visitor named ' +
      '(targetKwp or panelCount); a refinement like "cheaper" or "with a battery" is sent as that ' +
      'field alone and accumulates onto what they asked for earlier. Do not add products, prices or ' +
      'savings of your own: the options returned are the whole answer.',
    parameters: {
      type: 'object',
      properties: {
        targetKwp: { type: 'number', description: 'System size the visitor asked for, in kWp.' },
        panelCount: {
          type: 'number',
          description: 'Or a panel count, if that is how they said it.',
        },
        maxBudgetMajor: {
          type: 'number',
          description: 'Their stated ceiling in major units -- 8000 for £8,000.',
        },
        currency: { type: 'string', description: 'ISO 4217 code the budget is stated in.' },
        requireBattery: { type: 'boolean' },
        requireEvCharging: { type: 'boolean' },
        minBatteryKwh: {
          type: 'number',
          description: 'Minimum battery size, when they named one.',
        },
        preferCheaper: {
          type: 'boolean',
          description: 'True when they asked for the cheapest option rather than the best.',
        },
        reset: {
          type: 'boolean',
          description:
            'True only when they have changed their mind and want earlier needs dropped.',
        },
      },
    },
    required: [],
    async run(args, ctx) {
      const products = await ctx.store.listProducts(ctx.tenant.id);
      const standing = await ctx.store.getWant(ctx.tenant.id, ctx.sessionId);
      const want = mergeWant(standing, wantFromArgs(args));

      const response = recommend({
        products,
        answers: ctx.answers,
        want,
        now: new Date().toISOString(),
      });

      // Stored even when nothing could be built. A refinement that produced no
      // option is still a requirement the visitor stated, and dropping it would
      // make the next turn quietly answer a different question.
      await ctx.store.saveWant(ctx.tenant.id, ctx.sessionId, want);

      const best = response.packages[0] ?? null;
      if (best) {
        // What the widget's "here are your options" moment fires on.
        ctx.events.push({ kind: 'recommendation_ready', detail: { recommendationId: best.id } });
      }

      return {
        ok: best !== null,
        data: {
          catalogue: response.catalogue,
          want: response.want,
          packages: response.packages.map(packageForModel),
          exclusions: response.exclusions,
          constraintsChecked: response.constraintsChecked,
          assumptions: response.assumptions,
          surveyConfirmed: response.surveyConfirmed,
          note: response.note,
        },
        summary: best
          ? `${response.packages.length} option(s). Best: ${best.title} — ` +
            `${money(best.totalMinor, best.currency) ?? 'one item has no price, so there is no total'}.`
          : response.note,
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
