# Quote Conversation Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each installer shapes Sunny's route to a quote in Studio (remove, reword, add, reorder, follow-ups), and answers change the quote through add, remove and swap effects on the installer's own price list.

**Architecture:** A stored per-tenant `ConversationFlow` (contracts) is resolved on the server into a `ResolvedFlow` that offers the same API today's `questionnaire.ts` offers over the global `QUESTIONS`; the chat path takes the tenant's resolved flow, the host-page route keeps the default. Answer effects become a `SystemConfig` transform passed into the quote engine through a new optional `adjustConfig` hook, so price, generation and savings are all computed from the adjusted kit. Studio gets a three-panel editor (list, diagram, preview) backed by new portal routes.

**Tech Stack:** TypeScript, zod 4 (contracts), Fastify 5 API, `@sunny/quote-engine`, Next.js 16 Studio (React), Vitest, Playwright (chromium).

**Spec:** `docs/superpowers/specs/2026-11-09-quote-flow-editor-design.md`

## Global Constraints

- Prices only from the installer's **published** price list through the existing pricing path (`pricingFromPriceList` / engine); never a figure from the request, never interpolated.
- Fixed start: `address`, `roof_confidence` (system-set), `roof_confirmed`. Fixed end: quote, consent, contact. Neither can be removed or moved.
- Effects: add, remove, swap only. Items marked `mandatory` can never be an effect's target. A swap whose source item is not in a package does nothing to that package.
- Preset answers: labels rewordable, values fixed (no adding or deleting preset options).
- A follow-up always comes after its parent question.
- Quantity: per panel, per kWp and per battery kWh come from the package; any other unit needs a fixed quantity set in the editor, or the effect cannot be saved.
- The host-page route `POST /v1/qualification/answer` keeps the default (SunScan) question set.
- Leads keep stable question ids and values under the installer's wording.
- New portal routes join the cross-tenant sweep in `tests/security/tenant-isolation.test.ts`.
- Every plan; admin and owner edit, viewer reads.
- No em dashes in any user-facing text.
- `npm run typecheck` and `npm run lint` need `NODE_OPTIONS=--max-old-space-size=8192`.

## Review Focus

1. **A visitor mid-conversation when the installer saves a new flow**: answers already given stay; questions now removed are not asked; a quote uses the flow in force when it is built. (Task 5 test.)
2. **A stored flow that no longer matches the price list** (item deleted, item made mandatory after linking): Sunny skips that effect, the quote carries a warning naming it, Studio flags the question. (Tasks 3 and 4 tests.)
3. **Two answers whose effects collide** (both add the same item; one removes what another adds): applied in flow order, an item is never added twice. (Task 4 test.)
4. **A typed reply that matches no choice of an added question**: Sunny asks again and stores nothing. (Task 5 test.)
5. **A flow with every price-dependent preset removed**: still quotes, with every figure from engine defaults listed in `estimatedFrom`. (Task 4 test.)

---

## File Structure

- `packages/contracts/src/conversation-flow.ts` (new): the stored flow schema and types.
- `apps/api/src/flow/presets.ts` (new): preset metadata (which presets are fixed, which feed the price, removal warning copy).
- `apps/api/src/flow/resolve.ts` (new): `resolveFlow` and the `ResolvedFlow` API (ordering, applicability, validation, reconciliation, labels).
- `apps/api/src/flow/check.ts` (new): `checkFlow` against a published price list.
- `apps/api/src/flow/effects.ts` (new): `effectsFor` and `applyEffects` (`SystemConfig` transform).
- `packages/quote-engine/src/recommend/optionTypes.ts`, `buildOptionSet.ts` (+ `buildBudgetLadder.ts` if it builds configs): `adjustConfig` hook.
- `apps/api/src/journey/quote.ts`, `journey.ts`, `extract.ts`, `agent-tools.ts`, `apps/api/src/agent/tools.ts`: take a `ResolvedFlow`.
- `apps/api/src/routes/conversation.ts` (new): portal routes.
- `apps/api/src/tenants.ts`: `Tenant.config.conversation?: ConversationFlow`.
- Lead record and lead email/dashboard: `flowAnswers`.
- `apps/marketing/components/dashboard/conversation/*` (new): the editor.

---

### Task 1: The flow contract

**Files:**
- Create: `packages/contracts/src/conversation-flow.ts`
- Modify: `packages/contracts/src/index.ts` (export)
- Test: `packages/contracts/test/conversation-flow.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FlowEffect =
    | { kind: 'add'; itemKey: string; quantity?: number }
    | { kind: 'remove'; itemKey: string }
    | { kind: 'swap'; fromKey: string; toKey: string; quantity?: number };
  export interface FlowChoice { value: string; label: string; effects: FlowEffect[] }
  export type FlowStep =
    | { kind: 'preset'; id: string; prompt?: string; labels?: Record<string, string>;
        effects?: Record<string, FlowEffect[]>; followUps?: FlowFollowUp[] }
    | { kind: 'custom'; id: string; prompt: string; mode: 'quote' | 'lead';
        answer: 'choice' | 'text'; choices: FlowChoice[]; followUps?: FlowFollowUp[] };
  export interface FlowFollowUp { when: string[]; step: FlowStep }   // `when` = parent answer values
  export interface ConversationFlow { version: number; updatedAt: string; steps: FlowStep[] }
  export const conversationFlowSchema: z.ZodType<ConversationFlow>;
  export const CUSTOM_ID: RegExp; // /^c_[a-z0-9]{6,24}$/
  export const FLOW_LIMITS = { steps: 60, choices: 12, followUpDepth: 2, promptChars: 300, labelChars: 80 };
  ```
  `steps` lists the middle section only (fixed start and end are implied). A preset absent from `steps` is removed.

- [ ] **Step 1: Write the failing tests** in `conversation-flow.test.ts`:
  - `accepts a flow with a preset rewording, a custom quote question with an add effect, and a follow-up`.
  - `refuses a custom question in quote mode with free-text answers` (`mode: 'quote', answer: 'text'` fails).
  - `refuses follow-ups nested deeper than 2`.
  - `refuses a custom id that does not match c_[a-z0-9]{6,24}`.
  - `refuses a prompt over 300 characters and a label over 80`.
  - `refuses an add with quantity 0 or a fraction` (quantity is a positive integer).
- [ ] **Step 2: Run** `npx vitest run packages/contracts/test/conversation-flow.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the schema with `z.lazy` for `FlowStep` and `FlowFollowUp`; depth checked with `superRefine`; text fields trimmed, non-empty.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): the conversation flow schema`.

### Task 2: Presets and the resolved flow

**Files:**
- Create: `apps/api/src/flow/presets.ts`, `apps/api/src/flow/resolve.ts`
- Modify: `apps/api/src/questionnaire.ts` (re-implement its exported functions over `resolveFlow(null)`, keeping signatures)
- Test: `apps/api/test/flow-resolve.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `QUESTIONS`, `OPTION_LABELS` from `questionnaire.ts`.
- Produces:
  ```ts
  // presets.ts
  export const FIXED_START = ['address', 'roof_confidence', 'roof_confirmed'] as const;
  export const PRESET_WARNINGS: Readonly<Record<string, string>>; // removal warning per price-dependent preset
  export const PRESET_GROUPS: Readonly<Record<string, readonly string[]>>; // e.g. usage_source -> [annual_kwh, monthly_cost, household_size]; roof_size/roof_direction travel together
  // resolve.ts
  export interface ResolvedQuestion { id: string; prompt: string; options: string[] | null;
    multi: boolean; numeric: NumericRule | null; freeText: boolean; mode: 'quote' | 'lead' | 'preset';
    parent: { id: string; anyOf: string[] } | null; label(value: string): string }
  export interface ResolvedFlow {
    custom: boolean;                 // false for the default flow
    questions: ResolvedQuestion[];   // fixed start, then middle in order (follow-ups right after their parent)
    removedPresets: string[];
    question(id: string): ResolvedQuestion | undefined;
    applicability(id: string, answers: Record<string,string>): Applicability;
    outstanding(answers: Record<string,string>): string[];
    next(answers: Record<string,string>): string | null;
    validate(id: string, value: string, answers?: Record<string,string>): AnswerVerdict;
    reconcile(answers: Record<string,string>): { answers: Record<string,string>; dropped: DroppedAnswer[] };
  }
  export function resolveFlow(stored: ConversationFlow | null | undefined): ResolvedFlow;
  ```
- `PRESET_WARNINGS` copy (exact):
  - `roof_shading`: "Sunny uses this to allow for shade. Without it, quotes assume no shading, so generation and savings may be too high."
  - `roof_size`: "Sunny uses this when it cannot map the roof. Without it, quotes assume a medium roof."
  - `roof_direction`: "Sunny uses this when it cannot map the roof. Without it, quotes assume a south-facing roof, so savings may be too high."
  - `usage_source`: "Sunny uses this to work out savings. Without it, quotes use a typical UK household's usage, so the savings figures will be rougher."
  - `lifestyle`: "Sunny uses this to judge whether a battery and Sentinel suit the home. Without it, those recommendations are more general."
  - `tariff_type`: "Sunny uses this for savings and Sentinel. Without it, quotes assume a standard tariff."
  - `existing_system`: "Sunny uses this to spot homes that already have solar or a battery. Without it, quotes assume a new installation."
  - `budget_band`: "Sunny uses this to flag packages over budget. Without it, no package is flagged."

- [ ] **Step 1: Write the failing tests:**
  - `the default flow asks exactly what questionnaire.ts asks today`: for each answer map in a table of 8 maps (empty; address only; low roof confidence; usage household; lifestyle ev_now; everything answered; a conflicting monthly_cost after household; a pending annual_kwh), `resolveFlow(null).next/outstanding/validate/reconcile` equal the pre-change results (record them from the current module first, as literal expectations).
  - `a removed preset is never asked`; `removing usage_source removes its follow-ups too`.
  - `a reworded preset keeps its values and shows the new label`.
  - `a custom question sits where the installer put it, and its follow-up comes right after it, only when its parent's answer matches`.
  - `the fixed start comes first whatever the stored order` and `a stored flow cannot remove roof_confirmed` (it is ignored if listed as removed).
  - `a custom choice question refuses a value that is not one of its choices` (verdict `ok: false`, `allowed` = choice values).
  - `a lead text question accepts any text up to 500 characters`.
  - `reconcile drops a follow-up answer when its parent answer changes`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/flow-resolve.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `presets.ts` and `resolve.ts`; then make `questionnaire.ts`'s `applicability`, `outstandingQuestions`, `nextQuestion`, `reconcile`, `validateAnswer` delegate to a module-level `resolveFlow(null)` (signatures unchanged, so existing callers and tests keep working).
- [ ] **Step 4: Run** `npx vitest run apps/api/test/flow-resolve.test.ts apps/api/test/questionnaire*.test.ts apps/api/test/journey*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): resolve an installer's conversation flow`.

### Task 3: Checking a flow against the price list

**Files:**
- Create: `apps/api/src/flow/check.ts`
- Test: `apps/api/test/flow-check.test.ts`

**Interfaces:**
- Consumes: `ConversationFlow`; `PriceList`, `PriceItem` from `apps/api/src/catalogue/price-list.ts`.
- Produces:
  ```ts
  export interface FlowIssue { stepId: string; choice?: string; code:
    'missing_item' | 'mandatory_item' | 'not_targetable' | 'needs_quantity' | 'bad_parent' | 'duplicate_id';
    message: string }   // plain English, shown in Studio
  export function checkFlow(flow: ConversationFlow, list: PriceList | null): FlowIssue[];
  export const PACKAGE_UNITS: readonly string[]; // ['panel','kwh'] plus kWp if the list has it
  ```
  Not targetable: categories `pv` and `panel_uplift`, and pricing kind `quote_only`. Messages, exact:
  - missing_item: "{item} is no longer on your price list."
  - mandatory_item: "{item} is on every quote, so an answer cannot remove or swap it."
  - not_targetable: "{item} is part of the system price, so an answer cannot change it."
  - needs_quantity: "Set how many {unit}s of {item} to add."
  - bad_parent: "This follow-up's question is no longer in the conversation."
  - duplicate_id: "Two questions share the same id."

- [ ] **Step 1: Write the failing tests**, one per code above, plus `a flow with no effects and no price list has no issues` and `an effect on a per-panel item needs no quantity`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/flow-check.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `checkFlow`.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): check a conversation flow against the price list`.

### Task 4: Answer effects in the quote

**Files:**
- Create: `apps/api/src/flow/effects.ts`
- Modify: `packages/quote-engine/src/recommend/optionTypes.ts` (add `adjustConfig?: (config: SystemConfig) => SystemConfig` to `OptionSetInput`), `packages/quote-engine/src/recommend/buildOptionSet.ts` (apply it to each preset before candidates are built; also wherever `buildBudgetLadder.ts` builds its own configs), `apps/api/src/journey/quote.ts` (`buildQuote` input gains `flow?: ResolvedFlow`; record gains `estimatedFrom: string[]`; effect warnings appended to `warnings`), `apps/api/src/journey/journey.ts` (`journeyStatus` and `quoteAnswers` take a `ResolvedFlow`, default `resolveFlow(null)`).
- Test: `apps/api/test/flow-effects.test.ts`, `packages/quote-engine/test/adjust-config.test.ts`

**Interfaces:**
- Consumes: Task 2 `ResolvedFlow`, Task 3 rules; `SystemConfig`, `PricingCatalogue` from `@sunny/quote-engine`.
- Produces:
  ```ts
  export interface AppliedEffect { effect: FlowEffect; questionId: string; value: string }
  export function effectsFor(flow: ConversationFlow | null, answers: Record<string,string>): AppliedEffect[]; // flow order
  export function applyEffects(config: SystemConfig, effects: AppliedEffect[], catalogue: PricingCatalogue,
    warn: (message: string) => void): SystemConfig;
  ```
  Routing by catalogue: a panel item sets `panelSku`, an inverter sets `inverterSku`, a battery sets or clears `battery`, a mounting item sets `mountingSku`, a scaffold extra goes in `scaffoldingExtras`, a `general_electrical`/structural extra in `electricalExtras`, any other extra in `optionalExtras`. Add of an item already present does nothing. An effect whose item is missing or mandatory is skipped with the warning "{item} could not be added from your answers, so your installer will confirm it." (or "removed"/"swapped").
  `estimatedFrom` lists the `flow.removedPresets` that are keys of `PRESET_WARNINGS`. When it is non-empty the quote's `warnings` gain, exactly: "Some figures use typical values because your installer does not ask about {list}." where {list} is the presets' prompts in lower case joined with ", " and " and ".

- [ ] **Step 1: Write the failing engine test** `adjust-config.test.ts`: `buildOptionSet` with `adjustConfig` that sets `battery: null` returns options whose `batteryType` is null and whose savings differ from the unadjusted run; without the hook the result is byte-identical to today's.
- [ ] **Step 2: Write the failing effects tests** in `flow-effects.test.ts` (use the existing price-list fixtures in `apps/api/test`):
  - `"yes" to an electric-car question adds the EV charger to every option at its listed price`.
  - `an ev_now lifestyle answer can carry the same effect`.
  - `removing the battery recalculates savings` (savings differ from the quote without the effect; `batteryType` null).
  - `swapping panels changes generation and price together`.
  - `a swap whose item is not in a package leaves that package alone`.
  - `an item added by two answers appears once`; `remove after add in flow order removes it`.
  - `a stale effect (item gone from the list) is skipped with its warning, and the quote still builds`.
  - `a flow with every price-dependent preset removed still quotes, with estimatedFrom listing them`.
  - `the default flow's quote equals today's quote for the same answers`.
  - `a quote with removed presets tells the visitor which figures are typical values` (exact warning text).
- [ ] **Step 3: Run** `npx vitest run apps/api/test/flow-effects.test.ts packages/quote-engine`. Expected: FAIL.
- [ ] **Step 4: Implement** the hook, `effects.ts`, and the `buildQuote` / `journeyStatus` / `quoteAnswers` changes.
- [ ] **Step 5: Run** `npx vitest run apps/api/test/flow-effects.test.ts packages/quote-engine apps/api/test/journey*.test.ts apps/api/test/quote*.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(quote): answers add, remove and swap price-list items`.

### Task 5: Sunny's chat follows the installer's flow

**Files:**
- Modify: `apps/api/src/tenants.ts` (`config.conversation?: ConversationFlow`), `apps/api/src/agent/tools.ts` (`get_questionnaire`, `save_answer` use `ctx.flow`), the tool context type (add `flow: ResolvedFlow`, built once per turn from the tenant), `apps/api/src/journey/agent-tools.ts` (labels and replies from `flow.question(id).label`), `apps/api/src/journey/extract.ts` (validation and label matching via the flow; a reply matching no choice stores nothing), `apps/api/src/journey/service.ts` (pass the flow to `journeyStatus` and `buildQuote`).
- Unchanged by design: `POST /v1/qualification/answer` in `server.ts` keeps the default flow.
- Test: `apps/api/test/flow-chat.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces: `ToolContext.flow: ResolvedFlow`.

- [ ] **Step 1: Write the failing tests** (through the tools and the journey service with a fake provider, as the existing journey tests do):
  - `get_questionnaire lists the installer's questions in their order, with their wording`.
  - `a removed preset is never offered and save_answer refuses it`.
  - `quick replies carry the installer's labels`.
  - `a typed reply matching no choice of a custom question stores nothing` (extract path).
  - `a flow saved mid-conversation: earlier answers stay, removed questions are not asked`.
  - `the host-page route still accepts every SunScan question for a tenant with a custom flow`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/flow-chat.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api/test` . Expected: PASS (whole API suite).
- [ ] **Step 5: Commit** `feat(agent): Sunny asks the installer's own questions`.

### Task 6: Portal routes and preview

**Files:**
- Create: `apps/api/src/routes/conversation.ts` (registered in `server.ts` beside the branding routes)
- Modify: `tests/security/tenant-isolation.test.ts` (add the three routes)
- Test: `apps/api/test/conversation-routes.test.ts`

**Interfaces:**
- Produces (all under `/v1/portal/tenants/:tenantId/conversation`):
  - `GET ` (viewer): `{ flow: ConversationFlow | null, presets: PresetView[], priceItems: PriceItemView[], issues: FlowIssue[] }` where `PresetView = { id, prompt, options: {value,label}[], fixed: boolean, warning: string | null, group: string[] }` and `PriceItemView = { key, name, category, unitLabel, packageUnit: boolean, mandatory, targetable, priceText }` from the published list.
  - `PUT ` (admin): body `{ flow: ConversationFlow }`; zod, then `checkFlow`; any issue → 400 with `{ error, issues }`; else saves `tenant.config.conversation` (bumps `version`) and returns the GET shape.
  - `DELETE ` (admin): resets to Sunny's questions (removes `config.conversation`).
  - `POST /preview` (viewer): body `{ flow, answers }`; returns `{ next: {id,prompt,options}|null, effects: {label, priceText}[], issues }` priced from the published list. No LLM, no session, no lead.

- [ ] **Step 1: Write the failing tests:** GET shape for a tenant with no flow; PUT round trip; PUT refused with the `mandatory_item` message; viewer cannot PUT or DELETE (403); DELETE resets; preview returns the EV charger's listed price for "yes"; preview with no price list says the item is priced by the installer.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/conversation-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and add the routes to the security sweep.
- [ ] **Step 4: Run** `npx vitest run apps/api/test/conversation-routes.test.ts tests/security`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): portal routes for the conversation flow`.

### Task 7: Leads carry the installer's questions

**Files:**
- Modify: the lead record type in `packages/contracts/src/leads.ts` and where a lead is created from the conversation (search `createLead`/`saveLead` callers in `apps/api/src`), the lead notification email renderer, `apps/marketing/components/dashboard/lead-detail.tsx`.
- Test: `apps/api/test/flow-leads.test.ts`, extend the lead-detail e2e in `tests/e2e/dashboard.spec.ts`.

**Interfaces:**
- Produces: `LeadRecord.flowAnswers?: Array<{ id: string; question: string; value: string; answer: string; mode: 'preset' | 'quote' | 'lead' }>` (question and answer in the installer's wording; `id` and `value` stable). Also `LeadRecord.flowVersion?: number`, the `ConversationFlow.version` the visitor was asked with (absent for the default flow).

- [ ] **Step 1: Write the failing tests:** a lead from a custom flow lists every answered question in flow order with the installer's wording and the stable id/value; a lead-only free-text answer appears; the lead email contains the custom question and answer; the dashboard lead page shows them.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/flow-leads.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `apps/api/test/lead*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(leads): installer questions and answers on every lead`.

### Task 8: The Studio editor

**Files:**
- Create: `apps/marketing/components/dashboard/conversation/editor.tsx` (state, save, reset), `question-list.tsx` (drag to reorder, open in place, add question and follow-up, effect picker), `flow-diagram.tsx` (SVG drawn from the same state; selection shared), `chat-preview.tsx` (calls `POST /preview`), `panel.tsx` (collapsible panel wrapper; collapsed state per panel in `localStorage` key `sunny:flow-panels`, wrapped in try/catch)
- Modify: `apps/marketing/lib/portal-api.ts` (types and calls for Task 6), the Studio page to add a "Your conversation" section, `apps/marketing/app/dashboard.css`
- Test: `tests/e2e/conversation-editor.spec.ts`

**Interfaces:**
- Consumes: Task 6 routes.
- Behaviour fixed by the spec: three panels side by side at ≥ 1100 px, tabs below that; each panel minimisable; fixed start and end shown locked; tags "Sunny's question", "Changes the quote", "Lead only"; removing a preset with a warning shows the warning and asks to confirm; effects chosen only from `priceItems` where `targetable`; a non-package unit asks for a quantity; follow-ups indented under their answer; diagram selection and list selection stay in step; preview shows the installer's wording with the note "Sunny may phrase this more naturally in the chat." and the exact price effect; Save shows each issue's message beside its question; "Reset to Sunny's questions" confirms first; viewers see everything read-only. Drag also works by keyboard (move up / move down buttons).

- [ ] **Step 1: Write the failing e2e tests:** add "Do you have an electric car?" with "Yes" adding the EV charger, save, reload, it is still there; drag it above roof shading and the diagram order follows; remove electricity use, the warning appears, confirm, it is gone and the chat preview never asks it; a follow-up appears indented and in the diagram; minimising the diagram keeps the list and preview; picking a mandatory item is not possible; reset restores Sunny's questions; a viewer cannot edit.
- [ ] **Step 2: Run** `MARKETING_PORT=4196 npx playwright test tests/e2e/conversation-editor.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `tests/e2e/dashboard.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): the conversation editor`.

### Task 9: End to end and the whole suite

**Files:**
- Test: `tests/e2e/conversation-flow.spec.ts`

- [ ] **Step 1: Write the test:** an installer saves a flow with an electric-car question linked to the EV charger; a visitor in the widget answers "yes"; the quote shows the EV charger line at its listed price in every option; the lead in the dashboard shows the question and answer.
- [ ] **Step 2: Run** it. Expected: PASS.
- [ ] **Step 3: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npx prettier --check apps packages tests`. Expected: all pass.
- [ ] **Step 4: Commit** `test(e2e): an installer's question changes a visitor's quote`.
