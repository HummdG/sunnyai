#!/usr/bin/env node
/**
 * Measures the marketing site with Lighthouse and holds it to a budget.
 *
 * The plan's P3 exit gate is "visual regression, Lighthouse/accessibility
 * baseline, working demo", and §12 asks for "marketing Core Web Vitals in good
 * range" with the thresholds "established after first measured staging build".
 * Two of those three halves exist: the visual regression is the character
 * baselines (D-16) and accessibility is the axe pass in Chromium. This is the
 * third, and it was the one thing in P3 that nothing measured.
 *
 * ## Why it does not start the servers
 *
 * This is a *measurer*, not a supervisor, and it follows `verify-isolation`:
 * point it at a running deployment and it reports what it finds. Starting a
 * Next.js production server and the API from inside a Node script means signal
 * handling, process trees and orphaned children on Windows -- a second, worse
 * problem than the one being measured, and a source of the very flakiness a
 * performance baseline must not have. The two commands to start are printed when
 * the site is not reachable, so there is no way to read the failure and not know
 * what to do.
 *
 * ## Why the budget is a ceiling rather than the good-range figure
 *
 * §12 says to set thresholds *after* the first measured build, and that order is
 * the point. A budget that fails on the day it is written is not a budget, it is
 * a wish, and a gate nobody can pass is a gate everybody learns to skip (the
 * same reasoning as `npm run verify` being separate from `verify:all`). So each
 * metric carries two numbers:
 *
 *   - `budget` -- a regression ceiling, set from the first measurement with
 *     headroom for run-to-run variance. Exceeding it fails the run.
 *   - `target` -- the Lighthouse "good" boundary. Printed next to the measured
 *     value so a reader can see, without opening a second document, which
 *     metrics already meet the goal and which do not.
 *
 * Today `total-blocking-time` is the one that does not, and it says so rather
 * than being quietly given a lenient budget.
 *
 * ## Why the lab, and what it cannot say
 *
 * These are lab numbers from one machine, not field data. They cannot stand in
 * for a real-user p75, which needs real users, and the device is the host CPU
 * with Lighthouse's throttling applied rather than a mid-range phone. The
 * baseline exists to catch a regression in the built artefact -- a dependency
 * that adds 200 ms of parse, a font that blocks paint -- which is exactly what
 * the lab is good at, and it is the only thing it is claimed to do here.
 *
 * Usage:
 *   node scripts/lighthouse-marketing.mjs [--desktop] [--write] [--url=<url>]
 *
 *   --desktop  measure the desktop preset instead of mobile
 *   --write    also refresh docs/performance/marketing-baseline.json
 *   --url      measure this URL instead of the local one
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASELINE_PATH = join(ROOT, 'docs', 'performance', 'marketing-baseline.json');

const DEFAULT_URL = 'http://127.0.0.1:4176/';

/**
 * What this reports: the performance score, the five Core Web Vitals metrics
 * Lighthouse measures in the lab, and Time to First Byte.
 *
 * `server-response-time` is here although it is not a Core Web Vital because on
 * this site it is the one number a deployment change moves and nothing else
 * does -- a static Next.js page served from disk is 15 ms and a cold Cloud Run
 * instance is not -- so without it a hosting regression would show up as a
 * mysterious LCP movement instead of as itself.
 *
 * `higherIsBetter` is a property of the measure rather than a detail of the
 * comparison: the score is the only one of these where a larger number is the
 * better one, and encoding that next to each metric is what stops the score
 * being checked the way the milliseconds are.
 */
const REPORT = [
  { id: 'performance', label: 'Performance score', unit: 'score', higherIsBetter: true },
  { id: 'largest-contentful-paint', label: 'Largest Contentful Paint', unit: 'ms' },
  { id: 'cumulative-layout-shift', label: 'Cumulative Layout Shift', unit: 'index' },
  { id: 'total-blocking-time', label: 'Total Blocking Time', unit: 'ms' },
  { id: 'first-contentful-paint', label: 'First Contentful Paint', unit: 'ms' },
  { id: 'speed-index', label: 'Speed Index', unit: 'ms' },
  { id: 'server-response-time', label: 'Time to First Byte', unit: 'ms' },
];

/**
 * The budget, in the units Lighthouse reports.
 *
 * Set on 2026-10-11 from five mobile runs of the same build, because one run
 * would have set the budget from a sample of one and Lighthouse is visibly
 * variable: the score read 0.92, 0.96, 0.97, 0.89 and 0.94; LCP 2188, 2095, 1857,
 * 2249 and 2140 ms; TBT 299, 205, 162, 386 and 259 ms -- a spread whose width is
 * itself the finding, and the reason the score is treated here as a coarse signal
 * rather than as the gate. The ceilings are roughly 1.5x the *worst* of the five
 * for the millisecond metrics: wide enough that ordinary variance does not redden
 * the run, narrow enough that a genuine regression (a bundle that grows, a font
 * that arrives late) cannot hide under it. A tighter budget would fail on
 * variance alone, and a gate that fails on variance is one people re-run until
 * it passes. The CLS ceiling is the good-range figure rather than a loosened
 * one, because the site laid out at exactly zero in every run and a budget of
 * "some layout shift" is a budget for a defect. The score ceiling is below the
 * good-range target on purpose: a run that drifts from 0.95 to 0.87 is a
 * regression worth seeing even though 0.87 is not a number to be ashamed of.
 *
 * `server-response-time` is the one budget that cannot be read as a promise
 * about the deployed site: these runs measure a local `next start`, where 3-15
 * ms is a file read. A Cloud Run cold start is a different number, and this
 * script will not see it until something measures a deployment.
 */
const BUDGETS = {
  performance: { budget: 0.85, target: 0.9 },
  'largest-contentful-paint': { budget: 3400, target: 2500 },
  'cumulative-layout-shift': { budget: 0.1, target: 0.1 },
  'total-blocking-time': { budget: 600, target: 200 },
  'first-contentful-paint': { budget: 1200, target: 1800 },
  'speed-index': { budget: 1600, target: 3400 },
  'server-response-time': { budget: 100, target: 800 },
};

function arg(name) {
  return process.argv.includes(`--${name}`);
}

function argValue(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/**
 * Find a Chrome for Lighthouse to drive.
 *
 * Playwright already keeps a Chromium on this machine for the browser suite, and
 * a second download of the same thing would be a second thing to keep current.
 * `CHROME_PATH` wins when it is set, so a developer with their own Chrome is not
 * overruled, and the Playwright locations are tried in the order Playwright
 * itself would use them. The failure names both remedies rather than reporting
 * that a launcher could not find a browser, which is the message that sends
 * people looking in the wrong place.
 */
function resolveChrome() {
  const explicit = process.env['CHROME_PATH'];
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`CHROME_PATH is set to ${explicit}, which does not exist`);
    }
    return explicit;
  }

  const home = homedir();
  const caches = [
    process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'ms-playwright') : null,
    join(home, '.cache', 'ms-playwright'),
    join(home, 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);

  const suffixes = [
    join('chrome-win64', 'chrome.exe'),
    join('chrome-win', 'chrome.exe'),
    join('chrome-linux', 'chrome'),
    join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  ];

  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    // Newest build first: the number in the directory is a build id, and the
    // higher one is what `test:e2e:install` fetched last.
    const builds = readdirSync(cache)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const build of builds) {
      for (const suffix of suffixes) {
        const candidate = join(cache, build, suffix);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  throw new Error(
    'no Chrome found for Lighthouse. Either run `npm run test:e2e:install` to fetch the ' +
      'Playwright Chromium, or set CHROME_PATH to a Chrome binary.',
  );
}

/**
 * One Lighthouse run, trimmed to what this script reports.
 *
 * The preset matters more than any option here: without one Lighthouse measures
 * the host at full speed and every figure reads good on every site. Mobile is
 * the default and the one the plan's "mobile-first" is about; desktop is opt-in
 * rather than both-by-default, because two runs double a measurement that is
 * already slow and only one of them is the promise being kept.
 */
async function measure(url, chromePath, formFactor) {
  const chrome = await chromeLauncher.launch({
    chromePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const options = {
      port: chrome.port,
      onlyCategories: ['performance'],
      output: 'json',
      logLevel: 'error',
    };

    const config =
      formFactor === 'desktop'
        ? (await import('lighthouse/core/config/desktop-config.js')).default
        : undefined;

    const result = await (config
      ? lighthouse(url, { ...options, config })
      : lighthouse(url, options));

    if (!result?.lhr || result.lhr.runtimeError) {
      throw new Error(
        `Lighthouse could not measure ${url}: ` +
          `${result?.lhr?.runtimeError?.message ?? 'no report returned'}`,
      );
    }

    const { lhr } = result;
    const values = { performance: lhr.categories.performance.score };
    for (const metric of REPORT) {
      if (metric.id === 'performance') continue;
      values[metric.id] = lhr.audits[metric.id]?.numericValue ?? null;
    }
    return values;
  } finally {
    await chrome.kill();
  }
}

/** Render a value in the unit the metric is reported in. */
function format(value, unit) {
  if (value === null || value === undefined) return 'n/a';
  if (unit === 'ms') return `${Math.round(value)} ms`;
  if (unit === 'score') return value.toFixed(2);
  return value.toFixed(3);
}

function verdict(value, spec, budget) {
  if (value === null || value === undefined) return 'unknown';
  // The score counts up and every other metric counts down, which is why the
  // direction is carried on the metric rather than assumed here.
  const over = spec.higherIsBetter ? value < budget.budget : value > budget.budget;
  const meets = spec.higherIsBetter ? value >= budget.target : value <= budget.target;
  if (over) return 'OVER BUDGET';
  return meets ? 'ok' : 'in budget, short of target';
}

async function main() {
  const url = argValue('url', DEFAULT_URL);
  const formFactor = arg('desktop') ? 'desktop' : 'mobile';
  const chromePath = resolveChrome();

  // Reachable before measured, so an unstarted server is a sentence rather than
  // a Lighthouse timeout after thirty seconds of work.
  let reachable = false;
  let detail = '';
  try {
    const response = await fetch(url, { redirect: 'manual' });
    reachable = response.status < 400;
    detail = `answered ${response.status}`;
  } catch (error) {
    detail = error.message;
  }
  if (!reachable) {
    process.stderr.write(`\n${url} ${detail}.\n`);
    process.stderr.write('\nStart the site first, in another shell:');
    process.stderr.write(
      '\n  npm run build:widget && npm run build -w @sunny/marketing && npm run start -w @sunny/marketing',
    );
    process.stderr.write('\n\nAnd the API it talks to, if the widget is to find one:');
    process.stderr.write('\n  PORT=8787 npx tsx apps/api/src/main.ts');
    process.stderr.write('\n\nOr point this script somewhere else with --url=<url>.\n\n');
    process.exit(2);
  }

  console.log(`\nMeasuring ${url} (${formFactor}, ${chromePath})\n`);

  const measured = await measure(url, chromePath, formFactor);

  let overBudget = 0;
  console.log(
    `${'Metric'.padEnd(26)} ${'Measured'.padStart(11)} ${'Budget'.padStart(11)} ${'Target'.padStart(11)}  Verdict`,
  );
  for (const spec of REPORT) {
    const budget = BUDGETS[spec.id];
    const value = measured[spec.id];
    const line = verdict(value, spec, budget);
    console.log(
      `${spec.label.padEnd(26)} ${format(value, spec.unit).padStart(11)} ` +
        `${format(budget.budget, spec.unit).padStart(11)} ${format(budget.target, spec.unit).padStart(11)}  ${line}`,
    );
    if (line === 'OVER BUDGET') overBudget += 1;
  }

  if (arg('write')) {
    const baseline = {
      url,
      formFactor,
      measuredAt: new Date().toISOString(),
      // Recorded so a figure can be compared with the machine that produced it.
      // A baseline without its provenance is a number nobody can argue with.
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      metrics: measured,
      budgets: BUDGETS,
    };
    await mkdir(dirname(BASELINE_PATH), { recursive: true });
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`\nWrote docs/performance/marketing-baseline.json`);
  } else {
    console.log(
      '\n(not written; pass --write to refresh docs/performance/marketing-baseline.json)',
    );
  }

  if (overBudget > 0) {
    console.error(`\n${overBudget} metric(s) over budget.`);
    process.exit(1);
  }
  console.log('\nEvery metric is within its budget.');
}

await main();
