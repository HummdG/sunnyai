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

## D-17. The eureka gets a caller, a band, and its own still

The animation catalogue (D-16's sibling commit) found three moments the engine
implements and nothing requests. This fixes the eureka, because it is the one
where both the defect and the right answer are unambiguous.

**Nothing asked for it.** The machine goes `thinking` -> `speaking` on
`speaking_started`, and that event requested no group at all. Every other
conversational beat is requested where it happens: `guiding_started` asks for
`guide`, `attention` asks for `open`. The first token arriving is the answer
arriving, which is precisely the moment `thinking-eureka` describes, so
`speaking_started` now asks for it — but only when it follows `thinking`. A host
that streams a greeting, or a turn resumed from history, goes straight to
`speaking` with no idea to land, and a spark there would be the character lying
about its own state. That conditional is the whole reason the event is the right
call site rather than the state.

**It could not have been seen even if something had asked.** At `PRIORITY.success`
(400) it lost every frame of its own `thinking` and `speaking` states to the
ambient layers — `thinking-whirr` and `speaking-pulse`, both at `PRIORITY.chat`
(600). A sequence can be requestable, eligible, correctly written and never once
drawn; the only way to notice is to ask the scheduler what it would draw, which
is what the catalogue's playable test now does. It moves to `chat + 20`: inside
the chat band, where the plan's ordering puts it, but above the ambient layer it
has to interrupt. Its still moves with it, because a floor is about how much
motion a tenant allows, not which moment they asked for.

**And it no longer claims `celebrating`.** With the higher band it had to be
taken out of that state: a eureka still in flight would outrank the celebration
that arrived while it played, so a real success — the thing the celebration tests
exist to protect — would be buried entirely rather than deferred. The existing
test caught this immediately, which is the case for having written the ordering
down as an assertion rather than as a sentence in this file. An idea landing and
a job well done are different beats and Sunny should not confuse them.

`thinking-eureka` also carried `reducedMotionFallback: 'celebrate-still'` —
a copy-paste, since `eureka-still` exists for exactly this and was sitting
unused. A visitor who had asked for less motion was getting a different moment
from the one they asked for.

Two moments remain unreachable and are now asserted as such rather than
forgotten: `charge` (A12, one of the plan's five flagship sequences) has no
trigger because no stream event or tool has been tied to the solar-education
moment, and `listen`'s perk is never asked for because `attention` requests
`open` and the listening state's ambient layer is the idle group. Both need a
decision about _when_ they should fire, which is a product question rather than
a mechanical one.

## D-18. The catalogue gets a surface, and the surface found three things

P11's exit gate is "the animation catalogue and playable tests pass". The
catalogue half was D-17. This is the playable half: the character lab grows a
gallery built directly from `CATALOGUE`, and a Playwright spec drives it, so
"every moment can be played" is a thing that was clicked rather than a sentence
in a document.

Building it from `CATALOGUE` rather than from a hand-written list is the same
bijection argument as D-16's: a moment cannot exist in the gallery and be absent
from the engine, because the gallery is the engine's own export rendered. The
name and description on the card are asserted against the catalogue's, so a
moment cannot be renamed in one place and not the other.

**Seven of the thirteen moments cannot be reached from the resting state.** The
perk, the thinking spin, the eureka, the speaking pulse, the point, the tilt and
the error each declare a state only an event can enter, so a gallery that simply
called `play()` in place would leave the most interesting cards doing nothing
when clicked -- which reads as a broken engine rather than as a moment that
needs a reason. Each card therefore carries the route an application would
actually take (idle → `turn_started` → play), and the gallery is a demonstration
rather than a bypass. `idle` leads every route so that one click cannot strand
the next: without it, which cards worked would depend on the order they were
clicked in.

Three things fell out of making the test honest.

**A moment that loses its whole life is dropped, not deferred.** A requested
sequence expires on a clock that starts at the request, not at the first frame
that draws it. `celebrate` asked for while a 2.6 s `charging-panel` is playing is
outranked on every frame of its own 1.4 s and then expires without ever being
drawn. This is the priority system working -- the alternative is a celebration
landing a second late, detached from the thing it is celebrating -- but it
happens silently, and it is the second time this increment has found a moment
whose only defect was that nobody could see it. `Scheduler.clear()` and
`SunnyAnimator.reset()` are the answer for a caller that needs an isolated
encounter: the lab's gallery clears the stage on every click, because each click
is a separate question and the previous demonstration must not be the answer.
The browse order is asserted in the sequence tests, with the drop as the
documented behaviour rather than an accident.

**`canInterrupt` is declared by every sequence and read by nothing.** The plan
requires each sequence to declare it and the requirements matrix claims it is
real, and it is -- the field exists, is typed, and is set on all twenty-four
sequences. No code branches on it. Every sequence says `true`, so implementing
it today would change nothing, which is exactly why it went unnoticed; the note
is here so the next person adding a sequence that must _not_ be interrupted does
not assume the field already does that.

**The lab's own preview clock could starve a moment.** The clock was scoped to
the selected moment's duration and restarted there, so a moment longer than the
one being previewed could be rewound mid-flight: the 420 ms bubble that the
perk waits behind never reached 420 ms, and the perk was never drawn. It now
restarts only when nothing is playing. A moment that looks broken only from
inside the lab is not a moment that is broken, and finding that required the
browser test rather than the engine test.

The spec asserts on a `data-drawn` mark the page sets for whatever it renders
since the click, not on the live highlight, because the mark cannot be missed:
the listening perk is on screen for under a third of a second, and a polling
assertion that sampled the class at the wrong moment would report a moment that
plays perfectly well as broken.

## D-19. A07, the play moves, and the state that changed nothing

The animation catalogue's own gallery made the gap obvious the moment the
moment could be clicked: `play_started` moved the machine into `playing` and
**changed no pixel**. The playing state borrowed the resting layer, so a game
could start and Sunny would carry on breathing as if nothing had been said. That
was not a missing animation -- the engine had none for the state -- it was a
state with no behaviour, which is the kind of defect a scheduler test cannot see
because the frame it produces is a perfectly valid resting pose.

Three moves close it, one per intensity, and they are the plan's A07:

| Move           | Intensity  | What it is                                     |
| -------------- | ---------- | ---------------------------------------------- |
| `play-shuffle` | `minimal`  | Two small side-steps, gaze and head leaning in |
| `play-run`     | `balanced` | A run on the spot: lean, wind in the rays, bob |
| `play-dance`   | `playful`  | A rock with the head lagging, rays rippling    |

**They are finite bursts, not loops, and the state's ambient stays the resting
layer.** A game lasts minutes; a character that hops for the whole of it is
exhausting and competes with the board the visitor is trying to read. So the
move is a burst at the start of the session, and `idle-breathe` carries the wait
between moves -- which is also why `AMBIENT_GROUP.playing` still points at the
idle group rather than at the play group. Every pose is enveloped by `bump(t)`
so a move leaves and returns to the resting pose: one that started mid-hop would
snap into it on its first frame, and one that ended mid-hop would leave the
character in the air.

**"No animation collisions" holds structurally.** The three moves are variants
of a single group, and the scheduler refuses a second instance of a group that
is already running, so a shuffle cannot be drawn over a dance. A07's acceptance
criterion is met by the data model rather than by making the sequences shorter
than each other, and the test asserts the refusal rather than the durations.

**A07's "stops immediately on user interaction" holds by a different mechanism
than the one the plan names.** The plan's §5.2 contract has `canInterrupt` doing
that work, and, as D-18 records, nothing reads `canInterrupt`. What actually
happens is that the moves declare `states: ['playing']`, so an event that moves
the machine anywhere else retires them on the next frame. The behaviour is right
and the field is still inert; the two are worth telling apart, because the next
sequence that has to survive a state change cannot rely on the field either.

**Blinking is enabled in `playing`.** The moves outrank a blink, so during the
one-second burst there is no blink -- the move is the behaviour. But a game
lasting minutes would otherwise be spent by a character that never blinks, which
reads as switched off rather than as attentive, so `blink` declares `playing`
and the animator's blinkable list includes it.

**The intensity dial means more here than anywhere else.** For every other
group, lowering the intensity gives a quieter version of the same moment; for
this one it selects a different move. That is why the play group gets its own
scene at `playful` in the visual baselines while no other group does, and why
there is no `playing-off` scene: `off` and reduced motion both resolve to
`play-still`, which is the resting pose, and a baseline for that already exists.

**The `playing` scene's capture time moved from 950 ms to 550 ms.** The scene
exists to catch a state mid-behaviour, and 950 ms is past the midpoint of a
1.1 s burst: the run had already tapered back towards rest, so the new baseline
would have shown a standing character with slightly lowered brows. The scene's
content changed with this commit regardless, so the capture time was re-chosen
by looking at the frames -- which is how `scenes.ts` says the times were chosen
in the first place.

## D-20. A04 wants a prop that is furniture, and a state that was borrowed

`dismissed` moved the machine into `relaxing` and, like `playing` before D-19,
the state borrowed the idle layer -- so closing the chat changed the panel and
nothing else. A04 is the plan's fourth moment: "chair unfolds, shades, relax",
"stops immediately on user interaction".

**The prop needed a third way of being drawn.** Props had two: an ink stroke,
which is right for a _mark_ (a question mark, the temple of a pair of glasses),
and a solid ink mass, which is right for a small _sign_ (a sparkle). Neither can
draw an **object**, because the character's own language is a black outline
around a flat fill: a chair drawn as a silhouette reads as a hole cut in the
scene, and a chair drawn in hairlines disappears at launcher size -- and the
launcher is exactly where this moment is seen, since the panel has just closed.
So `PROP_PATHS` gained `surface: true`, which draws an ink outline around the
theme's `highlight` colour. It is a third _painting_, not a third prop: it reads
the existing theme, so a tenant on the purple preset gets a lilac chair, and the
test asserts that rather than restating the hex.

**The deckchair is the only prop authored in the body frame.** Every other prop
is authored in a small frame about the origin so that `scale` is a plain
multiplier. Furniture cannot be: a body with a 47-unit radius has to sit _in_
the chair, so the chair has to be drawn against the body's own coordinates. That
is what produced the one geometric constraint worth recording: a straight back
that leans up-left and is anchored under the body **must** cross the silhouette,
because a circle bulges further at shoulder height than any chord of it can.
Only a vertical back or a tangent one clears her. The back panel is therefore
the tangent -- centre-line distance ~50 against a radius of 47.26, about 2.7
units of clearance -- and that tangent happens to fall out as a ~30 degree
recline, which is a deckchair's angle rather than a compromise. The geometry
chose the pose.

**The chair is planted; she is not.** A prop's transform is applied inside the
body's frame, so a prop inherits the body's motion -- including the breath. The
chair is given back the exact inverse of the transform her body was given in
order to sit down: the root rotation is negated and the root translation is
rotated by it before being negated, about the same origin the artwork is
authored against. Her breath is cancelled with it rather than left on the chair,
because a chair standing on the ground does not rise and fall while the person in
it breathes -- so the chair's origin does not move at all across the whole hold,
which a test asserts to six decimal places. That is a stronger claim than any
single snapshot could make, and it is the one that fails if someone later
simplifies the three lines into two negations.

**The break is a finite event, not a loop, and not the ambient layer.** A loop
would replay the unfold every cycle, and a loop that began already deployed
would pop the chair into existence on frame one; the state's ambient cannot hold
the pose instead, because the scheduler never retires the floor instance and the
ambient is required to loop. So the chair arrives by unfolding and leaves by
folding: the moment is one arc whose last tenth narrates her getting up, and the
idle layer is what shows underneath for the rest of the state. That is the same
shape as A07's play moves, and it is why A04's "stops immediately on user
interaction" is structural rather than tuned -- any event that moves the machine
out of `relaxing` retires the instance on the next frame.

**A held blink is not a closed eye.** The first render of the seated pose put a
black slab across her face. `renderEye` computes `scaleY = scaleY * (1 - closed *
0.94)` and then fills the eye path with ink, so `closed = 0.92` -- a perfectly
good reflex blink -- flattens the eye into a solid bar, which at 512 px is the
width of a moustache. A held pose needs a squint (0.62), not a blink, and the
shades at the stronger settings are lenses _filled_ with ink anyway, so the
squint is what carries the `minimal` setting. The block comment in `sequences.ts`
says so, so the next person does not re-derive it.

**Three new baselines, and the existing thirteen did not move.** `relaxing`,
`relaxing-playful` and `relaxing-reduced-motion` were added to the PNG suite;
that no existing baseline changed is the evidence that the artwork change is
additive rather than a global re-render. `relaxing-reduced-motion` is byte
identical to `celebrating-off` and `celebrating-reduced-motion` -- all three show
the resting pose -- so the suite's coincidence guard now names three scenes that
are _supposed_ to coincide, which is the guard doing its job: any other pair
coinciding still fails, and the pair that used to coincide for the wrong reason
(`relaxing` and the resting pose) was the bug this moment fixed.

**Two smaller things the work turned up.**

- The `relaxing` exemption in the sequences test's state-coverage check is gone.
  It was written when no sequence declared the state; an exemption that outlives
  the gap it was written for is how a state goes silently empty a second time,
  so the check is now unconditional.
- Reduced motion is a per-frame fact, not a construction-time option:
  `Scheduler.update` assigns `#reducedMotion = ctx.reducedMotion || ctx.lowPower`
  on every frame, so a test that passes the preference to the animator's
  constructor gets the unmodified sequence. The relax tests pass it with the
  frame, which is what the widget does, since it re-reads the media query as the
  visitor's preference can change while the page is open.

## D-21. A05 is the first moment a visitor starts, so the engine gains an input

Every moment before this one began in the machine: a stream event, or the blink
timer. A05 is the plan's first line that names the visitor -- "Balloon floats,
gaze follows, optional tap/pop", with "Pointer/touch" in its checks column -- so
the work is not only a balloon. It is the first place where a position from
outside the engine becomes a position inside it.

**A tap is a coordinate, and the engine is the only thing that knows what is at
one.** `SunnyAnimator.tap(point, now)` takes the point in viewBox coordinates and
hit-tests it against the frame that was actually drawn -- `#last.rig` -- rather
than against the rest pose. That distinction has teeth here because the balloon
travels: a tap where the balloon was when it was released, half a second later,
has to miss. The conversion both ways lives in `rig.ts` as `toBodyFrame` and
`toViewBox`, the forward and inverse of `renderSunny`'s root transform, and a
test in `packages/character` reads that transform out of the emitted SVG and
checks the helpers against it -- because two self-consistent copies of the same
arithmetic would both pass a round-trip and still be wrong about the picture.

**Two groups, not one.** The float is `balloon` at `PRIORITY.play` and the burst
is `pop` at `PRIORITY.interaction`. They could have been one group with a
strength ladder, and that would have been wrong twice over: `bestInGroup` picks
the strongest _eligible_ variant of a group, so a single group could not hold
"floating" and "bursting" as alternatives, and the same-group guard in `request`
is what stops a second moment of a group from being drawn over the first -- which
is exactly the protection wanted when a visitor taps a second time.

**The burst is anchored, and the anchor outlives the gesture.** It is the only
moment drawn somewhere the moment did not choose. So the scheduler's instance
carries an optional `MomentAnchor`, set by `request` from a fourth argument and
read at render time, rather than the position being passed to `pose` each frame:
the burst is still being drawn a fifth of a second after the finger left, and by
then there is no gesture left to ask. `pose(base, t, anchor?)` takes it through.
Played cold -- from the gallery's `Play`, with no input at all -- the burst
centres on the balloon's own resting place, which is the one position that is not
an invention, and a test asserts the two produce the same shards.

**`cancel` matched nothing, and the test is what found it.** `tap` on the balloon
cancels the float before requesting the burst, so the balloon does not drift away
beside its own shards. It called `cancel('balloon')` -- a group name -- but
`cancel` matched sequence _ids_, and the instance a group request installs is
whichever variant the intensity picked (`balloon-sway` at `balanced`), which
under reduced motion renders a third sequence again (`balloon-still`). So the
cancel was a silent no-op in every case. Nothing failed visibly, because the
burst outranks the float for its own duration; the float only reappeared when the
burst settled. `cancel` now names things the way `request` does -- group or id --
and the reduced-motion test is the one that catches it, because there the burst
resolves to nothing and a surviving float is the whole difference.

**A04's third painting was reused, not extended.** The balloon is drawn with
`surface: true`, the ink-outline-around-`highlight` treatment A04 added for the
deckchair. A balloon is the clearer case for it -- an object with an inside,
where a hollow outline is a ring -- so no new prop painting was needed, and the
surface test now covers both. The artwork also needed no string: the balloon is a
rounder envelope and a knot, and the float itself is what says it is held.

**Reduced motion gets a balloon that does not move, not the absence of one.**
Unlike the deckchair, there is an honest still of "a balloon at rest", so the
float falls back to `balloon-still`: same balloon, no travel, no lean, no gaze.
The burst declares no fallback at all, because there is no honest still of
something bursting -- the pop under reduced motion _is_ the balloon's
disappearance, and the test says so by asserting a still balloon and then
asserting its absence. At an intensity of `off` the same held balloon is the
whole moment, which is the one place a moment survives `off` with a prop still on
screen; the group-off motionlessness invariant is satisfied because the pose is
genuinely motionless, and a tap takes it away into the base pose.

**The catalogue gained a third answer to "who asks".** The two new moments are
asked for by neither the engine nor nobody: something outside the engine asks,
and that something is a gesture the host has to forward. `AskState` gained
`gesture`, and the lab marks those cards `unwired` for the same reason it marks
the engine-less ones -- the widget does not forward a pointer yet -- while the
`UNREACHABLE_GROUPS` list keeps its narrower meaning and its test. That the two
lists are no longer the same list is the point of having both.

**Three new baselines, and the reduced-motion one is the interesting one.**
`balloon-float`, `balloon-pop` and `balloon-reduced-motion` join the PNG suite;
the existing seventeen did not move. The last of the three is a third image in
which reduced motion does _not_ resolve to the resting pose -- the other two
being a deckchair and a celebration -- so the suite's coincidence guard still
names exactly three scenes, and the new one is evidence for the decision above
rather than a repetition of an existing scene.

**The lab has the gesture, and says what it is for.** The stage takes `pointerup`
and converts through the SVG's own screen matrix, so a mouse, a finger and a pen
all arrive the same way and the conversion survives a zoom or a resize; a hint
under the character says "Tap her to give her a balloon, then tap the balloon to
pop it", which is the documentation of a channel nothing in production forwards
yet. An end-to-end test taps the body centre and then taps the balloon where it
is _painted_ -- read page-side in one call, because the lab replaces the stage
markup every frame and an element handle is detached before it can be measured.

## D-22. A06 is a game, so the rules get a package of their own

The plan's gate for A06 is "legal turns, win/draw/replay tests". None of those
four words is about animation, and the first thing that fell out of taking that
seriously is that the rules have no business living in the animation engine.

**A new package, `@sunny/games`.** `packages/games/src/tic-tac-toe.ts` imports
nothing: a position goes in, a position comes out, and the whole thing is
immutable so the move log cannot be edited underneath the game it describes.
That is what makes the gate testable in the way the gate is written -- eight
lines checked by looping over the same `LINES` the board draws its strike-through
from, a draw, an illegal move that throws, and `replay()` rebuilding a position
from its history. The plan calls A08's arcade game "lazy-loaded", and a package
boundary is the thing that makes lazy-loading honest later rather than a
reorganisation nobody wants to do then.

**The board is a surface, not a pose.** The tempting version of this increment
draws a 3x3 grid as nine props on the character -- the prop system already
draws sparkles and balloons, so it would have worked. It would also have been a
lie about what props are: a prop is a mark, a sign or an object _the character
holds or wears_, and bending the vocabulary to mean "a board game floating in
the same viewBox" would make `assets` stop describing what a sequence draws. So
the board is page markup in the lab and the character contributes her
_reactions_, which the catalogue already had: `play_started` when the game
begins (the plan's own description of that moment is "a game the visitor asked
for"), the thinking spin on her turn, `impress` if she wins and `celebrate` if
the visitor does. A draw gets no moment, because nothing in the vocabulary means
"evenly matched" and borrowing `confused` would say she got something wrong.

**A game therefore has no state of its own in the machine.** The machine's states
are conversational, and the board drives it exactly as a stream event would --
which is why the mapping above is four `dispatch` calls rather than a `playing`
mode with a lifetime. The one that already existed, `play_started` -> `playing`,
is used for what it says: the opening move of a game.

**Sunny is a heuristic, not a solver, and that is a product decision.** Tic-tac-
toe is a solved draw, so an opponent that plays perfectly cannot be beaten, and a
game you cannot win is a wall rather than a game. She takes a win, blocks the
visitor's, prefers the centre, then a corner; the tie-break is the only place
chance enters and it is injected, so a caller with a seeded generator gets a
reproducible game. The tests pin both halves of that claim -- she blocks a single
threat, and she loses to a two-move fork, which is the one thing the visitor has
to _see_ to win. A first draft of the fork test used two of her marks that
shared a line, which quietly gave her an immediate win and made the test pass for
the wrong reason; the comment on it now says so.

**The board runs on the stage's clock.** The lab can be paused and scrubbed, and
the stage is driven at `state.t`, so a board on `performance.now()` would go on
playing while everything the visitor can see stood still. Sunny's turn is
therefore a _deadline_ in stage milliseconds rather than a `setTimeout`, and a
rewind of the clock re-arms it: a visitor who scrubbed back far enough would
otherwise leave her thinking for ever.

**Two new browser tests, and the replay one is the claim worth having.** One
plays a mark, checks the square cannot be played twice, watches the stage label
say the thinking sequence is the one being drawn -- a claim about the character
rather than about a class the board put on a paragraph -- and waits for her
answer. The other plays to the end and then runs the history the page _published_
back through the same rules and compares the result with the marks on screen, so
"the log can replay the game" is checked rather than asserted in prose.

## D-23. A08's arcade is "lazy-loaded", and that is a claim about bytes

The plan's row for A08 is "Space Invaders | Lazy-loaded arcade game | Real
collision, score, restart". The three words of the acceptance column are the same
shape as A06's and get the same answer -- the rules are a module in
`@sunny/games`, tested without a browser -- but the _fourth_ word of the
description is the one with a decision inside it, because "lazy-loaded" is the
kind of claim a build can quietly stop supporting while every test stays green.

**Two entry points, and the arcade is a file of its own.** `build.mjs` now emits
`lab.js` and `arcade.js`; the lab injects a `<script src="/arcade.js">` when the
visitor presses the button and not before. The tidier-looking alternative is a
dynamic `import()` -- except esbuild cannot use `splitting` with
`format: 'iife'`, and the lab is served as a classic script, so a shared chunk
would be _lazily parsed_ rather than _not fetched_, which is a weaker claim than
the one the plan makes. A second IIFE entry costs a `declare global` and a
hand-written loader, and buys a test that watches the network and can actually
fail.

**The arcade chunk does not carry the engine.** It imports `@sunny/games` and
nothing else, and talks to the character through a two-method `Reactions`
interface (`dispatch(type)`) that the lab implements with
`animator.dispatch(...)`. Importing `SunnyAnimator` here would have worked and
would have shipped a second copy of the engine inside a bundle whose only
interesting property is its size. `el()` is copied from the lab for the same
reason: an import from `lab.ts` would pull the catalogue, the grid and the engine
into the lazily-loaded file.

**`mount` returns nothing.** A game with a `requestAnimationFrame` loop is a leak
that outlives whatever it was mounted into, so the first draft handed back
`{ stop() }`. Nothing ever called it -- the lab builds the panel once and never
replaces it -- and an unused stop button is an API describing a life cycle this
page does not have. It was removed rather than kept "for later"; the comment says
where it would go.

**The clock belongs to the game, which is the opposite of A06's choice.** A board
has no notion of time, so A06's runs on the stage's `state.t` and is paused and
scrubbed with everything else on the page. An arcade game _is_ its tick -- it is
what makes a shot move one cell and the fleet descend -- so running it on a clock
a debug slider can rewind would make the game's only rule a function of the
debugger. It has its own `requestAnimationFrame` loop at a fixed 110 ms tick, and
the catch-up is capped at six ticks so a backgrounded tab is found where it was
left rather than already lost.

**The playfield is a grid of integers, and the collision test is a lookup.** A
pixel game needs overlap tests, sub-stepping to stop a bullet tunnelling through
a thin invader, and a rule for the exact boundary; each is a place where "it
looked like a hit" and "it was a hit" disagree. Cells make a hit a lookup --
`invaderAt(fleet, x, y)` is the only collision test in the file and every shot
goes through it -- and the answer is identical on every machine. The renderer
decides how big a cell is; it does not decide whether something was hit.

**One namespace per game, because two games export the same three names.** Both
tic-tac-toe and invaders want to export `newGame`, `Game` and `Status`, and none
of those names is wrong. Flat re-exports would have meant one shadowing the
other, so `index.ts` re-exports `ticTacToe` and `invaders` as namespaces:
`ticTacToe.replay(...)` says which game it is replaying, and A09's ping pong will
add a third without reopening this. Four call sites changed.

**Four test bugs, all in the tests.** The walls test moved the ship with a helper
that only steps a counter; the "two kills" test aimed at a column the fleet had
already left; the fleet-clearing test put its last invader on the top row, where
the fleet's cadence never brings the shot, and never called `fire`; and the
determinism test asserted a step count for a game that a bomb ended early, which
a throwaway trace showed was reachable because the counter generator wraps to
`0` every seventh call. No rule changed: every failure was the test being clearer
about the game than the game is.

**The two browser tests found two real defects, only one of which was the game's
fault to fix.** The first is that the readouts are published as `data-*` on the
element `mount` was handed -- the slot inside `#arcade` -- while the test read
them off `#arcade`, so "the score never moved" was a fact about the selector. The
second is more interesting: aiming through Playwright locators failed every time,
because a locator click is a round trip and the fleet keeps stepping during it,
so the shot was aimed where the fleet _had_ been. Aiming and firing in one
page-side turn is what a player does and hits on the first attempt in every run;
the fix is in the test, and the comment says why the same-looking code is not the
same test.

**What is checked where.** The rules -- collision, score, wave, restart,
determinism -- are 30 unit tests in `packages/games`; the two browser tests prove
the two things only a browser can: that `/arcade.js` is not fetched until the
button is pressed, and that the cabinet the visitor gets is that game, driven
from the keyboard with the score answering a hit. The lab is a developer surface
and the axe suite covers the widget rather than the lab, which is the status A06
left it in; the arcade's keyboard path is at least asserted by a test rather than
described in prose.
