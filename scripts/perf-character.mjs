#!/usr/bin/env node
/**
 * Measure the character's frame times in Chromium.
 *
 *   npm run build:lab && npx tsx apps/character-lab/serve.ts --port 4190 &
 *   node scripts/perf-character.mjs [http://localhost:4190/perf.html]
 *
 * Records requestAnimationFrame intervals and the time spent in each frame's
 * script for 5 s, at 1× and with 4× CPU throttling, and prints p50 / p95 / max
 * frame interval and the number of dropped frames (intervals > 1.5 × 16.7 ms).
 */
/* global window, requestAnimationFrame, performance */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4190/perf.html';
const browser = await chromium.launch();

async function measure(throttle) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const cdp = await page.context().newCDPSession(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await cdp.send('Performance.enable');
  const metric = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
    );
  const before = await metric();
  await page.evaluate(() => (window.__work.length = 0));
  const stats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const intervals = [];
        let last = performance.now();
        const start = last;
        const step = (now) => {
          intervals.push(now - last);
          last = now;
          if (now - start < 5000) requestAnimationFrame(step);
          else {
            intervals.sort((a, b) => a - b);
            const pick = (q) =>
              intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * q))];
            resolve({
              frames: intervals.length,
              p50: +pick(0.5).toFixed(1),
              p95: +pick(0.95).toFixed(1),
              max: +intervals[intervals.length - 1].toFixed(1),
              dropped: intervals.filter((i) => i > 25).length,
            });
          }
        };
        requestAnimationFrame(step);
      }),
  );
  const after = await metric();
  const work = await page.evaluate(() => {
    const w = [...window.__work].sort((a, b) => a - b);
    const q = (x) => +w[Math.min(w.length - 1, Math.floor(w.length * x))].toFixed(2);
    return {
      workP50: q(0.5),
      workP95: q(0.95),
      workMax: +w[w.length - 1].toFixed(2),
      over8ms: w.filter((v) => v > 8).length,
    };
  });
  const per = (name) => +(((after[name] - before[name]) * 1000) / stats.frames).toFixed(2);
  await page.close();
  return {
    throttle: `${throttle}×`,
    ...stats,
    ...work,
    scriptMsPerFrame: per('ScriptDuration'),
    styleMsPerFrame: per('RecalcStyleDuration'),
    layoutMsPerFrame: per('LayoutDuration'),
    taskMsPerFrame: per('TaskDuration'),
  };
}

for (const rate of [1, 4]) console.log(JSON.stringify(await measure(rate)));
await browser.close();
