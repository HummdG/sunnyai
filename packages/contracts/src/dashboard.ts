import { z } from 'zod';

/**
 * The installer's overview figures -- the numbers a dashboard opens on.
 *
 * The plan's §6.4 names five things the overview shows: "real conversations,
 * qualified leads, engagement, source health, usage". Three of those the store
 * can substantiate today and two it cannot, and the shape below is the honest
 * half rather than the plan's words with numbers invented underneath them:
 *
 *   - **real conversations** -> `conversations.started` and `.active`. Both count
 *     records, not estimates: a conversation is a transcript on disk.
 *   - **engagement** -> `engagement`. Turn counts, again records rather than a
 *     model of attention.
 *   - **qualified leads** -> `leads.captured` and `leads.withContact`. There is
 *     deliberately **no "qualified" count**, because nothing in this deployment
 *     qualifies a lead: both write paths set `score` to null on purpose ("a number
 *     the installer cannot interpret is worse than a blank"), so the honest figure
 *     is not 0 -- it is *absent*, and the field is absent too. A dashboard that
 *     printed "0 qualified leads" would be telling the most plausible kind of lie.
 *   - **source health** -> `knowledge.sources` is a *count* and is named as one.
 *     Health in the plan's sense -- is the sync running, did the last job fail --
 *     needs the Drive integration, which is blocked (see STATUS blocker 4), and a
 *     count of documents is not a substitute for it.
 *   - **usage** -> `usage`: what the model calls actually cost, in time and in
 *     tokens. It reports p50/p95 latency, token sums and call counts, grouped by
 *     the model that answered. There is still **no cost in currency** and no
 *     quota consumption counter, and the `usage` block's own doc comment says
 *     why the missing half is missing rather than guessed at.
 *
 * ## Denominators and ranges
 *
 * §12 asks for analytics "based on events, with clear denominators and date
 * ranges". Every count here is over records that carry a timestamp, filtered to
 * an explicit half-open window `[from, to)` in UTC, and every ratio names its
 * denominator in its own doc comment and returns **null rather than zero** when
 * that denominator is zero. A rate of "0" and a rate of "no data" are different
 * facts, and a dashboard that renders them the same way is the one place a missing
 * denominator becomes invisible.
 *
 * The two present-state counts (`knowledge.sources`, `catalogue.products`) are the
 * exception: a count of the documents an installer has is a state, not an event,
 * so it is deliberately *not* range-filtered, and it says so here rather than
 * leaving a reader to wonder why it is the only pair that does not move with the
 * window.
 */

/** The window every range-scoped figure was counted over, echoed back. */
export const dashboardRangeSchema = z.object({
  /** Inclusive start, ISO 8601 UTC. */
  from: z.string(),
  /** Exclusive end, ISO 8601 UTC. This is the instant the request was served. */
  to: z.string(),
  /** The width of the window in days, after the query's value was clamped. */
  days: z.number().int(),
});

/**
 * p50 and p95 over a set of model-call durations.
 *
 * Both percentiles are computed twice over the same calls: once for
 * time-to-first-token and once for the whole call. They answer different
 * questions and the gap between them is the point -- see `usage.latency`.
 *
 * Null when the set is empty, following the contract's rule: a percentile over
 * no calls is unknown, not zero. Within a `byModel` entry this cannot happen,
 * because a group exists only because a call created it; the fields are typed
 * permissively anyway so that "no measurements" has exactly one representation
 * in this file rather than two.
 */
export const modelLatencySchema = z.object({
  ttfbMsP50: z.number().nullable(),
  ttfbMsP95: z.number().nullable(),
  totalMsP50: z.number().nullable(),
  totalMsP95: z.number().nullable(),
});

export type ModelLatency = z.infer<typeof modelLatencySchema>;

/**
 * One model's calls within the window.
 *
 * The group key is `(provider, model)` and not the model alone, because the same
 * model name served by a different provider -- or by a scripted provider in a
 * test -- is a different thing being measured and averaging them together would
 * describe neither.
 */
export const modelUsageSchema = z.object({
  /** Which provider implementation served the calls (`gemini`, a scripted one). */
  provider: z.string(),
  /** The model identifier as the provider named it, or null when it names none. */
  model: z.string().nullable(),
  /** Calls in the window served by this provider and model. */
  calls: z.number().int(),
  /**
   * How many of those calls reported token counts.
   *
   * Carried alongside the sums because a sum of zero is ambiguous: it is what
   * "the provider reported nothing" produces, and it is also what "the provider
   * reported zero tokens" produces, and those mean different things about
   * whether the accounting is working at all.
   */
  callsWithTokens: z.number().int(),
  /** Input tokens summed over the calls that reported them; 0 if none did. */
  inputTokens: z.number().int(),
  /** Output tokens summed over the calls that reported them; 0 if none did. */
  outputTokens: z.number().int(),
  latency: modelLatencySchema,
});

export type ModelUsage = z.infer<typeof modelUsageSchema>;

/**
 * What the window's model calls cost in time and tokens -- §12's "p50/p95
 * latency and costs by tenant and model".
 *
 * ## Where the costs are
 *
 * The plan asks for latency **and costs**. Latency is here. Cost, as a figure in
 * currency, is **deliberately absent**, because nothing in this repository knows
 * any model's price and the plan forbids inventing one (see the `ModelCall`
 * docblock in `apps/api/src/store.ts`, which records the reasoning where the
 * data is written). A wrong cost is indistinguishable from a right one to the
 * person reading the dashboard, which makes it worse than no cost.
 *
 * What is here instead is everything a cost is *made of*: the tokens each
 * provider actually accounted, and the model that accounted them. Supply a real
 * rate and the multiplication is arithmetic; until then the token counts are
 * themselves factual and useful.
 *
 * ## Why two latencies
 *
 * `ttfbMs` is time to the model's first chunk and is the clean measure of model
 * responsiveness. `totalMs` is the whole call and includes tool execution, which
 * happens inside the stream. Read together they separate "the model got slow"
 * from "a tool got slow" -- a distinction a single number would erase, and the
 * reason a p95 over `totalMs` alone can move for a reason that has nothing to do
 * with the model.
 *
 * Both are **nearest-rank** percentiles: the reported number is always a call
 * that actually happened, never an interpolation between two of them.
 *
 * ## What is not counted
 *
 * Calls made before this field existed have no `call` on their turn and are not
 * counted, so a window reaching back past the first deployment that recorded
 * them under-reports rather than inventing. `calls` is therefore the honest
 * denominator for everything else in the block.
 */
export const dashboardUsageSchema = z.object({
  /** Assistant turns written in the window that recorded a model call. */
  calls: z.number().int(),
  /** How many of those reported token counts; see `byModel[].callsWithTokens`. */
  callsWithTokens: z.number().int(),
  /** Input tokens summed over the window's calls; 0 when none reported any. */
  inputTokens: z.number().int(),
  /** Output tokens summed over the window's calls; 0 when none reported any. */
  outputTokens: z.number().int(),
  /** Over every call in the window, all models together. */
  latency: modelLatencySchema,
  /**
   * The same figures per `(provider, model)`, most-used model first.
   *
   * Sorted by call count descending, then provider, then model, so the order is
   * total and a reader comparing two responses is comparing the same rows in the
   * same places. Empty when the window saw no calls.
   */
  byModel: z.array(modelUsageSchema),
});

export type DashboardUsage = z.infer<typeof dashboardUsageSchema>;

export const dashboardMetricsSchema = z.object({
  range: dashboardRangeSchema,
  conversations: z.object({
    /** Conversations whose first write fell in the window (`createdAt`). */
    started: z.number().int(),
    /**
     * Conversations with any write in the window (`updatedAt`).
     *
     * Not a superset of `started`, and not a subset either: a conversation opened
     * last month and continued today is `active` and not `started`, and one opened
     * today and abandoned is `started` and also `active` -- they last wrote when
     * they began. The two measure different things on purpose, and neither is
     * derived from the other.
     */
    active: z.number().int(),
  }),
  engagement: z.object({
    /** Visitor turns whose timestamp fell in the window. */
    visitorTurns: z.number().int(),
    /** Assistant turns whose timestamp fell in the window. */
    assistantTurns: z.number().int(),
    /**
     * `(visitorTurns + assistantTurns) / conversations.active`, rounded to three
     * decimals. Null when no conversation was active -- see the note at the top:
     * this is "no denominator", not "zero engagement".
     *
     * The denominator is `active` and not `started` because a turn counted in this
     * window belongs to a conversation that was written in this window, which is
     * what `active` counts. Dividing by `started` would make a conversation that
     * spans the window's edge drag the average down for no reason a reader could
     * reconstruct.
     */
    turnsPerActiveConversation: z.number().nullable(),
  }),
  leads: z.object({
    /** Enquiries filed in the window (`createdAt`). */
    captured: z.number().int(),
    /**
     * Captured enquiries carrying an email or a phone number -- the ones an
     * installer can actually act on.
     *
     * A subset of `captured`, so the two are read together: "38 enquiries, 31 with
     * a way to reply" is the sentence a sales team wants, and it needs both halves.
     */
    withContact: z.number().int(),
  }),
  /**
   * `leads.captured / conversations.started`, rounded to three decimals, or null
   * when nothing started in the window.
   *
   * The denominator is `conversations.started`, not `active`: the question is "of
   * the conversations that began, how many became an enquiry", and a conversation
   * that began before the window and converted inside it is not a conversion this
   * window can attribute to a start.
   */
  leadConversion: z.number().nullable(),
  knowledge: z.object({
    /** Documents the installer has today. A state, not a windowed count. */
    sources: z.number().int(),
  }),
  catalogue: z.object({
    /** Product rows the installer has today. A state, not a windowed count. */
    products: z.number().int(),
  }),
  usage: dashboardUsageSchema,
});

export type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>;

/**
 * The query the metrics route accepts.
 *
 * `days` is coerced rather than typed because a query string carries it as text,
 * and it is bounded: the upper bound keeps one request from being asked to count
 * an unbounded history, and the lower bound keeps a zero or negative window from
 * producing a range that ends before it starts. A value outside those bounds is a
 * **400, not a silent clamp**: a caller that asked for something impossible should
 * be told so rather than handed a different question's answer. When `days` is
 * absent the route uses its own default, which is a default and not a clamp -- the
 * response always echoes the window it actually used in `range`, so a caller never
 * has to guess which of the two happened.
 */
export const dashboardMetricsQuerySchema = z.object({
  tenantId: z.string().min(1),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export type DashboardMetricsQuery = z.infer<typeof dashboardMetricsQuerySchema>;
