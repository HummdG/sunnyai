# Sunny Workflows: Conversation builder becomes a Workflow builder

## Context

Today Studio's "Conversation" tab edits one solar question list (`tenant.config.conversation`). The chat runs it as soon as anything sounds like buying interest, and its first question is the address (hard-wired in `flow/resolve.ts` FIXED_START, `journey/journey.ts:143`, and `prompt.ts` `quoteJourneyRules()`), so the chat feels like a sales form. Solar is the only product: heat pumps appear only as a lifestyle tag. The widget sends Sunny only the site's origin, never the page path.

The owner wants:

- **Workflows.** Guided tasks inside a normal chat. Sunny ships ready-made ones (Solar quote, Heat pump quote, Battery quote) that installers switch on and edit. Installers can also build their own, from blank or by copying one. A promo is its own workflow with its own shorter question list.
- **Triggering.** A workflow starts when the visitor asks for it, or after a soft discovery step. Normal FAQ chat keeps working alongside. A mid-workflow question is answered, then Sunny gently re-asks the question it was on. "Not now" pauses the workflow and keeps its answers.
- **Soft start.** Two or three gentle discovery questions come first ("what are you looking for", "what matters most"), then Sunny suggests the matching workflow. Those answers carry over and aren't asked again.
- **Simpler solar flow.** Motivation first, address later, budget and finance optional.
- **Per-page availability.** Each workflow can appear on all pages or only on URL path patterns, for promo landing pages.
- **Engines.** The heat pump engine gives a priced estimate and a PDF: heat loss, pump size, installer price minus the £7,500 BUS grant, running cost vs today. A battery engine prices a battery for homes that already have solar.
- **Build order.** (1) runtime, (2) builder UI, (3) heat pump, (4) battery.

House rules apply:

- No em dashes in user-facing text or Sunny's replies.
- The server decides every step; the LLM only words it.
- Existing tenant flows must keep working.

Per-phase implementation plans live in `docs/superpowers/plans/`.

---

## Phase 1: Workflow runtime, soft start, page rules

### 1a. Contracts

**New `packages/contracts/src/workflow.ts`**

```ts
type WorkflowKind = 'solar_quote' | 'heat_pump_quote' | 'battery_quote' | 'custom';
type QuoteEngine = 'solar' | 'heat_pump' | 'battery';
type WorkflowOutcome = { kind: 'quote'; engine: QuoteEngine } | { kind: 'lead' };
type DiscoveryInterest = 'solar' | 'battery' | 'heating' | 'ev_charger' | 'not_sure';
interface PageRule {
  include: string[];
  exclude: string[];
} // include [] = all pages; path globs, no regex
interface Workflow {
  id /* wf_* */;
  kind;
  name;
  enabled;
  description;
  triggers: string[];
  interests: DiscoveryInterest[];
  pages: PageRule;
  steps: FlowStep[];
  outcome: WorkflowOutcome;
  template: { id; version } | null;
  version: number;
  updatedAt: string;
}
interface WorkflowSet {
  version;
  updatedAt;
  discovery: { enabled: boolean };
  workflows: Workflow[];
}
export function pathMatches(rule: PageRule, path: string | null): boolean; // shared by API and Studio
```

The rest of the contract:

- **Schema rules:**
  - A built-in kind must use its own engine outcome.
  - Each built-in kind appears at most once.
  - Workflow ids are unique, and custom step ids are unique across the whole set (answers share one map).
  - Limits: 12 workflows, 8 triggers, 20 page patterns.
- **`conversation-flow.ts`:** `FlowStep` gains `optional?: boolean`.
- **`chat.ts`:** `chatRequestSchema` gains `page?: { path }`, and `sessionRequestSchema` gains `path?`.
- **`events.ts` `TOOL_NAMES`:** add `start_workflow`, `get_workflow_step`, `save_workflow_answers`, `pause_workflow`. The old names stay in the enum so stored transcripts still parse.
- **Lead contract:** gains optional `workflowId`.

### 1b. API core

- **`flow/banks.ts` (new): `QuestionBank`.** It holds `{questions, fixedStart, followers, groups, defaultSteps}`. The banks:
  - `LEGACY_SOLAR`: today's behaviour, used by `resolveFlow(null)` for parity.
  - `SOLAR`: no fixed start. The follower `address -> [roof_confidence, roof_confirmed]` makes the roof checks follow the address wherever it sits.
  - `DISCOVERY`: `disc_interest` plus a neutral `motivation`, with `comfort` added to its options.
  - `HEAT_PUMP` and `BATTERY`: added in later phases.

  Shared presets (`address`, `property_type`, `ownership`, `household_size`, `motivation`) keep the same ids, so answers carry between workflows.

- **`flow/resolve.ts`:** `resolveFlow(stored, bank = LEGACY_SOLAR)` uses `bank.*` in place of the module constants, emits followers after their anchor, and adds `optional`. It also gets `required(answers)`. `validate` accepts `skipped` for optional questions.
- **`journey/journey.ts` `journeyStatus`:** drop the "address first" override, so the next question is the first askable one in resolved order. `canQuote` uses `required()`.
- **`journey/service.ts`:** `JourneyDeps.flow` becomes a function returning the active workflow's resolved flow. `submitAnswers` and `createQuote` are otherwise unchanged.
- **New `apps/api/src/workflows/`:**
  - `templates.ts`: the simplified Solar template, in this order:
    - motivation
    - property_type, ownership
    - address + roof
    - shading
    - usage
    - lifestyle, tariff, existing
    - budget (optional), finance (optional)

    Also the heat pump and battery templates, which ship disabled until their phase lands.

  - `tenant.ts`: `workflowsForTenant(tenant, warn)` replaces `flowForTenant`.
    - **Lazy migration.** When `config.workflows` is absent, build the set from the templates. A tenant with a stored `config.conversation` keeps its exact order: the solar workflow's steps are `[address preset, ...conversation.steps]`.
    - **Bad data.** An unparseable set warns and falls back to the templates.
    - **First save.** The first save writes `config.workflows` and leaves `config.conversation` in place for rollback.
  - `session.ts` (pure): `start`, `pause`, `resume`, `complete`, `available(set, path)` and `suggest(set, answers, path)`.
    - One workflow is active at a time. Starting B pauses A.
    - A workflow with a specific page pattern beats an all-pages one, so a promo page suggests its promo.
  - `status.ts`: `workflowStatus` dispatches on outcome: solar to `journeyStatus`, lead to a generic resolved-flow view ending `ready_for_lead`. Heat pump and battery are added later. `toFlow(workflow)` lets `effectsFor`, `checkFlow`, `extract` and `flowFieldsFor` run unchanged.
  - `agent-tools.ts`: replaces `QUOTE_TOOLS`; `get_quote_options` is kept and dispatches on the engine.

    | Tool                                              | Behaviour                                                                                                                                   |
    | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
    | `start_workflow {workflowId}`                     | Refuses a workflow that is disabled or not on this page. Resumes a paused one.                                                              |
    | `get_workflow_step`                               | Today's `get_quote_journey` view plus `workflow`, `optional` and quick replies.                                                             |
    | `save_workflow_answers {answers, visitorMessage}` | Today's `save_answers`. Starts SunScan on the server as soon as the address is accepted, so the roof measures while the questions continue. |
    | `pause_workflow {reason}`                         | Moves the active workflow to paused.                                                                                                        |
- **Session state.** `store.ts`: `Conversation.workflow?: WorkflowSession`.
  - Shape: `{active, paused[], completed[], discovery: {status, suggestedWorkflowId}, lastPath}`.
  - Store methods `getWorkflowState` / `saveWorkflowState` in the File, Firestore and memory stores, modelled on `saveWant`.
  - A matching case in `store-contract.ts`.
- **Channel allowlist.** `agent/channels.ts`: the chat allowlist swaps the old tool names for the new ones.
- **Leads.** `create_lead` and `request_callback` stamp `workflowId` and use the active workflow's flow for `flowFieldsFor`.
- **Bug fix.** `/v1/qualification/answer` (`server.ts:879`) uses the active workflow's flow instead of the global `validateAnswer`.

### 1c. Turn wiring, prompt, widget

- **Page path.** `server.ts` chat route reads `body.page?.path`, normalises it (path only, at most 512 characters), saves it to `lastPath`, and passes `pagePath` to `runTurn`.
- **Turn context.** `agent.ts`: `ctx` gains `workflows`, `session` and `pagePath`. `ctx.flow` is the active workflow's flow, or the solar workflow's when none is active.
- **State block.** `prompt.ts`: a new server-authored `<workflow_state>` block in the message sandwich, with installer text escaped and never put in the system instructions. It lists:
  - the active workflow and its current question
  - paused workflows and whether resume was offered
  - workflows available on this page, with their descriptions
  - discovery status and suggestion
  - a `likely: wf_x` hint when a trigger phrase matches the visitor's message
- **Prompt rules.** `quoteJourneyRules()` becomes `workflowRules()`:
  - No address-first.
  - Start a workflow only through `start_workflow` with an available id.
  - When intent is vague, run discovery gently, then suggest the workflow.
  - When an FAQ comes up mid-workflow, answer it, then re-ask the current question in one short sentence.
  - On "not now", call `pause_workflow` and say the answers are kept.
  - Offer resume once only.
  - Optional questions get a "skip" reply.
  - No em dashes.

  `fallbackLine()` changes to the neutral "one of our specialists".

- **Backstops in `agent.ts` after the stream.**
  - If a workflow is active and no workflow tool emitted quick replies this turn, re-emit them for the current question. This keeps the buttons after an FAQ detour.
  - `noteForSilence` reads `ask` from the new tools.
  - Set `resumeOfferedAt` once the resume offer has been shown.
- **Widget.** `packages/widget/src/chat.ts` `send()` adds `page: { path: location.pathname }` on every message, which covers single-page-app navigation. `#openSession` sends `path`. Both are optional, so older widgets and servers keep working.

## Phase 2: Builder UI

- **API.** New `apps/api/src/routes/workflows.ts` under `/v1/portal/tenants/:id/workflows`:

  | Method and path                            | Purpose                                                                                                    |
  | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
  | `GET`                                      | List, with issues and the discovery toggle                                                                 |
  | `POST` `{from: template \| blank \| copy}` | Create                                                                                                     |
  | `GET`, `PUT`, `DELETE` `/:wid`             | Read, save, delete. PUT has a per-workflow version check (409). Built-ins can be disabled but not deleted. |
  | `POST /:wid/reset`                         | Restore from its template                                                                                  |
  | `POST /:wid/preview`                       | Takes `{answers, path}`                                                                                    |
  | `POST /:wid/suggest`                       | Effect suggestions                                                                                         |

  It reuses `view()`, `presetViews` (now per bank), `priceItemViews`, `describeEffect` and `suggestEffects` from `routes/conversation.ts`. `flow/check.ts` gains `checkWorkflow`, which checks:
  - an engine outcome has that engine's required presets
  - page patterns are valid
  - warns when two enabled workflows overlap on interest and pages

  The `/conversation` routes stay as a shim over the solar workflow, then are removed.

- **Marketing.**
  - `app/dashboard/studio/page.tsx`: the tab becomes "Your workflows", with `?tab=conversation` kept as an alias.
  - New `components/dashboard/workflows/`:
    - `workflow-list.tsx`: cards with an on/off toggle, kind badge and "appears on" summary
    - `new-workflow.tsx`: template, blank, or copy
    - `workflow-settings.tsx`: name, description, triggers, interests, outcome
    - `page-rules.tsx`: all pages vs only these pages, include and exclude chips, and a "test a URL" box using `pathMatches`
  - `conversation/editor.tsx`: refactor `ConversationEditor` to take `source: {load, save, reset}` and `bank` props. `model.ts` `draftFrom` uses the bank's presets, and the fixed-start lock becomes "an address is required for quote outcomes".
  - `chat-preview.tsx` gains a page-path field.
  - `lib/portal-api.ts` gains the workflow client functions.
  - A discovery on/off toggle on the list page.

## Phase 3: Heat pump quote + PDF

- **Engine.** New pure package `packages/heat-pump-engine`, with the same layout as `packages/quote-engine`:
  - Modules: `heat-loss`, `demand`, `sizing`, `running-cost`, `bus`, `nation`, `options`.
  - Dated data tables: fabric W/m² by age band, design temperatures, fuel prices, BUS rules.
  - How it works out the estimate:
    - **Heat loss:** the age-band rate adjusted for walls, loft and glazing, times (21 minus the design temperature), times floor area. When floor area is unknown, fall back to bedrooms.
    - **Annual demand:** from the same table, plus hot water.
    - **Pump size:** the smallest standard kW that is at least the peak heat loss.
    - **Running cost:** SCOP from emitters and age, compared with today's fuel. Regional electricity rates reuse `quote-engine/src/data/regional-tariffs.ts`.
    - **BUS grant:** £7,500 when the home is in England or Wales, owned, replacing fossil or direct-electric heating, and the EPC check isn't "no". Border postcodes count as "unsure". Verify the rules against current Ofgem guidance during the build.
- **Catalogue.** Add `heat_pump` and `heat_pump_install` price categories and a `kw` unit to `catalogue/price-list.ts`. Add a `heat_pump` product category with `capacityKw` to `contracts/catalogue.ts`.
- **Pricing and service.**
  - `journey/heat-pump/pricing.ts`: builds heat pump pricing from the published price list (reusing `priceFor`). BUS appears as a separate deduction line. With no units priced, the result is unpriced: "Priced by your installer".
  - `HEAT_PUMP` bank: shared presets plus `hp_age`, `hp_floor_area` (optional) / `hp_bedrooms`, `hp_walls`, `hp_loft`, `hp_glazing`, `hp_current_heating`, `hp_emitters`, `hp_hot_water`, `hp_annual_spend` (optional), `hp_epc` (optional), `hp_outdoor_space`.
  - `journey/heat-pump/{status,service}.ts`: `hpStatus` and `createHeatPumpQuote`. It reuses the snapshot, warranties and brand assets from `createQuote`.
- **Quote record.** `QuoteRecord` becomes a union with `kind`. Solar-only call sites narrow with an `isSolarQuote` guard. `quoteCardSchema` gains `kind`, and a missing kind reads as solar.
- **PDF.** `proposal/index.ts` dispatches on `kind`. New `proposal/heat-pump/{system,running-costs,grant,quotation}.ts` reuse the cover, terms and layout. The disclaimer says an MCS MIS 3005 survey is required.
- **Widget and template.** A heat pump quote card in the widget: kW, price before and after the grant, running cost vs today. Enable the heat pump template.

## Phase 4: Battery quote (for homes with solar)

- **Engine.** `packages/quote-engine/src/battery/` (new). Reuse the existing battery tiers, retrofit prices and `batteryCapacityKwh` logic from `recommend/` and `pricing-source.ts`.
  - Inputs: existing PV size (kWp, or panel count, or unsure), annual usage, tariff (including time-of-use), EV, home in the daytime, goal (bill savings / backup / tariff shifting), inverter type (hybrid or not, for the AC-coupled extra).
  - Outputs: up to three capacities, priced with the installer's retrofit prices, plus yearly savings from extra self-consumption and tariff shifting.
- **API.** A `BATTERY` bank, `journey/battery/{status,service}.ts`, `quoteCardSchema` kind `battery`, and PDF pages under `proposal/battery/`. Enable the battery template. It becomes the obvious base for battery promo workflows.

---

## Tests (Vitest; `npm test`, single file `npx vitest run <path>`)

- **Contracts:** `workflow-contract.test.ts`: schema rules, `pathMatches` (globs, exclude, null path), worst-case size.
- **Migration:** `workflow-migrate.test.ts`. A stored flow maps to the solar workflow in the same order. For about 30 answer maps, legacy `next` equals migrated `next`. A broken set falls back to the templates.
- **Resolver:** `flow-resolve` (extend). `resolveFlow(null)` is unchanged; followers come after the address; optional questions are left out of `required`.
- **Session:** `workflow-session.test.ts`. Start, pause, resume; only one active; page filtering; suggestion ranking.
- **Chat:** `workflow-chat.test.ts` (ScriptedProvider).
  - Vague opener: discovery runs, then a suggestion.
  - Direct ask: the workflow starts with motivation, not address, and discovery answers are not asked again.
  - FAQ mid-workflow: quick replies re-emitted for the current question.
  - Pause: resume offered exactly once.
  - Page-restricted workflow: refused off-page.
  - Address saved: SunScan starts.
  - Lead-outcome custom workflow: lead carries `workflowId`.
- **Updated tests:** move `flow-chat`, `quote-journey`, `tools` and `flow-leads` to the new tool names. Add a qualification-route regression test.
- **Store:** `store-contract.ts` round-trips the workflow state.
- **No em dashes:** `no-em-dash.test.ts` scans the templates, discovery prompts, tool text and prompt output.
- **Routes:** `workflow-routes.test.ts` covers CRUD, reset, 409, viewer read-only and the shim.
- **Phase 3:** engine golden tests (heat loss, sizing, BUS cases: Scotland, renter, existing heat pump, TD postcode), `heat-pump-journey.test.ts`, and `proposal-heat-pump.test.ts` (PDF text including the grant line).
- **Phase 4:** battery engine golden tests, `battery-journey.test.ts`, `proposal-battery.test.ts`.
- **Marketing:** `workflow-model.test.ts` covers the draft model with banks and page rules.
- **End to end:** run `npm run verify`. Then run the app locally with the run skill and try these by hand:
  - a vague opener leads to discovery and a suggestion
  - an FAQ mid-quote leads back to the question
  - a promo page shows only its workflow
