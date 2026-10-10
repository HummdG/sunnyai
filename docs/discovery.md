# Discovery record

**Project:** Sunny.ai — `C:\Work\Arkalith\sunny-ai`
**Plan:** _Sunny.ai — Executable Engineering Plan_ v1.0 (10 October 2026), §2 "Source-of-truth hierarchy and discovery gate"
**Status:** Discovery-gate record. Describes what was actually inspected, what the reference artwork measures, what already exists, and where the plan's assumptions do not match this repository.
**Written:** 10 October 2026

> This is a record of inspection, not of intent. Every number and claim below has a
> path behind it. Nothing is inferred from the plan's prose. Where a fact could not
> be established it is marked **Unknown — needs verification** rather than guessed.

---

## 1. What was inspected

### 1.1 Documents

| Path                                                                    | What was taken from it                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C:\Work\Arkalith\SunScanV2\SUNNY_AI_IMPLEMENTATION_PLAN.md`            | The governing plan (v1.0, 357 lines). Sections §2–§16. Note: this file lives in the **workspace root**, not inside the `sunny-ai` repository.                                             |
| `C:\Work\Arkalith\SunScanV2\sunny.png`                                  | The reference character artwork. Note: also **outside** `sunny-ai`.                                                                                                                       |
| `docs/discovery-sunscan.md`                                             | The only permitted source for SunScan's data model, questionnaire, lead schema, routes and pricing. Used for §"SunScan" and for `docs/integration/sunscan-contract.md`.                   |
| `docs/discovery-google-services.md`                                     | Verified Google Cloud service capabilities: model retirement (§3), managed-search ACL status (§4), App Check domain limit (§6), Firestore limits (§7), Cloud Run streaming/timeouts (§8). |
| `docs/architecture/adr-001-platform.md` … `adr-005-widget-isolation.md` | Five ADRs present in the tree at the time of writing (hosting, agent runtime, retrieval isolation, widget isolation, platform). Not authored by this task.                                |

### 1.2 Repository source (all under `C:\Work\Arkalith\sunny-ai`)

| Path                                                                                | What was read                                                                                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/server.ts`                                                            | The complete route table, CORS hook, error handler, SSE framing.                                                                  |
| `apps/api/src/config.ts`                                                            | `loadConfig`, default model, escalation config, `assertProductionReady`, `capabilityReport`.                                      |
| `apps/api/src/tenants.ts`                                                           | `Tenant` shape, `DEMO_TENANT`, `resolveSunscanUrl`, `TenantRegistry`.                                                             |
| `apps/api/src/store.ts`                                                             | `Store` interface, `FileStore` (JSONL), `LeadRecord`, idempotent lead append.                                                     |
| `apps/api/src/sessions.ts`                                                          | HMAC-SHA256 session tokens, `SESSION_TTL_MS`.                                                                                     |
| `apps/api/src/main.ts`                                                              | Boot sequence and capability warnings.                                                                                            |
| `apps/api/src/agent/tools.ts`                                                       | The 13 tool definitions and their implementations; `QUESTIONNAIRE_VERSION`, `QUESTIONS`, `STEP_ORDER`; `assertToolSurfaceClosed`. |
| `apps/api/src/agent/agent.ts`                                                       | `buildSystemInstruction`, `runTurn`, answers recovery.                                                                            |
| `apps/api/src/agent/provider.ts`                                                    | `ChatProvider`, `UnconfiguredProvider`, `GeminiProvider`.                                                                         |
| `apps/api/test/pipeline.test.ts`                                                    | The vertical-slice test (runs against a `ScriptedProvider`).                                                                      |
| `packages/contracts/src/*.ts`                                                       | `errors.ts`, `events.ts`, `chat.ts`, `widget.ts`, `index.ts`.                                                                     |
| `packages/character/src/rig.ts`, `geometry.ts`, `render.ts`, `tokens.ts`            | The rig, its measured constants, the pure SVG renderer, the colour tokens.                                                        |
| `packages/animation-engine/src/*.ts`                                                | `types.ts`, `sequences.ts`, `machine.ts`, `scheduler.ts`, `engine.ts`, `index.ts`.                                                |
| `packages/animation-engine/test/*.test.ts`                                          | `machine.test.ts`, `sequences.test.ts` — the deterministic-replay and scheduler tests.                                            |
| `packages/widget/src/*.ts`                                                          | `widget.ts`, `index.ts`, `chat.ts`, `dom.ts`, `styles.ts`.                                                                        |
| `packages/widget/scripts/build.mjs`                                                 | esbuild IIFE build and `SIZE_BUDGET_BYTES`.                                                                                       |
| `packages/character/scripts/render-samples.ts`                                      | Sample-pose rasteriser (reference-comparison tooling).                                                                            |
| `apps/widget-demo/serve.ts`, `apps/widget-demo/public/index.html`                   | The plain-HTML host fixture.                                                                                                      |
| `apps/widget-demo-react/{serve.ts,src/app.tsx,public/index.html,scripts/build.mjs}` | The React host fixture: the same widget in a page React 19 owns.                                                                  |
| `apps/character-lab/serve.ts`, `src/lab.ts`, `public/index.html`, `public/lab.js`   | The interactive character lab page.                                                                                               |
| `scripts/smoke-api.mjs`                                                             | The dependency-free API smoke test.                                                                                               |
| `scripts/static-server.ts`                                                          | The demo/lab static server and its containment check.                                                                             |
| `scripts/measure-reference.py`, `scripts/compare-reference.py`                      | The measurement/comparison tooling that produced the rig constants.                                                               |
| `package.json` (root), `apps/*/package.json`, `packages/*/package.json`             | Workspace layout, engines, scripts, dependencies.                                                                                 |
| `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.gitattributes`                 | Build/test configuration.                                                                                                         |

### 1.3 What was **not** inspected

- **The SunScan application at `C:\Work\Arkalith\SunScan` was not read, searched or
  referenced.** An explicit standing instruction forbids it. Every SunScan fact in
  this document comes from `docs/discovery-sunscan.md` alone.
- No live Google Cloud, Firebase, Stripe or Gemini endpoint was called. No credential
  was exercised. See §4.4.

---

## 2. The reference artwork

`C:\Work\Arkalith\SunScanV2\sunny.png`

| Property                       | Value                            | How established                               |
| ------------------------------ | -------------------------------- | --------------------------------------------- |
| Format                         | PNG, 8-bit RGBA (colour type 6)  | PNG IHDR read directly                        |
| Dimensions                     | **1254 × 1254 px**               | IHDR width/height fields                      |
| Size on disk                   | 1,073,379 bytes                  | Directory listing                             |
| Author, licence, creation date | **Unknown — needs verification** | Not recorded anywhere in the two repositories |

The artwork is the canonical design source (plan §1: "Preserve the supplied reference
artwork as canonical; do not recreate the design from prose"). Its measurements were
turned into code by `scripts/measure-reference.py` and recorded as constants in
`packages/character/src/geometry.ts`. The scale factor is `SOURCE_TO_VIEWBOX =
0.125417` (viewBox units per source pixel), and `SOURCE_BODY_CENTRE = (625, 618)px`
maps to the rig origin `(100, 100)` in a 200-unit viewBox.

### 2.1 Measurements taken from the artwork and where they became code

| Measured in `sunny.png` (source px)   | Code constant / value                                                                                   | Defined in                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| Overall frame 1254 × 1254             | source frame; `SOURCE_TO_VIEWBOX = 0.125417`                                                            | `geometry.ts`               |
| Body centre (625, 618)                | `SOURCE_BODY_CENTRE`; rig root `x=100, y=100`                                                           | `geometry.ts` / `rig.ts`    |
| Body outline stroke 20.0 px           | `BODY.strokeWidth = 2.51`                                                                               | `geometry.ts`               |
| Ray tip radius 601.9 px               | `RAY.tipRadius = 75.5`                                                                                  | `geometry.ts`               |
| Ray base radius 398.8 px              | `RAY.baseRadius = 50.0`                                                                                 | `geometry.ts`               |
| Ray base half-width 97.8 px           | `RAY.baseHalfWidth = 12.3`                                                                              | `geometry.ts`               |
| Ray angles (eight, clockwise from up) | `RAY.anglesDeg = [0, 49, 91.5, 131.5, 180, 228.5, 268.5, 311]`                                          | `geometry.ts`               |
| Eye outline stroke 11.0 px            | `EYE.strokeWidth` (rendered at 2× on the eye)                                                           | `geometry.ts` / `render.ts` |
| Highlight notch 53.7 % down the eye   | `EYE_HIGHLIGHT.notchAt`                                                                                 | `geometry.ts`               |
| Eye positions, tilts and openings     | `defaultRig().eyes.left = (-14.0, -1.9, -14°, 17.7 × 32.2)`, `right = (17.6, -8.3, -5.1°, 16.2 × 30.3)` | `rig.ts`                    |
| Brow geometry                         | `left = (-20.8, -23.0, -36.7°, len 12.5, arch 4.3)`, `right = (12.3, -30.5, -5.9°, len 9.1, arch 2.5)`  | `rig.ts`                    |
| Smile geometry                        | centre `(5.1, 15.2)`, rotation `-14.6°`, `span 46.6`, `depth 7.531`, `strokeWidth 4.0`                  | `rig.ts`                    |

`rig.ts` states outright: _"Every number here is a measurement; see
docs/design/character-reference.md."_ That design document is **absent** (see §4.2);
the numbers themselves exist only in code and in the Python measurement scripts.

The character's deliberate asymmetry (the left eye longer and more tilted than the
right, the left brow steeper, the smile rising more on its right) is a measured
property of the artwork, not a defect.

### 2.2 Props

`packages/character/src/rig.ts` defines a closed list of seven props — `PROP_IDS =
['question-mark', 'sparkle', 'sweat-drop', 'battery', 'sunglasses', 'deckchair',
'balloon']` — each with an authored SVG path in `render.ts`. These were **authored,
not measured**, with one exception worth knowing about: the deckchair is the only
prop authored in the _body's_ frame rather than in a small frame of its own, because
furniture has to be sized against the body that sits in it (D-20). The balloon is
drawn with the same `surface` treatment the deckchair introduced (D-21). The plan's
animation backlog (§5.3) still names many props that have **no artwork yet**:
tic-tac-toe grid, skateboard, ice-cream, Rubik's/impossible cube, ping-pong paddle,
and a folding solar panel or phone.

---

## 3. What already exists in this repository

Status vocabulary: **Implemented** (real behaviour, tested or exercised), **Partial**
(some real behaviour, incomplete against the plan), **Stub** (manifest/directory only,
no implementation), **Empty scaffold** (directory exists, no files), **Absent** (does
not exist).

| Path                                          | Status         | One line                                                                                                                                                                                                                           |
| --------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`                                    | Implemented    | Fastify + TypeScript API. Real routes: `GET /healthz`, `GET /v1/widget/config/:publicId`, `POST /v1/widget/session`, `POST /v1/chat/stream` (SSE), plus `GET /v1/conversation` and `GET /v1/leads` (not in the plan's §4 list).    |
| `apps/character-lab`                          | Implemented    | Interactive character lab: `serve.ts`, `src/lab.ts`, a built `public/lab.js`, and a `scripts/build.mjs`.                                                                                                                           |
| `apps/widget-demo`                            | Implemented    | Plain-HTML host fixture that loads the built widget bundle from `packages/widget/dist`.                                                                                                                                            |
| `apps/widget-demo-react`                      | Implemented    | React 19 host fixture (React + `StrictMode`, bundled by esbuild), driven by `tests/e2e/react-host.spec.ts`. Its bundle is gitignored rather than committed, unlike the character lab's.                                            |
| `apps/widget-demo-next`                       | Implemented    | Next.js 16 (App Router) host fixture, served as a production build by `next start`. Two routes: the documented snippet, and `next/script`. Driven by `tests/e2e/next-host.spec.ts`. Its bundle and `.next/` output are gitignored. |
| `apps/marketing`                              | Implemented    | Next.js 16 marketing site: hero with the live character, a working demo that mounts the real widget, the theme presets, and an honest pricing shell. Built with webpack (D-15). Driven by `tests/e2e/marketing.spec.ts`.           |
| `apps/dashboard`                              | Absent         | The plan's §3.2 layout calls for it; there is no such directory.                                                                                                                                                                   |
| `packages/contracts`                          | Implemented    | Zod schemas as the single source of truth: error envelope (9 codes), chat stream events, widget/session schemas, closed tool-name and page-action lists.                                                                           |
| `packages/character`                          | Implemented    | Rig, geometry constants, pure SVG renderer, colour tokens, sample-pose rasteriser.                                                                                                                                                 |
| `packages/animation-engine`                   | Implemented    | State machine (10 states), priority scheduler, 27 sequences, deterministic animator.                                                                                                                                               |
| `packages/widget`                             | Implemented    | Shadow-DOM-isolated embeddable bundle (`dist/sunny-widget.js`, 108,483 bytes raw at build time), SSE chat client, esbuild IIFE build with a 60 KB gzip budget.                                                                     |
| `packages/ui`                                 | Stub           | `package.json` only; `src/` empty. No shared tokens/components package in practice.                                                                                                                                                |
| `packages/solar-rules`                        | Stub           | `package.json` only; `src/` empty. No deterministic recommendation rules exist.                                                                                                                                                    |
| `packages/sunscan-adapter`                    | Stub           | `package.json` only; `src/` empty. **No SunScan adapter code exists anywhere** (see §4.3).                                                                                                                                         |
| `infrastructure/terraform`                    | Empty scaffold | `infrastructure/terraform/modules/` exists; **no `.tf` files anywhere**.                                                                                                                                                           |
| `scripts`                                     | Implemented    | `static-server.ts`, `smoke-api.mjs`, `measure-reference.py`, `compare-reference.py`.                                                                                                                                               |
| `tests/e2e`, `tests/security`, `tests/visual` | Empty scaffold | Directories exist, no files.                                                                                                                                                                                                       |
| `docs`                                        | Partial        | Two discovery documents plus five ADRs. `docs/design/` is **empty**; `docs/integration/` was empty until this task. No `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/RELEASE_CHECKLIST.md`, or `README_DEPLOY.md`.                  |

### 3.1 Test evidence observed

- `npx vitest run` in `sunny-ai`: **3 test files, 43 tests passed** (Fastify
  deprecation warnings only, non-fatal). Run during this discovery session.
- Type checking: `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) is declared.
- `vitest.config.ts` includes `packages/*/test` and `apps/*/test` and **excludes**
  `tests/e2e`. The `test:e2e` script runs `playwright test`, but `@playwright/test`
  is **not** in `devDependencies` and `tests/e2e` is empty.

---

## 4. Discrepancies

Where the plan's assumptions met reality and did not match.

### 4.1 Model retirement (the escalation gap)

- **Plan assumption** (§7.1): "Gemini Flash-class default, configurable escalation to a
  stronger Gemini model for difficult tasks."
- **Reality:** `apps/api/src/config.ts` sets the default to `gemini-3.8-flash` but
  leaves `escalationModel` **unset** by design. The comment records why: the only GA
  Pro-class model (`gemini-2.5-pro`) retires **2026-10-20** and its successor is
  preview-only, so picking one is a deliberate operator decision. `capabilityReport`
  therefore reports `escalation: { available: false }`.
- **Evidence:** `apps/api/src/config.ts`; `docs/discovery-google-services.md` §3.

### 4.2 The plan/artwork are outside the repository, and two deliverables are missing

- **Plan assumption** (§2, gate D0, and the reading list): the plan and the reference
  artwork live inside the `sunny-ai` repository, and the discovery gate produces
  `docs/design/character-reference.md`.
- **Reality:** the plan and `sunny.png` are at `C:\Work\Arkalith\SunScanV2\` — the
  workspace root — not inside `sunny-ai`. `docs/design/` is **empty**, so
  `character-reference.md` does not exist even though three source files
  (`rig.ts`, `geometry.ts`, `render.ts`) cite it as the source of the measurements.
- **Evidence:** directory listings; `packages/character/src/rig.ts` line 179.

### 4.3 The plan lists routes and a SunScan capability that are not built

- **Plan assumption** (§4): fourteen target Sunny API groups, including
  `POST /v1/qualification/answer`, `POST /v1/leads`, `GET /v1/catalog/products`,
  `POST /v1/recommendations`, `POST /v1/sunscan/assessments`,
  `GET /v1/sunscan/assessments/:id`, `GET /v1/dashboard/metrics`,
  `POST /v1/knowledge/sources`, `GET /v1/knowledge/jobs/:id`,
  `POST /v1/integrations/google-drive/connect`, `POST /v1/billing/webhook`.
- **Reality:** only three of those exist (`POST /v1/widget/session`,
  `POST /v1/chat/stream`, `GET /v1/widget/config/:publicId`). Three real routes are
  **not** in the plan's list: `GET /healthz`, `GET /v1/conversation`, `GET /v1/leads`.
  Qualification answers and leads are written through **tools** over the SSE stream
  (`save_answer`, `create_lead`), not through the REST routes the plan names. There is
  no evidence anywhere in the codebase of any HTTP call to SunScan: `packages/sunscan-adapter`
  is empty and every SunScan tool (`start_sunscan_assessment`, `get_sunscan_result`,
  `search_catalogue`) returns `ok: false`.
- **Evidence:** `apps/api/src/server.ts`; `apps/api/src/agent/tools.ts`;
  `packages/sunscan-adapter/`.

### 4.4 No `GEMINI_API_KEY`, so the live model path is unverified

- **Plan assumption** (§7.1, §11.3, §11.13): real Gemini chat, streaming, latency and
  failure handling.
- **Reality:** no `GEMINI_API_KEY` is available in this environment. `loadConfig`
  therefore leaves `config.gemini` undefined and `capabilityReport` reports
  `chat: { available: false }`; `UnconfiguredProvider` **refuses** rather than faking
  a reply. The only exercised chat path is `apps/api/test/pipeline.test.ts`, which runs
  against a `ScriptedProvider`, not a live model. The plan's own smoke script treats an
  unconfigured chat as an honest pass unless `SMOKE_EXPECT_CHAT=1` is set.
- **Evidence:** `apps/api/src/config.ts`; `apps/api/src/agent/provider.ts`;
  `apps/api/test/pipeline.test.ts`; `scripts/smoke-api.mjs`.

### 4.5 Retrieval isolation is unproven, and retrieval is not implemented

- **Plan assumption** (§3.1, §7.2): managed Vertex AI Search provides strict
  per-tenant isolation; the RAG pipeline is per-tenant.
- **Reality:** `docs/discovery-google-services.md` §4 records that Vertex AI Search
  ACLs are **Preview** and allow-list only (no deny list), so hard per-tenant
  isolation is **unverified**. Independently, none of the retrieval path is built:
  `retrieve_knowledge` returns `configured: false` (no sources) or
  `pending: 'ingestion-not-implemented'`, and `knowledgeSourceCount` is always 0
  because `DEMO_TENANT.knowledgeSourceIds` is empty.
- **Evidence:** `docs/discovery-google-services.md` §4; `apps/api/src/agent/tools.ts`
  (`retrieve_knowledge`); `apps/api/src/tenants.ts`.

### 4.6 The error-envelope comment contradicts the SunScan discovery

- **Plan/source assumption:** `packages/contracts/src/errors.ts` states the unified
  error envelope "mirrors the convention already used by SunScan".
- **Reality:** `docs/discovery-sunscan.md` records that **SunScan's routes have no
  unified error envelope** — error shapes differ per route. The comment asserts a
  convention the discovery says does not exist. The internal envelope is fine for
  Sunny's own APIs; it must **not** be assumed to describe SunScan's.
- **Evidence:** `packages/contracts/src/errors.ts`; `docs/discovery-sunscan.md`;
  `docs/integration/sunscan-contract.md`.

### 4.7 Storage, identity and hosting do not match the architecture diagram

- **Plan assumption** (§3.1): Firestore for data, Firebase Auth for identity, ADK for
  the agent, Cloud Run + Firebase Hosting for hosting.
- **Reality:** persistence is a JSONL `FileStore` on local disk (`store.ts`, kind
  `file-jsonl`); identity is a self-issued HMAC session token only (`sessions.ts`),
  with **no** Firebase Auth, memberships or roles; the agent is a direct
  `@google/genai` call (`provider.ts`) with **no** ADK dependency and no Vertex path
  (`location` is read but never used to construct the client); nothing is deployed.
- **Evidence:** `apps/api/src/store.ts`, `sessions.ts`, `agent/provider.ts`,
  `config.ts`.

### 4.8 Animation frame budget: 30 FPS, not ~60 FPS

- **Plan assumption** (§12): "character motion ~60 FPS on capable devices."
- **Reality:** the widget's render loop caps at 30 FPS — `const FRAME_MS = 1000 / 30`
  in `packages/widget/src/widget.ts`. No FPS measurement has been recorded.
- **Evidence:** `packages/widget/src/widget.ts` line 35.

### 4.9 `apps/marketing` — resolved this session

- **Plan assumption** (§6.1): a complete Next.js marketing site.
- **Reality then:** `apps/marketing/package.json` referenced `scripts/dev.mjs`
  and `scripts/build.mjs`, neither of which existed, and `src/` was empty. The
  root `dev:marketing` script failed.
- **Now:** the site is built and served, and `npm run build:marketing` is part
  of the browser suite (30 checks, 9 of them on this site). Two of the plan's
  §6.1 items are deliberately **not** built, and the reasons are recorded rather
  than glossed: an animation gallery (the theme presets are shown, but there is
  no gallery of every sequence) and any marketing claim that would need a
  customer to be true.
- **Evidence:** `apps/marketing/`; `tests/e2e/marketing.spec.ts`; D-15.

### 4.10 Minor wording mismatches

- Plan §5.2 describes "long black **rounded-rectangle** eyes"; the code renders an
  **egg/oval** eye (`render.ts` `eyeOutlinePath`, comment "the reference's egg-like
  eye"). The probe is the artwork, which the repository's measurements follow.
- Plan §5.3 A12 is "Charge panel/phone"; the built `charging-panel` sequence uses a
  **battery** prop, not a folding solar panel.
- Plan §5.3 A10 is "Arcade spin"; the built `celebrate-spin` is a celebratory spin and
  is not wired to an arcade game.

---

## 5. Constraints discovered

1. **Node ≥ 22**, npm workspaces, a single lockfile (`package-lock.json`). Line
   endings are pinned to LF via `.gitattributes`.
2. **Honest refusal is the house style.** A missing integration returns `ok: false` or
   a `pending:` marker; it never returns a plausible invention. `config.ts` refuses to
   boot in production on the development session secret. This is a product constraint,
   not a placeholder: "a visitor told I can't reach the pricing service is better served
   than one shown a made-up number."
3. **The model's arguments are input, never authorisation.** Tenant, session and price
   come from server-side context; `assertToolSurfaceClosed()` asserts every declared
   tool is on the approved list.
4. **Tenant isolation is a code convention, not a database guarantee.** `FileStore`
   partitions by `tenantId`; there is no Firestore rule set or row-level security
   behind it.
5. **The widget is Shadow-DOM isolated** and reads no host cookies or storage
   (`packages/widget/src/` contains no `cookie`/`localStorage`/`sessionStorage` access).
6. **No rate limiting** exists on any route, though plan §4 requires it.
7. **The only permitted source of SunScan truth is `docs/discovery-sunscan.md`.** The
   SunScan application itself must not be read.

---

## 6. What is deliberately not built yet

Absent from the repository, and stated here so no reader mistakes the plan for the
implementation:

- Any **deployment**: no Cloud Run container, no Firebase Hosting, no Terraform, no
  `infrastructure/terraform/*.tf`, no CI workflow files.
- Any **Firestore, Firebase Auth, Cloud Storage, Cloud Tasks/Pub-Sub, Secret Manager,
  Model Armor, Cloud Armor** usage. Persistence is local JSONL.
- Any **RAG**: no ingestion, no managed search, no Drive connector, no citations.
- Any **catalogue or recommendation** logic: `packages/solar-rules` is empty; the
  catalogue and recommendation tools return `ok: false`.
- Any **SunScan adapter** or HTTP call to SunScan.
- The **dashboard**, **tenant onboarding**, **billing (Stripe)**, **voice (Gemini
  Live)**, **email (Gmail)** and the **page-guidance host SDK** (only the in-widget
  `suggest_page_action` half exists).
- The **marketing site** and the **games / seasonal cosmetics** (A05–A18 of §5.3),
  which the plan itself defers behind the five flagship sequences.
- **E2E (Playwright), visual-snapshot, accessibility (axe), security-scanning and
  Terraform-validation** checks: the scripts or directories exist, the runnable tests
  do not.
- The **operational documents**: `docs/STATUS.md`, `docs/DECISIONS.md`,
  `docs/RELEASE_CHECKLIST.md`, `README_DEPLOY.md`, `docs/design/character-reference.md`.
