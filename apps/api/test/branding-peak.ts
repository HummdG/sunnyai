/**
 * Run by branding-trace.test.ts in a fresh process, so the peak resident set it
 * reports belongs to one `processLogo` call and nothing else in the test run.
 * Prints one JSON line: the call's time and its peak memory growth.
 */
import { readFileSync } from 'node:fs';

import { processLogo } from '../src/branding/process.js';

const bytes = new Uint8Array(readFileSync(process.argv[2]!));
const before = process.memoryUsage();
const start = performance.now();
const p = processLogo(bytes, 'icon');
const ms = performance.now() - start;
const after = process.memoryUsage();
// maxRSS (KiB) is the process's peak, so growth counts transient buffers the GC already freed.
const peakRss = process.resourceUsage().maxRSS * 1024;
console.log(
  JSON.stringify({
    ms,
    rssBefore: before.rss,
    peakRss,
    growth: peakRss - before.rss,
    heapAfter: after.heapUsed + after.external - (before.heapUsed + before.external),
    width: p.width,
    effects: p.availableEffects.length,
  }),
);
