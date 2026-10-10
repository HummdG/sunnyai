# Decisions

A record of choices made while building, with the reasoning. Section 7 of the
plan says to ask for approval only at genuine external, account, billing or
destructive boundaries, and otherwise to make documented decisions and proceed.
This is that documentation.

Entries marked **OPEN** are the ones that need the user, because they cannot be
resolved from inside the code.

---

## D-1. The character is a pure function, not a Rive or GSAP timeline

**Decision.** A pose is a plain serialisable object; the renderer is a pure
function of it; an animation is a function `(base, t) => rig`.

**Why.** The plan names Rive or GSAP as candidate tooling for the character. Both
model an animation as a timeline held by the library, which makes "what does
frame 37 look like" a question you answer by watching, not by asserting. The
reference artwork had to be reproduced _to measurement_, and the only way to keep
that reproducible is for the artwork to be a function of data. It also means the
widget ships no animation runtime, which is why the bundle is 29.6 kB gzipped.

**Consequence.** Applying an effect to a subset of the rig is more code than it
would be with a timeline library, and designers cannot edit the character in a
visual tool. Neither has been a real cost yet. `docs/design/character-reference.md`
records the fidelity this buys.

## D-2. Props are a closed vocabulary

**Decision.** `PROP_IDS = ['question-mark', 'sparkle', 'sweat-drop', 'battery',
'sunglasses']`. A prop exists only if a sequence declares it in `assets`.

**Why.** The plan's §5.2 requires that sequence cleanup be structural rather than
a matter of remembering to undo things. With a closed vocabulary, "every prop on
screen is one the current sequence declared" is an invariant the renderer can
enforce, so a prop cannot be left behind by an interrupted animation. It also
gives the renderer and the scheduler a single shared source: a prop it can draw
but the scheduler cannot name would be unreachable, and one the scheduler can
name but it cannot draw would be a silent no-op.

## D-3. The model-authored animation script is never executed

**Decision.** The model emits application events — `message_started`,
`tool_started`, `recommendation_ready`, `lead_saved` — and a fixed table maps
events to approved sequences. §5.2 says this explicitly; what is worth recording
is that no code path was built that could do otherwise. There is no parser for a
model-supplied animation, so the failure mode is not "we forgot to validate it".

## D-4. Intensity is a floor, and a variant that animates is never `off`

**Decision.** `Intensity` (Off / Minimal / Balanced / Playful) sets the minimum
that may play. A sequence declaring `intensity: 'off'` holds one pose; anything
that animates declares at least `minimal`. Invariant: every group has a variant
at `minimal`, `balanced` and `playful`, excluding `blink` and `idle`.

**Why.** This came from a real defect. `confused-still` and `error-still` both
ignored `t`, so a `minimal` tenant watched the face **pop** in and back out
instead of fading — and `error-still` was declaring `off` while animating, which
is the contradiction the invariant exists to catch. Both now fade via `bump(t)`,
and the `error` group legitimately resolves to `null` at `off`.

## D-5. Priority bands, not a priority queue

**Decision.** `PRIORITY = { idle: 0, play: 200, success: 400, chat: 600,
accessibility: 800, interaction: 1000 }`.

**Why.** The plan specifies the _order_ (direct interaction > accessibility and
error > chat and guidance > success > user-invoked games > idle). Wide gaps mean
a new sequence can be placed between two bands without renumbering, and an equal
priority is a deliberate tie rather than an accident of two numbers being
adjacent. Accessibility outranking chat is the one ordering worth stating
explicitly: an error or an accessibility need pre-empts conversation, and that
should not be changeable by editing one number.

## D-6. ESLint `recommendedTypeChecked`, not `strictTypeChecked`

**Decision.** `tseslint.configs.recommendedTypeChecked` plus a named list of
high-value rules (`no-eval`, `no-implied-eval`, `no-new-func`, `no-explicit-any`,
`no-unsafe-assignment`, `no-floating-promises`, `no-misused-promises`,
`consistent-type-imports`, and others).

**Why.** `strictTypeChecked` produced **147 errors with almost no real defect
behind them**: `restrict-template-expressions` on `` `port ${n}` ``,
`no-confusing-void-expression` on `onReady?.(port)`, `no-unnecessary-condition`
on defensive checks that exist because the value arrives from the network. A
linter that noisy gets disabled, and then the rules that matter stop running too.
The explicit list is the part worth keeping.

**Consequence.** Some genuine-but-marginal strictness is off. That is a
deliberate trade and is recorded here rather than in a comment nobody reads.

## D-7. Animation runs at 30 FPS; the plan says about 60

**Decision.** 30 FPS for now. **The plan's target is not met.**

**Why.** The character is SVG, and at 30 FPS on a mid-range phone the per-frame
cost is dominated by the rasteriser re-rendering the ray group. Going to 60 would
need either a coarser scene graph or a canvas path, which is a real change rather
than a constant.

**Consequence.** Recorded as a gap, not dressed up as a decision. It should be
revisited against a real device before launch, because the flagship idle
animation is the one that would show the difference. The rendered sample set and
the frame budget are both cheap to re-measure.

## D-8. The model surface is chosen deliberately, and reported

**Decision.** `GOOGLE_CLOUD_PROJECT` present → the **Vertex AI** surface; absent
→ the **Gemini Developer API**. The capability report carries `surface` and
`modelVerified`, and `modelVerified` is `false` on the Developer API surface.

**Why.** This was a real bug, not a design preference. The client was built as an
API-key-only client while the default model identifier had been read from
**Vertex AI's** model pages, and `location` was read but never passed. The two
surfaces are reached at different hosts with different identifiers, and sending a
Vertex identifier to the Developer API fails with a model-not-found rather than
degrading. So the surface has to be derived from the credentials and reported,
because "which of the two am I talking to" determines which model ids are even
valid — and `modelVerified` is false whenever the ids were not checked against
the surface in use.

**Unresolved, and it is a real risk:** every model identifier verified in this
project came from Vertex AI documentation. None has been checked against the
Developer API's catalogue.

## D-9. **OPEN** — where does this code live?

**Updated 2026-10-10.** Part of this entry is now resolved: `sunny-ai` **is** a git
repository, on branch `main`, with real history (`b1edc17`, `61eb3f2`, …). Earlier
in the day it was not — it had a `.gitignore` and a `.github/workflows/ci.yml` but
no `.git`, so the work was unversioned and one bad command from being lost. That
gap was closed by initialising a repository here, which is the only one of the
candidate options that touches nothing outside this directory and commits to
nothing outward-facing.

**What is still open, and still needs the user:** this repository has **no
remote**, and **none of its history has been pushed anywhere**. The original
concern stands unchanged —

`C:\Work\Arkalith\SunScanV2` is a repository with remote
`https://github.com/HummdG/sunny.git` — a repo **named `sunny`** holding
**SunScanV2's** history (roof geometry, cross-gable fitting). The implementation,
the plan document (`SUNNY_AI_IMPLEMENTATION_PLAN.md`) and `sunny.png` live in
different directories from that history.

**Why this still needs the user.** Every remaining option is outward-facing:
push `sunny-ai` to a new repository, add it as a second remote on the existing
one, or move the tree into `SunScanV2` and push there. The last writes this
project's files into the history of a repository that currently belongs to a
different project. None of that is derivable from the code, and getting it wrong
is not cheaply undone.

**Until it is decided:** the history exists on one machine and nowhere else. Local
commits protect against a bad edit; they do not protect against the machine.

## D-10. Rate limiting is an in-memory fixed window, and is not a quota

**Decision.** A fixed-window counter in process memory. Session creation and lead
submission are keyed by client address; chat is keyed by session. Defaults: 30
session creations, 20 chat turns and 10 leads per minute, all overridable by env
var, with the whole thing switchable off by `SUNNY_RATE_LIMIT=0`.

**Why it exists at all.** The API has three public routes that cost something real.
`POST /v1/widget/session` is unauthenticated and writes a durable conversation
record, so a loop fills the store. `POST /v1/chat/stream` calls a model and bills
per token, so a loop is a denial of wallet — there is no data to steal, which is
precisely why nobody notices. `POST /v1/leads` is the third, and the sharpest: it
writes a row the installer is expected to act on, and unlike a conversation there
is no way to take it back. `rate_limited`/429 was already in the error contract
and **nothing could ever return it**; the control had been designed and not built.

**Why a fixed window.** A sliding log or token bucket defends against a caller who
tunes their rate to sit just under the limit. That is not the threat. The threat is
a script with no pacing at all, which a fixed window stops equally well for less
memory and less work per request. The cost is that a caller can burst to 2x the
limit across a window boundary, and for a chat widget that is not worth defending
against.

**Why `X-Forwarded-For` is resolved by hand rather than by a framework option.**
The obvious implementation reads the left-most entry of the header, which is the
one the caller supplies — so the attacker picks the key they are limited by and
rotates it, which is the same as no limit. `clientAddress()` counts in from the
socket instead: trusting N proxies means the client is N entries back from the
right, and everything to the left is ignored. With no trust configured, or a
chain shorter than the configured trust, it falls back to the socket peer, which
over-limits rather than under-limits. The spoofing case is a unit test.

**The honest limits of this, which belong in the release notes and not only here:**

- **It is per-instance.** The effective limit is `limit × instances`. On Cloud Run
  with four instances the real ceiling is four times what the config says. This is
  a backstop against a naive script and a runaway client, **not a quota**, and not
  a substitute for an edge control (Cloud Armor rate limiting, an API gateway) at
  scale.
- **The bucket map is bounded, and eviction resets a counter.** At
  `SUNNY_RL_MAX_KEYS` the sweep drops expired buckets, then the oldest. A dropped
  key starts a fresh count, so extreme key cardinality makes the limiter _more_
  permissive for the keys it evicts. That is the deliberate direction for a memory
  guard to fail, but it means the cap cannot be relied on as a security control.
- **The hop count for Cloud Run is not verified.** `SUNNY_TRUST_PROXY` has not been
  set against a real deployment, and the number of proxies between a visitor and
  the container has not been confirmed from Google's documentation. Until it is,
  the safe setting is the default (trust nothing), which means the address key is
  the load balancer and the limit applies across all visitors at once.
- **The smoke test shares the address budget, and now says so.** This one stopped
  being hypothetical the moment `POST /v1/leads` joined the smoke run: the first
  two runs of the extended suite failed against a server whose lead budget the
  author's own curl testing had already spent. Two changes came out of it. The
  lead limit default moved from 5 to 10 per minute, because 5 is not merely tight
  for a script, it is tight for a real office behind one NAT address. And the
  smoke script now treats a `429` on either lead call as a **skipped check** that
  it prints, rather than a failure — a 404 or a 5xx still fails, so "limiter
  engaged" cannot be mistaken for "route missing". Verified both ways: 21/21 with
  budget available, and 18/18 with the skip announced when the limit is spent.

## D-11. Answers belong on the conversation, not in the transcript

**Status: decided and built** (2026-10-10). `POST /v1/qualification/answer` exists;
this records what it does and why, because the convenient implementation was
available and wrong.

**The problem.** In the conversational flow, `save_answer` records into a map that
the turn persists as structured data, and the next turn recovers it from history
rather than re-parsing the assistant's prose. That works because a turn exists.

A route inverts this: the host page submits an answer directly, with no chat turn
around it. The tempting implementation is to append a synthetic user turn — one
whose text is something like `"Roof details: direction = south"` — because
`answersFromHistory` would then pick it up with no other change.

**Why not.** That puts words in the visitor's mouth. The model reads the
transcript as the conversation so far, so a fabricated user message is not just
untidy: it is the assistant being told the visitor said something they did not.
It also cannot be un-said, and it would be indistinguishable from a real turn to
every later reader of the same conversation.

**Decision.** `Conversation.answers` is a first-class standing map, written through
`Store.mergeAnswers`. It is **last write wins** and both paths maintain it:

- the route writes the single answer it was given;
- a turn reads the map, and folds back the answers it changed when it finishes.

That last point is the one worth stating, because the obvious alternative — leave
the map to the route, keep the transcript to the chat, merge them on read — has no
defensible tie-break. Two maps can disagree ("the visitor told the chat south, the
form east"), and the only thing available to decide between them is which code
path happened to run last, which is exactly the answer you should not want. With a
single map, whichever write was later wins, and that is the right rule.

**The per-turn map stays, holding only the delta.** A turn persists just the
answers it set or changed, not the whole accumulated map. A test caught the first
version doing the latter: the assistant turn was recording every answer ever given,
so "what did this turn change" was unanswerable from the transcript. The delta is
what makes the record an audit trail rather than a series of lengthening repeats.
`answersFromHistory` still merges the per-turn maps underneath the standing map,
so a conversation written before this field existed resumes with its answers
intact.

**One deliberate looseness.** The contract's Zod schema does not enumerate the
questions or their options. That vocabulary is SunScan's, it lives in the API
beside the question set, and `@sunny/contracts` ships to the browser — a copy
there would be public as well as a second thing to keep in step. The route
validates against the real question set and answers `400` naming the permitted
values, which is more useful to a caller than a schema error. There is now one
`validateAnswer` for both the tool and the route, so the two cannot drift.

---

## Recorded, not decided

Smaller choices worth a line each, so a future reader does not relitigate them.

- **Terraform does not create a database.** The API persists to a file store. A
  managed database is a decision a person should make, not one a Terraform file
  should make by existing. See `adr-006-data-and-consent.md`.
- **The model key secret is created empty.** Terraform state is readable; a
  credential written into it has leaked. The value is added out of band.
  Exception: the session secret, which is generated _by_ Terraform and exists
  only to sign this deployment's own sessions.
- **`ignore_changes` on the container image.** CI owns the image tag; without
  it, the next `apply` would silently roll the service back to whatever a human
  last set. Terraform owns everything around the image.
- **No backend block is committed.** It is passed at `init`, because a state
  bucket location is environment-specific and should not be guessable from the
  repository.
- **The `no-console` rule allows `warn` and `error`.** The widget's boot-time
  `console.error` for a malformed embed snippet is exactly the case where an
  integrator must be told why nothing mounted.
- **Snapshots are excluded from Prettier.** Formatting them would rewrite the
  expectation rather than check it.
- **The smoke test sets `process.exitCode` instead of calling `process.exit()`.**
  `process.exit()` tore the process down while a pooled keep-alive socket was
  closing, tripping a libuv assertion on Windows: a run printing _"17/17 checks
  passed"_ exited **127**, which as a post-deploy CI step reads as a failed
  deployment. Verified pass → 0, unreachable server → 1, wrong expectation → 1.
- **The eye tilt and highlight width were corrected against measurement, not
  taste.** Tilt now matches the reference to 0.2°; cream-mask IoU 0.567 → 0.741.
  Both values carry the provenance and the residual discrepancy in
  `docs/design/character-reference.md`.

## D-12. The readable tone of the brand colour is computed, not chosen

**Status: decided and built** (2026-10-10). Recorded because the widget's
accessibility depends on a colour we do not control.

The browser audit failed the widget's own default palette. The suggestion chips
were `#FF6500` on `#FFF1E5`, a contrast ratio of **2.66:1** against the 4.5:1
WCAG AA asks for body text. The visitor's own chat bubbles were white on the
brand fill, **2.64:1** — worse, because that is the visitor reading back their own
words. The send button was the same pair, and axe had not reported it only because
the button is `disabled` until there is text and axe skips disabled controls.

None of that is a tenant's mistake. `#FF7900` is the colour the widget ships with.

**The options.** Darken the shipped palette by hand. Or drop the brand colour from
anywhere it carries text, using it only as a decorative fill. Or derive the tone
from the colour at runtime.

**Decided: derive it.** A hand-picked darker orange fixes the demo and nothing
else — a tenant who picks `#00C2FF` or `#FFE600` is back to square one, and there
is no palette we can ship that is safe against colours we have never seen.
Removing the brand from text would fix it too, and would take the installer's
colour out of the interface almost entirely, which is the opposite of the
promise that the widget looks like their site.

So `legibleInk(color, backgrounds)` walks the colour's HSL lightness down in 2%
steps until it clears 4.5:1 against every background it will sit on, keeping hue
and saturation. A brand that already passes is returned **unchanged**, so a tenant
who chose a deep navy gets their exact navy; the function is a floor, not a
colour-picker. An unparseable colour is returned untouched rather than replaced,
so a typo in a tenant's config stays visible as their typo.

The result is written to `--sunny-accent-ink` in the shadow root at mount and used
for the three places the accent carries text. `--sunny-accent` still holds the
brand colour unchanged for decoration — the focus rings, the launcher.

Two consequences worth stating. The audit now checks the accent directly rather
than through a rendered chat bubble, because a bubble cannot be produced without
a model credential and the widget correctly refuses to invent one; a unit test
proves the maths, and the browser test proves the widget applied it. And the
palette the widget ships with is now measurably correct rather than assumed to be,
which is the more useful outcome of the whole exercise.

## D-13. The widget belongs to the document, not to the snippet's parent

**Status: decided and built** (2026-10-10). Recorded because the previous
behaviour was invisible in exactly the placement integrators are told to use.

The widget used to insert its host element beside its own script tag —
`script.parentNode.insertBefore(host, script.nextSibling)`. That reads as the
tidy choice: the widget appears where the integrator put the snippet. It is right
in one placement, the one our demo page happens to use, where the snippet sits at
the end of the body.

Two things break it. A snippet pasted into `<head>` — where an embed is usually
told to go — leaves a `<div>` in the document head, which the browser never
renders. And a framework is entitled to move the tag: React 19 hoists
`<script async src>` into the head itself, so a widget that "respects the
snippet's position" is placed wherever the framework decided, not wherever the
integrator wrote it.

That is not hypothetical. The React host fixture in `apps/widget-demo-react`
mounted the widget, the widget fetched its config, registered itself on
`window.sunny` and reported one instance — and was **invisible**, because the host
was in the head with a zero-sized bounding box. Every existing test passed, since
they only ever asserted the element was attached.

**Decided: append the host to `document.body`.** The widget is fixed-positioned
and painted inside a shadow root, so its place in the document affects nothing
except paint order, and the end of the body is where an overlay belongs. The
fallback is `document.documentElement`, for the case where there is no body yet.

**A second decision came out of the same fixture.** Removing the script tag does
not tear the widget down, and that is deliberate: a widget belongs to the
_document_, so a single-page app changing route underneath it leaves the assistant
where it was. The alternative — watching the whole document for the tag's removal
— is a `MutationObserver` on every customer's page, which is too high a price for
a teardown nobody asked for. But it means a route change that remounts the
snippet re-executes the bundle and mounts a second widget, so `boot()` now skips
a public id that is already present in the document. Several widgets on one page
remain supported, keyed by id; two of the _same_ widget was never what anyone
meant, and it looks like two launchers stacked on each other.

Both are pinned in the browser suite: one test asserts the host's parent is
`BODY` on the plain demo page, and five drive the widget through a React page
under `StrictMode`, a re-render, and an unmount-and-remount.

## D-14. Framework hosts are supported, and Next 16 is the floor for a Next site

**Status: decided and built** (2026-10-10). Recorded because the version of a
framework is a security decision here, not a preference.

The plan asks for plain-HTML, React and Next.js host fixtures before the widget's
embed story can be called done, on the reasoning that a widget which works in one
host shape is not evidence that it works in another. Both framework fixtures now
exist (`apps/widget-demo-react`, `apps/widget-demo-next`) and all 30 browser
checks pass.

**The version is load-bearing.** `next@15.5.27` — the version installed first,
because it was the current release — pulls in a `postcss` carrying a
high-severity advisory. `npm audit --audit-level=high` had been clean at **0
vulnerabilities** and the CI security job fails precisely on that command, so
accepting it would have meant quietly accepting that the gate only holds while
the repository has no framework in it. `next@16.4.0` is where npm reports the
fix; the audit is clean again. A future contributor who downgrades Next for a
convenience will fail the security job, and should — the reason is written down
rather than inferred from a version number.

Two smaller decisions came out of building the fixture, and both are about what
the fixture is _for_:

- **`next start` on a production build, not `next dev`.** A dev server hides
  hydration and hoisting behind different defaults, and the whole point of this
  fixture is the hoisting. Costing a build in CI is the trade being made.
- **The bundle is copied into `public/` rather than fetched from the demo
  origin.** Serving it same-origin keeps the fixture's infrastructure out of the
  test: when a Next check fails, the widget is the suspect, not the network
  between two servers. The copy script refuses to run without a built bundle, so
  the fixture cannot pass against a `dist` that no longer exists.

What this does **not** settle is where the product surfaces go. `apps/marketing`
(P3) and `apps/dashboard` (P10) are still unbuilt, and the plan still calls them
Next.js sites. What has changed is that this is no longer an assumption: the
widget's behaviour under Next, under both supported integrations and under
client-side routing, is now a tested fact rather than a hope.

## D-15. The marketing site, and why it builds with webpack rather than Turbopack

`apps/marketing` is the first product surface in this repository, and the first
thing built with the plan's Next.js rather than a fixture that embeds the
widget. Three decisions came out of it.

**The site builds with webpack, and that is a build-tool concession, not a
preference.** Every package here points `main` at TypeScript source and writes
relative imports with a `.js` extension, which is what Node's ESM resolver
requires of the emitted JavaScript. Bundlers normally infer the mapping back to
`.ts`; esbuild does, which is why the widget bundle has never needed
configuration. Next's webpack build does not, and neither does Turbopack — both
fail with `Can't resolve './tokens.js'` on the first shared package they reach.
Webpack exposes the switch for it (`resolve.extensionAlias`); Turbopack has no
equivalent. So the choice was:

1. build every shared package to `dist/` purely so the bundler can find it, or
2. run this one app on webpack and set the alias.

Option 1 would mean the page and the tests no longer consume the same artefact —
the property that makes "there is no compiled copy that can fall behind" true.
That is a real property, and it was traded for a build-tool detail only in the
direction that keeps it. If Turbopack gains an extension alias, this decision
should be revisited and the alias deleted, not preserved out of habit.

**The colour tokens are generated, not written.** `packages/character` already
describes itself as the single source of truth for colour "so the rig, the
widget and the marketing site cannot drift apart". A second copy of `#FF7900` in
`packages/ui` would have falsified that sentence the moment either changed.
So `packages/ui/src/tokens.css` is an artefact of `cssVariables()`, written by
`npm run build:tokens`, and a test asserts the file on disk is byte-identical to
the function's output. It is in `.prettierignore` for the same reason snapshots
are: its exact bytes are the assertion, so reformatting it would rewrite the
expectation instead of the code.

**The site publishes no pricing and claims no customers.** The plan forbids
inventing pricing, and there is no price list to publish, so the pricing section
says exactly that and stops. There are likewise no logos, testimonials, ratings
or install counts, because there are no customers yet. These are asserted in
`tests/e2e/marketing.spec.ts` rather than left to review: a currency symbol
appearing in the pricing section, or the words "trusted by" anywhere on the
page, fails the build. The point is not that the copy is finished — it is that
adding a claim later has to be deliberate.

Axe found two genuine contrast failures on the first run, both since fixed: the
eyebrow label at 2.66:1 (deep orange on pale orange) and the URL bar at 4.25:1
(the muted token, which is calibrated against the warm-white page background and
was being used on a tinted bar). The second is the more interesting one — a
token is only valid on the surface it was measured against, and the fix was to
override it locally rather than to trust the name.

## D-16. Visual baselines are aimed at the character, not at a page

Plan §12 lists visual snapshots among the required checks, and this repository
has never had one: `docs/RELEASE_CHECKLIST.md` has carried "Vitest snapshots
only, **not** pixel-diffed" since it was written. Those are two different things
and the gap was real — a `toMatchSnapshot()` of a rig proves the object is the
one the test itself produced, not that it draws the same picture it drew
yesterday.

**The baseline is the character, rasterised, not a screenshot of a page.** A
screenshot of a web page is a different image on every operating system: font
hinting, subpixel antialiasing and the installed font set all differ, so a
baseline generated on this Windows machine fails on Linux CI for reasons
unrelated to the change under review. Tests like that get deleted, and a deleted
test protects nothing. Sunny has no text and no fonts — paths and circles,
rasterised by `resvg` with its own rasteriser — and the engine is deterministic
on purpose, with time passed in and the blink cadence seeded. The same input is
the same bytes on every machine, which is what makes a committed PNG a fair
expectation rather than a hostage to the CI box.

**Byte equality, not a pixel-difference budget.** A tolerance would add a second
way for a real regression to pass, and it would be unearned here: when the
pipeline is deterministic, "differs by one pixel" and "differs" are the same
event. On a mismatch the actual image is written to `.data-visual/actual/` so
the failure can be looked at rather than guessed at.

**Thirteen scenes, and the generator is a separate command.** One scene per
visually distinct state, at a fixed frame, plus the two extremes of the
intensity setting and the reduced-motion fallback — because "reduced motion
looks the same as no animation" is an assumption worth checking rather than
asserting. `scripts/update-visual-baselines.ts` is the only thing that writes a
baseline and the test only compares, so a green run means the images are what
they were instead of the renderer agreeing with itself.

**Writing the harness found a real mistake in the harness, and the guard that
caught it was worth its cost.** The first version of `rigFor` built an animator
and called `frame(captureTime)` on it directly. A sequence's instance is
anchored to the _first frame that observes it_, so a single call at `1400` is
elapsed time zero — the start of the sequence. Six of the thirteen baselines
were therefore the wrong frame, and `idle-rest` and `idle-breathing` came out
byte-identical, because "breathing" was the rest pose twice. The product has
never had this bug: the widget drives the animator from a
`requestAnimationFrame` loop, where a frame always follows a frame. The harness
now walks the same 30 FPS cadence, dispatching events as they come due, which is
the only way the captured frames are the frames the product draws.

The initial guard — "every scene renders to a distinct image" — then failed on
`celebrating-off` and `celebrating-reduced-motion`, and that one is correct
behaviour, not a defect: an intensity of `off` resolves no sequence at all, so
the character rests, while reduced motion resolves `celebrate-still`, whose pose
is the resting pose. Two routes, one image. The guard was rewritten to state
that pair explicitly and require every other pair to differ, which keeps the
degenerate-pass protection (a rasteriser emitting one blank image for everything)
without pretending the scenes form a bijection. A second test asserts the
resting and celebrating scenes differ, because a general distinctness check
would have gone on passing while half the suite collapsed.

The cross-platform claim was tested rather than trusted. CI runs on
`ubuntu-latest` and the baselines were generated on Windows, so "the same bytes
everywhere" is exactly the kind of assertion that is only discovered to be false
by a red build someone then deletes. The committed tree was extracted into a
`node:22-bookworm` container, installed with `npm ci` and run there:

    git archive HEAD | docker run --rm -i -w /work node:22-bookworm \
      bash -c 'mkdir -p /work && tar -x -C /work && npm ci && npx vitest run tests/visual'

All fifteen tests pass, so the thirteen PNGs `resvg` produces on Linux are
byte-identical to the ones Windows produced — different platform binaries, same
pixels. That result is worth having on the record because it is the whole
premise of the increment; if it had failed, the baseline would have had to move
into the container rather than into the repository.
