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
- [ ] `npm run test` — currently **280 passing across 9 files**
  - [ ] unit
  - [ ] contract (Zod schemas exercised through the routes)
  - [ ] integration — _partial: the API is exercised in-process, not across a
        network boundary_
  - [ ] visual snapshots — Vitest snapshots only; **not** pixel-diffed against
        the reference artwork in CI
- [ ] `npm run build` — record both bundle sizes and compare against the last
      release. Last known: widget **112.1 kB (30.8 kB gzipped)**, lab 65.0 kB
- [ ] `npm run smoke` — against a **running** deployment
  - [ ] exits **0**, not 127 (the exit-code bug is fixed; confirm it stays
        fixed, because a gate that always fails gets deleted, and one that
        always passes is worse)
  - [ ] run with `SMOKE_EXPECT_CHAT=1` once a key is configured, so the live
        turn is actually exercised instead of skipped
- [ ] `npm run verify:all` — the browser suite (Playwright + axe), **11 passing**
      in Chromium
  - [ ] requires `npm run test:e2e:install` once per machine; a release
        that skipped it has never driven the embed snippet in a browser
  - [ ] axe fails the run at `serious` and above. Passing it is a floor, not a
        clean bill of health: it cannot judge whether the assistant is
        understandable or the focus order sensible
  - [ ] the visitor's own chat bubble is **not** covered here — it needs a
        model credential to exist. Its colour is asserted directly instead
        (D-12), so removing that assertion would silently drop the coverage
- [ ] Dependency and security scanning — **written, never executed.** The CI job
      also greps for credential-shaped strings (`AIza…`, `BEGIN … PRIVATE KEY`,
      `sk-…`) and fails the build on a hit. Run it at least once before trusting
      it.
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
      (only `idle-still` and `guiding-still` resolve; everything else is `null`,
      and that is intended)
- [ ] Every sequence's `reducedMotionFallback` is honoured — a test asserts every
      one exists, but confirm the fallback is actually _used_, not merely defined
- [ ] The widget is keyboard-reachable and the conversation is reachable by a
      screen reader
- [ ] Colour contrast on the chat surface, not just the character

## 6. Observability

- [ ] Something reads `/healthz` and alerts on it. **Nothing does yet.** Until
      something does, a dead model key is a silent failure — the deployment looks
      healthy and refuses every conversation.
- [ ] Errors are captured somewhere a human will see them
- [ ] Token usage and cost per conversation are recorded
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

- [ ] **5 of the plan's 14 API routes exist.** Catalogue, recommendations,
      assessments, dashboard metrics, knowledge ingestion, Drive integration and
      billing are **not implemented**. Lead creation and qualification capture
      **are** implemented by route, and the conversational `create_lead` /
      `save_answer` tools also exist; the pairs write the same records. Do not
      describe the product as having the rest.
- [ ] **There is no SunScan integration.** No SunScan endpoint has ever been
      called from this code. `packages/sunscan-adapter` is a stub, and SunScan
      has no unified error envelope, so the adapter must translate per route.
- [ ] **SunScan has no finance/APR calculators and no grants logic.** A tool
      named `calculate_approved_estimate` has nothing to call. Either build it or
      remove the promise.
- [ ] The dashboard and marketing apps do not exist.
- [ ] Animation runs at **30 FPS**, not the plan's ~60 (D-7). Re-measure on a
      real mid-range device before launch.
- [ ] Multi-tenant retrieval isolation rests on a **Preview** ACL feature with no
      documented absolute guarantee (ADR-004).
- [ ] Deploying a TypeScript ADK agent to Agent Runtime is **undocumented**
      (ADR-003).
- [ ] Firebase App Check caps at **250 domains**, which bounds tenant scale.
