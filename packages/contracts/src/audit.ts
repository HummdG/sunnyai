import { z } from 'zod';

/**
 * The audit trail: what a privileged caller did, recorded so it can be
 * reconstructed afterwards without the record becoming a second copy of the data
 * it is about.
 *
 * That last clause is the plan's §4 requirement ("audit events record privileged
 * changes and tool actions without unnecessarily copying sensitive user
 * content"), and it is enforced here by the *shape* rather than by discipline.
 * `detail` is a map whose values may be numbers or booleans and never strings, so
 * there is no field through which a visitor's email, an uploaded document's text
 * or a caller's search term could travel even by accident: copying content into
 * this record would take changing the schema's value type, which is a change a
 * reviewer sees in the diff. The strings that do appear are ids and vocabulary
 * the server owns -- tenant ids from the registry, source and job ids it minted,
 * tool names from the closed `TOOL_NAMES` list, the action and reason enums below
 * -- plus the request id Fastify generated. None of them is derived from a
 * request body.
 *
 * What is deliberately absent is as important as what is present: there is no
 * free-form `metadata`, no `message`, no `error`, and no `payload`. An audit
 * record that can hold a string will eventually hold somebody's email address --
 * someone adds `reason: error.message`, or the document's title because it seemed
 * useful at the time -- and the way to stop that is to leave no place to put it.
 */

/**
 * The acts this deployment records.
 *
 * This list is the audit's own vocabulary and it is closed, for the same reason
 * `TOOL_NAMES` is: a record whose action field can be anything is a log nobody
 * can count or alert on.
 *
 * **`leads.read` is the odd one out and it belongs here anyway.** The plan says
 * "privileged changes", and this is a read. But reading the lead list hands over
 * every visitor's name, email and phone in one response, which is the single most
 * consequential thing an admin credential can do to this deployment, and an audit
 * log that recorded the catalogue upload while staying silent about the customer
 * export would be answering a question nobody asks. The plan's phrase is a floor,
 * not a ceiling.
 */
export const AUDIT_ACTIONS = [
  /** An installer's price list replaced or appended to. `POST /v1/catalog/products`. */
  'catalogue.upload',
  /** One of an installer's documents created or replaced. `POST /v1/knowledge/sources`. */
  'knowledge.source.write',
  /** What happened to one ingestion job, read back. `GET /v1/knowledge/jobs/:id`. */
  'knowledge.job.read',
  /** The installer's entire enquiry list read out. `GET /v1/leads`. */
  'leads.read',
  /**
   * One enquiry erased, with the conversation it came from.
   * `DELETE /v1/leads/:leadId`.
   */
  'leads.delete',
  /**
   * One conversation erased, which is what erases a qualification record.
   * `DELETE /v1/conversation`, and the second half of a lead deletion.
   */
  'conversation.delete',
  /**
   * The retention sweep removed records that had reached the end of their window.
   *
   * A deletion nobody asked for is exactly the kind of act an audit trail exists
   * to explain, so the sweep writes one event per run that removed something --
   * `system` as the actor, since no person did it, with the counts in `detail`.
   */
  'retention.purge',
  /** The waitlist read out by the operator. `GET /v1/waitlist`. */
  'waitlist.read',
  /** Someone removed from the waitlist, at their request. `DELETE /v1/waitlist`. */
  'waitlist.delete',
  /**
   * The assistant invoked one of its tools that has an effect outside this
   * conversation.
   *
   * Only the effectful ones. A turn that consults the catalogue or searches the
   * installer's documents is already recorded on the turn itself -- every
   * assistant turn carries the tool names it used -- and copying every read into
   * the audit log would bury the handful of events that matter under the ones
   * that do not.
   */
  'agent.tool.invoke',
] as const;

export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

/**
 * How the attempt ended.
 *
 * - `permitted`: it happened.
 * - `denied`: the caller was not allowed to make it, and nothing was attempted.
 *   A refusal is recorded because "somebody tried and was turned away" is the
 *   event an incident review asks about first, and because a run of them is what
 *   a credential-stuffing attempt looks like from inside.
 * - `failed`: the caller was allowed and the act still did not complete -- a
 *   tenant that does not exist, a body that does not validate, a document with
 *   nothing in it to index. Kept apart from `denied` because they are different
 *   findings: one is about the caller, the other about the request.
 */
export const AUDIT_OUTCOMES = ['permitted', 'denied', 'failed'] as const;
export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

/**
 * Why a `denied` or `failed` event ended that way, from a closed list.
 *
 * Closed rather than free text, and not merely because the server's own messages
 * would be a place to put body content: these are the values an alert rule can be
 * written against, and "tell me when `bad_credential` spikes" needs the code to
 * be a name rather than a sentence.
 */
export const AUDIT_REASONS = [
  /** The credential was missing or wrong for this route. */
  'bad_credential',
  /** The caller named a tenant this deployment does not have. */
  'unknown_tenant',
  /** The body did not validate against the route's contract. */
  'invalid_request',
  /** The named thing does not exist -- a source id, a job id. */
  'not_found',
  /** The act was refused by its own rules, with the credential and body both fine. */
  'refused',
  /** Something unexpected. The detail is in the log line, not in this record. */
  'error',
] as const;
export const auditReasonSchema = z.enum(AUDIT_REASONS);
export type AuditReason = z.infer<typeof auditReasonSchema>;

/**
 * Who acted.
 *
 * `id` is null for both kinds today, and that is not an oversight: the only
 * privileged credential this deployment issues is a single deployment-wide admin
 * token, which identifies an installer's *deployment* and not a person. Recording
 * a name here would mean inventing one. The field exists now so that the day
 * dashboard authentication lands (blocker 4) the change is a populated field
 * rather than a schema migration, and so that the nulls in the meantime read as
 * "we cannot tell you who" rather than "nobody thought about it".
 */
export const AUDIT_ACTOR_KINDS = [
  /** The deployment admin token, or the session credential on a gated route. */
  'admin',
  /** The assistant itself, for a tool it chose to invoke. */
  'system',
] as const;
export const auditActorSchema = z.object({
  kind: z.enum(AUDIT_ACTOR_KINDS),
  id: z.string().nullable(),
});

/**
 * What the act was done to.
 *
 * `id` is the server's own identifier for the thing, or null where the thing has
 * none of its own -- a catalogue is the tenant's, so it is identified by the
 * event's `tenantId` rather than by an id of its own, and the lead list is the
 * tenant's whole list rather than one row.
 */
export const AUDIT_TARGET_KINDS = [
  'catalogue',
  'knowledge_source',
  'ingestion_job',
  'lead_list',
  /** The deployment-wide waitlist (`waitlist.ts`). `id` is always null. */
  'waitlist',
  /** One conversation, identified by its session id. Erased whole, or purged. */
  'conversation',
  /** A tool in the closed `TOOL_NAMES` list; `id` is the tool's name. */
  'tool',
] as const;
export const auditTargetSchema = z.object({
  kind: z.enum(AUDIT_TARGET_KINDS),
  id: z.string().nullable(),
});
export type AuditTarget = z.infer<typeof auditTargetSchema>;

export const auditEventSchema = z.object({
  /** Minted by the store, so an event is citable in a support thread. */
  id: z.string(),
  /**
   * The tenant the act was against, or null when the attempt was refused before
   * a tenant could be named -- a wrong admin token on a route that takes the
   * tenant in its body, for instance. Null is a fact about the attempt and is
   * kept rather than guessed at.
   */
  tenantId: z.string().nullable(),
  actor: auditActorSchema,
  action: auditActionSchema,
  target: auditTargetSchema,
  outcome: auditOutcomeSchema,
  /** Present on `denied` and `failed`; null on `permitted`. */
  reason: auditReasonSchema.nullable(),
  /**
   * The conversation a tool call belongs to, for `agent.tool.invoke`.
   *
   * A pseudonymous key rather than an identity: it is what the conversation store
   * is already keyed by, and it is what makes "which conversation was the callback
   * promised in" answerable. It is not a person and cannot be turned into one
   * without the conversation record, which this log deliberately does not copy.
   */
  sessionId: z.string().nullable(),
  /** Fastify's request id, so an event can be lined up with the log line. */
  requestId: z.string().nullable(),
  /**
   * Counts and flags about the act. Never content. See the note at the top.
   *
   * The type is the guarantee: a value here is a number or a boolean, so the
   * length of a document may be recorded and its text may not.
   */
  detail: z.record(z.string(), z.union([z.number(), z.boolean()])),
  /** ISO 8601, from the server's clock. */
  at: z.string(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

/**
 * An event as the API hands it back.
 *
 * `tenantId` is stripped, exactly as `publicProductSchema` strips it from a
 * catalogue row and for the same reason: the caller named the tenant in the
 * query, so the field tells them nothing they did not supply, and it is the key
 * these rows are stored under -- which is not a thing to put in a response body
 * if it is not needed there.
 */
export const publicAuditEventSchema = auditEventSchema.omit({ tenantId: true });
export type PublicAuditEvent = z.infer<typeof publicAuditEventSchema>;

export const auditEventsResponseSchema = z.object({ events: z.array(publicAuditEventSchema) });
export type AuditEventsResponse = z.infer<typeof auditEventsResponseSchema>;
