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
built, tested and green: **243 tests across 7 files**, a real fidelity comparison
against the supplied artwork, and **21/21 API smoke checks** against a running
server. The assistant itself **has never answered a prompt**, because there is no
model credential in this environment — the deployment correctly refuses instead
of simulating. Terraform exists and has never been run. Four of the plan's
fourteen API routes exist. Nothing has been deployed anywhere. Sunny is not
reachable by any customer, and by the plan's own standard it must not be
described as working until it is.

## Verified in this session

Every line below is a command that ran and its output.

| Check                          | Command                        | Result                                                              |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------- |
| Formatting                     | `npm run format:check`         | _All matched files use Prettier code style_                         |
| Lint                           | `npm run lint`                 | clean (ESLint, type-aware)                                          |
| Types                          | `npm run typecheck`            | clean (`tsc --noEmit`, strict + `noUncheckedIndexedAccess`)         |
| Unit / contract / visual tests | `npm run test`                 | **243 passed (7 files)**                                            |
| Widget bundle                  | `npm run build`                | 109.4 kB — **29.6 kB gzipped**                                      |
| Character lab bundle           | `npm run build`                | 65.0 kB                                                             |
| API smoke                      | `npm run smoke`                | **21/21 checks passed, exit 0**                                     |
| Character fidelity             | `scripts/compare-reference.py` | ink 0.4828, cream 0.7412 (see `docs/design/character-reference.md`) |

Runtime: Node v24.12.0 on Windows 11. The project declares `node >= 22`.

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
  tenant it is filed against), rate limiting (both the counter and the address
  resolution it keys on, including the case where a caller forges
  `X-Forwarded-For`), and the persistence layer.
- **Contracts** (`packages/contracts`) — the Zod schemas that are the single
  source of truth for the wire format.

### Fixed in this session

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

### 4. Four of the plan's fourteen API routes exist

Implemented: `POST /v1/widget/session`, `POST /v1/chat/stream`,
`GET /v1/widget/config/:publicId`, `POST /v1/leads`, plus `GET /healthz`,
`GET /v1/conversation` and `GET /v1/leads` (none of those three is in the plan's
list).

**Corrected on 2026-10-10:** this section previously claimed `POST /v1/leads` was
implemented. It was not — only `app.get('/v1/leads', …)` existed, so the count was
**three**. The claim was wrong when written, and was fixed by correcting the count
rather than by hurrying out a route to make the sentence true. `POST /v1/leads`
now exists and the count is **four**. Creating a lead also still happens through
the `create_lead` tool in the conversation; the two paths write the same record.

Absent, each with nothing behind it: `POST /v1/qualification/answer`,
`GET /v1/catalog/products`, `POST /v1/recommendations`,
`POST /v1/sunscan/assessments`, `GET /v1/sunscan/assessments/:id`,
`GET /v1/dashboard/metrics`, `POST /v1/knowledge/sources`,
`GET /v1/knowledge/jobs/:id`,
`POST /v1/integrations/google-drive/connect`, `POST /v1/billing/webhook`.

So qualification capture, catalogue search, recommendation,
assessment hand-off, knowledge ingestion, Drive, billing and the dashboard are
**not implemented**. The widget can hold a conversation and save a lead; it
cannot yet recommend a package, and there is no product data to recommend from.

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
| Unit tests                     | **done** — 206                                                             |
| Contract tests                 | **done** — Zod schemas exercised through the routes                        |
| Integration tests              | **partial** — the API is exercised in-process, not across a network        |
| E2E (Playwright)               | **absent** — dependencies not installed                                    |
| Visual snapshots               | **done** as Vitest snapshots; not pixel-diffed against the reference in CI |
| Accessibility (axe)            | **absent**                                                                 |
| Dependency / security scanning | **written, never executed** — the CI job has not run once                  |
| Terraform validation           | **written, never executed**                                                |
| Smoke test                     | **done**, and now exits 0 when it passes (blocker 1 aside)                 |

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
6. **`POST /v1/qualification/answer`** — the last of the plan's routes that does
   **not** depend on SunScan data. It reuses the question set and its option
   validation, which already exist. `POST /v1/leads`, the item that used to sit
   here alongside it, is **done** (see "Fixed in this session"). The caveat found
   while scoping this one is recorded in `docs/DECISIONS.md` D-11: an answer given
   to the route needs somewhere to live that is not the chat transcript, so the
   route wants a first-class answers map on the conversation rather than a
   synthetic turn. That is a small schema decision, not a large one, but it should
   be made deliberately rather than as a side effect of adding a route.
