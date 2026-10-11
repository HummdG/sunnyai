# Marketing performance baseline

**As of 2026-10-11.** Every number here came from a command that ran; the command
is given with each row.

The plan's P3 exit gate is "visual regression, Lighthouse/accessibility baseline,
working demo", and §12 asks for "marketing Core Web Vitals in good range" with
thresholds established "after first measured staging build". There is no staging
deployment (nothing is deployed anywhere — D-9), so this is the local production
build measured by Lighthouse, and it is labelled as such rather than presented as
a staging figure.

## What was measured

`npm run perf:marketing` against a local production build:

```
npm run build:widget
NEXT_PUBLIC_SUNNY_API_URL=http://localhost:8787 npm run build -w @sunny/marketing
PORT=8787 npx tsx apps/api/src/main.ts            # so the widget finds an API
npm run start -w @sunny/marketing                 # port 4176
npm run perf:marketing -- --write
```

Lighthouse 13.5.0, mobile preset (its own throttling and a 4× CPU slowdown),
driving the Chromium that Playwright already keeps on the machine. Node
v24.12.0 on Windows 11.

## The numbers, and how much they move

Five runs of the same build, `npm run perf:marketing`, mobile:

| Run | Score | LCP (ms) | CLS | TBT (ms) | FCP (ms) | SI (ms) | TTFB (ms) |
| --- | ----- | -------- | --- | -------- | -------- | ------- | --------- |
| 1   | 0.92  | 2188     | 0   | 299      | 768      | 824     | 15        |
| 2   | 0.96  | 2095     | 0   | 205      | 757      | 842     | 4         |
| 3   | 0.97  | 1857     | 0   | 162      | 764      | 1040    | 6         |
| 4   | 0.89  | 2249     | 0   | 386      | 755      | 809     | 3         |
| 5   | 0.94  | 2140     | 0   | 259      | 755      | 777     | 4         |

The committed baseline JSON is run 5, the last one written:
`docs/performance/marketing-baseline.json`.

**The spread is itself a finding, and it is the reason the budget is what it is.**
TBT ranged 162–386 ms across five runs of an unchanged build, a factor of 2.4, and
the score ranged 0.89–0.97. A threshold set from one run — the thing this project
would have done if it had trusted a single measurement — would have been a
threshold on run-to-run variance rather than on the site. So the budget ceilings
are roughly 1.5× the _worst_ observed value, and the score is kept as a coarse
signal rather than as the gate.

## Against the targets, honestly

| Metric                   | Worst observed | Budget (fails above) | Lighthouse "good" | Verdict                    |
| ------------------------ | -------------- | -------------------- | ----------------- | -------------------------- |
| Largest Contentful Paint | 2249 ms        | 3400 ms              | ≤ 2500 ms         | **Meets the goal**         |
| Cumulative Layout Shift  | 0              | 0.1                  | ≤ 0.1             | **Meets the goal**         |
| Total Blocking Time      | 386 ms         | 600 ms               | ≤ 200 ms          | **Short of the goal**      |
| First Contentful Paint   | 768 ms         | 1200 ms              | ≤ 1800 ms         | **Meets the goal**         |
| Speed Index              | 1040 ms        | 1600 ms              | ≤ 3400 ms         | **Meets the goal**         |
| Time to First Byte       | 15 ms          | 100 ms               | ≤ 800 ms          | **Meets the goal** (local) |
| Performance score        | 0.89           | 0.85                 | ≥ 0.90            | **At the goal**            |

Five of the six Core Web Vitals metrics a lab run can measure already meet the
Lighthouse "good" boundary, layout shift is exactly zero, and the largest paint
lands 250–650 ms inside the good range. **Total blocking time is the one that does
not**, and it is the metric a mid-range phone would feel as input lag. D-45
attributed it to "React hydration and the character's render loop". The hydration
half was right and the loop half was wrong: both were measured the same day and
only one of them is a cause. The section below records what the traces say, and
what happened when the two obvious fixes were tried.

## Where the blocking actually is

The same page, traced with Lighthouse's throttling, with the API up so the widget
is running in its intended configuration. Seven traces of this build were taken;
three are shown.

| Sample | TBT    | Largest task                                         | Hydration of the document | The embed |
| ------ | ------ | ---------------------------------------------------- | ------------------------- | --------- |
| 1      | 266 ms | 299 ms — `chunks/968-48fc94ed9c0a5195.js` at 2636 ms | 97 + 74 ms                | 78 ms     |
| 2      | 262 ms | 295 ms — the same chunk at 2615 ms                   | 82 + 71 ms                | 70 ms     |
| 3      | 222 ms | 272 ms — the same chunk at 2629 ms                   | 156 ms                    | —         |

In every one of the seven the largest single task is the same 66 kB Next.js chunk
— React and the app router's own internals — between 215 and 299 ms, which is
165–249 ms of blocking time. In most samples that one task is very nearly the
whole of the measured TBT. Nothing else the page loads produces a task over
160 ms: hydration of the document accounts for 71–156 ms and the embed for 0–86 ms.

So the metric is short of the good-range boundary because of framework code the
page's own authors do not write, running under a 4× CPU slowdown. That is the
finding, and it is the reason the two candidate fixes below did not ship.

### Two fixes were tried, measured, and not shipped

**Stopping the character's loop.** The rAF loop in `sunny-hero.tsx` was disabled
entirely — not slowed, not paused off-screen, but never started — and the build
was verified to have stopped animating before being measured (the hero's markup
was byte-identical two and a half seconds apart, where the real build's differs).
Six runs: **143, 175, 194, 216, 236, 324 ms** (median 205). Six runs of the same
build with the loop running: **171, 174, 175, 267, 408, 435 ms** (median 221). A
second six of that same build, taken minutes later: **195, 260, 271, 371, 384,
408 ms** (median 321). Two samples of _one_ artefact, 100 ms apart in median, means
a change of the loop's size cannot be read out of six runs at all. The loop was
left running, and D-45's attribution to it is withdrawn.

**Deferring the embed.** The demo widget — the same script a customer pastes, but
loaded with `next/script`'s `lazyOnload` instead of as a plain tag — was built and
measured: **171, 174, 175, 267, 408, 435 ms** and **195, 260, 271, 371, 384, 408 ms**
against the authored build's **158, 173, 194, 197, 292, 294, 349 ms**. Unresolved,
for the same reason. Time until the launcher is usable, under the same 4×
slowdown: median **285 ms** as authored, **312 ms** deferred — little to choose
between them, though the deferred build's worst run was 2165 ms against 799 ms
authored, and on a slow connection `lazyOnload` waits for the load event, which is
precisely when the launcher — the thing this page is selling — should already be
there. It was reverted, and the page is byte-for-byte the artefact these numbers
describe.

One thing the experiment did turn up: React 19 does not put that `<script>` in the
server's HTML. It inserts it during hydration, which is why "eager" and "deferred"
measured so alike — the embed was never on the parse path to begin with.

## The same build read 300 ms slower hours later

The five runs above were taken at one point on 2026-10-11; the traces above at
another, hours later, on the same machine and the same artefact — the chunk
filename is unchanged, which is the artefact-level proof. First Contentful Paint
read **755–768 ms** then and **1056–1058 ms** now; Largest Contentful Paint read
1857–2249 ms then and 1954–2451 ms now.

Nothing changed but the time of day. This is D-45's "one machine" caveat with a
number attached: it is not one number, it is one machine on one afternoon. It is
also the reason the budget is set from the worst of a batch rather than from a
figure somebody liked.

## What these numbers cannot say

- **They are lab numbers, not field data.** No real user has loaded this page, so
  there is no p75 to compare against the Core Web Vitals thresholds, and these
  figures cannot be quoted as if there were.
- **They are one machine.** Lighthouse throttles the CPU and network to a fixed
  profile, which is what makes the figures comparable between runs, but the host
  CPU is still a desktop one and a real mid-range phone is not modelled.
- **Time to First Byte measures a local `next start`**, where 3–15 ms is a file
  read. A Cloud Run cold start is a different number and this script will not see
  it until a deployment exists to measure.
- **Nothing enforces this in CI.** CI does exist now (the repository got a remote
  on 2026-10-11, D-9) and runs four jobs — but none of them is Lighthouse, so this
  budget is still a developer's command run by hand, enforced only when somebody
  runs it.

## What would move this

The honest next steps, in the order the numbers argue for them:

1. **Bring TBT under 200 ms — not from this page's own code.** The evidence is
   above: the blocking is a framework chunk under Lighthouse's CPU slowdown, and
   both app-level levers were tried and moved nothing measurable. Reaching the
   good-range boundary means changing what hydrates the page, which is a
   product-and-stack decision rather than a fix, and it is not one this repository
   should take to satisfy a lab metric. What is explicitly _not_ on the table is
   buying the number by removing the character: the character is the product, and
   a budget that argues against the thing being sold is the wrong budget (D-45).
2. Re-measure on a deployment once one exists, which turns Time to First Byte
   from a file read into a real figure and makes "staging build" true rather than
   approximated.
3. Add the run to the CI job once it exists, so the budget is a gate rather than a
   habit — and so a regression in the artefact has to pass a human's review rather
   than a human's memory.
