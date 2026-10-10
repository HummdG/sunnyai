# Status

**As of 2026-10-10.** Written against the tree as it exists, from commands run in
this session. Where something has not been executed, it says so rather than
describing what it would do.

This document is the honest answer to "how far along is this?" It is not a
roadmap. Section 7 of the plan requires that missing credentials, unavailable
platform features and mock-only implementations never be hidden, so the
blockers below are stated first and in full.

## The one-paragraph version

The character rig, the animation engine, the API's first vertical slice and the
public marketing site are built, tested and green: **476 tests across 13 files**,
a real fidelity comparison
against the supplied artwork, **20 committed visual baselines** of the character
compared byte for byte, **26/26 API smoke checks** against a running server,
and **35 browser end-to-end checks** — including an axe accessibility pass — over
the widget mounted by its own embed snippet, in a React host page, in a Next.js
host page, and on the marketing site, which runs the real widget and the real
character rather than pictures of them. The
assistant itself **has never answered a prompt**, because there is no model
credential in this environment — the deployment correctly refuses instead of
simulating. Terraform exists and has
never been run. Five of the plan's fourteen API routes exist. Nothing has been
deployed anywhere. Sunny is not reachable by any customer, and by the plan's own
standard it must not be described as working until it is.

## Verified in this session

Every line below is a command that ran and its output.

| Check                          | Command                                                                                     | Result                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Formatting                     | `npm run format:check`                                                                      | _All matched files use Prettier code style_                                                  |
| Lint                           | `npm run lint`                                                                              | clean (ESLint, type-aware)                                                                   |
| Types                          | `npm run typecheck`                                                                         | clean (`tsc --noEmit`, strict + `noUncheckedIndexedAccess`)                                  |
| Unit / contract / visual tests | `npm run test`                                                                              | **476 passed (13 files)**                                                                    |
| Browser end-to-end             | `npm run verify:all`                                                                        | **35 passed** (Chromium, four real host pages, the character lab, real API, real shadow DOM) |
| Widget bundle                  | `npm run build:widget`                                                                      | 125.1 kB — **34.7 kB gzipped**                                                               |
| Character lab bundle           | `npm run build:lab`                                                                         | 99.3 kB                                                                                      |
| API smoke                      | `npm run smoke`                                                                             | **26/26 checks passed, exit 0**                                                              |
| Dependency audit               | `npm audit --audit-level=high`                                                              | **0 vulnerabilities**                                                                        |
| Committed secrets              | the CI job's `git grep`, run locally                                                        | clean — and proven to fire (below)                                                           |
| Character fidelity             | `scripts/compare-reference.py`                                                              | ink 0.4828, cream 0.7412 (see `docs/design/character-reference.md`)                          |
| Visual baselines on Linux      | the committed tree in a `node:22-bookworm` container (`npm ci` + `vitest run tests/visual`) | **19 passed** — the Windows-generated PNGs are byte-identical to the ones Linux produces     |

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
  id-only `cancel` had hidden.
- **Visual regression** (`tests/visual`, 22 tests) — twenty scenarios, one per
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
  that the standing map survives a restart), rate limiting (both the counter and
  the address resolution it keys on, including the case where a caller forges
  `X-Forwarded-For`), and the persistence layer.
- **Contracts** (`packages/contracts`) — the Zod schemas that are the single
  source of truth for the wire format.
- **Widget** (`packages/widget`) — the embed snippet's attributes and which wins,
  and the colour maths that keeps an arbitrary tenant brand legible.
- **Browser** (`tests/e2e`, Playwright + axe) — the widget mounted from its own
  snippet inside a shadow root, mounted on the body rather than beside the script
  tag, named from the API rather than the page, leaking no tenant internals,
  openable and closable from the keyboard, exposing the documented `window.sunny`
  handle, and audited by axe in three states (closed, open, and open with the
  composer enabled — the last because axe skips disabled controls, so the send
  button's contrast is only checked when it is live).
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
  hidden, and **every moment is played**: the spec clicks `Play` on all seventeen
  and waits for the page to record that it drew each one. It is the half of P11's
  gate that a unit test cannot reach, and it found three things (D-18) — including
  a moment that was dropped rather than deferred, and a bug in the lab's own
  preview clock that made a working moment look broken. It also carries the two
  A05 checks that only a browser can make: a tap on the stage's own screen
  coordinates becomes the viewBox point the engine reasons in, and the balloon is
  popped by tapping it where it is _painted_ rather than at a coordinate the test
  worked out.

### Fixed in this session (A05: the balloon)

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
  after the play moves added two scenes: **16/16 in the container**, so the
  premise held for the new baselines too rather than only for the first set.

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

`packages/solar-rules` and `packages/sunscan-adapter` are `package.json`-only
stubs. `packages/ui` is real but only holds tokens — no components yet.
`apps/dashboard` does not exist. `tests/security` is an empty directory.
(`tests/visual` no longer is — it holds the character baselines, D-16 — and
`tests/e2e` holds the Playwright suites.) `apps/marketing`
now exists and is built (D-15), which makes the dashboard the larger remaining
gap of the two: it is the one the plan's P10 blocks on a product decision rather
than on code, and it is the only surface that still needs a data source that has
not been designed.

### 9. Section 12's required checks, honestly accounted

| Required check                 | State                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Formatting / lint              | **done**, in CI and locally                                                                        |
| Typecheck                      | **done**                                                                                           |
| Unit tests                     | **done** — 476                                                                                     |
| Contract tests                 | **done** — Zod schemas exercised through the routes                                                |
| Integration tests              | **partial** — the API is exercised in-process, not across a network                                |
| E2E (Playwright)               | **done** — 35 checks in Chromium against four real host pages, the API, the lab and the shadow DOM |
| Visual snapshots               | **done** — 20 committed PNG baselines, byte-compared, re-verified on Linux `resvg` (D-16)          |
| Accessibility (axe)            | **done** — three widget states, failing at `serious` and above                                     |
| Dependency / security scanning | **commands run and passing**; the CI _job_ has still never run                                     |
| Terraform validation           | **written, never executed**                                                                        |
| Smoke test                     | **done**, and now exits 0 when it passes (blocker 1 aside)                                         |

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

7. **The dashboard does not exist** (plan P10), and it is the largest piece of
   remaining work that needs nothing from outside the repository. It sits behind
   `GET /v1/dashboard/metrics`, which is a product decision before it is a route:
   until someone decides what an installer should see on opening the tool, there
   is no schema to build against.

   `apps/marketing` (P3) was the other half of this item and is now built. Its
   exit gate in the plan is "a visual regression and a Lighthouse/accessibility
   baseline", and it is **better than half met but not met**: axe passes at
   `serious` and above; the hero's motion, its canonical colour and its use of
   the real widget are all asserted in a browser; and the character now has
   twenty committed visual baselines (D-16). What is still missing is the
   _performance_ half — there is no Lighthouse run and no Core Web Vitals figure,
   so nothing has measured how fast the page is. Page-level screenshots are
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
   Playwright spec clicks all seventeen and waits for the page to record that it
   drew each one (D-18). **A07 is now done** (D-19): the playing state had no
   behaviour of its own — `play_started` moved the machine and changed no pixel —
   so it gained three short moves, one per intensity, which is also how A07's "no
   animation collisions" holds without timing anything. **A04 is done too**
   (D-20): `dismissed` moved the machine into `relaxing` and the state borrowed
   the idle layer in exactly the same way, so it gained a deckchair that unfolds,
   holds with her in it, and folds away — which needed a third way of painting a
   prop, because the character's first two cannot draw an object. **A05 is done**
   (D-21): it is the first moment a visitor starts, so the engine gained its first
   input — a tap hit-tested against the drawn frame — and with it the first
   moment drawn somewhere the moment itself did not choose. What remains of P11 is
   what the gate does not cover: A06, A08–A18, the three games and the seasonal
   cosmetics, none of which are blocked on anything outside this repository. The
   three games (A06, A08, A09) are the hard ones: they need state that outlives a
   single frame, which is the open question ADR-001 leaves — whether a `playing`
   subsystem owns it or the host does — and the balloon added the engine's _input_
   channel without answering where a _board_ would live.
