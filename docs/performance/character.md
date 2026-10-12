# Character performance

Measured 2026-10-12 with `scripts/perf-character.mjs` against
`apps/character-lab/public/perf.html`: the website hero (460 px) and the widget
launcher (72 px) running the real loop (animator → `cartoonClock` →
`createSunnyView` with the ink boil), cycling celebrate / sunglasses / deckchair
/ run / eureka / confused every 2.5 s. Headless Chromium, 5 s per run, with and
without 4× CPU throttling (CDP `Emulation.setCPUThrottlingRate`).

"Work" is the JavaScript time inside each animation frame (animator + render +
DOM update). "Dropped" counts frame intervals over 25 ms.

| Run           | Work p50   | Work p95   | Work max | Frames > 8 ms work | Dropped | Worst interval |
| ------------- | ---------- | ---------- | -------- | ------------------ | ------- | -------------- |
| Before, 1×    | 0.5 ms     | 3.9 ms     | 11.3 ms  | 2                  | 1       | 66.6 ms        |
| **After, 1×** | **0.2 ms** | **1.8 ms** | 16.3 ms  | **1**              | **0**   | **16.8 ms**    |
| Before, 4×    | 2.4 ms     | 20.8 ms    | 26.4 ms  | 101                | 10      | 533.2 ms       |
| **After, 4×** | **0.9 ms** | **7.4 ms** | 19.8 ms  | **12**             | **0**   | **16.8 ms**    |

Chrome's own per-frame metrics at 4×: script 7.8 → 2.7 ms, task 10.7 → 6.0 ms.
The old numbers also excluded the cost of rasterising the boil filter (off the
main thread), which the new renderer does not have at all.

## What changed

1. **No SVG filter.** The "boil" was a feTurbulence + feDisplacementMap filter
   re-rasterised every frame. It is now three pre-jittered variants of each
   path (`packages/character/src/boil.ts`), cached.
2. **Part-wise updates.** The renderer returns named parts (`renderSunnyParts`);
   the view builds the SVG once, sets body/face/part transforms as attributes
   and only re-parses a part whose drawing changed.
3. **Cached boil drawings.** Each part keeps one child per boil drawing; after
   warm-up a boil tick only switches which child is shown.
4. **Skipped frames.** The cartoon clock holds each pose for 2–3 display
   frames; identical rig + boil → no work.

Re-run: `npm run build:lab && npx tsx apps/character-lab/serve.ts --port 4190`
then `node scripts/perf-character.mjs`.
