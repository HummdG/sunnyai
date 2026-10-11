# Status

**As of 2026-10-11.** Written against the tree as it exists, from commands run in
this session. Where something has not been executed, it says so rather than
describing what it would do.

This document is the honest answer to "how far along is this?" It is not a
roadmap. Section 7 of the plan requires that missing credentials, unavailable
platform features and mock-only implementations never be hidden, so the
blockers below are stated first and in full.

## The one-paragraph version

The character rig, the animation engine, the API's first vertical slice and the
public marketing site are built, tested and green: **1034 tests across 31 files**,
a real fidelity comparison
against the supplied artwork, **25 committed visual baselines** of the character
compared byte for byte, **27/27 API smoke checks** against a running server,
and **58 browser end-to-end checks, none failing** — including an axe
accessibility pass — over the widget mounted by its own embed snippet, in a React
host page, in a Next.js host page, on a WordPress-shaped host page, and on the
marketing site, which runs the real widget and the real character rather than
pictures of them, and which now has a **measured Lighthouse baseline** against a
committed budget. An earlier version of this paragraph read "44 of 46" and
attributed the two missing checks to the character lab; that reading was wrong
and is corrected below and in item 9 — they were a stale dev API being reused at
its shipped rate limits, not a failing test (D-40). The
assistant itself **has never answered a prompt**, because there is no model
credential in this environment — the deployment correctly refuses instead of
simulating. Terraform exists and has
never been run. Ten of the plan's fourteen API routes exist, and the two that
reach an installer's own documents answer from a lexical index built here rather
than the managed retrieval service the plan names. Nothing has been
deployed anywhere. Sunny is not reachable by any customer, and by the plan's own
standard it must not be described as working until it is.

## Verified in this session

Every line below is a command that ran and its output.

| Check                                      | Command                                                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting                                 | `npm run format:check`                                                                                                         | _All matched files use Prettier code style_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Lint                                       | `npm run lint`                                                                                                                 | clean (ESLint, type-aware)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Types                                      | `npm run typecheck`                                                                                                            | clean (`tsc --noEmit`, strict + `noUncheckedIndexedAccess`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Unit / contract / visual tests             | `npm run test`                                                                                                                 | **1034 passed (31 files)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Browser end-to-end                         | `npm run test:e2e`                                                                                                             | **58 passed, 0 failed** in the run of 2026-10-11, after D-47 repaired the three `lab.spec.ts` checks the D-46 release run exposed — a test-design repair, with the diagnosis, the fixes and every earlier reading recorded in item 10 below. The row before this one read **57 passed, 1 failed**; those three checks were **pre-existing lab checks, not D-46's**, and the day's investigation reproduced them against a stashed tree rather than arguing they could not be D-46's. The green reading before _that_ was the **58 passed, 0 failed** this suite last reported ahead of D-46, so what moved was the lab spec's own checks rather than the product. The row also, at an earlier date, said **44 passed, 2 failed**, attributed to `lab.spec.ts` "reproducing at HEAD" — and that conclusion was wrong, which is why the D-46 investigation repeated the control instead of believing it. A stale dev API on 8787 was being reused with the shipped rate limits, so a late test was starved of its session and rendered a panel with no option card — see item 9 below and D-40, and `playwright.config.ts` no longer reuses it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Widget bundle                              | `npm run build:widget`                                                                                                         | 152.1 kB — **42.4 kB gzipped**. The device-cutout support and its comments (D-41) are +3.5 kB raw / +1.2 kB gzipped of that. The `!important` on every declaration in the shadow stylesheet's `:host` block (D-36, the WordPress fixture) is +1.6 kB: the same build before it is 147.0 kB / 40.6 kB gzipped, and the paint guard before that 146.7 kB. The figure in this row had sat at 131.5 kB / 36.5 kB gzipped since A11, and the 29.6 kB quoted in D-1 is older still; both predate the option cards (D-28) and the A09–A11 prop geometry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Character lab bundle                       | `npm run build:lab`                                                                                                            | 141.3 kB, plus the lazily-loaded arcade chunk at 11.9 kB (A08). The row's previous 140.8 kB was measured at A11 and had fallen about 0.4 kB behind the committed bundle, which D-34's theme-colour fix grew without this row being updated; this reading picks that up and adds D-47's **+90 bytes** for the rally count the pong panel now publishes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| API smoke                                  | `npm run smoke`                                                                                                                | **27/27 checks passed, exit 0** — the admin routes are skipped and the skip is printed, because this run passes no `SMOKE_ADMIN_TOKEN` to a deployment that has one. With the secret in the run the same script reports **34/34**, exercising knowledge onboarding end to end; against a token-less deployment, **29/29**, where the admin routes are asserted to refuse rather than half-work. All three re-run today. The lead-list check is two-mode since `GET /v1/leads` became admin-only: with the token it reads the filed lead back the way the installer's dashboard will, without it it asserts the visitor is refused. It is the check that caught this change, having failed 26/27 on the visitor read-back it used to make (D-39)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Dependency audit                           | `npm audit --audit-level=high`                                                                                                 | **0 vulnerabilities**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Committed secrets                          | the CI job's `git grep`, run locally                                                                                           | clean — and proven to fire (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Character fidelity                         | `scripts/compare-reference.py`                                                                                                 | ink 0.4828, cream 0.7412 (see `docs/design/character-reference.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Visual baselines on Linux                  | the committed tree in a `node:22-bookworm` container (`npm ci` + `vitest run tests/visual`)                                    | **27 passed** — the Windows-generated PNGs, including the posed `paddle-from-ray` (A09), the two arcade-spin scenes (A10) and the two planting scenes (A11), are byte-identical to the ones Linux produces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Catalogue & recommendations                | the running API on 8787, seeded with `npm run seed:catalogue fixtures/demo-catalogue.csv` (10 _fictional_ demo rows)           | **the golden scenario, live**: 3 priced options at 4 kWp; `{"requireBattery":true}` and then `{"preferCheaper":true}` each merge onto the stored want (`{"targetKwp":4}` → `+requireBattery` → `+preferCheaper`) and add a 5 kWh battery to every option; adding a GBP 3,000 budget on top honestly returns **no** options rather than exceed it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Option cards (widget surface)              | `npm run verify` + `npx playwright test tests/e2e/widget.spec.ts tests/e2e/accessibility.spec.ts`                              | **732 unit tests green**, and **16 browser checks green** over the rendered cards — the widget reads `GET /v1/recommendations` back at mount and paints the option set, with the axe audit over the card-bearing panel clean at `serious` and above (D-28)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Knowledge sources (P6)                     | `npm run verify` + `node scripts/smoke-api.mjs` + `curl` against the running API on 8787                                       | **822 unit tests green across 24 files**, and the two routes exercised over real HTTP two ways: the smoke script, which now covers them in all three modes (34/34 with the admin token in the run, 29/29 against a token-less deployment, 27/27 plus a printed skip when the token is configured but withheld), and `curl` directly — `POST /v1/knowledge/sources` refuses without the admin token (401) and with it returns 3 passages for a 340-character warranty page, read back by job id, with the same job id under another tenant a 404. Retrieval through a chat turn is covered by a scripted provider only — chat needs the credential in blocker 1 (D-29)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Conditional questionnaire (P7)             | `npm run verify`, then `fetch` against the running API on 8787                                                                 | **822 unit tests green across 24 files**, and the answer route exercised live: `usage_source=monthly_cost` then `annual_kwh=4200` is a 400 reading `that question is not asked, given an earlier answer — it needs usage_source to be one of bill_ocr, manual_kwh (it is "monthly_cost")`; `monthly_cost=£150` is accepted and stored verbatim; `annual_kwh=quite a lot` is refused as `value is not a number: a number of kWh`; `4,200` is accepted and stored as typed; `999999` is refused as `value is outside the range that makes sense: a number of kWh between 1 and 100000`; `household_size=6` is refused as `value not among the allowed options: 1, 2, 3, 4, 5` (D-30). And correcting an answer live (D-31): `usage_source=monthly_cost` then `monthly_cost=150` then `usage_source=household` returns `answers: {"usage_source":"household"}` with `removedAnswers: [{questionId: "monthly_cost", value: "150", ruledOutBy: {questionId: "usage_source", value: "household"}}]`, while an unrelated write returns `removedAnswers: []`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Lead idempotency (P14)                     | `npm run verify`, then `curl` against the running API on 8787, across a real process restart                                   | **830 unit tests green across 24 files**; the smoke script re-run in all three modes for this change, **27/27** / **29/29** / **34/34**. Live: two byte-identical submissions are a `201` with `duplicate: false` and then a `200` with `duplicate: true` and the _same_ `leadId`, and the installer's list stays at one row; the same key arriving with a changed phone number is a `400` naming `clientLeadId`, with the first row standing; and the replay is still recognised after the process is restarted, because the key is kept on the row (D-33)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Theme paint guard (§9)                     | `npm run verify` + `npx playwright test tests/e2e/widget.spec.ts tests/e2e/accessibility.spec.ts`                              | **833 unit tests green across 24 files**, and **16/16 browser checks** against the rebuilt bundle — the axe pass over the card-bearing panel and the check that reads `--sunny-accent-ink` back off the host both included. The repro is a test now: a theme of `"><img src=x onerror="alert(1)">` renders no element and no handler and falls back to `SUNNY_THEME`, eleven legitimate colour forms pass through untouched, and eight near-misses are refused (D-34)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Cross-tenant denial (D-35)                 | `npm run verify` (the suite is `tests/security/tenant-isolation.test.ts`)                                                      | **953 unit tests green across 27 files**, 107 of them this suite: the registered route table asserted equal to the declared one (14 routes), each swept against 7 credentials — 98 access cases asserting the _right_ refusal code, plus 9 behavioural ones. Two deliberate breaks were made, observed and reverted: removing the `sessionId` check from `POST /v1/leads` reddened exactly the two cross-tenant cases and nothing else, and ingesting both fixtures under one tenant emptied the other tenant's lookup. **The admin token is deployment-wide**, so on the two installer write routes the tenant is a caller's choice — recorded in the entry, and in the §4 row for blocker 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Device cutout & host failure (§6.2, §11.2) | `npm run verify` + `npx playwright test tests/e2e/resilience.spec.ts`                                                          | **953 unit tests green across 27 files**, and **5 browser checks green**. The launcher measures the plain 20px from each viewport corner, then 68px once a 48px cutout is declared on the host element, and the small-screen breakpoint narrows the gutter to 12px and still adds the inset. Three cases of a dead API — every route unreachable, the session route refused while config answers, and a stream that dies mid-turn — leave the host page's own script and navigation working, with no uncaught error and no console error other than the failed requests the fixture asked for. Falsified both ways: restoring the plain `inset` reddens the two geometry checks (48px ignored), and reinstating the widget's fetch throws reddens all three outage checks with `uncaught: Failed to fetch`; removing `ChatClient`'s catch instead leaves the transcript with no error turn at all (D-41, D-42)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit trail (§4, §9)                       | `npm run verify` + `npx vitest run apps/api/test/audit.test.ts tests/security/tenant-isolation.test.ts`                        | **1034 unit tests green across 31 files**; the two-file run is **146 passed**, 8 of them the audit suite and 138 the isolation suite (it was 115 when this row was written, up 8 then because the route inventory gained `GET /v1/audit/events` so the credential sweep gained its row, and up 23 since because the inventory has gained three routes -- the two visitor erasures, `DELETE /v1/conversation` and `DELETE /v1/leads/:leadId`, and the dashboard metrics read -- each of which the sweep now exercises against all seven credentials). The dashboard row is the sweep earning its keep in the unglamorous direction: `GET /v1/dashboard/metrics` hands over no visitor data, so it is deliberately not audited (D-46), and that is exactly the reason it is easy to forget it still needs a credential. The sweep does not forget. A behavioural case proves two tenants' event-id sets are disjoint. The design point is enforced by the record's _shape_: `detail` is `z.record(z.string(), z.union([z.number(), z.boolean()]))`, so no string can travel in it, and the suite plants five markers — a document body, a document title, a catalogue model name, a visitor email, a lead summary — searches the stored bytes for all five while asserting the action names _are_ there. Three deliberate breaks were made, observed and reverted: dropping the denial record reddened the refused-credential case, emptying `EFFECTFUL_TOOL_NAMES` reddened the tool-call cases, and injecting the document title into `detail` as a string reddened the no-content and numbers-only cases together (D-43)                                                                                                                                                                                                                                                                                                                                |
| Consent, retention & deletion (§4)         | `npm run verify` + `npx vitest run apps/api/test/consent.test.ts apps/api/test/retention.test.ts apps/api/test/config.test.ts` | **1034 unit tests green across 31 files**: 15 of them the consent suite, 8 the retention suite, 7 new in the config suite, and the isolation suite's two new erasure routes swept against all seven credentials. **The new tests found three real defects, and this is the row's actual result** — none was a test's fault: `#ensure` guarded the store's load with a boolean read across an `await`, so the boot-time retention sweep and the first request both saw "not loaded" and every enquiry landed in memory twice (and would have been written back twice by the next rewrite); two rewrites in flight at once shared one scratch filename and one in-memory snapshot, so an installer erasing a record while the deployment swept could have the erased row swapped back onto disk; and `deleteConversation` returned early when a visitor had no transcript, which is every visitor the form route serves, so erasing their record was a lie told over an untouched row. All three are fixed and the pair of overlapping writes is now a test. What is recorded as consent is only what the server _observed_ — a server-owned wording `version`, the `surface`, and the origin in the _signed_ session, never a caller's claim — and a lead's `createdAt` is its consent instant, so no second timestamp is stored. No deliberate break was planted for this row, and the reason is the three defects above: each was a real bug in code that had already passed the suite, so the suite's discriminating power is shown by what it caught rather than by what it was made to catch. The retention counts are asserted against the bytes on disk and not against the sweep's own return value, which is exactly the shape of the bug they would otherwise miss (D-44)                                                                                                                                                                       |
| Marketing performance (P3, §12)            | `npm run perf:marketing` against the built site on 4176, with the API on 8787                                                  | **Five of six lab-measurable metrics meet the Lighthouse good-range boundary** over five runs of one build: LCP 1857–2249 ms (good ≤ 2500), CLS **exactly 0** every run (good ≤ 0.1), FCP 755–768 ms, SI 777–1040 ms, TTFB 3–15 ms, score 0.89–0.97. **Total blocking time is the one short of the goal** — 162–386 ms against 200 ms — and that spread is why the budget is ~1.5× the worst run rather than the good-range figure: a threshold set from one run would be a threshold on run-to-run variance. The budget, the five runs and the limits (lab not field, one machine, TTFB is a local file read) are in `docs/performance/marketing.md` (D-45)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Dashboard metrics (P10, §6.4)              | `npm run verify` + `npx vitest run apps/api/test/dashboard.test.ts tests/security/tenant-isolation.test.ts`                    | **1034 unit tests green across 31 files**, 11 of them the new dashboard suite; the two-file run is **146 passed** — 8 audit and 138 isolation, the isolation suite earning its keep in the unglamorous direction, on a route that hands over no visitor data and so is easy to forget still needs a credential. The route answers §6.4's Overview with **eleven counts and two ratios** over a half-open UTC window the caller may widen (`days`, 1..365, a **400 rather than a silent clamp**, echoed back in `range`): conversations started and active, visitor and assistant turns, leads captured and leads with a way to reach the visitor, knowledge sources, catalogue products. **Two of the plan's five words are left unanswered on purpose**: "qualified leads" has no count because both lead-writing paths store `score: null`, so the honest figure is absent rather than `0`, and "usage" is absent entirely because nothing meters it — while "source health" is a count of documents, named for what it counts, because health in the plan's sense needs the blocked Drive sync. A ratio whose denominator is zero comes back `null`, never `0`, because "0%" and "no data yet" are different facts. Deliberately **not audited** — it exposes no visitor data, so there is nothing for a trail to explain — while still behind the admin token, which is what the sweep's new row asserts: "no data" is not "no credential" (D-46). Also exercised **live over HTTP** against the API on 8787 with a real admin token and an empty store: 401 with no token and with a wrong one, 404 for a tenant that is not this deployment's, `days=400` a 400 whose `details` name the bound (`"Number must be less than or equal to 365"`) rather than a clamped window, and a 200 whose body is every count at `0` with **both ratios `null`** — the no-denominator rule visible in one response, a `"0%"` a reader would have believed (D-46) |
| Lab checks, repaired (A06/A09)             | `npx playwright test` — all six servers started by the config, `PW_REUSE_API` unset                                            | **58 passed, 0 failed, 3.0 m** — the first green reading of the whole browser suite since the D-46 gate exposed three `lab.spec.ts` checks failing. The three are fixed rather than retried, and each was a check asserting an _instantaneous_ reading of something moving: the catalogue walk against a **30 s budget** it was measured to exceed (**39.4 s** loaded, **14.8 s** idle, now given **120 s**); `toContainText('thinking-')` against a label up for **600–800 ms** (now the catalogue card's cumulative mark for the `think` group, asserted absent before the click and present after); and `data-hits` `"0"` against a rally that is running again within ~250 ms (the pong panel now publishes a monotonic `data-rallies`, and the check requires it to have advanced by exactly one). The only non-test change is that published count — +90 bytes on the lab bundle — and the failing readings, the control run and the diagnosis are all kept in item 10 (D-47)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

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

### What §13 verified this session

The scripts are not a deployment and do not claim to be, so what was actually
executed is worth separating from what was merely written.

Ran: `scripts/verify-isolation.ts` against a live local API — 8/8 checks green,
then green→red→green with the fix it measures reverted and restored, so the
sweep localises that defect instead of reddening wholesale; four configurations
(including the two guards that make it refuse to report a sweep that would prove
nothing) all with the documented exit codes. `scripts/seed-demo.ts` loaded the
real demo catalogue and the fictional knowledge document through the real admin
routes. `npm run build:marketing` compiled the site (Next 16.4.0, three static
pages) and copied the widget bundle into it. Every script's argument and refusal
path ran: `--help` 0, unknown argument 2, `--apply` without a project 2, a
non-URL base 2, `rollback.sh` 3.

Not ran, and said so where it matters: `terraform init`, `plan`, `apply`;
anything needing `gcloud`; any request to any deployed service. There is no
`terraform` and no `gcloud` binary here, so
`scripts/bootstrap-google-cloud.sh --apply` has never got past its toolchain
check.

What the sweep found, and the reason it was worth writing before a deployment
existed: `GET /v1/catalog/products` served `products[].tenantId` — the key the
rows are stored under — to a visitor, while the route's own comment claimed no
internal reference appeared. Fixed at the contract (`publicProductSchema`) with a
test that proves the stored row still carries the field, so the strip is what is
being measured rather than the data's absence.

### What the tests actually cover

- **Character** (`packages/character`, 20 tests) — determinism, byte-identical
  replay, SVG accessibility, the closed prop vocabulary, the three ways a prop
  can be painted (a mark, a sign, and an object drawn in the theme's own surface
  colour, which re-tints per tenant preset), gradient rules, a deep-frozen
  snapshot of the canonical pose, and the two helpers that convert between the
  viewBox and the body's own frame — checked against the transform parsed out of
  the rendered SVG, because a helper and a renderer that drifted apart would each
  be self-consistent (D-21).
- **Animation engine** (`packages/animation-engine`, Vitest snapshots) —
  every sequence exercised across its motion, purity, no mutation of the base
  rig, every group resolved at every intensity, and that every declared
  `reducedMotionFallback` exists. Plus **the catalogue** (D-17): every group
  described by exactly one human-facing entry, and every entry proven
  **playable** — asked of the scheduler rather than read off the sequence's own
  `states`, because a moment can be requestable, eligible and still never drawn.
  The eureka was, for its whole life. The moments nothing asks for are asserted
  as a list — `charge` and `listen` today — so wiring one up, or letting another
  rot, shows up as a diff rather than as silence. Plus **the play moves** (A07,
  D-19): three short moves in one group, so two can never collide, asked for by
  `play_started` — which until now moved the machine and changed no pixel,
  because the playing state borrowed the resting layer and had no behaviour of
  its own. Plus **the break** (A04, D-20): four variants of one moment asked for
  by `dismissed`, the same defect in the same shape — closing the chat changed the
  panel and nothing else — closed with a deckchair that unfolds, holds and folds
  away, and a test that the chair's own origin does not move while she breathes.
  Plus **the balloon** (A05, D-21): the first moment a _visitor_ starts, which
  meant the engine gaining its first input channel — a tap is a viewBox point
  hit-tested against the frame actually drawn, and the burst is anchored where the
  finger was rather than where the moment chose — with a test that the float is
  cancelled rather than left drifting beside its own shards, which is the bug the
  id-only `cancel` had hidden. Plus **the arcade spin** (A10, D-25), which is the
  engine's first _cue_ — a moment played on top of the state rather than moving
  the machine — and needs its own arithmetic to return to the exact default pose.
  Plus **the plant** (A11, D-26): four stages drawn with three props because a prop
  cannot morph, a composition held out of the rays by a test that measures the
  actual triangles, and the first catalogue entry whose `asked` is `app` — nothing
  in the machine asks for it, so the scene harness gained a way to ask for a moment
  by name rather than only by event.
- **Visual regression** (`tests/visual`, 27 tests) — twenty-five scenarios, one per
  visually distinct state plus the intensity extremes, the reduced-motion
  fallbacks and the moments where the setting changes the moment rather than its
  strength, each rasterised and compared byte for byte against a committed PNG.
  Aimed at the character rather than at a page, for the reason in D-16, and
  re-verified on Linux `resvg` whenever a baseline moves.
- **API** (`apps/api`) — config and capability reporting, the SSE contract,
  session tokens, tenant isolation, tool dispatch, lead capture (including that a
  submission without consent writes nothing, and that the caller cannot name the
  tenant it is filed against), qualification capture (including that an answer
  reaches the model's tool context and does **not** appear in the transcript, and
  that the standing map survives a restart), and the answer route applying the
  journey's own rules (D-30): the follow-up the usage answer actually opened being
  the one `nextQuestionId` names, an answer the visitor's own earlier one ruled out
  refused with the reason named, an answer given before the question it depends on
  accepted, and a figure that is not a number refused), correction (D-31: changing
  a gate answer takes the orphaned answer out of the store — asserted against the
  store, not the route's own response — and reports it, a correction that strands
  nothing reports an empty list, an answer given ahead of its gate stands until the
  gate is answered against it, and a correction made inside a chat turn reaches the
  store the same way one made by the route does), several answers from one turn
  (D-32: two `save_answer` calls in a single turn both reaching the store and both
  landing on the turn's own map, so the assistant need not ask twice -- the
  extraction itself needs the credential in blocker 1), rate limiting (both the counter and
  the address resolution it keys on, including the case where a caller forges
  `X-Forwarded-For`), the persistence layer, and the catalogue (D-27): an upload
  through its route refused without an admin token and refused entirely when the
  token is unset, a structural file error storing nothing, a thin row stored with
  a warning rather than rejected, append and dry-run, the recommendation route
  accumulating a refinement onto the stored want, and a chat turn that prices
  something and emits `recommendation_ready` with an option id — and reading the
  standing options back (D-28): `GET /v1/recommendations` refused without a
  session token, returning the same options the POST did, writing nothing, and
  scoped to the caller's own session so one visitor's token cannot read another's.
  And the knowledge routes (D-29): ingestion refused without an admin token and
  refused entirely when the token is unset, a document stored, chunked and given a
  succeeded job, a replacement keeping its `createdAt` and appending to the job
  log rather than replacing it, a named source that does not exist being a 404
  rather than a silent second copy, an empty document failing its job and storing
  nothing, a stub heading warning without blocking, a job read back by id and the
  same id under another tenant a 404, and — the phase's actual gate — installer
  B's index empty and its `retrieve_knowledge` refusing, with a replacement and a
  deletion both visible on the very next lookup. Plus the injection defence: a
  fixture document that ends in an instruction aimed at the assistant, and a
  chat-turn test asserting that sentence reaches neither the transcript nor the
  tool's summary.
- **Dashboard metrics** (`apps/api/test/dashboard.test.ts`, 11 tests; D-46) — §6.4's
  Overview as the figures the store can substantiate and nothing at all where it
  would have to guess. The eleven counts and two ratios are read over a half-open
  UTC window the caller can widen (`days`, 1..365, a **400 rather than a silent
  clamp**, default 30, echoed back in `range`), counted from records: conversations
  started by `createdAt` and active by `updatedAt` (asserted to diverge, because
  neither is a subset of the other), visitor and assistant turns in the window,
  leads captured and leads carrying a way to reach the visitor, knowledge sources
  and catalogue products. The suite's teeth are in the edges: a lead at exactly
  `from` is in and one at exactly `to` is out; the two present-state counts ignore
  the window while everything else obeys it; a ratio whose denominator is zero comes
  back `null` and **not** `0`, with a case that has leads but no conversations; the
  rounding is pinned (`3/2` is `1.5`); and one tenant's figures never appear in
  another's response. What is not asserted is as deliberate: there is no
  "qualified" count to assert, because nothing in this deployment scores a lead, and
  no usage block, because nothing meters usage — the contract says both absences in
  words rather than printing a `0` that reads like a fact.
- **Consent, retention and deletion** (`apps/api/test/consent.test.ts`, 15 tests;
  `apps/api/test/retention.test.ts`, 8; D-44) — the provenance half and the
  erasure half of the same promise, kept in separate files because one is a
  caller asking and the other a timer deciding. The consent suite records only
  what the server observed: the wording `version` it publishes, the `surface`,
  and the origin carried in the **signed** session — the origin-header case and
  the "no origin claim" case are both there, the second minted with a token
  signed before the field existed. Erasure is exercised through the two routes:
  `DELETE /v1/conversation` on a visitor token is idempotent 200 and takes the
  transcript and the session's enquiries with it, `DELETE /v1/leads/:leadId` on
  the admin token 404s a foreign or unknown id and takes the conversation only
  when it was the last enquiry from that session, and the erasure is written to
  the audit trail without the erased content in it. The retention suite drives
  the **rule** through `store.purgeExpired` — an enquiry past the cutoff gone and
  one inside it kept, measured by `createdAt`; a transcript by `updatedAt`, with
  a three-year-old transcript written an hour ago kept and yesterday's transcript
  last written three years ago removed; an unreadable date kept rather than read
  as "old enough"; and a twenty-turn session counted as one conversation — and
  the **sweep** through `startRetention`, where the boot run writes one event per
  installer with that installer's own counts, a sweep that removed nothing writes
  nothing, `SUNNY_LEAD_RETENTION_DAYS=0` disables the sweep and keeps the bytes,
  and the two-writers case above is asserted in both memory and on disk.
- **Questionnaire** (`apps/api/src/questionnaire.ts`, 30 tests) — the journey's
  rules as a module rather than a list, so the tool surface, the route a host page
  calls and the next-question suggestion cannot disagree about whether a visitor
  was asked something (D-30). The step constants agree with the questions; exactly
  one usage follow-up applies per source, where the earlier build asked every
  visitor for an annual kWh figure including the ones who had just said they would
  give a monthly cost; a question waiting on an unanswered gate is **pending** and
  answerable in any order, while one the visitor's own answer has ruled out
  **conflicts** and is refused with a message naming the gate and its value; the
  walk over the flow terminates rather than looping on a question no answer can
  clear; and the numeric fields accept the punctuation people type (`3,200`,
  `4 200`, `4200kWh`, `£150`) while storing the visitor's own text rather than
  rewriting it, refusing a word where a number belongs and a figure outside the
  range that makes sense. And the correction (D-31): a stored answer the visitor's
  own later answer has ruled out is dropped and the drop is reported — its reason
  included — while answers that still apply and answers still waiting on their
  gate are kept; the report comes out in the question set's order however the
  answers arrived; and the invariant is asserted over a map with every gated
  question answered against its gate, so no stored answer survives as one its own
  question says was never asked. And the absence of a skip state, pinned rather
  than assumed (D-32): the journey's one optional step is `lifestyle`, which this
  set omits, and every question a visitor might not know carries the journey's own
  uncertainty option (`unsure`, `unknown`, or `household` for "I don't know"), so
  nothing in the set can be answered only by a mechanism Sunny does not have.
- **Knowledge** (`packages/knowledge`, 22 tests) — chunking that keeps a heading with its passage and leaves the text exactly as written, so a part number a
  cleaner would tidy into two words is still quotable; a heading with no body
  dropped rather than emitted empty; an over-long paragraph split rather than
  truncated; a table kept whole. And retrieval, documented as **lexical** rather
  than semantic (D-29): the best passage ranked first, a passage found by the
  words under its heading even when the body never repeats them, `missingTerms`
  so "not documented" is distinguishable from "wrong word", zero-score chunks
  dropped rather than ranked last, deterministic order with ties broken by chunk
  id, and `tokenize('SB-430')` holding both `sb-430` and `430`.
- **Solar rules** (`packages/solar-rules`, 55 tests) — the part of the product
  that decides without asking a model, and what it refuses (D-27). The CSV reader
  (a BOM, semicolons, a quoted delimiter containing one, CRLF, a value spanning
  two lines, an unterminated quote, a column named twice); the row reader, where a
  price with no currency or a figure with no unit stops its row while a price with
  no source is stored as `indicative` and said aloud, and a duplicate is rejected
  against the line it first appeared on; and the recommendation engine, where a
  rule that cannot run reports `skipped-missing-data` rather than passing, a
  pairing is `incompatible` only when the installer's own list names the other
  device and excludes it, a total is `null` unless every item is priced in one
  currency, and every rule that ran is named with the numbers it used.
- **Games** (`packages/games`, 59 tests across two files) — tic-tac-toe, as rules
  rather than as a picture: all eight lines (checked by looping over the same
  `LINES` the board draws from), an illegal move on a taken square, a non-cell,
  or a finished game each refused, the canonical draw, `replay()` rebuilding a
  position from its history and `moves.slice(0, n)` being the undo, and Sunny's
  opponent. The opponent suite pins both halves of her being a heuristic rather
  than a solver: she takes a win and blocks a threat, and she **loses to a
  two-move fork**, which is the one thing the visitor has to see to win (D-22).
  And Space Invaders (A08): the field and the fleet's origin, the ship's clamp at
  both walls, `invaderAt` as the one collision test (a hit on an alive invader, a
  miss on a dead one, out-of-range on the field's edge), each rank's points, one
  shot in the air at a time, a bomb that hits only the cell the ship is in, lives
  running out, a wave that keeps the score and speeds the fleet up, `restart`
  keeping nothing, and a seeded generator making a whole game reproducible (D-23).
- **Contracts** (`packages/contracts`) — the Zod schemas that are the single
  source of truth for the wire format.
- **Widget** (`packages/widget`) — the embed snippet's attributes and which wins,
  the colour maths that keeps an arbitrary tenant brand legible, and the option
  cards as a **view** (D-28): a panel only once the visitor has asked for
  something, money printed only when it carries a currency, a verified figure
  distinguished from an indicative one by both a word and a colour whose contrast
  the suite measures, the total present only when every row is priced, and the
  four things §7.4 asks a card to carry. Plus the two things no card may ever do,
  asserted against the serialised view rather than the rendered text: never quote
  a yield, and never dress the panels' rated DC power as generation.
- **Browser** (`tests/e2e`, Playwright + axe) — the widget mounted from its own
  snippet inside a shadow root, mounted on the body rather than beside the script
  tag, named from the API rather than the page, leaking no tenant internals,
  openable and closable from the keyboard, exposing the documented `window.sunny`
  handle, and audited by axe in four states (closed, open, open with the composer
  enabled — the last because axe skips disabled controls, so the send button's
  contrast is only checked when it is live — and open **with the option cards
  painted**, which is the densest surface the widget has). The cards are driven by
  an intercepted `GET /v1/recommendations` through `page.route()`, because the e2e
  API has no model credential and no seeded catalogue: the claim is about the
  rendered DOM, and the real API's own read-back is covered separately, in-process.
- **Browser, React host** (`tests/e2e/react-host.spec.ts`) — the same widget in a
  page React 19 owns, under `StrictMode`: exactly one mount, a re-render over a
  live widget, a route-change unmount and remount that must not leave two, opening
  from host-page state through `window.sunny`, and no console error across the
  whole lifecycle.
- **Browser, Next.js host** (`tests/e2e/next-host.spec.ts`) — the same widget in a
  production `next build` served by `next start`, through both integrations an
  integrator would choose between: the documented snippet pasted in unchanged, and
  `next/script`, which creates the element after hydration rather than during the
  server render. Plus client-side routing between the two routes, which exercises
  the dedupe rule through a router instead of a hand-removed tag.
- **Browser, WordPress host** (`tests/e2e/wordpress-host.spec.ts`) — the same
  widget on a page with what an ordinary WordPress site actually ships: a theme
  whose globals are `!important` (including a `body > div` rule that matches the
  widget's host element), a plugin that injects a stylesheet into the head after
  load and re-renders a sidebar widget on a timer, `wp_footer` rendered inside a
  theme wrapper that carries a `transform` and `overflow: hidden`, and a consent
  banner fixed in the opposite corner at `z-index: 99999`. The page reproduces a
  WordPress site's _output_ rather than being WordPress -- what the widget reacts
  to is the DOM and the cascade, and both are faithful. Every isolation claim is
  paired with a control proving the theme and plugin are live, so a stylesheet
  that had stopped applying cannot make the widget look immune for free. It found
  a real defect: the host element was being repositioned and painted by the
  theme's `body > div` rule, which the shadow stylesheet's `:host` block only
  survives because every declaration in it is `!important` (D-36).
- **Browser, device cutout and host failure** (`tests/e2e/resilience.spec.ts`) —
  the two claims about the widget being _peripheral_ to the page it lives on.
  A phone's cutout is read from `env(safe-area-inset-*)` and added to the
  launcher's gutter, and the same arithmetic is measured in the browser by
  setting the custom property the widget's `env()` feeds — 20px from each corner
  on a desktop, 68px once a 48px cutout is declared, and a 12px gutter on the
  small-screen breakpoint that still adds the inset. A cutout cannot be conjured
  in CI and `env()` cannot be set from a test, so the channel a host page would
  use to correct the insets for its own chrome is the channel the test uses to
  measure them (D-41). And three outages: the whole API unreachable, the
  session route refused while branding answers, and a stream that dies
  mid-turn. In each the host page's own script and navigation keep working, the
  widget degrades to an honest in-panel error rather than a hang or a silent
  nothing, and the only console error is the failed request the fixture asked
  for (D-42).
- **Browser, marketing site** (`tests/e2e/marketing.spec.ts`) — the one page that
  drives the character engine directly rather than only through the widget, so it
  is where a broken frame loop would be caught: the hero is asserted to paint the
  canonical colours and to redraw, the visitor's own buttons are asserted to make
  it react, and the real widget is asserted to mount and open. It also asserts the
  page's _honesty_ — that the pricing section carries no figure and the page
  carries no customer claim — because those are the two ways this page could lie
  without any test noticing.
- **Browser, animation catalogue** (`tests/e2e/lab.spec.ts`) — the character lab,
  which is the only surface where the catalogue is something a person can click.
  Every catalogued moment is asserted to be listed under its catalogue name and
  description, the moments nothing asks for are asserted to be marked rather than
  hidden, and **every moment is played**: the spec clicks `Play` on every entry
  in the catalogue and waits for the page to record that it drew each one. It is
  the half of P11's
  gate that a unit test cannot reach, and it found three things (D-18) — including
  a moment that was dropped rather than deferred, and a bug in the lab's own
  preview clock that made a working moment look broken. It also carries the two
  A05 checks that only a browser can make: a tap on the stage's own screen
  coordinates becomes the viewBox point the engine reasons in, and the balloon is
  popped by tapping it where it is _painted_ rather than at a coordinate the test
  worked out. And the two A06 checks: a click lands on the square it was aimed
  at, Sunny answers on her own turn and not before (the stage label names the
  thinking sequence while she does), and the history the page published rebuilds
  the position it is showing. And the two A08 checks: **no request is made for
  `/arcade.js` until the button is pressed** — the page is asserted to be up and
  drawing the catalogue first, so the claim is "nothing fetched it" rather than
  "it is absent" — and then the cabinet is played from the keyboard, with the
  score asserted to answer a shot that was aimed at where the fleet actually was.
  Two of these assertions were repaired by D-47 after the D-46 gate exposed them:
  the catalogue walk (a 30 s budget the walk was measured to exceed) and the
  "she is thinking" claim, which now reads the catalogue card's **cumulative**
  mark for the `think` group rather than the stage label's text while it was up —
  the same fact, from a place that does not expire (item 10). The A09 pong
  checks carry a third: "a fresh rally" is now read from the lab's growing
  `data-rallies` count rather than from `data-hits`, which the ball puts back
  above zero within a quarter of a second.

### Fixed in this session (A06: tic-tac-toe)

The increment was the plan's sixth row — "Real 3×3 game against Sunny", checked
"Legal turns, win/draw/replay tests" — and it is the first one that is a _game_
rather than a moment, which is what made the shape of it the whole problem:

- **The rules are a new package, `@sunny/games`.** `packages/games/src/tic-tac-toe.ts`
  imports nothing and holds a position as an immutable value, so the move log
  cannot be edited underneath the game it describes. That is what makes the gate
  testable the way the gate is written: all eight lines are checked by looping
  over the same `LINES` the board draws its strike-through from, plus a draw, an
  illegal move that throws, and `replay()` rebuilding a position from its
  history. Twenty-nine tests, and the three-fold alias registration (Vitest,
  tsconfig, the lab's esbuild) that every `@sunny/*` package needs.
- **The board is a page surface, not a pose.** A 3×3 grid is not something a
  character holds, and nine sparkles in a square would have been a lie about what
  props are for. So the board is markup in the lab and the character contributes
  her _reactions_, which the catalogue already had: `play_started` when a game
  begins, the thinking spin on her turn, `impress` if she wins and `celebrate` if
  the visitor does. A draw gets no moment, because nothing in the vocabulary
  means "evenly matched" and `confused` would say she got something wrong.
- **Sunny is a heuristic, not a solver.** Tic-tac-toe is a solved draw, so a
  perfect opponent could never be beaten and a game you cannot win is a wall
  rather than a game. She takes a win, blocks the visitor's, prefers the centre,
  then a corner, with the tie-break injected so a seeded caller gets a
  reproducible game. The tests pin both halves: she blocks a single threat, and
  she loses to a two-move fork — the one thing the visitor has to _see_ to win.
  A first draft of that fork test used two of her marks that shared a line, which
  quietly gave her an immediate win and would have made the test pass for the
  wrong reason (D-22).
- **The board runs on the stage's clock, not `performance.now()`.** The lab can
  be paused and scrubbed, so Sunny's turn is a deadline in stage milliseconds and
  a rewind of the clock re-arms it; a visitor who scrubbed back far enough would
  otherwise have left her thinking for ever.
- **Two new browser checks, and the replay one is the claim worth having.** One
  plays a mark, proves the square cannot be played twice, watches the stage label
  say the thinking sequence is the one being drawn — a claim about the character,
  not about a class the board put on a paragraph — and waits for her answer. The
  other plays to the end and runs the history the page _published_ back through
  the same rules, comparing the result with the marks on screen.
- **The lab bundle grew 99.3 → 106.3 kB**, which is the rules plus the board.
- **The Linux container run caught a real defect, which is the point of it.** A
  new npm workspace is only a workspace once it is in `package-lock.json`, and
  `npm ci` refuses to install a tree whose lockfile does not mention a workspace
  the root manifest declares: `npm error Missing: @sunny/games@0.1.0 from lock
file`. Nothing local noticed, because the workspace was already linked in the
  existing `node_modules` — so `npm run verify`, `npm run build` and the whole
  browser suite were green on a tree that **could not be installed from a fresh
  clone**, which is what CI does. `npm install --package-lock-only` fixed it, the
  A06 commit carries the lockfile, and the container then ran **22/22**. A gate
  that only ever runs against a warm working tree is not a gate; this one earned
  its place in the checklist.

### Fixed in this session (A08: the arcade)

The increment was the plan's eighth row — "Space Invaders | Lazy-loaded arcade
game | Real collision, score, restart" — and the fourth word turned out to carry
the decisions, because "lazy-loaded" is a claim a build can stop supporting while
every test stays green:

- **The arcade is a second bundle, `/arcade.js`, and the lab fetches it on the
  press.** Two esbuild entries rather than a dynamic `import()`, because esbuild
  cannot use `splitting` with `format: 'iife'` and a shared chunk would be
  lazily-_parsed_ rather than not fetched at all. The chunk imports `@sunny/games`
  and nothing else, and talks to the character through a two-method `Reactions`
  interface, so it does not carry a second copy of the engine (D-23).
- **The rules are 30 tests in the existing `@sunny/games`**, and the collision
  test is a lookup on a grid of integers rather than a pixel overlap: one
  `invaderAt`, everything that can hit anything goes through it, and the answer is
  the same on every machine. The tick order — shots move and hit, fleet moves,
  landing judged, bombs move and hit — is documented in the function and is the
  reason it is one function rather than a pipeline of exported steps.
- **`index.ts` now re-exports a namespace per game.** Both games wanted to export
  `newGame`, `Game` and `Status`, and neither name is wrong; `ticTacToe.replay()`
  says which game it is replaying, and A09's ping pong adds a third without
  reopening it. Four call sites changed.
- **`mount` returns nothing.** The first draft handed back `{ stop() }` for a rAF
  loop that outlives its panel; nothing in the lab ever called it, and an unused
  stop button is an API describing a life cycle the page does not have.
- **The two browser checks found two defects, and only one was the game's.** The
  readouts are published as `data-*` on the element `mount` was handed — the slot
  inside `#arcade` — while the test read them off `#arcade`, so "the score never
  moved" was a fact about a selector. The other was in the test: aiming through
  Playwright locators failed every single time, because a locator click is a round
  trip while the fleet keeps stepping, so the shot was aimed where the fleet had
  _been_. Aiming and firing in one page-side turn is what a player does, and it
  hits on the first attempt in every run. Both are recorded in D-23 because the
  second one is the interesting kind of red: the assertion was right and the
  mechanism for setting it up was wrong.
- **Four test bugs in the new rules suite, none of them a rule change.** A helper
  that only counted steps was used to move the ship; a second shot was aimed at a
  column the fleet had already left; the fleet-clearing test put its last invader
  on the top row where the fleet's cadence never brings the shot and never called
  `fire`; and the determinism test asserted a step count for a game a bomb ended
  early, which a throwaway trace showed is reachable because the counter generator
  wraps to `0` every seventh call. The trace script was deleted and the test now
  asserts what it can defend.
- **A note on the suite's own margin, found by accident.** Two consecutive
  full-file runs failed the catalogue test on its 30-second budget with the lab's
  clock advancing at a twelfth of real time. The cause was not the code: stale
  `sunny-ai` server processes from earlier Playwright runs were still alive and
  starving the page of frames, which is the failure mode recorded for this
  machine. With them killed the test takes 10.4 s of its 30 s. Worth knowing
  before blaming an arcade for a slow catalogue.
- **Nothing visual moved, and the container says so.** The suite's rasteriser is
  the character's, and A08 draws page cells rather than rig frames, so the
  expectation was that the baselines would be untouched — but "nothing should
  have moved" is exactly the claim the Linux run exists to test rather than to
  assume. The committed tree in `node:22-bookworm` installed from its lockfile
  and produced **22/22** byte-identical PNGs. No new workspace this time, so
  `npm ci` had nothing new to refuse.

### Fixed in this session (A10: the arcade spin)

The increment was the plan's tenth row — "Arcade spin | Original fast roll/spin,
not Sonic IP | Returns to exact default pose" — and the constraint and the
acceptance criterion are both unusual, so this is mostly about what those two
phrases forbade rather than about what was added:

- **"Original" is a constraint on the silhouette, and it is why she rolls as a
  disc.** The move being reached for is the one everybody has seen a hedgehog do,
  so the shape cannot be copied and Sunny's roll had to be shaped like her: her
  eight rays fold **flat**, gathering into one disc with her face legible at the
  middle, and it is the disc that turns. A turning sun still showing eight
  splayed rays is a sun wobbling, which is why that version was rejected before it
  was tried. Three variants, one per intensity: the tuck (a beat, no turn), the
  roll (one whole revolution) and the spin (two revolutions with a hop and a
  bloom on the way out).
- **"Returns to exact default pose" was taken literally, and that is why the row
  needed its own arithmetic.** A pose is a pure function of progress, so
  "returns" is a claim about `t = 1`, and _exact_ has to mean something a test can
  hold with `toEqual`. The existing helper for a gesture that fades out,
  `bump(t) = sin(pi t)`, is **1.2e-16 at `t = 1`** — invisible in one term, and a
  rig that renders identically to the resting pose while comparing differently in
  three. So the row adds `land` (a bump clamped to exactly zero at both ends),
  `turns` (whole revolutions folded with `% 360`, so a two-turn spin ends at 0
  and not 720) and `swell` (a bump whose ends are tested against `t` rather than
  against a divided progress, because `(1 - 0.72) / 0.28` is 0.9999999999999999).
  Every field is then written as the base value _plus_ a term that is exactly
  zero at both ends — never as a bare expression that happens to be zero, because
  `-a * 0.03` is _negative_ zero when `a` is zero and `toEqual` distinguishes it.
  The acceptance criterion is one line per variant:
  `expect(sequence.pose(defaultRig(), 1)).toEqual(base)`.
- **`spin` is a cue, not a transition, and the obvious wiring is a bug.** Adding
  the wave-cleared to the machine as another `celebrate` reads right and is
  wrong, because `celebrating` settles back to `idle` after four seconds and a
  wave cleared happens _inside_ a game — she would leave the playing state to
  spin, settle to idle while the fleet was still descending, and spend the rest of
  the visitor's game breathing at nothing. A moment that ends the thing it is
  celebrating is not worth having. So `SunnyAnimator.dispatch` answers `spin`
  before the machine is consulted, leaving the state alone — the same shape
  `tap()` uses for a balloon — and the request can still be refused, which is the
  right answer: the group lists `playing`, `celebrating` and `idle` and nothing
  else, so the cue is dropped mid-sentence rather than interrupting an answer
  with a somersault.
- **The arcade's loss had been falling on the floor since A08, and the fix is
  not the one it looks like.** `impress` out of `playing` is ignored: the playing
  row has no entry for it. Adding one is the tempting repair and is wrong for the
  same reason the spin is a cue — a reaction that moved her out of `playing`
  would also move her out on every _point_, and the pong and the board each
  dispatch one apiece (A09, A06). A point is not the end of the game; a loss is,
  so the arcade now says so: `play_finished` (the only event that takes her out
  of a game) and then `impress`, which from `idle` reaches the shades. **The
  pong's and the board's per-point reactions are still dead dispatches**, stated
  here rather than left to be rediscovered, and left alone because waking them is
  a change to A06 and A09 that this row is not.
- **A flaky browser test in A09 was found by running this row's gate, and the
  test was the thing that was wrong.** The lab's third pong test took the right
  bat over and asserted the rally count grew — which it cannot do reliably: her
  aim is deliberately as far from the _opponent's_ bat as it can be (D-24), so a
  visitor who takes the bat and puts their hands down concedes, every point
  resets `hits` to zero, and whether the count moved was a coin flip on one serve
  angle. It passed in A09 by luck and failed three times in a row here. It now
  asserts that **her bat is still playing** while the visitor holds the right one,
  which is what the test's own comment always claimed and is true every run.
- **Nothing moved that should not have.** The existing twenty-one baselines are
  byte-identical and two are added — the spin caught in the middle of the turn,
  and the reduced-motion tuck, which is the fallback being _used_ rather than
  merely declared. The committed tree in `node:22-bookworm` installed from its
  lockfile and produced **25/25** byte-identical PNGs.
- **Thirty new tests, and none of them a count that had to be remembered.** The
  generator loops do it: three new sequences add five engine snapshot tests each,
  the catalogue's per-entry `describe.each` adds three, the sequences suite adds
  ten of its own, and the two new scenes add two — 589 across sixteen files, from 559. What is checked where is D-25's last paragraph.

### Fixed in this session (A11: the plant)

The increment was the plan's eleventh row — "Plant flower | Seed, shine, sprout,
flower | Solar-theme showcase" — three columns, three separate problems, and the
middle one is a four-act story the engine has to tell in one moment:

- **A prop cannot morph, so four stages are drawn with three props and an
  ordering rule the tests hold.** A prop is one path with one transform (D-2), so
  a seed cannot _become_ a shoot: the growth is a cross-fade. What matters then is
  what may be on screen together — the seed is **in the ground before the shoot
  breaks it** (a seed beside a plant is not a story), while the shoot and the
  flower **do** overlap, because the flower is meant to come out of the shoot. The
  shine has no prop at all, because she _is_ the light: that stage is her rays
  lengthening, and it is the one stage whose strength differs at every intensity.
  A fourth prop would have been a beam, which is a painting of something she
  already is.
- **"Solar-theme showcase" is a composition constraint, and it is why the plant
  leans _away_ from her.** The first version put the plant in the lower right and
  drew it straight across the ray at 131.5 degrees — a black smudge on an orange
  triangle, past saving by tint or outline. She has eight rays and the two that
  own the lower right leave a 40-degree gap, so the plant goes in the gap: 64
  units out, past both ray tips at 75.5, leaning 14 degrees away, which keeps the
  stem outside the ray ring the whole way up. Leaning it _toward_ her — the way a
  real plant grows toward a sun — would grow it across the rays this placement
  exists to avoid. The same rule then caught the glints: the first version drifted
  them on their own arc, and at the top they landed on the ray at 91.5 degrees,
  where a dark sparkle on orange reads as a speck of dirt on the ray rather than
  as light, so they now rise along the plant's own lean. The rule is executable
  rather than eyeballed — for every prop of every variant, at 400 points through
  the moment, the distance from the nearest ray's axis must exceed that ray's
  half-width at its radius, computed from `RAY` rather than from numbers copied
  into the test.
- **A reduced-motion visitor gets the flower, which is A05's decision rather than
  A04's.** There is no honest still of a deckchair arriving (D-20) and there _is_
  an honest still of a plant growing: a flower standing beside her is an ordinary
  thing to see. So the fallback is `bloom-still` — three of the four stages
  compressed into the one the row is about — and what the visitor is spared is the
  story rather than the plant. It is the fourth image in a suite where the other
  three reduced-motion scenes fall back to the resting pose, and the baseline is
  the record of that. A test found the asymmetry worth stating: a fallback runs on
  the **clock of the variant it replaced**, so reached as a reduced-motion
  fallback at a higher intensity the plant stands for the 6.2 s the showcase would
  have taken and is retired with the moment, while at `off` — where the setting
  selects the still itself — it loops and stays. That is the engine's behaviour
  rather than this row's; every group with a fallback does the same.
- **It is the first moment with no event at all, so it needed a new answer to
  "who asks for this?"** `asked: 'app'` has been a possible answer since D-18 and
  this is the first animation to actually be one: nothing in the machine asks for
  the planting, because it is not a response to anything. An application calls
  `SunnyAnimator.play('bloom')` when it wants to show a visitor what sunlight
  does, and that is a decision no event could make. So `UNWIRED_GROUPS` grows by
  one and `UNREACHABLE_GROUPS` does not move — unwired is "implemented, needs a
  caller", unreachable is "no caller exists", and the difference between the two
  lists is the whole reason the catalogue distinguishes them. The lab's gallery
  plays it from the card, which is what an application does, and its card is the
  first with an empty route; the tooltip says "plays from the resting state"
  because that is the truth of it.
- **That found a real gap in the visual harness, which could only dispatch events
  or taps.** A moment with no event **could not be looked at** by the suite that
  exists to look at things, so `Scene` gained an optional `play`, wired through
  the same public `play()` the lab uses; the A11 scenes are its first users, and
  the app-request path is now exercised by the baselines rather than only by the
  lab.
- **Nothing moved that should not have.** The existing twenty-three baselines are
  byte-identical and two are added — the seed in the soil with the rays
  lengthening (the only frame in the suite where `seed` is on screen) and the
  reduced-motion still, a full flower standing beside her. The committed tree in
  `node:22-bookworm` installed from its lockfile and produced **27/27**
  byte-identical PNGs.
- **Thirty-five new tests, from 589 to 624 across the same sixteen files.** The
  generator loops do most of it: four new sequences add five engine snapshot tests
  each (twenty), the catalogue's per-entry `describe.each` adds three, the
  sequences suite adds ten of its own, and the two new scenes add two. What is
  checked where is D-26's last paragraph.

### Fixed in the previous session (A05: the balloon)

The increment was the plan's fifth moment — "Balloon floats, gaze follows,
optional tap/pop", checked "Pointer/touch + reduced motion" — and unlike every
moment before it, it starts with the visitor rather than with the machine:

- **The engine gained its first input channel.** `SunnyAnimator.tap(point, now)`
  takes a viewBox coordinate and hit-tests it against the frame that was actually
  drawn, not the rest pose — which matters because the balloon travels, so a tap
  where it _was_ has to miss (D-21). The forward and inverse of the renderer's
  root transform now live in `rig.ts` as `toViewBox`/`toBodyFrame`, and a new
  test reads that transform out of the emitted SVG and checks the helpers against
  it rather than against a second copy of the same arithmetic.
- **`cancel` matched nothing, and only a test found it.** Tapping the balloon
  cancels the float before requesting the burst; `cancel('balloon')` named a
  group but matched sequence _ids_, and the instance a group request installs is
  the intensity's variant (`balloon-sway`), which under reduced motion renders a
  third sequence again. So the cancel was a silent no-op in every case, and the
  balloon only reappeared after the burst settled — invisible without the burst
  over it. `cancel` now names things the way `request` does.
- **The burst needed an anchor the gesture had already left behind.** It is the
  only moment drawn somewhere the moment did not choose, and it outlives the
  input by a fifth of a second, so the scheduler's instance carries an optional
  `MomentAnchor` from `request` through to `pose`. Played cold from the gallery it
  centres on the balloon's own resting place, which is the one position that is
  not an invention.
- **Two props became one project's worth of art, by reusing A04's decision.** The
  balloon is drawn with `surface: true`, the ink-outline-around-`highlight`
  treatment the deckchair introduced, so no new prop painting was needed and the
  surface test now covers both.
- **Reduced motion gets a balloon that does not move, not the absence of one.**
  There is an honest still of a balloon at rest, so the float falls back to
  `balloon-still`; the burst declares no fallback, because the pop under reduced
  motion _is_ the balloon's disappearance — which the test asserts by holding a
  still balloon and then asserting its absence, the opposite of what A04's
  `relax-still` does for the same setting.
- **The catalogue gained a third answer to "who asks".** The two moments are
  asked for by neither the engine nor nobody; a gesture the host has to forward
  asks for them. `AskState` gained `gesture`, and `UNWIRED_GROUPS` is now a
  longer list than `UNREACHABLE_GROUPS` — which is the point of having both, and
  the reason the lab marks the balloon and the burst dashed until a pointer is
  forwarded through the widget.
- **Three new baselines, and one of them is the third image in which reduced
  motion does _not_ resolve to the resting pose.** That is the evidence for the
  decision above rather than a repetition of an existing scene, and the suite's
  coincidence guard still names exactly three scenes.
- **The widget bundle grew 33.1 → 34.7 kB gzipped** (the engine travels inside
  the widget), and the lab grew 86.0 → 99.3 kB, most of it the eight new
  sequence variants the balloon and the burst add to the grid.

### Fixed in the previous session (A04: the deckchair)

The increment was the plan's fourth moment — "chair unfolds, shades, relax",
"stops immediately on user interaction" — and it turned out to be the same defect
as A07, one state along:

- **`dismissed` moved the machine into `relaxing`, which borrowed the idle
  layer.** Closing the chat changed the panel and nothing else, so the one moment
  the launcher is alone on screen was the one moment Sunny did nothing (D-20).
  It is the second state found with no behaviour of its own, and both were found
  the same way: by rendering the state and looking at it.
- **The prop vocabulary gained a third painting, because furniture is not a
  mark.** An ink stroke draws a mark and an ink mass draws a small sign; neither
  can draw an _object_, because the character's own language is a black outline
  around a flat fill. `surface: true` is that outline around the theme's highlight
  colour, so a tenant on the purple preset gets a lilac deckchair, and the test
  asserts the re-tint rather than the hex.
- **The first render put a black slab across her face.** A held blink is not a
  closed eye: `renderEye` fills the eye path with ink, so `closed = 0.92` flattens
  the eye into a bar that is legible as a blink at 72 px and reads as a moustache
  at 512 px. A squint (0.62) carries the pose instead. This was found by rendering
  the frames large and looking at them, which is the only way it could have been
  found.
- **The chair would have inherited her body motion.** Props are drawn in the
  body's frame, so the deckchair had to be given the exact inverse of the
  transform her body was given to sit down — including the rotation of the
  translation, which is why the correction is not two negations — and no breath,
  because a chair on the ground does not rise and fall with the person in it. The
  test measures the chair's origin to six decimal places rather than trusting a
  snapshot.
- **The break is a finite event rather than a loop, and that is a decision rather
  than a limitation that was not noticed.** A loop replays the unfold every cycle
  or pops the chair in on frame one, and the state's ambient cannot hold the pose
  because the ambient has to loop. So the chair arrives and leaves, the idle layer
  shows underneath afterwards, and A04's "stops immediately on user interaction"
  falls out of the state check rather than out of a tuned duration.
- **Three new baselines; the existing fourteen did not move.** That no committed
  PNG changed is the evidence the artwork change is additive, and the suite's own
  coincidence guard now names three scenes that are _supposed_ to be identical
  (all three showing the resting pose) — which is the guard catching the exact
  shape of the bug that was fixed, since `relaxing` used to coincide with rest for
  the wrong reason.
- **The widget bundle grew 30.8 → 33.1 kB gzipped** with this and A07's moves.
  Worth stating rather than discovering: the engine travels inside the widget, so
  an animation is paid for by every host page.

### Fixed in the previous session (A07: the play moves)

The increment started as "add the three play animations" and turned into
"A07 asks for a state that had no behaviour", which is the more useful shape:

- **`play_started` moved the machine and changed no pixel.** The playing state
  borrowed the resting layer and no sequence declared it, so a game could start
  and Sunny would carry on breathing as if nothing had been said (D-19). The
  catalogue's playability test could not see it — the frame it produced was a
  perfectly valid resting pose — and neither could any assertion about the
  machine's state, because the state _was_ right. It took rendering the state
  and looking at it.
- **A07's "no animation collisions" is now structural, not timed.** The three
  moves are intensity variants of one group, and the scheduler refuses a second
  instance of a group that is already running, so a shuffle cannot be drawn over
  a dance. The test asserts the refusal rather than the durations.
- **The run did not read as running in the first frame that was captured, and
  the way it failed is the instructive part.** Its lean and its ray-wind were
  multiplied by the stride, and the stride is a rectified sine that is zero at
  the midpoint — so the frame at the middle of the move, which is the one worth
  capturing, showed a character leaning by nothing. A character with no legs
  cannot show a stride; the lean and the wind are what carry the meaning and the
  bob only says how fast, so they are now held for the whole move and merely
  scaled. This was found by rendering the frames and looking at them, not by
  reasoning about the pose functions.
- **The `playing` baseline's capture time moved 950 → 550 ms.** At 950 ms a
  1.1 s move has already tapered back towards rest, so the new baseline would
  have shown a standing character with slightly lowered brows and the scene
  would have proved nothing. The scene's content changed with this commit
  regardless; the time was re-chosen against the frames.

### Fixed in the previous session (the visual baselines)

The increment that closed §12's visual-snapshot gap found a mistake in itself,
which is the useful kind of finding:

- **Six of the thirteen first baselines were the wrong frame.** The harness built
  an animator and called `frame(captureTime)` on it directly. A sequence's
  instance is anchored to the first frame that observes it, so that single call
  is elapsed time zero — the _start_ of the sequence, not the frame named. The
  two idle scenes came out byte-identical because "breathing" was the rest pose
  twice, and the distinctness guard caught it before anything was committed. The
  widget has never had this bug: it drives the animator from a
  `requestAnimationFrame` loop, where a frame always follows a frame. The harness
  now walks the same 30 FPS cadence (D-16).
- **A correct pair then failed the guard, and the guard was what was wrong.**
  `celebrating-off` and `celebrating-reduced-motion` render the same image: an
  intensity of `off` resolves no sequence, so the character rests, and reduced
  motion resolves `celebrate-still`, whose pose is the resting pose. Two routes,
  one image. The guard now names that pair explicitly and requires every other
  pair to differ — the same protection, without pretending the scenes form a
  bijection.
- **The cross-platform premise was checked, not assumed.** The baselines were
  generated on Windows and CI runs on `ubuntu-latest`, so "the same bytes
  everywhere" could have been the kind of claim that is only found to be false by
  a red build someone then deletes. The committed tree was run in a
  `node:22-bookworm` container and all thirteen comparisons pass, so `resvg` on
  Linux produces byte-identical PNGs to Windows. Docker was already running on
  this machine; without it the honest line would have been "unverified". Re-run
  after the play moves added two scenes: **16/16 in the container**. It was then
  left too long — the count in the table above had drifted to 19 without a
  container run on record behind it, which is the failure mode this whole
  paragraph exists to warn about — and re-run after A05's three balloon scenes:
  **22/22**. Every PNG in the tree now has a Linux run behind it.

### Fixed in the previous session (the marketing site)

Three findings, all of them caught by the checks rather than by reading the code:

- **Two colour-contrast failures on the new page.** Axe failed the first run:
  the eyebrow label at 2.66:1 (deep orange on pale orange) and the browser-chrome
  URL bar at 4.25:1. The second is the instructive one — the muted token is
  calibrated against the warm-white page background where it passes, and was
  being used on a tinted bar, where it does not by a hair. A token is only valid
  on the surface it was measured against, so it is overridden locally with the
  measurement written next to it. Both are now ink.
- **The marketing page broke a different test by doing its job.** It mounts the
  real widget, so every page load in the suite spent a session from the API's
  per-address rate-limit bucket. At the shipped default the last widget test to
  run got a 429 and failed with "loads without console errors". The limit is
  raised explicitly for the e2e server rather than worked around in the tests,
  because the limiter's own coverage lives in `apps/api/test`, where the
  threshold is the subject rather than an obstacle.
- **A test read the character mid-redraw.** The hero's frame loop replaces the
  stage's markup about thirty times a second, so a node located a moment earlier
  can be detached by the time it is read — and a detached element has no computed
  style, so the read comes back empty. It passed alone and failed in the full
  run. The assertion now polls, which retries a read that lost the race; it was
  run three times afterwards to confirm the fix rather than assuming it.

### Fixed in the previous session

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

- **The widget mounted itself in the document head, invisibly.** The host element
  was inserted next to the snippet's own script tag — `script.parentNode` — which
  works in exactly one placement: the tag sitting in the body, which is what the
  demo page happens to do. A snippet pasted into `<head>` would have left a `<div>`
  in the head, where the browser never renders it. React 19 makes that the default
  case rather than an unusual one, because it hoists `<script async src>` into the
  head itself: on the new React host fixture the widget mounted, registered itself
  on `window.sunny`, answered its config request, and was _invisible_. The host is
  now appended to the body (D-13), which costs nothing — the widget is
  fixed-positioned inside a shadow root, so it only affects paint order.
- **A remounted snippet produced a second widget.** Removing the snippet's script
  tag does nothing, by design, so a single-page app navigating away and back
  re-executed the bundle and mounted again — leaving two launchers stacked and two
  entries on `window.sunny`. `boot()` now skips a public id that is already in the
  document (D-13). Two widgets on one page remain supported; two of the _same_
  widget was never what anyone meant.

- **Adding Next.js broke the security gate.** `next@15.5.27` depends on a
  `postcss` with a high-severity advisory (unguarded `</style>` in stringified
  output, and arbitrary `.map` reads via an attacker-controlled
  `sourceMappingURL`). `npm audit --audit-level=high` had been clean, and the CI
  security job fails the build on exactly that command — so the version of the
  framework was a decision about whether the gate still means anything, not a
  detail. The fixture runs on **Next 16**, which is where npm reports the fix,
  and the audit is back to **0 vulnerabilities** (D-14).

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

`scripts/bootstrap-google-cloud.sh` is the front door to it: it checks the
toolchain (refusing a Terraform older than the `>= 1.9` that `versions.tf`
requires), the account, the project and the billing account, prints the resources
`terraform apply` would create, and only then runs `init` / `plan` / `apply` —
each behind a confirmation, and with the state bucket named by `TF_STATE_BUCKET`
or a warning about local state. Its refusal paths were exercised here; with no
`terraform` and no `gcloud` on the machine, it stops at the toolchain check with
exit 2 and has never reached its first `init`.

### 4. Ten of the plan's fourteen API routes exist

Implemented: `POST /v1/widget/session`, `POST /v1/chat/stream`,
`GET /v1/widget/config/:publicId`, `POST /v1/qualification/answer`,
`POST /v1/leads`, `GET /v1/catalog/products`, `POST /v1/recommendations`,
`POST /v1/knowledge/sources`, `GET /v1/knowledge/jobs/:id` and
`GET /v1/dashboard/metrics`,
plus `GET /healthz`, `GET /v1/conversation`, `GET /v1/leads` (an installer's
route, admin token and an explicit `tenantId`), `GET /v1/recommendations`,
`GET /v1/audit/events`, `DELETE /v1/conversation` and `DELETE /v1/leads/:leadId`
(none of those seven is in the plan's list: four read back and two erase what a
plan route already wrote, and `healthz` is health, so the count is
unmoved).
A further route, `POST /v1/catalog/products`, is
the catalogue upload: it is the API's only installer-facing write and the plan's
§4 list does not name it, so it is not counted here.

**Corrected and then resolved on 2026-10-10:** this section previously claimed
`POST /v1/leads` was implemented. It was not — only `app.get('/v1/leads', …)`
existed, so the count was **three**. The claim was wrong when written, and was
fixed by correcting the count rather than by hurrying out a route to make the
sentence true. `POST /v1/leads` and then `POST /v1/qualification/answer` have
since been built, so the count was **five**. Both also still happen through the
conversation, via the `create_lead` and `save_answer` tools; each pair writes the
same record. The catalogue pair (P8, D-27) has since taken it to **seven**: the
tools behind them no longer refuse, because an installer's own uploaded rows are a
real source rather than invented commercial data — and with no rows uploaded they
refuse in as many words rather than guess.

**On 2026-10-11 the knowledge pair took it to nine** (P6, D-29). The plan names
both `POST /v1/knowledge/sources` and `GET /v1/knowledge/jobs/:id`, so both count.
What they do _not_ do is anything in the phase's name beyond onboarding and
ingestion from text the caller supplies: no Google retrieval, no Drive, no
website crawl, no sync. That gap is the honest one to leave open, and it is
recorded in D-29 rather than papered over with a route that accepts a URL it
would never fetch.

**And later on 2026-10-11 the dashboard read took it to ten** (D-46). The plan
names `GET /v1/dashboard/metrics`, so it counts. It is the overview's **data
half** and only that half: the figures an installer's home screen would show —
conversations started and active in a window, turn counts, enquiries captured,
enquiries with a way to reply, and two ratios whose denominators are named — with
two of §6.4's five words _absent on purpose_ because this deployment cannot
substantiate them honestly. There is no "qualified leads" count (nothing scores a
lead: both write paths set `score` to null deliberately, and "0 qualified" would
be the most plausible kind of lie) and no "usage" block at all (nothing meters
usage). The dashboard **app** is still blocked on blocker 4 — building a UI over
an admin-token API would put that token in a browser — so the route is reachable
exactly as `GET /v1/leads` is, by an operator holding the deployment's admin
token.

Absent, each with nothing behind it:
`POST /v1/sunscan/assessments`, `GET /v1/sunscan/assessments/:id`,
`POST /v1/integrations/google-drive/connect`, `POST /v1/billing/webhook`.

So assessment hand-off, Drive, billing and the dashboard's **surface** are **not
implemented** — its figures are, but nothing renders them —
and the knowledge routes ingest text rather than retrieving from the installer's
own sites. The widget can hold a conversation, capture qualification
answers, save a lead, and — from whatever an installer has uploaded — search the
catalogue and price package options. What it cannot do is anything that needs
SunScan, Google or a payment provider, and it has no product data until someone
uploads some.

### 5. There is no SunScan integration, only a model of one

Discovery read SunScan's questionnaire, lead schema, journey and pricing modules
under the narrow authorisation given for that purpose. **No SunScan endpoint has
ever been called from this code.** `packages/sunscan-adapter` is a stub.
Findings that matter to anyone planning the integration:

- SunScan has **no unified error envelope** — route handlers return differing
  shapes — so the adapter must translate per route rather than assume a format.
- The finance/APR calculators and the grants logic the plan refers to are
  **not present** in SunScan. `calculate_approved_estimate` has nothing to call.
- **The estimate tool is deliberately refusing, not merely unimplemented;
  the catalogue and recommendation tools no longer are.** When this section was
  first written, `search_catalogue` and `recommend_packages` also returned a
  refusal, on the reasoning written into the code: the installer's prices are the
  installer's commercial data, and two different prices for the same roof is
  worse than no price. P8 (D-27) made that reasoning _holdable_ rather than a
  reason to refuse — the tools now answer from rows the installer uploaded
  themselves, through `POST /v1/catalog/products`, and refuse in as many words
  while the catalogue is empty, so nothing about a price is ever invented. What
  remains blocked on the integration is the other half of the plan's §7.4: with
  no SunScan result, every option is an **assumption** and none is
  **survey-confirmed**, and structural suitability cannot be stated as fact.
  `calculate_approved_estimate` still has nothing to call, because the finance
  and grants modules it would call do not exist in SunScan.

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

### 7. The history exists on one machine and nowhere else

**Corrected 2026-10-10.** This section previously said
`C:\Work\Arkalith\sunny-ai` was not a git repository at all. That was true when it
was written and is no longer: it is a repository on `main` with 27 commits, each
increment committed as it landed. What remains missing is a **remote** — the
history has never left this machine, so it is protected against a bad edit and
not against the machine (D-9).

Meanwhile `C:\Work\Arkalith\SunScanV2` _is_ a repository whose remote is
`https://github.com/HummdG/sunny.git` — a repository named **sunny** that
currently holds **SunScanV2's** history (roof geometry, cross-gable fitting),
not this project. The plan document and `sunny.png` also live in `SunScanV2`,
while the implementation lives in the sibling directory.

So "push the work" has no obvious destination, and the remote named `sunny`
belongs to a different codebase. **This needs a decision from the user** — see
`docs/DECISIONS.md`, D-9. It is not resolvable from inside the code.

### 8. Not built at all

`packages/sunscan-adapter` is still a `package.json`-only stub, and
`packages/solar-rules` no longer is — it is real as of P8 (D-27) and holds the
CSV reader, the row reader, the compatibility rules and the package assembly.
`packages/ui` is real but only holds tokens — no components yet.
`apps/dashboard` does not exist. (`tests/visual` no longer is — it holds the
character baselines, D-16 — and `tests/e2e` holds the Playwright suites.)
`apps/marketing` now exists and is built (D-15), which makes the dashboard the
larger remaining gap of the two. As of D-46 that is a smaller gap than it was:
the data source that had "not been designed" is now `GET /v1/dashboard/metrics`,
with a contract and tests, so what remains is a surface over an existing route
rather than a route over nothing — and the surface is blocked on dashboard
authentication (blocker 4), which is a credential rather than a decision.

Two gaps closed since this section was last written, both from §13.
`tests/security` holds the cross-tenant denial sweep (D-35), and
`scripts/verify-isolation.ts` is now its deployment-facing counterpart: eight
checks against a _running_ API, which is the thing an in-process test cannot do
(it ran 8/8 green against a local API, and red on exactly one case when the fix
it measures was reverted). And the §13 scripts all exist:
`bootstrap-google-cloud.sh`, `deploy-staging`, `deploy-production`,
`smoke-test`, `rollback` and `seed-demo`. They are not a deployment —
`deploy-staging` and `deploy-production` build for real and then stop at the
boundary with exit 3, and `rollback.sh` exits 3 rather than pretend, because
this repository still has no `Dockerfile` (D-37, `README_DEPLOY.md`).

### 9. Section 12's required checks, honestly accounted

| Required check                 | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting / lint              | **done**, in CI and locally                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Typecheck                      | **done**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Unit tests                     | **done** — 1034 across 31 files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Contract tests                 | **done** — Zod schemas exercised through the routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Integration tests              | **partial** — the API is exercised in-process, not across a network                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| E2E (Playwright)               | **done** — 58 checks in Chromium against five real host pages, the API, the lab and the shadow DOM, none failing (D-47, item 10). The reading before it was **not done on 2026-10-11**: three `lab.spec.ts` checks were failing, reproduced with the day's change stashed, and then diagnosed and fixed as D-47 — the failing record is kept in item 10 rather than overwritten. The reading before _that_ one read "44 of 46 … the two failures are in the lab and reproduce without this increment"; that one **was** a stale dev API being reused rather than a failing test (item 9, D-40) — which is precisely why the later readings were controlled against a stashed tree instead of believed |
| Visual snapshots               | **done** — 25 committed PNG baselines, byte-compared, re-verified on Linux `resvg` (D-16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Accessibility (axe)            | **done** — four widget states (one of them the card-bearing panel), failing at `serious` and above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Performance (Lighthouse)       | **measured, budgeted, not gated** — `npm run perf:marketing` over the production build; five of six metrics meet the good-range boundary, total blocking time does not (162–386 ms against 200 ms), and nothing runs the budget in CI because there is no CI (D-9, D-45)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Dependency / security scanning | **commands run and passing**; the CI _job_ has still never run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Terraform validation           | **written, never executed**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Smoke test                     | **done**, and now exits 0 when it passes (blocker 1 aside)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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
- **The recommendation engine cannot invent a fact, because it cannot invent
  anything.** It is a pure function of the installer's uploaded rows: no network,
  no clock, no randomness, so the same catalogue and request give the same answer
  byte for byte, and a "golden scenario" is a test rather than a memory. A rule
  that cannot run says so instead of passing; a pairing is refused only where the
  installer's own data contradicts it; a total exists only when every item is
  priced in one currency; and no yield, roof capacity or structural claim is
  computed anywhere (D-27).

## Next actions, in order

1. **Decide where the repository should live** (blocker 7). The work is now
   versioned locally and is still one machine away from being lost; every
   remaining option — a new remote, a second remote, or merging into `SunScanV2`
   — is outward-facing and needs the user (D-9).
2. **Set a model credential and run one live turn.** Everything downstream
   depends on whether the real model behaves like the scripted one.
3. **Choose the escalation model** before 2026-10-20 (blocker 2).
4. Run the CI job at least once, so Terraform and the security scan stop being
   unexecuted code.
5. **Connect the SunScan adapter** (blocker 5). This replaces an earlier version
   of this item that said to "build the catalogue and recommendation routes" —
   that was wrong, and worth correcting rather than quietly dropping. The
   catalogue and recommendation tools existed then and **deliberately refused to
   answer**, on the reasoning that the installer's prices are the installer's
   data and that one product receiving two different prices is worse than no
   price at all. Building a catalogue here would mean inventing commercial data,
   which the plan forbids and which the existing design argues against in
   comments. **P8 has since shown the missing premise in that argument**: the
   tools can answer without inventing anything, as long as the prices come from
   rows the installer uploads — so the routes are built and the refusal is now
   only the empty-catalogue case. What is still true, and still the reason this
   item is first among the unblocked ones, is the survey half: the widget is
   genuinely less useful without a real assessment, and with no adapter every
   option is an assumption rather than a survey-confirmed figure.
6. **Little in blocker 4 is reachable without external input, and less than
   before.** What is left, with what each needs:

   - `POST /v1/sunscan/assessments` and `GET /v1/sunscan/assessments/:id` need a
     real SunScan contract and credentials.
   - `POST /v1/integrations/google-drive/connect` needs a Google OAuth
     client and a consent screen — and, per ADR-004, the mechanism itself is
     `v1alpha` and UNVERIFIED as GA. `POST /v1/billing/webhook` needs a billing
     provider and its signing secret. `GET /v1/dashboard/metrics` is **done**
     (D-46): the product decision it was waiting on was made rather than deferred,
     and it turned out to be a decision about _what not to report_ as much as what
     to — see blocker 4's own text. What is left of the dashboard is its
     **surface**, and that needs dashboard authentication, which is the first line
     of this blocker and not a route.
   - `POST /v1/qualification/answer`, `POST /v1/leads`,
     `GET /v1/catalog/products` and `POST /v1/recommendations` are **done**
     (the last two by P8, D-27 — they needed the installer's upload, not SunScan,
     and the earlier version of this list was wrong to say otherwise). The answer
     route now applies the journey's own conditional rules (P7, D-30), including
     the usage branch, and a correction now takes the answers it invalidated with
     it (P7, D-31). Of what is left of P7, the skip state turned out not to apply
     -- the journey has no skip to model (D-32) -- and the view-before-submit
     review is a host-page surface whose half of the wire already exists (the
     standing `answers`, `nextQuestionId` and `removedAnswers`). `POST /v1/leads`
     now stops a replayed submission from becoming a second row (P14, D-33),
     which was the one route §135's "idempotency" clause had nothing behind.
   - **Corrected 2026-10-11.** This list previously said the two knowledge routes
     "need Vertex AI Search", which was the wrong reason to leave them unbuilt:
     the managed service is a better retriev*er*, not a prerequisite for ingestion
     or for the tenant isolation the phase is gated on. Both routes now exist
     against a lexical index (P6, D-29). The part that genuinely needs Vertex AI
     Search — and the Drive connector and a crawl — is the _retrieval quality_ and
     the _sources_, and that remainder is what is still blocked.

   - The audit trail (§4) was the other row that needed nothing external, and it
     is built (D-43): the four privileged routes and every effectful tool call
     now record one event each, including the refusals, with a record whose shape
     cannot hold user content. Two things it still cannot say are both about
     blocker 4 rather than about the log: every event's actor is `admin` with a
     **null** id, since one deployment-wide token identifies nobody, and the
     cross-tenant view of refused attempts is stored but served by no route,
     because that view belongs to the dashboard.
   - **Added 2026-10-11.** The row this list used to leave as "a policy decision
     rather than a missing dependency" is now built too, and only half of it was
     a decision. Consent provenance, retention and deletion (§4) are implemented
     and green (D-44): what is recorded as consent is what the server observed
     and nothing a caller asserts, a retention window sweeps on a boot and a
     timer with `SUNNY_LEAD_RETENTION_DAYS` (default 730, `0` = keep), each sweep
     records one event per installer only when it removed something, and a
     visitor or an installer can have a record erased through two routes that
     write the erasure to the trail without the erased content. What is still a
     policy decision is **tamper-evidence** (whether the audit log is to be
     made tamper-evident, and how) and the exact retention window for a real
     deployment — the mechanism exists, the number is the operator's and the
     plan's own §4 row for it is not business-approved (requirements-matrix row
     229).

   So the next honest step is not another route. It is either the SunScan
   contract (item 5) or a model credential (item 2) — each of which turns a
   mocked or refusing surface into a real one.

7. **The dashboard's data half now exists; its surface does not** (plan P10), and
   the surface is the largest piece of remaining work that needs nothing from
   outside the repository. `GET /v1/dashboard/metrics` is built (D-46), so the
   schema that item 7 used to say did not exist yet does: eleven counts and two
   ratios over an explicit window, with the two of §6.4's five words this
   deployment cannot substantiate — "qualified leads" and "usage" — left absent
   rather than filled with a plausible number. What is still missing is the thing
   that would _render_ it, and that is blocked on dashboard authentication, not on
   a decision: a UI over an admin-token API would put the token in a browser.

   `apps/marketing` (P3) was the other half of this item and is now built, and as
   of 2026-10-11 its exit gate is **met**: axe passes at `serious` and above; the
   hero's motion, its canonical colour and its use of the real widget are all
   asserted in a browser; the character has twenty-five committed visual baselines
   (D-16); and the _performance_ half now exists — `npm run perf:marketing` runs
   Lighthouse over the production build, and the measured, committed baseline lives
   in `docs/performance/marketing.md` (D-45). Five of the six lab-measurable
   metrics already meet the good-range boundary and layout shift is exactly zero;
   **total blocking time is the one that does not** (162–386 ms against a 200 ms
   target), which is the main thread blocked after first paint by React hydration
   and the character's render loop. Page-level screenshots are
   deliberately not used as the visual regression, for the operating-system
   reason in D-16, so the baseline is the character rather than the page.

8. **The animation library (P11) is the largest unblocked piece of remaining
   work, and it is now started.** Its dependencies (P2, P4) were already met. Its
   exit gate is "the animation catalogue and playable tests pass", and the
   catalogue half is done: every moment is named, described and _proven playable
   by asking the scheduler_ rather than by reading the sequence's own `states`.
   That test immediately found three moments the engine implements and nothing
   requests — `charge` (A12, one of the plan's five flagship sequences), `listen`
   and `eureka` — and the eureka has since been wired (D-17). **Both halves of
   the gate are now met**: the catalogue exists and is tested, and playability is
   demonstrated in a browser as well as proven by test. The lab grew a gallery
   built from `CATALOGUE`, with a route per moment so that the moments
   unreachable from rest can be demonstrated rather than appearing broken, and a
   Playwright spec clicks every entry in it and waits for the page to record that
   it drew each one (D-18). **A07 is now done** (D-19): the playing state had no
   behaviour of its own — `play_started` moved the machine and changed no pixel —
   so it gained three short moves, one per intensity, which is also how A07's "no
   animation collisions" holds without timing anything. **A04 is done too**
   (D-20): `dismissed` moved the machine into `relaxing` and the state borrowed
   the idle layer in exactly the same way, so it gained a deckchair that unfolds,
   holds with her in it, and folds away — which needed a third way of painting a
   prop, because the character's first two cannot draw an object. **A05 is done**
   (D-21): it is the first moment a visitor starts, so the engine gained its first
   input — a tap hit-tested against the drawn frame — and with it the first
   moment drawn somewhere the moment itself did not choose. **A06 is done**
   (D-22), and it answers the question ADR-001 left open: state that outlives a
   frame lives in the **host**, not in a `playing` subsystem inside the engine.
   The rules are a package of their own (`@sunny/games`), the board is a page
   surface, and the character contributes only its reactions through the four
   machine events a board can reach — so the engine gained no new mode, and the
   next two games get the same split rather than a redesign. **A08 is done**
   (D-23), and it is the row where the plan's adjective carried the work: the
   arcade is a genuinely separate bundle the page does not fetch until it is asked
   to, which a browser check proves by watching the network, and its collision is
   one lookup on a grid of integers rather than a pixel overlap. Its rules joined
   `@sunny/games` and forced that package's exports into one namespace per game,
   so A09's ping pong is an addition rather than a collision. **A09 is done**
   (D-24), and it is the row where the plan's first phrase hid a rig control: its
   "paddle from ray" is the ray-to-arm morph §5.2 lists and the character did not
   have — `armTo` aims one of her eight rays and stretches it until its tip is at
   the bat, which is where the `paddle` prop hangs. Its rally joined
   `@sunny/games` and a test that plays a game to a winner found a real defect the
   unit tests could not: a bat that always met the ball dead centre returned it
   dead level, and two such bats rallied forever without scoring, so she now aims
   every return at the side of the court the opponent's bat is not on. **A10 is
   done** (D-25), and it is the row where the acceptance criterion carried the
   work: "returns to exact default pose" is a claim about `t = 1` that a test can
   hold with `toEqual`, which is what forced the row's own arithmetic. **A11 is
   done** (D-26), and it is the first moment not asked for by an event at all — an
   application plays it by name — so the catalogue's `asked: 'app'` answer went
   from declared to used, and the visual harness gained the same way of asking.
   What remains of P11 is what the gate does not cover: A12–A18, one more game and
   the seasonal cosmetics, none of which are blocked on anything outside this
   repository.
9. **The e2e failures were a stale server, not a flaky spec, and the earlier
   reading of them was wrong.** This item used to say that two `lab.spec.ts`
   checks fail and that they reproduce at HEAD under `git stash`, so the spec
   was failing or racy independently of the change in hand. The first half was
   observed and the conclusion drawn from it does not follow: the failures were
   an artefact of the harness. Playwright's API entry reused whatever was on
   8787 -- including a developer's own `npm run dev:api`, started with the
   _shipped_ rate limits, where this run raises them all to 10000 -- so the
   suite spent the shipped allowance of 30 widget sessions a minute and a late
   test was starved of its session. Measured directly: 30
   `POST /v1/widget/session` answered 200 and the 31st answered
   `429 rate_limited` with `retry-after: 44`. That is why the failing pair
   differed between runs: which test starves depends on how much of the
   allowance the tests before it spent, and `git stash` changes how many
   requests come first. With the six ports free the whole suite was **53 passed**
   then (**58 now**, with the five device-cutout and host-resilience checks added
   since), twice, including every check in `lab.spec.ts`. The reuse is now opt-in
   (`PW_REUSE_API=1`), so an occupied port fails with Playwright's own
   `is already used` message before a browser opens rather than inside a widget
   test (D-40).

10. **Three `lab.spec.ts` checks were failing on this machine, they were not
    D-46's, and the control was run rather than argued.** Found by running the
    release gate for the dashboard increment, on 2026-10-11, with all six ports
    free and `PW_REUSE_API` unset. D-47 fixed them the same day — the diagnosis
    and the fix are at the end of this item, and the failing readings are kept
    here rather than replaced:

    - `npm run test:e2e`, the whole suite: **57 passed, 1 failed**. The failure
      is `lab.spec.ts:60`, "plays every moment in the catalogue when it is asked
      for" — a 30 s test timeout raised while a `locator.click` was still in
      flight, not one of its `data-drawn` assertions timing out.
    - The lab spec alone, re-run: **3 failed** (lines 60, 210 and 541), 9 passed.
    - Those three alone, re-run: **2 failed** — line 60 timing out again and
      line 541, "starts a fresh rally with the score cleared", failing its
      assertion with `Expected: "0"` / `Received: "15"` — while line 210 passed.
      So line 210 is flaky and lines 60 and 541 are reproducible.
    - **The control:** `git stash -u` back to `8f04cef` (the D-45 commit, with the
      whole D-46 change lifted out of the tree) and the same three checks run
      again — **the same two fail**: line 60 on
      `"listen" was asked for and never drawn` (its `data-drawn` attribute never
      became `"1"` inside 10 s) and line 541 on the same `data-hits` "0" vs "15".
      The failures therefore pre-date this increment.

    The reason the control was still run: the argument that D-46 cannot reach
    the lab is a strong one and is mechanical — the lab imports only
    `@sunny/animation-engine`, `@sunny/character` and `@sunny/games`, none of
    which reference `@sunny/contracts`, so its bundle is byte-identical with and
    without the change — but "this failure cannot be mine" is exactly the claim
    item 9 shows being made wrongly before, so it was measured instead. Item 9's
    explanation does **not** cover these two: nothing was reused off an occupied
    port, and neither symptom is a session or rate-limit symptom. Two readings
    are consistent with what was seen (the `listen` perk waits behind the 420 ms
    bubble its own event requests, and the pong check asserts an instantaneous
    zero on a rally that is running, where `data-score` clears to `0-0` and
    `data-hits` is already climbing), but neither is a diagnosis yet. **No fix is
    in this increment** — the increment is API-only — and the three checks are
    the next thing to fix, so that the browser row can go back to saying green
    with the fix's revision behind it.

    **Resolved later the same day as D-47.** The three checks had three different
    causes, and every one of them was a check asserting an _instantaneous_
    reading of something that was moving — or, for the walk, a budget nobody had
    measured:

    - **Line 60, the catalogue walk.** Not the `listen` perk. The walk is 19
      clicks and 19 waits and it costs what the machine takes to resolve them:
      **39.4 s** measured while the rest of the release gate was running, and
      **14.8 s** on the same machine idle. The file's 30 s default sat between
      those two readings, so the walk was cut off part-way on a busy machine. It
      now sets its own **120 s** budget — about 3× the loaded reading — and keeps
      its per-moment `data-drawn` wait at 10 s, which is about 3× the 1.8–3.2 s
      each moment actually takes. The control run's `listen` symptom is a _late_
      moment's wait running out, which the total budget was cutting short as
      well; the two were not separated, and this record does not claim they were.
    - **Line 210, `toContainText('thinking-')`.** A race on a label that is up
      for 600–800 ms against polls that resolve seconds apart — and its signature
      is that it passed in the D-46 gate and failed on the run after it, then
      failed once in three under `--repeat-each=3`. It now asserts the same fact
      where it is cumulative: the catalogue card's `data-drawn` mark for the
      `think` group, asserted **absent before the click** (the only route to that
      group is `turn_started`, and the board's is on a click) and present after
      it.
    - **Line 541, `data-hits` `"0"`.** The same race in the game's own units. The
      click deals the next rally at once and a return lands about every 250 ms,
      so `"0"` is true for less time than a single poll takes. The lab's pong
      panel now publishes `data-rallies`, a count that only grows, and the check
      requires it to have advanced by exactly one. `data-score` `'0-0'` is kept:
      a point needs a rally _lost_, not a ball returned, so it is not in the
      race.

    The whole suite then read **58 passed, 0 failed** in 3.0 m, which is where
    the browser rows above take their green from. No product code was changed to
    make a test pass — the one non-test change publishes a fact for the same
    reason the panel already publishes six others — and the failing readings are
    kept above rather than replaced.
