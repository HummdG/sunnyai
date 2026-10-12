# Implementation evaluation and recovery plan

**Date:** 2026-10-12
**Evaluated against:** `SUNNY_AI_IMPLEMENTATION_PLAN.md` (v1.0) and the reference artwork `sunny.png`
**Tree:** `main` at `40bba4b`

This document supersedes the completion claims in `docs/STATUS.md` wherever the
two disagree. `STATUS.md` reports what the tests assert; this reports what the
product does when it is run and looked at.

## 1. Verdict

The code builds, typechecks and passes its unit tests, but the product does not
meet the plan. Roughly two of fifteen phases (P0–P14) are meaningfully done. The
character — which the plan names as _the differentiator_ — is the weakest part:
it does not look like the reference closely enough, its motion is stiff and
low-amplitude, and the flagship sequences are not the sequences the plan
describes. The widget has a visible layout bug on open, chat is disabled out of
the box, and the marketing site is a single page that covers a fraction of the
specified content.

The test suite is green because it verifies the implementation against its own
assumptions (including visual baselines captured from its own output), not
against the reference artwork or the plan's acceptance criteria.

## 2. What was run

| Check                                              | Result                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                | Pass                                                                                          |
| `npx vitest run`                                   | 1119 passed, 21 skipped, 38 files                                                             |
| `npm run build` (widget + lab)                     | Pass — widget 156.3 kB (43.9 kB gzip)                                                         |
| API (`apps/api/src/main.ts`)                       | Starts; **chat disabled** — `GEMINI_API_KEY is not set`                                       |
| Character lab, widget demo, marketing (`next dev`) | All serve HTTP 200, no console errors                                                         |
| Browser inspection                                 | Playwright screenshots and frame-by-frame captures of the hero, widget open and lab sequences |
| `npm run test:e2e`                                 | **Not run** in this evaluation                                                                |

Evidence screenshots are in `docs/evaluation/`.

## 3. Findings

### 3.1 Character fidelity — fails

Reference: `sunny.png`. Render at rest: `docs/evaluation/hero-still.png`.

- The character is drawn procedurally from SVG primitives
  (`packages/character/src/render.ts`, `geometry.ts`). The plan (§1, §3.1)
  calls for preserving the supplied artwork as canonical and using a Rive rig;
  no Rive, GSAP, Motion or Lottie dependency exists anywhere in the repo.
- Outline weight is thin and uniform; the reference uses heavy rubber-hose ink.
- The cheek creases at both ends of the smile — a large part of the
  reference's charm — are missing.
- The smile is a thin, slightly lopsided stroke rather than a bold arc with end
  ticks.
- Eye highlights approximate, but do not reproduce, the reference's notched
  pupil highlight.

### 3.2 Animation — stiff, low-amplitude, partly broken

Evidence: `docs/evaluation/lab-flagship-frames.png`,
`docs/evaluation/hero-show-off-sequence.png`.

**Rendering architecture.** Each changed frame rebuilds the entire SVG as a
string and assigns it with `innerHTML` (`packages/widget/src/widget.ts:410`,
`apps/marketing/components/sunny-hero.tsx:75`). This churns the DOM and the
garbage collector every frame, which produces jank on ordinary devices and
destroys event targets mid-interaction (commit `e48c506` patched one symptom of
this).

**No limbs.** The plan's ray-to-arm morph (§5.2) is implemented as a single ray
stretched into a longer triangle. Nothing in the rig can hold, stroke, pull or
point the way the sequences require.

| Sequence            | Plan (§5.3)                                                     | Observed                                                                                    |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A02 Thinking/eureka | Ray morphs to chin-stroking arm; another to bobbing "?"; eureka | Tiny "?" scribble near one eye; no arm; cut off by `speaking-pulse` within a few hundred ms |
| A12 Charge panel    | Panel unfolds, sunlight beam, battery fills                     | ~10 px battery outline beside the mouth                                                     |
| A03 Sunglasses      | Arm pulls out shades                                            | Black bar drops from above and lands as a line through the pupils                           |
| A04 Deckchair       | Chair unfolds; shades; relax                                    | Beige rectangles clipping through the body; shades askew across one eye                     |
| Guiding / point     | Arm points at a target                                          | One ray grows larger                                                                        |
| Celebrate           | Expressive, elastic                                             | Barely perceptible bounce and a few small sparkles                                          |
| Bubble open         | Fizzy bubbles → expanding panel                                 | Not visible in the lab; pressing "Play · bubble-open" played `cool-shades`                  |

**Idle.** Over a 3-second idle sample the hero produced 67 DOM mutations across
180 animation frames — the page runs at 60 FPS but almost nothing moves.

**Scheduler.** Direct "Play" requests in the lab are overridden by other
sequences, so the lab cannot serve as the deterministic replay harness the plan
requires (§5.3).

**Missing entirely:** A15 melting ice cream (the plan's "signature comedic
sequence"), A13 kickflip, A16 Rubik's cube, A17 impossible cube, A18 seasonal
themes.

### 3.3 Widget — visibly broken

Evidence: `docs/evaluation/widget-open-overlap.png`.

- After opening, a full-size Sunny is left over the panel header, covering the
  subtitle and the greeting bubble. The "settles into header" step does not
  scale or reposition the character.
- The opening transition (§6.2: react → bubbles rise → bubble expands →
  settle, ~400–650 ms) is not visible; the panel is essentially fully shown in
  the first captured frame (~80 ms).
- With no `GEMINI_API_KEY` and no `.env` or dev provider, the assistant cannot
  answer anything.

### 3.4 Marketing site — roughly 15% of the specified site

Evidence: `docs/evaluation/marketing-full-page.png`.

- One page and one component (~1,500 lines). Missing: product, meet Sunny,
  integrations, resources, privacy/terms, sign-in, start.
- Hero headline is not "Meet Sunny. Your brightest employee." The character is
  small, sits in a card, and does not emerge from a bubble. The hills are a
  single flat curve, not rolling layered hills.
- The "colour-switching demo" is four static coloured circles; nothing
  re-themes.
- No pricing: the section states that there is no price list.
- Copy is written defensively for engineers ("Anything more specific than that
  would be a number we made up"); the footer is placeholder text. It does not
  sell.

### 3.5 Platform scope

| Phase                      | State                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P0 Discovery               | Done — discovery docs, ADRs, requirements matrix exist                                                              |
| P1 Foundations             | Partial — monorepo, lint/types/tests, CI, Terraform and deploy scripts exist; no evidence of a live deployment      |
| P2 Design + character      | **Fails acceptance** — see 3.1, 3.2                                                                                 |
| P3 Marketing               | **Fails acceptance** — see 3.4                                                                                      |
| P4 Widget                  | Partial — async embed, shadow DOM, host fixtures exist; open sequence broken (3.3)                                  |
| P5 AI core                 | Partial — Fastify API with sessions, chat stream, rate limits, leads; Gemini gated behind an unset key              |
| P6 Knowledge               | Partial — upload route only; no Drive, crawl or Vertex retrieval                                                    |
| P7 Qualification           | Partial — questionnaire and answer route; SunScan-derived schema unverified                                         |
| P8 Catalogue/recommend     | Partial — upload and deterministic rules exist                                                                      |
| P9 SunScan                 | **Absent** — `packages/sunscan-adapter` is empty                                                                    |
| P10 Dashboard + onboarding | **Absent** — no `apps/dashboard`, no Firebase Auth, no onboarding, no Sunny Studio; admin routes use a shared token |
| P11 Full animation library | Partial — see 3.2; games: tic-tac-toe, ping pong, and a grid-of-cells Space Invaders                                |
| P12 Add-ons                | **Absent** — no voice, Gmail or guidance SDK                                                                        |
| P13 Billing/ops            | **Absent** — no Stripe code                                                                                         |
| P14 Hardening/release      | Not started                                                                                                         |

## 4. Root causes

1. **Wrong animation foundation.** Procedural SVG maths with a full repaint per
   frame cannot produce smooth, expressive character animation, and the rig has
   no limbs or real props. The plan's runtime choice was skipped.
2. **Verification measured the code, not the product.** Visual baselines were
   captured from the implementation's own output, so "matches baseline" passed
   while the widget overlapped its own text and the character drifted from the
   reference. No acceptance gate involved looking at the result next to
   `sunny.png`.
3. **Effort went to the wrong slice.** ~15k lines of API and a 1,580-line
   `STATUS.md`, while milestone M1 ("Character delight") — which the plan says
   to perfect first — was never met.

## 5. Recovery plan

Keep: `packages/contracts`, `packages/solar-rules`, `packages/games` (rules),
`apps/api`, the widget's shadow-DOM embed and host fixtures, CI and tooling.

Replace: the character renderer and rig, the flagship sequences, the widget open
sequence, and the marketing hero and site.

Each phase ends with a **human visual review** against `sunny.png` and the
plan's acceptance column. Automated baselines are re-captured only after that
review passes.

### R0 — Animation runtime: decided 2026-10-12 — Rive, authored by an animator

The owner chose high-quality animation: Sunny will be a Rive file built by an
animator from `sunny.png`. Recorded in
`docs/architecture/adr-007-character-runtime.md`. The animator brief, including
the fixed input/event contract the app codes against, is
`docs/design/rive-animator-brief.md`.

**Critical path:** engaging the animator. R1–R2 below are split between the
animator (the art and motion) and engineering (the `@sunny/character-rive`
integration, which can be built and tested against the contract before the
final file arrives).

### R1 — Character rebuild (P2 redo)

- Vector asset traced from `sunny.png` with separate layers: body, 8 rays,
  eye whites, pupils + notch highlights, brows, smile, cheek creases.
- Persistent DOM/canvas nodes; animate transforms and opacity only — no
  per-frame markup rebuilds.
- Rubber-hose limbs as their own rig parts (a ray detaches/morphs into a bendy
  arm with a gloved hand), not stretched triangles.
- Squash/stretch, independent elastic ray wobble, blink, eye aim.
- Idle that visibly breathes and glances, sparsely (§5.2), and pauses off-screen.

**Exit:** resting pose approved side by side with the reference; a
performance trace shows no layout or scripting spikes per frame at 60 FPS.

### R2 — Five flagship sequences (M1)

Idle, thinking/eureka, sunglasses, charging a panel, bubble-to-chat opening —
each with real arms and props at readable scale, interruptible, restoring
the exact rest pose, with a reduced-motion fallback.

- Fix the scheduler so a direct request wins (§5.2 priority order:
  direct interaction first) and the lab plays exactly what was asked.
- Lab supports deterministic replay, scrubbing and screenshots of any frame.

**Exit:** owner sign-off on a recorded GIF of each sequence; interrupt tests
(§11 scenario 8) pass with no lingering props or corrupted rays.

### R3 — Widget open and chat (P4/P5 fixes)

- Implement the open sequence: react → fizzy bubbles → bubble expands into the
  panel → Sunny scales into the header avatar slot → greeting, 400–650 ms;
  immediate in reduced motion.
- Fix the header overlap; add an E2E assertion that the header avatar's
  bounding box does not intersect the title, subtitle or first message.
- Provide a documented dev path to a working chat: `.env.example` with
  `GEMINI_API_KEY`, and a startup message that says exactly how to enable it.

**Exit:** §11 scenario 2 (external embed) passes on plain HTML, React and
Next.js hosts; a real multi-turn Gemini conversation works locally with a key.

### R4 — Marketing site (P3 redo)

- Hero per §6.1: "Meet Sunny. Your brightest employee.", large living
  character emerging from an orange bubble, rays settling, blink/glance,
  layered rolling hills transitioning into the next section.
- All specified pages: home, product, meet Sunny, how it works, integrations,
  pricing, resources, privacy/terms, sign-in, start.
- Live colour switcher that re-themes both Sunny and the embedded widget.
- Lazy-loaded interactive animation gallery.
- Customer-facing copy rewrite; pricing shows configurable plans (§15 —
  prices as configuration, clearly marked if placeholder).

**Exit:** visual review; Lighthouse and axe baselines re-measured; mobile
pass at 390 px.

### R5 — Verification that measures the product

- Reference comparison: the resting pose compared against `sunny.png`, not
  against the implementation's previous output.
- E2E geometry assertions for layout (no overlap, safe areas, z-index).
- A recorded GIF per flagship sequence attached to each release.
- `STATUS.md` reduced to the plan's §14 template, with each "done" item
  linking to visual evidence rather than test counts.

### R6 onward — Platform gaps, in plan order

1. **P10 Dashboard + onboarding:** `apps/dashboard` (Next.js), Firebase Auth,
   server-side memberships and roles, onboarding wizard, Sunny Studio,
   replacing the shared admin token.
2. **P6 Knowledge:** Vertex AI Search (or the ADR-004 fallback connector),
   Drive OAuth, website ingestion, citations, tenant-isolation tests.
3. **P13 Billing:** Stripe checkout, portal, signed and idempotent webhooks,
   entitlements.
4. **P9 SunScan:** blocked until the real contract and credentials are
   available; keep production acceptance marked blocked.
5. **P11 Remaining animations:** A05–A18 including ice cream, kickflip,
   Rubik's/impossible cube, seasonal themes; Space Invaders as a real
   canvas arcade game.
6. **P12 Add-ons:** voice (Gemini Live), Gmail drafts, website-guidance SDK.
7. **P14 Hardening and release.**
