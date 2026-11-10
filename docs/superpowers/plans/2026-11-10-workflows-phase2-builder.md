# Workflows Phase 2: Studio Workflow Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installers manage their workflows in Studio. They can:

- list workflows and switch each one on or off
- create one from a template, from blank, or as a copy
- edit a workflow's questions with the existing editor
- set its name, description, triggers, interests, outcome and the pages it appears on
- switch the soft discovery start on or off

**Architecture:**

- **API:** new portal routes under `/v1/portal/tenants/:id/workflows` read and write `tenant.config.workflows` (the `WorkflowSet` from Phase 1). Each save has a per-workflow version check.
- **Editing questions:** workflows are always edited over the `SOLAR` bank. There are no fixed starts: the address is an ordinary step that its roof checks follow.
- **Old routes:** the old `/conversation` routes become a thin shim over the solar workflow.
- **Studio:** the existing `ConversationEditor` is reused through a `source` prop. New components cover the list, settings and page rules.

**Tech Stack:** Fastify, zod, Vitest (API and pure marketing helpers), Next.js and React (marketing app).

**Spec:** `docs/superpowers/specs/2026-11-10-workflows-design.md` (Phase 2 section)

## Global Constraints

- **No em or en dashes.** No em dash (U+2014) or en dash (U+2013) in any UI copy, API message or template.
- **Roles.** Viewer reads; admin and owner edit (same as the conversation routes).
- **Ids.** Workflow ids match `^wf_[a-z0-9_]{3,30}$`. The built-ins are `wf_solar`, `wf_heat_pump` and `wf_battery`.
- **Built-ins.** Built-ins can be switched off but never deleted.
- **Limits.** At most 12 workflows per set (`WORKFLOW_LIMITS`).
- **Saving.** A save writes `tenant.config.workflows` and never deletes `tenant.config.conversation`.
- **Unchanged in chat.** A migrated tenant's stored order is unchanged in chat. Editing always resolves over `SOLAR`; `[address, ...]` resolves to the same order as legacy.
- **Copy.** Product name "Sunny". The assistant's name comes from tenant settings, as the existing editor already does.

## Review Focus

1. **First save of a never-saved set.** Every read of a never-saved set builds a new `updatedAt`. Version checks must use `Workflow.version` (stable: 0 or the migrated conversation version), never `updatedAt`. Test in Task 2.
2. **A conversation shim save after a workflows save.** The shim must update `wf_solar`'s steps inside the set rather than write `config.conversation`. Otherwise chat would ignore it, because `config.workflows` wins. Test in Task 2.
3. **Deleting or disabling the workflow a visitor has active.** The chat side already handles this with `settle`. The route must simply allow it for custom workflows and refuse delete for built-ins. Test in Task 2.
4. **An invalid page pattern or a duplicate custom step id across workflows.** The route must return 400 with `issues` naming the workflow and field, not 500. Test in Task 2.
5. **The editor on a migrated workflow whose first step is `address`.** It must show the address as a movable question and save it back without dropping it. Test in Task 3 (`draftFrom` and `flowFrom` round trip with SOLAR presets).

---

### Task 1: Shared view helpers and `checkWorkflow`

**Files:**

- Create: `apps/api/src/routes/flow-views.ts`. Move `PresetView`, `PriceItemView`, `ConversationView`, `presetViews`, `priceItemViews`, `describeEffect` and `priceText`/`money`/`unitLabel` out of `routes/conversation.ts`, unchanged except for the `presetViews` signature.
- Modify: `apps/api/src/routes/conversation.ts` (import from `flow-views.ts`).
- Modify: `apps/api/src/flow/check.ts` (add `checkWorkflow`, `checkWorkflowSet`).
- Test: `apps/api/test/flow-check.test.ts` (extend); `apps/api/test/conversation-routes.test.ts` must pass unchanged.

**Interfaces:**

- Produces:
  ```ts
  // flow-views.ts
  export function presetViews(bank?: QuestionBank): PresetView[];
  //   default LEGACY_SOLAR → today's output exactly
  //   with SOLAR: fixed = false for every preset;
  //     group = bank.groups[id] ?? bank.followers[id] ?? [];
  //     follower ids (roof_confidence, roof_confirmed) and systemSet ids are omitted from the list
  export function priceItemViews(list: PriceList | null): PriceItemView[];
  export function describeEffect(
    effect: FlowEffect,
    list: PriceList | null,
  ): { label: string; priceText: string };
  // check.ts
  export type WorkflowIssueCode =
    | FlowIssue['code']
    | 'needs_address'
    | 'bad_page_pattern'
    | 'duplicate_step_id'
    | 'interest_overlap';
  export interface WorkflowIssue {
    workflowId: string;
    stepId?: string;
    choice?: string;
    field?: 'pages' | 'steps' | 'interests';
    code: WorkflowIssueCode;
    message: string;
    warning?: boolean;
  }
  export function checkWorkflow(w: Workflow, list: PriceList | null): WorkflowIssue[];
  export function checkWorkflowSet(set: WorkflowSet, list: PriceList | null): WorkflowIssue[];
  ```
- `checkWorkflow` runs `checkFlow(toFlow(w), list)` and tags each issue with the workflow id. It adds:
  - `needs_address`: outcome is `quote` with engine `solar` and no `address` preset among the steps (follow-ups included). Message: `A solar quote needs the address question.`
  - `bad_page_pattern`: a pattern that does not start with `/`, or contains whitespace or `?`/`#`. Message: `Page patterns start with / and are paths only, like /offers/battery*.`
- `checkWorkflowSet` adds:
  - `duplicate_step_id` across workflows. Message: `This question id is used in another workflow.`
  - `interest_overlap` as a warning (`warning: true`, never blocks a save): two enabled workflows share an interest and both appear on all pages. Message: `Two workflows on the same pages cover the same interest. Sunny will suggest the first.`

- [ ] **Step 1: Write the failing tests** in `flow-check.test.ts`:
  - `presetViews()` deep-equals a snapshot of today's `/conversation` GET `presets`. Take it from `conversation-routes.test.ts`'s expectations or build it before the move.
  - `presetViews(SOLAR)`:
    - has no entry with `fixed: true`
    - has no `roof_confidence` or `roof_confirmed` entries
    - the `address` entry has `group: ['roof_confidence','roof_confirmed']`
  - `checkWorkflow` on a solar workflow without `address` gives one `needs_address`.
  - A pattern `offers/x` gives `bad_page_pattern` with `field: 'pages'`.
  - `checkWorkflowSet` with two workflows sharing `c_abc123` gives `duplicate_step_id`.
  - Two all-pages workflows sharing interest `solar` give one issue with `warning: true`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/flow-check.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api/test/flow-check.test.ts apps/api/test/conversation-routes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(flow): workflow checks and shared Studio views"`

### Task 2: Workflow portal routes and the conversation shim

**Files:**

- Create: `apps/api/src/routes/workflows.ts`
- Modify:
  - `apps/api/src/routes/conversation.ts` (shim)
  - `apps/api/src/server.ts:2180` (register beside conversation routes, same deps)
  - `apps/api/src/workflows/templates.ts` (`blankWorkflow(id, now)`, `templateFor(kind, now)`)
- Test: `apps/api/test/workflow-routes.test.ts`; `apps/api/test/conversation-routes.test.ts` (update only where the shim changes behaviour, and say why in the commit)

**Interfaces:**

- Consumes: Task 1, `workflowsForTenant`, `workflowSetSchema`, `workflowSchema`, `resolvedFlowFor`, `effectsFor`, `suggestEffects`.
- Produces: the HTTP API below (all JSON). The view:
  ```ts
  interface WorkflowSetView {
    set: WorkflowSet;
    migrated: boolean;
    presets: PresetView[] /* presetViews(SOLAR) */;
    priceItems: PriceItemView[];
    issues: WorkflowIssue[];
  }
  ```
- Routes under `/v1/portal/tenants/:tenantId/workflows`:

  | Method and path                                                            | Role   | Behaviour                                                                                                                                                                                                                           |
  | -------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `GET`                                                                      | viewer | Returns `WorkflowSetView`.                                                                                                                                                                                                          |
  | `PUT /settings` `{discoveryEnabled: boolean}`                              | admin  | Updates `set.discovery.enabled` and returns the view.                                                                                                                                                                               |
  | `POST` `{from: 'solar_quote' \| 'blank' \| {copy: string}, name?: string}` | admin  | Creates a workflow (rules below).                                                                                                                                                                                                   |
  | `GET /:workflowId`                                                         | viewer | `{workflow, presets, priceItems, issues}`. 404 when missing.                                                                                                                                                                        |
  | `PUT /:workflowId` `{workflow}`                                            | admin  | Saves one workflow (rules below).                                                                                                                                                                                                   |
  | `DELETE /:workflowId`                                                      | admin  | Built-ins (`template !== null`, or id in `BUILTIN_WORKFLOW_IDS`) give 400 `Built-in workflows can be switched off but not deleted.`. Otherwise removes it and returns the view.                                                     |
  | `POST /:workflowId/reset`                                                  | admin  | Built-ins only. Replaces steps, name, description, triggers, interests and outcome from the template. Keeps `enabled` and `pages`. Bumps the version.                                                                               |
  | `POST /:workflowId/preview` `{workflow, answers, path?}`                   | viewer | Returns `{next, effects, issues, appearsOnPage: boolean \| null}`. Same shape as the conversation preview, resolved with `resolvedFlowFor`. `appearsOnPage` is `pathMatches(workflow.pages, path)` when `path` is given, else null. |
  | `POST /:workflowId/suggest`                                                | admin  | Identical to conversation suggest, same rate-limit rule and scope `flow-suggest`.                                                                                                                                                   |

- `POST` create rules:
  - New id: `wf_` plus a slug of the name, de-duplicated with `_2`, `_3`.
  - `blank`:
    - name `New workflow`, enabled false
    - outcome lead, one custom text question `c_` + random
    - prompt `What would you like help with?`, mode `lead`
    - empty triggers and interests, all pages
  - `copy`: copies steps and settings. Name `<name> copy`, enabled false, template null. Every custom step id is renamed to a fresh `c_` id (follow-ups included), so ids stay unique.
  - `solar_quote`: when `wf_solar` already exists it acts as copy of `wf_solar`.
  - Errors: 400 at 12 workflows (`You can have up to 12 workflows.`).
  - Response: `{workflow, view}`.
- `PUT /:workflowId` rules:
  - The body's `workflow.id` must equal `:workflowId`.
  - Its `version` must equal the stored version, else 409 `Someone else changed this workflow. Reload to see their changes.`
  - The server bumps `version` and sets `updatedAt`; a client `kind` or `template` change is ignored (stored values win).
  - Validate with `workflowSetSchema` on the would-be set and with `checkWorkflowSet` (non-warning issues give 400 `{error, issues}` like the conversation PUT).
  - Writes go through `tenants.update` against the current stored tenant. If `config.workflows` is absent, start from `workflowsForTenant(current).set`. That is the migration's first save.
- Shim on `/conversation`:
  - **GET:** returns the old `ConversationView` built from the solar workflow:
    - `flow`: steps without a leading `address` preset; null when the tenant has no stored workflows and no stored conversation
    - `presets`: `presetViews()` (legacy)
    - existing `issues` semantics
  - **PUT:** writes into `wf_solar.steps` as `[address, ...flow.steps]` when workflows are stored. Otherwise it writes `config.conversation` exactly as today.
  - **DELETE:** resets `wf_solar` from the template when workflows are stored, else today's behaviour.

- [ ] **Step 1: Write the failing tests** in `workflow-routes.test.ts`. Follow `conversation-routes.test.ts` for server setup, tokens and roles:
  - **GET:** a fresh tenant gets `migrated: true` and the default set.
  - **First save:**
    - PUT of `wf_solar` with `version` from GET succeeds and returns `version + 1`.
    - A second PUT with the old version gives 409.
  - **Viewer:** a viewer gets 403 on PUT, POST and DELETE.
  - **Create and copy:**
    - POST `blank` creates a disabled lead workflow with id matching `^wf_`.
    - POST `{copy:'wf_solar'}` gives fresh custom ids and `template: null`.
    - A 13th create gives 400.
  - **Delete:** DELETE `wf_solar` gives 400; DELETE of a custom workflow gives 200 and it is gone.
  - **Bad saves:**
    - PUT with pattern `offers` gives 400 with `issues[0].code === 'bad_page_pattern'`.
    - PUT removing `address` from `wf_solar` gives 400 `needs_address`.
  - **Settings:** `PUT /settings {discoveryEnabled:false}` persists.
  - **Preview:** with `path:'/battery-deal'` on a workflow restricted to `/battery-deal*`, `appearsOnPage` is true.
  - **Reset:** keeps `pages` and `enabled`.
  - **Shim after a workflows save:** a conversation PUT changes `wf_solar` steps as seen by GET `/workflows`. `config.conversation` is unchanged.
  - **Chat sees the save:** after a workflows save, `workflowsForTenant(tenant).migrated === false`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/workflow-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api/test/workflow-routes.test.ts apps/api/test/conversation-routes.test.ts`, then `npx vitest run apps/api` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(workflows): portal routes and the conversation shim"`

### Task 3: Marketing client and pure workflow helpers

**Files:**

- Modify: `apps/marketing/lib/portal-api.ts` (add types and client functions next to the conversation ones at `:355-434`; re-export `Workflow`, `WorkflowSet`, `PageRule` and `pathMatches` types and helpers from `@sunny/contracts` if the app already imports contracts, else declare matching types)
- Create: `apps/marketing/components/dashboard/workflows/model.ts`
- Modify: `apps/marketing/components/dashboard/conversation/model.ts` (`draftFrom` and `defaultSteps` must handle presets with no fixed entries)
- Test: `apps/marketing/test/workflow-model.test.ts`

**Interfaces:**

- Produces in `portal-api.ts`:
  - `getWorkflows(tenantId)`
  - `createWorkflow(tenantId, from, name?)`
  - `getWorkflow(tenantId, id)`
  - `saveWorkflow(tenantId, workflow)`, which surfaces 409 as `ApiFailure` with status 409
  - `deleteWorkflow`
  - `resetWorkflow`
  - `previewWorkflow(tenantId, workflow, answers, path?)`
  - `suggestWorkflowPriceChanges(tenantId, workflowId, question)`
  - `saveWorkflowSettings(tenantId, {discoveryEnabled})`
  - `workflowIssuesOf(failure)`
  - Plus the view types matching Task 2.
- Produces in `workflows/model.ts` (pure):

  ```ts
  export function pagesSummary(rule: PageRule): string; // 'All pages' | 'Only /a, /b' | 'All pages except /x' | 'Only /a (not /a/old)'
  export function outcomeLabel(o: WorkflowOutcome): string; // 'Solar quote' | 'Heat pump quote' | 'Battery quote' | 'Passes details to you'
  export function kindBadge(w: Workflow): string; // 'Built in' for template !== null or builtin id, else 'Your own'
  export function addPattern(
    rule: PageRule,
    list: 'include' | 'exclude',
    raw: string,
  ): { rule: PageRule; error: string | null };
  //   trims; prefixes '/' if missing; rejects whitespace, '?', '#'; de-duplicates; max 20 per list
  export function removePattern(
    rule: PageRule,
    list: 'include' | 'exclude',
    pattern: string,
  ): PageRule;
  export function testUrl(rule: PageRule, input: string): boolean | null; // accepts a full URL or a path; null when unparseable
  export function workflowFlow(w: Workflow): ConversationFlow; // {version: w.version, updatedAt: w.updatedAt, steps: w.steps}
  export function withFlow(w: Workflow, flow: ConversationFlow): Workflow; // steps replaced, everything else kept
  ```

- [ ] **Step 1: Write the failing tests** in `workflow-model.test.ts`:
  - Every `pagesSummary` form above.
  - `addPattern` with `'offers/battery*'` stores `'/offers/battery*'`.
  - `addPattern` with `'/a b'` gives an error and an unchanged rule.
  - A 21st pattern gives an error.
  - `testUrl(rule,'https://x.co/offers/battery-deal?u=1')` is true for include `/offers/battery*`; `testUrl(rule,'::')` is null.
  - `kindBadge` and `outcomeLabel` cases.
  - The `draftFrom(flow, presets)` then `flowFrom(...)` round trip for a SOLAR-preset list keeps a leading `address` step and its position.
- [ ] **Step 2: Run** `npx vitest run apps/marketing/test/workflow-model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/marketing` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(studio): workflow client and page rule helpers"`

### Task 4: Editor runs on a workflow

**Files:**

- Modify:
  - `apps/marketing/components/dashboard/conversation/editor.tsx`
  - `chat-preview.tsx`
  - `suggestions.ts`
  - `flow-canvas.tsx`
  - `flow-layout.ts` (fixed start and end boxes)
- Test: `apps/marketing/test/flow-layout.test.ts` (extend)

**Interfaces:**

- Consumes: Task 3.
- Produces: `ConversationEditor` gains an optional prop `source?: EditorSource`. Without it, the editor behaves exactly as today on `/conversation`.
  ```ts
  export interface EditorSource {
    load(): Promise<{ flow: ConversationFlow | null; presets: PresetView[]; priceItems: PriceItemView[]; issues: FlowIssue[] }>;
    save(flow: ConversationFlow): Promise<{ flow: ConversationFlow | null; presets: PresetView[]; priceItems: PriceItemView[]; issues: FlowIssue[] }>;
    reset?(): Promise<…same…>;          // absent → no reset button
    preview(flow: ConversationFlow, answers: Record<string,string>): Promise<ConversationPreview>;
    suggest(question: { prompt: string; choices: Array<{value:string;label:string}> }): Promise<PriceSuggestion>;
    start: string | null;   // label of the fixed start box, null for none
    end: string;            // label of the fixed end box
  }
  ```
- Fixed boxes:
  - **Start box:** shown only when `start` is not null. For a workflow it is null, because the address is a normal question.
  - **End box:**
    - quote/solar: `Quote, then contact details`
    - lead: `Then Sunny passes their details to you`, using the assistant's name in place of Sunny if the editor already does that

- [ ] **Step 1: Write the failing tests.** `flow-layout` lays out with no start box when told none: the first node is the first question and no `fixed` node appears at the top. The end box label is whatever it is passed.
- [ ] **Step 2: Run** `npx vitest run apps/marketing/test/flow-layout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Thread `source` through the editor, the chat preview and suggestions. Default to the existing conversation functions when `source` is absent.
- [ ] **Step 4: Run** `npx vitest run apps/marketing` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(studio): the question editor runs on any workflow"`

### Task 5: "Your workflows" tab

**Files:**

- Create in `apps/marketing/components/dashboard/workflows/`:
  - `workflows-tab.tsx`: list and detail
  - `workflow-list.tsx`
  - `new-workflow.tsx`
  - `workflow-settings.tsx`
  - `page-rules.tsx`
- Modify: `apps/marketing/app/dashboard/studio/page.tsx` (tab key `workflows`, title `Your workflows`, replacing `conversation`; `tabFrom('conversation')` returns `'workflows'`)
- Modify: the dashboard stylesheet the conversation editor uses (find it via existing class names such as `studio-tabs`) for any new classes. Reuse existing card and button classes first.

**Interfaces:**

- Consumes: Tasks 3 and 4.
- Behaviour:
  - **List:**
    - Each card shows: name, `kindBadge`, an enabled switch (admins; viewers see text), `outcomeLabel` and `pagesSummary`.
    - The card has an Edit button and a Delete button (hidden for built-ins).
    - Above the list: a discovery switch labelled `Start with a few gentle questions` with the help text `Sunny asks what the visitor is looking for before suggesting a workflow.`
    - A `New workflow` button opens `new-workflow`, which offers: `Copy of Solar quote`, `Start from blank`, and `Copy of <each existing>`.
  - **Detail**, keyed by workflow id: a back link `All workflows`, `workflow-settings`, `page-rules`, then `ConversationEditor` with a `source` built from the workflow routes.
    - Its `save` sends `withFlow(currentWorkflow, flow)`.
    - Settings and page-rules edits are saved with the same PUT through their own Save button. The version check gives 409, which shows `Someone else changed this workflow. Reload to see their changes.` with a Reload button.
    - The editor's preview gets a page-path field labelled `Preview on page`. It passes `path` to the workflow preview and shows `Shows on this page` or `Does not show on this page` from `appearsOnPage`.
  - **`workflow-settings`:**
    - name (60), description (300, help: `Sunny reads this to decide when to offer it.`), triggers as chips (max 8, help: `Things a visitor might say, like "battery quote".`), interests as checkboxes with the discovery labels.
    - Outcome is a select for custom workflows: `Passes details to you` (lead) or `Solar quote`. For built-ins it is read-only text.
  - **`page-rules`:**
    - Radio: `All pages` or `Only these pages`.
    - Include chips appear when "only" is chosen. Exclude chips sit under `But not these pages` in both modes.
    - Errors from `addPattern` show inline.
    - A `Test a page` input shows `Shows here` / `Does not show here` / `Not a page address` from `testUrl`.
- Copy: no em or en dashes. Reuse the assistant name prop where the editor already does.

- [ ] **Step 1: Wire the tab and alias.** Run `npm run typecheck`. Expected: PASS.
- [ ] **Step 2: Build the list, new-workflow, settings and page-rules components.** Run `npm run typecheck` and `npx vitest run apps/marketing`. Expected: PASS.
- [ ] **Step 3: Check for dashes.** Scan `apps/marketing/components/dashboard/workflows` for U+2014 and U+2013 with `grep -rnP "[\x{2013}\x{2014}]" apps/marketing/components/dashboard/workflows`. Expected: no output.
- [ ] **Step 4: Commit.** `git commit -m "feat(studio): Your workflows tab"`

### Task 6: Verify end to end

**Files:**

- Modify: any e2e spec under `tests/e2e/` that opens Studio's conversation tab (`grep -rln "conversation" tests/e2e`) so it opens `?tab=workflows` and the solar workflow.

- [ ] **Step 1: Run** `npx vitest run`, `npm run typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 npm run lint`, and `git diff --name-only main...HEAD | xargs npx prettier --check`. Expected: all pass.
- [ ] **Step 2: Build the marketing app** with `npm run build -w apps/marketing` (or the workspace's build script). Expected: build succeeds.
- [ ] **Step 3: Update the e2e specs found above** to the new tab. If Playwright and the six-process web server cannot run in this environment, say so in the report rather than skipping silently.
- [ ] **Step 4: Commit.** `git commit -m "test(studio): e2e opens Your workflows"`
