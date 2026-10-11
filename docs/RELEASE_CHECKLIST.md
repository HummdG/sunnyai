# Release checklist

For a human to work through before Sunny is exposed to real visitors. It is
written to be usable as-is, including the parts that will fail today — several
items are currently red, and each one says what is red and why.

Nothing in this list substitutes for reading `docs/STATUS.md`, which is where the
current state actually lives. This is the _procedure_; that is the _position_.

## 0. Do not ship the following, regardless of what else is green

- [ ] **A deployment where chat is unconfigured is not a release.** `GET /healthz`
      must report `chat.available: true`, with a `surface` and `modelVerified`.
      An unconfigured deployment refuses rather than simulating, which is
      correct behaviour and is _not_ a working product.
- [ ] **No unversioned release.** The work is currently outside version control
      entirely — see `docs/DECISIONS.md`, D-9. A release cannot be identified,
      reproduced or rolled back until that is fixed.
- [ ] **No release while `modelVerified` is false** without a recorded decision,
      because on the Developer API surface the model identifiers have not been
      checked against that surface's catalogue (D-8).

## 1. Automated gates (plan §12)

Run `npm run verify` — it chains the first four.

- [ ] `npm run format:check` — Prettier, clean
- [ ] `npm run lint` — ESLint, type-aware, clean
- [ ] `npm run typecheck` — `tsc --noEmit`, strict, clean
- [ ] `npm run test` — currently **1016 passing across 30 files**
  - [ ] unit
  - [ ] contract (Zod schemas exercised through the routes)
  - [ ] integration — _partial: the API is exercised in-process, not across a
        network boundary_
  - [ ] visual snapshots — **25 committed PNG baselines** of the character,
        compared byte for byte. Aimed at the rig rather than at a page, for the
        reason in D-16: a page screenshot differs by operating system and the
        test gets deleted. Most are states the engine produces by itself; one,
        the paddle on the end of a ray (A09, D-24), is posed by hand, because the
        ray-to-arm morph is a rig control no machine event reaches; and five are
        reduced-motion scenes, where the baseline is the fallback _being used_
        rather than the resting pose handed back, the newest of them being the
        plant's growth and the tuck a reduced-motion visitor sees instead (A11,
        D-26). Regenerate with `npm run test:visual:update` only after looking
        at what moved.
  - [ ] re-run the visual suite under Linux (`node:22-bookworm`, `npm ci`, then
        `npx vitest run tests/visual`) whenever a baseline moves. That is the
        machine CI will use, and the whole reason the baselines are PNGs
        committed rather than a screenshot test is the claim that they are
        platform-independent — which is only a claim until it is re-checked
- [ ] `npm run build` — record both bundle sizes and compare against the last
      release. Last known: widget **152.1 kB (42.4 kB gzipped)**, lab 140.8 kB,
      arcade 11.9 kB. The lab now has a **second entry point** (A08, D-23): the
      arcade is a separate 11.9 kB file the page fetches only when the visitor
      asks for it, so any release that measures "the lab" must measure both, and
      a release where the arcade has crept back into `lab.js` is a regression
      against the plan's own word for that row. All three have grown since the
      figures this line used to carry (119.8 kB and 86.0 kB): the widget by four
      more moments of animation library (A04's break, A05's balloon and burst,
      A10's three arcade-spin variants, and A11's four planting variants, D-20,
      D-21, D-25 and D-26), the lab by the
      sequence variants those add to its grid and, latterly, by the tic-tac-toe
      board and the ping pong table and the rules they import (A06 and A09, D-22
      and D-24). The widget's own figure is unchanged by A09 and by A10 — the
      rally and the arcade are lab surfaces and ship no code to a customer — while
      A11 is the first moment since A05 to move it (127.7 to 131.5 kB, and 35.3 to
      36.5 kB gzipped), and the two changes after that are the option cards (D-28)
      and then device-cutout support plus the `!important` in the shadow
      stylesheet's `:host` block (D-36, D-41), which took it from 131.5 to
      **152.1 kB (42.4 kB gzipped)**. None has a budget
      yet. Nothing
      about either number is alarming at this size, but a figure nobody
      re-measures becomes a figure nobody can trust, so the next release should
      set the budget rather than only re-read the number.
- [ ] `npm run smoke` — against a **running** deployment
  - [ ] exits **0**, not 127 (the exit-code bug is fixed; confirm it stays
        fixed, because a gate that always fails gets deleted, and one that
        always passes is worse)
  - [ ] run with `SMOKE_EXPECT_CHAT=1` once a key is configured, so the live
        turn is actually exercised instead of skipped
- [ ] `npm run verify:all` — the browser suite (Playwright + axe), **58 passing**
      in Chromium, over the plain-HTML demo, the WordPress-shaped host page, the
      React and Next.js fixtures, the marketing site and the character lab
  - [ ] requires `npm run test:e2e:install` once per machine; a release
        that skipped it has never driven the embed snippet in a browser
  - [ ] axe fails the run at `serious` and above. Passing it is a floor, not a
        clean bill of health: it cannot judge whether the assistant is
        understandable or the focus order sensible
  - [ ] the visitor's own chat bubble is **not** covered here — it needs a
        model credential to exist. Its colour is asserted directly instead
        (D-12), so removing that assertion would silently drop the coverage
  - [ ] the React page is the one that catches a host-framework break
        (D-13). It is also the only fixture that exercises `StrictMode`, so
        dropping it would leave the double-mount path untested
  - [ ] the Next.js fixture is the only one that runs the widget in a
        production framework build, through `next/script`, and across
        client-side routing (D-14)
- [ ] Dependency and security scanning — **the commands have been run and pass**;
      the CI _job_ has still never executed
  - [ ] `npm audit --audit-level=high` → **0 vulnerabilities**
  - [ ] the committed-secret `git grep` → clean, and verified to fire on canaries
        for all three shapes (`AIza…`, `BEGIN … PRIVATE KEY`, `sk-…`). Re-check
        that it still fires if the pattern is ever edited, because a grep that
        matches nothing looks identical to a grep that is broken
- [ ] Terraform `fmt -check`, `init -backend=false`, `validate` — **written,
      never executed**; no `terraform`, `tofu` or `gcloud` binary is installed in
      the development environment.
- [ ] Character fidelity re-measured against `sunny.png`:
      `scripts/compare-reference.py`. Last known: ink 0.4828, cream 0.7412. A
      regression here is a silent one — nothing else would catch it.

## 2. Credentials and configuration

- [ ] `GEMINI_API_KEY` set in Secret Manager, added **out of band** so it never
      enters Terraform state:
      `printf '%s' "$GEMINI_API_KEY" | gcloud secrets versions add … --data-file=-`
- [ ] `GOOGLE_CLOUD_PROJECT` set — this is what selects the Vertex surface rather
      than the Developer API, and therefore which model identifiers are valid
- [ ] Session secret present and not the development default. Production
      **refuses to boot** on `DEV_SECRET`; that refusal is the feature.
- [ ] `SUNNY_ALLOWED_ORIGINS` set to an explicit list. Production refuses an
      empty list rather than defaulting to permissive.
- [ ] **Decide the escalation model.** `gemini-2.5-pro` is GA and **retires
      2026-10-20**; the successor is preview-only. This must be decided and
      tested, not inherited.
- [ ] Confirm the chosen model ids against the surface **actually in use**. Every
      id verified in this project came from Vertex AI documentation and none has
      been checked against the Developer API catalogue.
- [ ] **Set `SUNNY_LEAD_RETENTION_DAYS` deliberately.** The default is `730`; `0`
      means the deployment keeps enquiries and transcripts indefinitely, which
      production warns about at boot but does not refuse. Whatever is chosen is
      reported on `/healthz` under `retention` so it can be checked without
      reading the boot log (D-44).

## 3. Infrastructure

- [ ] State bucket bootstrapped by hand — Terraform cannot create the bucket
      holding its own state
- [ ] `terraform init` with explicit `-backend-config`; no backend is committed
- [ ] `terraform plan` reviewed by a person. The configuration has **never been
      applied**
- [ ] `env/<environment>.tfvars` exists and is **not** committed
- [ ] `deletion_protection` on for production
- [ ] Terraform service account can read its two secrets and nothing else
- [ ] **Cloud Run SSE timeouts set explicitly.** Default request timeout is
      300 s, maximum 3600 s. A long conversation will be cut at the default, and
      that will look like a broken assistant rather than a timeout.
- [ ] Confirm no proxy or load balancer buffers the streamed response. ADR-002
      flags this; it is not something to discover after go-live.

## 4. Behaviour under failure

- [ ] Chat unconfigured → refuses with `not_enabled`, does **not** answer
      plausibly
- [ ] Model call fails mid-stream → the visitor sees an error state, not a
      silent stop. Check this against a revoked key, not a mock.
- [ ] **Decide whether rate limiting is sufficient for launch, or whether an edge
      control is needed as well.** The built-in limiter is in-memory and
      per-instance, so the effective limit is `limit × instances`, and the bucket
      cap can evict a counter. It stops a naive script; it is not a quota. See
      `docs/DECISIONS.md`, D-10.
- [ ] **Set `SUNNY_TRUST_PROXY` deliberately, having confirmed the hop count.**
      Left at its default (trust nothing) the limiter keys on the load balancer,
      so every visitor shares one bucket and the limit applies globally. Setting
      it wrong is worse: a hop count above the real chain means the forged part of
      `X-Forwarded-For` is believed. The correct value has **not** been verified
      against Google's documentation.
- [ ] Rate limits are high enough that `npm run smoke` passes from one address —
      a smoke failure caused by the limiter is worse than no limiter, because it
      teaches whoever runs the gate to ignore it. The leads limit is the tight one
      (10/min by default) and the smoke run spends three of those, so a deployment
      set below about 3 will make the lead checks announce themselves as skipped.
      That is reported, not silent, but it is still lost coverage.
- [ ] Confirm a visitor who hits a limit sees something humane, not a bare 429.
      `retry-after` is set; nothing in the widget currently reads it. Note that
      `POST /v1/qualification/answer` is limited per address too, and its default
      (40/min) is set to clear a whole fourteen-question form — a page that
      submits answers in a loop of retries could still exhaust it.
- [ ] Tool call the deployment did not declare → dropped, never executed
- [ ] Lead save fails → the visitor is told, and the conversation is not silently
      lost
- [ ] A tampered session token does not resume another session (covered by
      smoke)
- [ ] An internal tenant id and the SunScan slug never appear in a public
      response (covered by smoke)
- [ ] **Decide Model Armor's failure posture — open or closed.** It is
      undocumented, so it is currently neither. Silence here is a safety
      decision made by omission.

## 5. Accessibility and reduced motion

- [ ] `Intensity = Off` still renders a complete, recognisable character
      (only the stills resolve — `idle-still`, `guiding-still`,
      `speaking-still`, `play-still`, `relax-still`, `balloon-still` and
      `pop-still`; everything else is `null`, and that is intended. The last two
      are the exception worth knowing: they are not the resting pose but a held
      prop, because there is an honest still of a balloon at rest and none of a
      deckchair arriving — D-20 and D-21)
- [ ] Every sequence's `reducedMotionFallback` is honoured — a test asserts every
      one exists, and the `relaxing-reduced-motion`, `balloon-reduced-motion`,
      `arcade-spin-reduced-motion`, `celebrating-reduced-motion` and
      `bloom-reduced-motion` baselines are the fallbacks actually being
      _used_ rather than merely defined (D-20, D-21, D-25, D-26). The arcade's is a
      fallback rather than a `-still` like the rest: `arcade-tuck` is the row's
      own minimal variant, so a visitor who asked for less motion still sees that
      something happened — they just do not see a spin
- [ ] The widget is keyboard-reachable and the conversation is reachable by a
      screen reader
- [ ] Colour contrast on the chat surface, not just the character

## 6. Observability

- [ ] Something reads `/healthz` and alerts on it. **Nothing does yet.** Until
      something does, a dead model key is a silent failure — the deployment looks
      healthy and refuses every conversation.
- [ ] Errors are captured somewhere a human will see them
- [ ] Token usage and cost per conversation are recorded
- [ ] Somebody reads the **audit trail**. It is written — one event per
      privileged route call and per effectful tool call, refusals included, served
      by `GET /v1/audit/events` (D-43) — and **nothing reads it yet, and nothing
      rotates it**. The records it describes now have a life: a retention window
      (`SUNNY_LEAD_RETENTION_DAYS`, default 730 days, `0` meaning keep) sweeps
      enquiries and stale transcripts on a boot and a timer, and a visitor or an
      installer can have a record erased outright (D-44). The **log itself** is
      still an append-only JSONL file per tenant with no rotation or expiry of its
      own, which is the open decision — a log that outlives the records it
      describes is itself a retention question the plan's §4 row for it does not
      settle (requirements-matrix row 229). Nor can it yet say _who_: every
      event's actor is `admin` with a **null** id, because the only privileged
      credential is one deployment-wide token, so the trail distinguishes what
      happened from what _a person_ did only once dashboard authentication exists
      (blocker 4). Refusals that named no valid credential are stored under no
      tenant, and no route serves them.
- [ ] A dashboard exists for `GET /v1/dashboard/metrics` — the route is not built

## 7. Rollback

- [ ] The previous image tag is known and pinned
- [ ] Rollback is **one step** and has been rehearsed. Note that `ignore_changes`
      on the container image means Terraform will not roll the image back for
      you — CI owns the tag (D-9 and the Terraform README).
- [ ] Session invalidation on rollback is understood: rotating the session secret
      signs everyone out, which is the correct response to a bad release and the
      wrong response to a cosmetic one.
- [ ] Lead data written by a bad release is recoverable — it is currently a file
      store, so "rollback" includes "what happened to the file".

## 8. Known scope gaps to state plainly, not to discover

- [ ] **9 of the plan's 14 API routes exist.** Assessments, dashboard metrics,
      Drive integration and billing are **not implemented**, and the two knowledge
      routes exist as ingestion from text the caller supplies rather than as
      managed retrieval. Lead creation, qualification capture, the catalogue pair
      and the knowledge pair **are** implemented by route, and the conversational
      `create_lead` / `save_answer` tools also exist; the pairs write the same
      records. Do not describe the product as having the rest.
- [ ] **There is no SunScan integration.** No SunScan endpoint has ever been
      called from this code. `packages/sunscan-adapter` is a stub, and SunScan
      has no unified error envelope, so the adapter must translate per route.
- [ ] **SunScan has no finance/APR calculators and no grants logic.** A tool
      named `calculate_approved_estimate` has nothing to call. Either build it or
      remove the promise.
- [ ] The dashboard does not exist. The marketing site does (D-15) — it builds
      and it is served locally, but it is not deployed anywhere.
- [ ] Animation runs at **30 FPS**, not the plan's ~60 (D-7). Re-measure on a
      real mid-range device before launch.
- [ ] Multi-tenant retrieval isolation rests on a **Preview** ACL feature with no
      documented absolute guarantee (ADR-004).
- [ ] Deploying a TypeScript ADK agent to Agent Runtime is **undocumented**
      (ADR-003).
- [ ] Firebase App Check caps at **250 domains**, which bounds tenant scale.
- [ ] **The retention window is a technical default, not an approved policy.**
      Enquiries and stale transcripts are swept on a 730-day window by default
      (`SUNNY_LEAD_RETENTION_DAYS`), and a visitor or an installer can have a
      record erased (D-44). Both mechanisms work and are tested; the **number**,
      and the retention of the audit log itself, are not business-approved and
      the plan's own §4 row for them is still `Partial` (requirements-matrix row
      229). The consent wording is versioned by the deployment
      (`CONSENT_WORDINGS`), and no wording has been reviewed by anyone qualified
      to approve it.
