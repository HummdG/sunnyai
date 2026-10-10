# Status

**As of 2026-10-10.** Written against the tree as it exists, from commands run in
this session. Where something has not been executed, it says so rather than
describing what it would do.

This document is the honest answer to "how far along is this?" It is not a
roadmap. Section 7 of the plan requires that missing credentials, unavailable
platform features and mock-only implementations never be hidden, so the
blockers below are stated first and in full.

## The one-paragraph version

The character rig, the animation engine and the API's first vertical slice are
built, tested and green: **280 tests across 9 files**, a real fidelity comparison
against the supplied artwork, **26/26 API smoke checks** against a running server,
and **11 browser end-to-end checks** — including an axe accessibility pass — over
the widget mounted by its own embed snippet. The assistant itself **has never
answered a prompt**, because there is no model credential in this environment —
the deployment correctly refuses instead of simulating. Terraform exists and has
never been run. Five of the plan's fourteen API routes exist. Nothing has been
deployed anywhere. Sunny is not reachable by any customer, and by the plan's own
standard it must not be described as working until it is.

## Verified in this session

Every line below is a command that ran and its output.

| Check                          | Command                              | Result                                                              |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------- |
| Formatting                     | `npm run format:check`               | _All matched files use Prettier code style_                         |
| Lint                           | `npm run lint`                       | clean (ESLint, type-aware)                                          |
| Types                          | `npm run typecheck`                  | clean (`tsc --noEmit`, strict + `noUncheckedIndexedAccess`)         |
| Unit / contract / visual tests | `npm run test`                       | **280 passed (9 files)**                                            |
| Browser end-to-end             | `npm run verify:all`                 | **11 passed** (Chromium, real page, real API, real shadow DOM)      |
| Widget bundle                  | `npm run build`                      | 112.1 kB — **30.8 kB gzipped**                                      |
| Character lab bundle           | `npm run build`                      | 65.0 kB                                                             |
| API smoke                      | `npm run smoke`                      | **26/26 checks passed, exit 0**                                     |
| Dependency audit               | `npm audit --audit-level=high`       | **0 vulnerabilities**                                               |
| Committed secrets              | the CI job's `git grep`, run locally | clean — and proven to fire (below)                                  |
| Character fidelity             | `scripts/compare-reference.py`       | ink 0.4828, cream 0.7412 (see `docs/design/character-reference.md`) |

Runtime: Node v24.12.0 on Windows 11. The project declares `node >= 22`.

`npm run verify` is the fast gate (format, lint, types, unit); `npm run verify:all`
adds the widget build and the browser suite. They are separate because the browser
suite needs a downloaded Chromium (`npm run test:e2e:install`), and a gate that
cannot run on a fresh checkout is a gate people learn to skip.

The two security checks are the CI job's own commands, run locally because the
job itself cannot run until something is pushed (D-9). A scanner that has never
reported anything is an unverified scanner, so the secret grep was checked
against canaries — a Google-key shape, an `sk-` shape and a PEM header — in a
gitignored directory, and it caught all three while ignoring a benign line. Its
first real finding should not be the one that matters.

### What the tests actually cover

- **Character** (`packages/character`, 14 tests) — determinism, byte-identical
  replay, SVG accessibility, the closed prop vocabulary, gradient rules, and a
  deep-frozen snapshot of the canonical pose.
- **Animation engine** (`packages/animation-engine`, visual snapshots) —
  every sequence exercised across its motion, purity, no mutation of the base
  rig, every group resolved at every intensity, and that every declared
  `reducedMotionFallback` exists.
- **API** (`apps/api`) — config and capability reporting, the SSE contract,
  session tokens, tenant isolation, tool dispatch, lead capture (including that a
  submission without consent writes nothing, and that the caller cannot name the
  tenant it is filed against), qualification capture (including that an answer
  reaches the model's tool context and does **not** appear in the transcript, and
  that the standing map survives a restart), rate limiting (both the counter and
  the address resolution it keys on, including the case where a caller forges
  `X-Forwarded-For`), and the persistence layer.
- **Contracts** (`packages/contracts`) — the Zod schemas that are the single
  source of truth for the wire format.
- **Widget** (`packages/widget`) — the embed snippet's attributes and which wins,
  and the colour maths that keeps an arbitrary tenant brand legible.
- **Browser** (`tests/e2e`, Playwright + axe) — the widget mounted from its own
  snippet inside a shadow root, named from the API rather than the page, leaking
  no tenant internals, openable and closable from the keyboard, exposing the
  documented `window.sunny` handle, and audited by axe in three states (closed,
  open, and open with the composer enabled — the last because axe skips disabled
  controls, so the send button's contrast is only checked when it is live).

### Fixed in this session

- **The demo page had never actually loaded the widget.** The bundle was mounted
  under the URL `/sunny-widget.js`, but `serveStatic` treats a mount's prefix as a
  directory and strips it before resolving — so an exact match left an empty
  remainder, which means `index.html`, which does not exist in `packages/widget/dist`.
  The request fell through to the catch-all and 404'd. The page an integrator is
  told to copy from shipped an embed snippet that mounted nothing; nothing in the
  unit suite could see it, because no browser had ever fetched the file.
- **`data-api-url` was parsed and then discarded.** `optionsFromScript` computed
  `configured ?? script.src` and then used `new URL(script.src).origin` regardless,
  so every request went to whichever origin served the JavaScript. That is correct
  in exactly one deployment — the demo, where the bundle and the API share a host —
  and wrong in the case the attribute exists for: a bundle on a CDN calling an API
  elsewhere. The end-to-end suite caught it as two 404s against the demo server's
  own origin. Now pinned by six unit tests, including the CDN shape.
- **The widget's default brand colour failed WCAG AA.** The suggestion chips were
  `#FF6500` on `#FFF1E5` — 2.66:1 against the required 4.5:1 — and the visitor's
  own chat bubbles were white on the brand fill, 2.64:1, which is worse because it
  is the visitor's own words. This was not a tenant's mistake: it is the palette
  the widget ships with. The readable tone is now derived from the brand colour at
  mount (D-12), so it is correct for every installers' colour rather than for the
  one that happens to be orange.
- **Importing the widget module ran DOM side effects.** The auto-mount at the
  bottom of `index.ts` reached for `document` unconditionally, so a test importing
  it for `optionsFromScript` died with `ReferenceError: document is not defined`,
  and so would any bundler or SSR pass that evaluated the file. Guarded now, which
  also makes the intent explicit: mount when there is a document to mount into.
- **The lint config could not type root config files.** `playwright.config.ts` was
  linted without a TypeScript project, so every import typed as `any` and it
  reported seven _unsafe member access_ errors that described the missing project
  rather than the file. Root config files are now named in `tsconfig.json`, which
  fixes the lint errors and gets them typechecked by `tsc --noEmit` as well.
- **The smoke test's runtime data was committed.** `.data-smoke/` — a conversation
  transcript and a captured lead, appended to on every run — had been tracked since
  the leads increment. It is not sensitive (the address is `smoke@example.test`),
  but the installer dashboard reads leads, so a committed one is a phantom enquiry
  in history, and every smoke run dirtied the working tree. Now ignored, along with
  the browser suite's `.data-e2e/`.

- **`POST /v1/qualification/answer` now exists**, and records the answer without
  inventing dialogue. The obvious implementation was to append a synthetic user
  turn (`"Roof direction: south"`), which would have let `answersFromHistory` pick
  it up unchanged — and would have put words in the visitor's mouth and persisted
  them where the model reads the transcript as fact. Instead the conversation
  gained a first-class standing `answers` map (D-11). A test caught the first
  version of the fold-back recording the _whole_ accumulated map on every
  assistant turn rather than the delta, which made "what did this turn change"
  unanswerable; it now records only what it set or changed. Also extracted
  `validateAnswer`, so the tool and the route cannot drift apart about what counts
  as a valid answer.
- **`POST /v1/leads` now exists**, closing one of the two routes this document
  had falsely claimed was built. It reuses the `create_lead` rules rather than
  re-deciding them: consent must be exactly `true`, the tenant comes from the
  verified token rather than the body, and a lead with neither an email nor a
  phone is refused at the point the visitor can still fix it. Verified end to end
  — `201` with a `lead_…` id, and the row readable back from the installer's
  list. The route is rate limited per address, because it is the one unauthenticated
  write a visitor cannot undo. See D-11 for the sibling route that is deliberately
  _not_ built yet.
- **The API had no rate limiting at all.** `rate_limited`/429 existed in the
  error contract and nothing could ever return it. `POST /v1/widget/session` is
  unauthenticated and writes a conversation record; `POST /v1/chat/stream` calls
  a model and bills per token. Either could be driven in a loop — a denial of
  wallet with no data to steal and nothing to detect. Both routes are now limited
  (session creation per client address, chat per session, checked _before_ the
  provider resolves so a refused turn costs nothing). Verified against a running
  server with `SUNNY_RL_SESSION_LIMIT=3`: three 200s, then `429` with
  `retry-after: 60` and the shared envelope. Details and the limits of the
  approach in `docs/DECISIONS.md`, D-10.
- **The smoke test could not fail the build.** It printed _"17/17 checks
  passed"_ and exited **127** on Windows: `process.exit()` tore the process down
  while `fetch`'s pooled keep-alive socket was still closing, tripping a libuv
  assertion. It now sets `process.exitCode` and lets the loop drain. Verified in
  all three directions: pass → 0, unreachable server → 1, expected-chat-but-
  unconfigured → 1.
- **The eyes were transposed.** The left eye carried the lean and the smaller
  size; the reference has them the other way round. Measured long axes were
  +76.5°/+85.4° against the reference's +89.6°/+76.6°. Corrected, along with the
  highlight width, the eye tilt now matches to **0.2°**. Cream-mask IoU
  0.567 → 0.741. Details in `docs/design/character-reference.md`.
- **`compare-reference.py` reported its own frame to one decimal**, which hid
  sub-pixel changes to the detected body radius that were large enough to
  resample the whole disc. Now four decimals, with the classifier's antialias
  blind spot documented rather than quietly worked around.

## Blockers

Ordered by what stops a customer from using Sunny, not by effort.

### 1. No model credential — the assistant has never answered

`GEMINI_API_KEY` is not set in this environment. `GET /healthz` reports:

```json
"chat": { "available": false, "model": null,
          "reason": "GEMINI_API_KEY is not set. Chat is disabled rather than
                     simulated: run with a key to exercise the assistant." }
```

The smoke run takes the `not_enabled` branch and explicitly skips the live turn.
So the streaming path, tool-calling, and the whole `POST /v1/chat/stream`
contract have been exercised against a **scripted provider**, never against the
model. This is the single largest gap between "the code is complete" and "it
works", and no amount of further unit testing closes it.

### 2. `gemini-2.5-pro` retires in ten days

The escalation model is GA today and **retires 2026-10-20**; its successor is
preview-only. Ten days from the date of this document. This is recorded in the
ADR set with a _"Unknown — needs verification"_ marker, but it is not an unknown
— it is a dated event, and the fallback has not been chosen or tested.

### 3. Nothing has been deployed, and Terraform has never been run

`infrastructure/terraform/` is written and has never had `init`, `plan` or
`validate` run against it, because no `terraform`, `tofu` or `gcloud` binary is
installed in this environment. The CI job that runs `fmt -check` and
`validate -backend=false` **has never executed either** — the repository is not
on GitHub in a form CI can see (see blocker 7). Treat the infrastructure as a
description of intent that compiles, not as infrastructure known to work.

### 4. Five of the plan's fourteen API routes exist

Implemented: `POST /v1/widget/session`, `POST /v1/chat/stream`,
`GET /v1/widget/config/:publicId`, `POST /v1/qualification/answer`,
`POST /v1/leads`, plus `GET /healthz`, `GET /v1/conversation` and
`GET /v1/leads` (none of those three is in the plan's list).

**Corrected and then resolved on 2026-10-10:** this section previously claimed
`POST /v1/leads` was implemented. It was not — only `app.get('/v1/leads', …)`
existed, so the count was **three**. The claim was wrong when written, and was
fixed by correcting the count rather than by hurrying out a route to make the
sentence true. `POST /v1/leads` and then `POST /v1/qualification/answer` have
since been built, so the count is now **five**. Both also still happen through the
conversation, via the `create_lead` and `save_answer` tools; each pair writes the
same record.

Absent, each with nothing behind it:
`GET /v1/catalog/products`, `POST /v1/recommendations`,
`POST /v1/sunscan/assessments`, `GET /v1/sunscan/assessments/:id`,
`GET /v1/dashboard/metrics`, `POST /v1/knowledge/sources`,
`GET /v1/knowledge/jobs/:id`,
`POST /v1/integrations/google-drive/connect`, `POST /v1/billing/webhook`.

So catalogue search, recommendation, assessment hand-off, knowledge ingestion,
Drive, billing and the dashboard are **not implemented**. The widget can hold a
conversation, capture qualification answers and save a lead; it cannot yet
recommend a package, and there is no product data to recommend from.

### 5. There is no SunScan integration, only a model of one

Discovery read SunScan's questionnaire, lead schema, journey and pricing modules
under the narrow authorisation given for that purpose. **No SunScan endpoint has
ever been called from this code.** `packages/sunscan-adapter` is a stub.
Findings that matter to anyone planning the integration:

- SunScan has **no unified error envelope** — route handlers return differing
  shapes — so the adapter must translate per route rather than assume a format.
- The finance/APR calculators and the grants logic the plan refers to are
  **not present** in SunScan. `calculate_approved_estimate` has nothing to call.
- **The catalogue, recommendation and estimate tools are deliberately refusing,
  not merely unimplemented.** `search_catalogue`, `recommend_packages` and
  `calculate_approved_estimate` all return a refusal with a reason, and the
  reasoning is written into the code: the installer's prices are the installer's
  commercial data, and two different prices for the same roof is worse than no
  price. So "make the widget able to recommend" is not a matter of writing the
  route — it is blocked on the integration, and doing it any other way would mean
  inventing commercial data. This is the right design and it is worth stating
  plainly, because the obvious next task looks like a build item and is not one.

### 6. Platform capabilities that are preview, capped, or undocumented

Each of these is an assumption the architecture leans on. None is settled by a
vendor guarantee:

- **Vertex AI Search tenant ACL isolation** is Preview and no absolute isolation
  guarantee is documented. Multi-tenant retrieval isolation rests on it.
- **Deploying a TypeScript ADK agent to Agent Runtime is undocumented.** The
  chosen agent path has no published deployment story.
- **Model Armor's behaviour when it fails is undocumented.** Whether a failure
  is open or closed is a safety decision, and it is currently neither.
- **Firebase App Check caps at 250 domains.** That bounds tenant scale and has
  not been validated against the plan's growth assumptions.
- **Cloud Run buffers SSE at 300 s by default, 3600 s maximum.** Long
  conversations will be cut without an explicit timeout and keep-alive.

### 7. The repository is not under version control

`C:\Work\Arkalith\sunny-ai` **is not a git repository.** It has a `.gitignore`
and a `.github/workflows/ci.yml`, so it was scaffolded as one — but there is no
`.git`, and none of the work above is committed anywhere.

Meanwhile `C:\Work\Arkalith\SunScanV2` _is_ a repository whose remote is
`https://github.com/HummdG/sunny.git` — a repository named **sunny** that
currently holds **SunScanV2's** history (roof geometry, cross-gable fitting),
not this project. The plan document and `sunny.png` also live in `SunScanV2`,
while the implementation lives in the sibling directory.

So "push the work" has no obvious destination, and the remote named `sunny`
belongs to a different codebase. **This needs a decision from the user** — see
`docs/DECISIONS.md`, D-9. It is not resolvable from inside the code.

### 8. Not built at all

`packages/ui`, `packages/solar-rules` and `packages/sunscan-adapter` are
`package.json`-only stubs. `apps/dashboard` and `apps/marketing` do not exist.
`tests/e2e`, `tests/security` and `tests/visual` are empty directories.

### 9. Section 12's required checks, honestly accounted

| Required check                 | State                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| Formatting / lint              | **done**, in CI and locally                                                |
| Typecheck                      | **done**                                                                   |
| Unit tests                     | **done** — 280                                                             |
| Contract tests                 | **done** — Zod schemas exercised through the routes                        |
| Integration tests              | **partial** — the API is exercised in-process, not across a network        |
| E2E (Playwright)               | **done** — 11 checks in Chromium against the real page, API and shadow DOM |
| Visual snapshots               | **done** as Vitest snapshots; not pixel-diffed against the reference in CI |
| Accessibility (axe)            | **done** — three widget states, failing at `serious` and above             |
| Dependency / security scanning | **commands run and passing**; the CI _job_ has still never run             |
| Terraform validation           | **written, never executed**                                                |
| Smoke test                     | **done**, and now exits 0 when it passes (blocker 1 aside)                 |

Two honest footnotes on the rows above. The axe pass is a floor: it finds a
missing label, a contrast failure or a role-less dialog, and it cannot tell you
whether the assistant is any good, whether the focus order makes sense, or whether
the motion is tolerable — none of which a machine can check. And the browser
suite audits the states reachable without a model key, which is why the visitor's
own chat bubble is covered by a direct colour assertion rather than by a rendered
message (D-12 records why).

### Known, and deliberately not fixed

- **Fastify deprecates `disableRequestLogging`** (`FSTDEP023`, removed in
  `fastify@6`), which the server set to suppress per-request logging under test.
  The replacement is the `logController` option. It has not been changed here
  because that option governs whether requests carrying a bearer token are logged,
  and nothing in the suite would notice if the replacement were wired wrong in the
  quiet direction. It is correct on the installed Fastify (5.12.5) and is worth
  doing as its own change, with a test, rather than as a footnote in this one.

## What is genuinely solid

So the blockers above are read in proportion: the parts that are done are done
properly rather than sketched.

- **The character is measured, not approximated.** Every number traces to a
  source-pixel measurement, the comparison is objective, and the one real defect
  found was found by the tool rather than by opinion. Residual discrepancies are
  written down in `docs/design/character-reference.md` rather than rounded away.
- **The rig is a pure function of a serialisable pose**, so replay is
  deterministic and fidelity is a testable property of data rather than of a
  timeline that has to be watched.
- **The contract is one set of Zod schemas**, and the stream is a discriminated
  union — so an event the UI does not understand is a type error, not a silent
  no-op.
- **An unconfigured deployment refuses rather than simulates.** There is no mock
  provider shipped in the server, deliberately: a fake that answers plausibly is
  worse than an error, because nobody goes looking for it.
- **Tenant isolation is enforced and tested**, including that an internal tenant
  id and the SunScan slug never appear in a public response.

## Next actions, in order

1. **Decide the repository destination** (blocker 7). Nothing else is
   recoverable until the work is versioned somewhere.
2. **Set a model credential and run one live turn.** Everything downstream
   depends on whether the real model behaves like the scripted one.
3. **Choose the escalation model** before 2026-10-20 (blocker 2).
4. Run the CI job at least once, so Terraform and the security scan stop being
   unexecuted code.
5. **Connect the SunScan adapter** (blocker 5). This replaces an earlier version
   of this item that said to "build the catalogue and recommendation routes" —
   that was wrong, and worth correcting rather than quietly dropping. The
   catalogue and recommendation tools already exist and **deliberately refuse to
   answer**, on the reasoning that the installer's prices are the installer's
   data and that one product receiving two different prices is worse than no
   price at all. Building a catalogue here would mean inventing commercial data,
   which the plan forbids and which the existing design argues against in
   comments. The gap is not a missing route; it is a missing integration. The
   widget is genuinely less useful without it, but the fix is a SunScan contract
   and credentials, not more code in this repository.
6. **Nothing left in blocker 4 is reachable without external input.** Every
   remaining route is blocked on something outside this repository:

   - `GET /v1/catalog/products`, `POST /v1/recommendations` and
     `POST /v1/sunscan/assessments` need a real SunScan contract and credentials.
     The tools behind them **deliberately refuse** rather than invent prices, so
     writing routes here would produce endpoints that return refusals.
   - `POST /v1/knowledge/sources` and `GET /v1/knowledge/jobs/:id` need Vertex AI
     Search. `POST /v1/integrations/google-drive/connect` needs a Google OAuth
     client and a consent screen. `POST /v1/billing/webhook` needs a billing
     provider and its signing secret. `GET /v1/dashboard/metrics` needs a
     decision about what an installer should see, which is a product decision
     before it is a route.
   - `POST /v1/qualification/answer` and `POST /v1/leads` are **done**.

   So the next honest step is not another route. It is either the SunScan
   contract (item 5) or a model credential (item 2) — each of which turns a
   mocked or refusing surface into a real one.
