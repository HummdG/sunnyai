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
not**, and it is worth saying plainly what it is: the main thread is blocked for
150–400 ms after first paint by the page's own JavaScript — React hydration and
the character's render loop — before the page can respond to input. It is the
metric a mid-range phone would feel, and it is the one to fix first. Pulling the
character's loop off the critical path, or deferring the hero's hydration, are the
two candidates; neither has been done.

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
- **Nothing enforces this in CI**, because nothing runs in CI (D-9: no remote).
  The command is a developer's, run by hand, and the budget is enforced only when
  somebody runs it.

## What would move this

The honest next steps, in the order the numbers argue for them:

1. Bring TBT under 200 ms. It is the single metric short of the goal and the one
   with the clearest cause (main-thread JavaScript after first paint).
2. Re-measure on a deployment once one exists, which turns Time to First Byte
   from a file read into a real figure and makes "staging build" true rather than
   approximated.
3. Add the run to whatever CI exists once the repository has a remote, so the
   budget is a gate rather than a habit.
