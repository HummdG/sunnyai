# ADR-003: Agent runtime — a provider interface that refuses rather than simulates, a Flash default, and the Pro-class gap

- **Status:** Accepted for the interface, the default model and the tool surface.
  **Proposed** for escalation routing, which is deliberately left undecided.
- **Date:** 2026-10-10
- **Related:** ADR-002 (hosting), ADR-004 (retrieval), ADR-006 (data)

## Context

The plan (§7.1) specifies a headless agent, "Gemini Flash-class default,
configurable escalation to a stronger Gemini model for difficult tasks", built
"with ADK on Cloud Run". The plan also lists the approved tool names (§7.1) and
states the overriding rule that a missing credential must be visible and never
simulated (§7.2, §9, §14).

The verified capability picture (`docs/discovery-google-services.md` §3) is the
constraint this ADR exists to confront:

| Class                | Exact model ID                       | Launch stage | Notes                             |
| -------------------- | ------------------------------------ | ------------ | --------------------------------- |
| Flash (default/fast) | `gemini-3.8-flash`                   | **GA**       | `global`, multi-region `us`, `eu` |
| Pro (strong)         | `gemini-3.1-pro-preview`             | **Preview**  | `global` only                     |
| Pro (strong, alt)    | `gemini-3.1-pro-preview-customtools` | **Preview**  | `global` only                     |
| Pro (older)          | `gemini-2.5-pro`                     | **GA**       | **retirement date 2026-10-20**    |
| Live (real-time)     | `gemini-3.8-live`                    | **GA**       | `us`, `eu`, `us-central1`         |

Put plainly: **the only generally-available Pro-class model is `gemini-2.5-pro`,
and it retires on 2026-10-20 — ten days after this ADR is dated. Its successor,
`gemini-3.1-pro-preview`, is Preview-only and `global`-only.** The discovery doc
records this as its own "could not verify" item #8: _"A GA Pro-class model that is
current and not retiring could not be confirmed."_

## Decision

### 1. A provider interface, and no simulated assistant

Everything above the model boundary takes a `ChatProvider`; everything below is
the only code that talks to a model (`apps/api/src/agent/provider.ts`). The
interface is `kind` + `model` + `stream(request): AsyncIterable<ChatChunk>`.

The critical choice is what an unconfigured deployment gets:

- `UnconfiguredProvider` — every call throws `ProviderUnavailableError`.
- The server selects it whenever `config.gemini` is undefined, i.e. whenever
  `GEMINI_API_KEY` is unset (`apps/api/src/server.ts`).
- The chat route then throws `not_enabled`, which maps to **HTTP 403**
  (`apps/api/src/server.ts`; `packages/contracts/src/errors.ts`
  `STATUS_FOR_CODE`).

There is deliberately **no mock provider shipped in the server**: "a fake that
answers persuasively is worse than an error, because nobody goes looking for it"
(`provider.ts`). The tests supply their own `ScriptedProvider`, so the fake lives
in `apps/api/test/pipeline.test.ts`, not in the product.

### 2. The default model

`GEMINI_MODEL` defaults to **`gemini-3.8-flash`** (GA), read once at boot
(`apps/api/src/config.ts`). The provider streams with
`ai.models.generateContentStream` from `@google/genai`
(`apps/api/src/agent/provider.ts`).

### 3. Escalation is left unset on purpose

`GEMINI_ESCALATION_MODEL` is **`undefined` by default**, and the reason is written
into the source: "the only GA Pro-class model (`gemini-2.5-pro`) retires
2026-10-20 and its successor is preview-only, so choosing one is a deliberate
operator decision rather than a default we can safely hard-code"
(`apps/api/src/config.ts`). `capabilityReport()` surfaces this honestly: with no
escalation model configured it reports `escalation.available = false` with the
reason "There is no GA Pro-class model that is not retiring, so this is left to
the operator" (`config.ts`), and `/healthz` returns that report
(`apps/api/src/server.ts`).

**Escalation is not wired beyond this.** `runTurn` never switches models; the
provider is constructed once from `config.gemini.model` and that is the model used
for every turn (`apps/api/src/server.ts` `getProvider`, `agent/agent.ts`). The
escalation setting is, today, a configuration surface and a health-report line,
not a routing behaviour. This is a **stub**.

### 4. The tool surface is closed and asserted

The approved tool set is the plan's list verbatim, in
`packages/contracts/src/events.ts` (`TOOL_NAMES`, 13 names). The implementations
live in `apps/api/src/agent/tools.ts`, and two invariants hold:

- **Every declared tool must be one the plan approved.** `assertToolSurfaceClosed()`
  returns any declaration not in `TOOL_NAMES` (`tools.ts`).
- **A model naming a tool the deployment did not offer is refused.** The guard
  sits in `runTurn` rather than in the Gemini provider, so it "holds for _every_
  provider" — otherwise "a scripted or future provider could push an undeclared
  tool name straight into the client's event stream" (`apps/api/src/agent/agent.ts`).
  The pipeline test asserts this with a `delete_everything` call
  (`apps/api/test/pipeline.test.ts`).

Tool arguments are validated before the implementation runs, and the model's
arguments are never authorisation: a tool that needs a tenant, a session or a
price reads it from the server-side `ToolContext`, not from the model
(`tools.ts`, header comment). Where a dependency is unreachable, the tool says so
rather than inventing a value — `retrieve_knowledge`, `search_catalogue`,
`recommend_packages`, `calculate_approved_estimate`, `start_sunscan_assessment`
and `get_sunscan_result` are all **stubs** that return `ok: false` with an
explanatory summary (`tools.ts`).

### 5. The framework is not ADK

`apps/api/package.json` depends on `fastify` and `@google/genai` — **not** on
`@google/adk`. The agent is a hand-rolled loop: build a system instruction from
the tenant's config (`agent/agent.ts` `buildSystemInstruction`), stream from the
provider, drain tool events into the SSE frame stream, and persist both halves of
the turn. The plan's "Start with ADK on Cloud Run" (§7.1) is **not** what the code
does; the code follows the narrower "structured tool invocation and server
validation" requirement and keeps the loop in-repo. Whether to adopt ADK is an
open question, informed by this verified fact: the ADK Agent Runtime deploy page
lists only **Python and Go v1.2.0** as supported — **TypeScript is not listed**,
so "deploy the TypeScript ADK to Agent Runtime" is **unverified**
(`docs/discovery-google-services.md` §2, item 2), and Agent Runtime's own GA/Preview
status is **not labelled** anywhere in the pages read (item 1). ADK TypeScript
itself is GA at v2.x and deployable to Cloud Run, which the code could already do
without it.

## Consequences

### What the Pro-class retirement means for escalation

The practical options are:

1. **Pin `gemini-2.5-pro` and migrate before 2026-10-20.** GA today, but the
   retirement is imminent and the plan forbids shipping an unverified dependency
   into production acceptance.
2. **Escalate to `gemini-3.1-pro-preview`.** The only Pro-class successor, but it
   is **Preview** (Pre-GA Offering Terms) and **`global`-only** — so an escalation
   would leave any per-region data-residency posture, which the Flash model can
   honour (`global`, `us`, `eu`) but the Pro model cannot.
3. **Do not escalate.** Ship a single Flash-class model and route "hard" turns to
   a human via `handoff_to_human` instead. This is the state the code is in by
   default and the only one that needs no Preview dependency.
4. **Wait for a GA successor** and keep the setting unset until one exists.

The code currently takes **option 3** and leaves the choice to the operator,
because it is a genuine decision the code should not make silently. It must be
made explicitly before escalation is turned on.

### Other consequences

- A tool failure is surfaced to the model as `{ ok: false, ... }` plus a one-line
  summary, and the model is told (in the system instruction) never to quote a
  figure that did not come from a tool call (`agent/agent.ts`). The pipeline test
  checks the instruction contains those rules
  (`apps/api/test/pipeline.test.ts`).
- Token usage is carried back as a `usage` chunk and in `message_finished`, so
  per-tenant cost dashboards have a real input (`provider.ts`, `chat.ts`).

## Alternatives considered

- **A mock provider for local development.** Rejected on the plan's explicit rule;
  the test suite's scripted provider covers the seam without shipping a fake.
- **Hard-coding an escalation model.** Rejected: any choice is either retiring or
  Preview, so a default would be a hidden risk. Left to the operator.
- **Adopting ADK now.** Not adopted. Its managed runtime does not list TypeScript
  as supported, so it buys little over the hand-rolled loop for a Cloud Run
  deployment.
- **Model Armor on the AI path.** Named in the plan (§9) as a control, but **not
  integrated** anywhere in the code. Its failure posture is **not documented**
  (fail-open vs fail-closed is **UNVERIFIED**, `docs/discovery-google-services.md`
  §5), so it must not be relied on for anything until that is resolved.

## Open questions

- **Unknown — needs verification:** whether the model IDs in the discovery doc
  (read from **Vertex AI** model pages) are served on the **API-key** path the
  code uses. The provider constructs `new GoogleGenAI({ apiKey })`
  (`apps/api/src/agent/provider.ts`); `GOOGLE_CLOUD_LOCATION` is read into config
  but is **not passed to the SDK**, and there is no Vertex project/ADC path. The
  discovery doc's model table is Vertex AI's; whether `gemini-3.8-flash` resolves
  identically over the API key is unverified.
- **Unknown — needs verification:** Model Armor fail-open vs fail-closed behaviour
  (`docs/discovery-google-services.md` §5, item 7), if it is adopted.
- **Unknown — needs verification:** whether ADK TypeScript can deploy to Agent
  Runtime (only Python and Go are listed), and Agent Runtime's GA/Preview status
  (`docs/discovery-google-services.md` §2, items 1–3).
- Should escalation, if enabled, be per-turn (the model decides), per-tenant, or
  operator-only? Undecided.
- The system instruction forbids inventing prices and claims to be human, and the
  tests assert both phrases are present — but there is no test that the _model's
  output_ actually obeys. Grounding is a retrieval problem (ADR-004), not a
  prompting one.
