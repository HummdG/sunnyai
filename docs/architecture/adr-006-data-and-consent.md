# ADR-006: Data and consent — what is written, where the tenant line is, and what a deletion request would take

- **Status:** Proposed (the store shape and the tenant boundary are decided and
  implemented; consent provenance, retention and data-subject handling are **not
  decided** — see Open questions)
- **Date:** 2026-10-10
- **Related:** ADR-002 (hosting), ADR-003 (agent runtime), ADR-004 (retrieval)

## Context

The plan (§3.1) puts the operational database on **Firestore** and lists a logical
entity set for it (tenants, memberships, installers, knowledge sources,
conversations, leads, and so on), with a privacy section (§9) covering consent,
minimisation and retention. This ADR records what the code actually persists, the
boundary that keeps tenants apart, and — plainly — where the plan's privacy
requirements are not met.

What is persisted today is a **single append-only file store**, behind an
interface, and nothing else. The tenant registry is in-memory seed data and is not
persisted at all.

## Decision

### 1. Two persisted record types, behind one interface

`Store` has five methods — `getConversation`, `appendTurn`, `saveLead`,
`listLeads`, `health` — and the only implementation is `FileStore`, which writes
newline-delimited JSON: one file per tenant per collection
(`apps/api/src/store.ts`).

- **`Conversation`** — `id`, `tenantId`, `sessionId`, `turns`, `createdAt`,
  `updatedAt` (`store.ts`).
- **`ConversationTurn`** — `role` (`user | assistant`), `text`, `at`, a
  `clientMessageId` (user turns only), the `tools` the assistant used, and
  `answers` (`store.ts`).
- **`LeadRecord`** — `id`, `tenantId`, `sessionId`, `conversationId` (nullable),
  `name`, `email`, `phone`, `postcode` (all nullable), `summary`, `score`
  (nullable), `createdAt` (`store.ts`).

Two properties are load-bearing and documented as such:

- **Appends are idempotent on `clientMessageId`.** A retried POST with the same
  id is a no-op, so a flaky connection cannot duplicate a visitor's question in the
  transcript (`store.ts`, `appendTurn`).
- **Every record carries `tenantId`, and reads are scoped by it** (`store.ts`,
  header comment). This is what makes the boundary checkable in one place.

Qualification answers are stored as **structured data** on the turn, not
re-derived from the assistant's prose: "parsing a sentence back into an answer is
how a resumed session ends up re-asking a question, or worse, recording the wrong
one" (`store.ts`, `ConversationTurn.answers`; read back by `answersFromHistory` in
`apps/api/src/agent/agent.ts`).

### 2. The tenant boundary is the file boundary

One file per tenant, with sessions as lines inside it. The store's own comment
gives the reason: partitioning by tenant "is what makes the cross-tenant read
impossible to get wrong: the file boundary _is_ the tenant boundary"
(`store.ts`, `#conversationFile`). The reader re-checks anyway — a line whose
`tenantId` does not match the file it was found in is dropped, "a file written by
another tenant id must never be served" (`store.ts`, `#readConversations`).

Tenant identity never crosses to the client. The widget config endpoint returns
only the public shape, the tenant id is validated against a schema that forbids
free-form values (`/^t_[a-z0-9]{6,40}$/`, `packages/contracts/src/widget.ts`), and
the smoke script asserts the public config contains neither the SunScan slug nor
the internal tenant id (`scripts/smoke-api.mjs`). A session token carries only
`sessionId`, `tenantId` and an expiry — no name, no email, no free text
(`apps/api/src/sessions.ts`, `SessionClaims`).

### 3. Consent is a hard gate at the point of capture

`create_lead` and `request_callback` **refuse** unless the model's arguments
include `consent === true`, and each writes a refusal naming the reason
(`apps/api/src/agent/tools.ts`). The pipeline test asserts a lead without consent
is refused and that a consented lead is saved
(`apps/api/test/pipeline.test.ts`, "requires consent before creating a lead").

**But consent is only a gate, not a record.** `LeadRecord` has no consent field,
no consent timestamp and no source. The plan (§9) asks for consent that is
evidenced and auditable; the code stores the _effect_ of consent (a lead exists)
and not the _evidence_ of it (who consented, when, to what). That is a gap
recorded here rather than papered over.

### 4. Sessions are anonymous and short-lived

A widget session is anonymous — "no login, no cookie, nothing that survives the
visitor leaving the page" (`sessions.ts`). The token exists only so the server can
recognise a conversation it started and so a session cannot be adopted by guessing
an id. Lifetime is `SESSION_TTL_MS = 2 hours` (`sessions.ts`). Verification
returns `null` for anything invalid — wrong signature, wrong shape, expired or
absent — and "there is no path that treats an unverifiable token as a valid one"
(`sessions.ts`).

## Consequences

- **The store is real but not production.** It survives a restart and can be read
  back, but the code is explicit that "it is not the production store, and the
  interface exists so the swap to Firestore is a new implementation of these two
  methods rather than a rewrite of the routes" (`store.ts`, header comment). This
  is a **disclosed stub**, not an accident.
- **The store keeps everything, forever.** There is no retention policy, no
  expiry job and no deletion path. Files accumulate. `listLeads` reads from an
  in-memory array loaded at first use, so a very large corpus is also a memory
  concern, not only a compliance one (`store.ts`, `#leads`).
- **A conversation is rewritten in full on every append** — the whole conversation
  object is serialised as one line each time it changes, and the reader takes the
  last line per session ("the last write wins, so re-reading a file replays it and
  keeps the tail", `store.ts`, `#readConversations`). Two appends racing on the
  same session could therefore lose a turn. Today the pipeline test exercises the
  idempotent path, not a concurrent one.
- **Firestore, when it arrives, has verified limits to design against**
  (`docs/discovery-google-services.md` §7): a **1 MiB maximum document size**, a
  **20-level nesting limit**, **200 composite indexes per database by default
  (1000 with a raise)**, and a recommendation to prefer subcollections over
  unbounded arrays. A conversation modelled as one document with a growing `turns`
  array would hit the 1 MiB ceiling; the natural shape is sessions as documents
  and turns as a subcollection.
- **Deletion, if requested, is manual.** There is no API to remove a lead or a
  conversation. Because the store is append-only NDJSON, a data-subject request
  would mean editing the tenant's `.jsonl` files by hand, and — because the reader
  keeps the **last** line per session — the effective deletion of a conversation
  requires writing a tombstone or rebuilding the file, not just appending. This is
  a concrete, currently-unmet requirement under the plan's privacy section.
- **Nothing else is persisted.** Tenant configuration is in-memory
  (`DEMO_TENANT`, `apps/api/src/tenants.ts`); the Gemini key, the session secret
  and any SunScan URL come from the environment, not from a database. There is no
  credential store and no per-tenant secret table.

## Alternatives considered

- **A database now (Firestore).** Not adopted for the slice. The file store is
  enough to prove the vertical slice and its idempotency and isolation properties;
  the interface is the seam. The cost is that the swap has not been exercised, so
  its limits are read from the discovery doc rather than felt.
- **Storing the transcript as free-form messages only.** Rejected: answers are
  stored structured (`answers`) precisely so a resumed session does not re-parse
  prose.
- **Trusting the client's `origin` for tenant selection.** Rejected throughout:
  tenant comes from the public widget id, resolved server-side
  (`apps/api/src/tenants.ts`).
- **Storing the consent gate's inputs as free text.** Rejected in favour of a
  boolean gate — with the consequence, noted above, that the evidence is not kept.

## Open questions

- **Unknown — needs verification:** what retention period the business actually
  commits to, and against which dataset (conversations, leads, or both). Nothing in
  the code or the plan as read fixes a number, so no retention job can be written
  against it yet.
- What is the durable **consent record**? It needs at least: a timestamp, the
  policy/version consented to, and the disclosure the visitor saw. `LeadRecord`
  stores none of these today.
- How is a **data-subject request** served — delete, or export-plus-delete? And
  what identifies the subject, given sessions are anonymous and only leads carry
  an email? Undecided.
- Does the widget set any client-side storage at all? The contract and the code
  described here persist nothing in the browser, but a future "resume my chat"
  feature would create a new consent question.
- **Unknown — needs verification:** whether plan §9's privacy controls were
  intended to bind the production Firestore only once it exists, or apply to the
  file store as well. The code currently satisfies the tenant-isolation controls
  and none of the retention ones.
