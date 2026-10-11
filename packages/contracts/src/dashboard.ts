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
 *   - **usage** -> **absent entirely.** Nothing meters usage: there is no quota
 *     consumption counter, no token accounting per tenant, no request total kept
 *     over time. A "usage" block here would have to be invented, so there is none.
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
