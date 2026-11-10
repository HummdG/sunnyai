import { describe, expect, it } from 'vitest';

import { pathMatches as contractsPathMatches } from '@sunny/contracts';

import { pathMatches as pagePathMatches, type PageRule } from '../lib/portal-api.js';

/**
 * The page's copy of `pathMatches` (kept so zod stays out of the page) must
 * answer exactly as the API's does, or Studio's "Shows here" would disagree
 * with what the widget does.
 */
const rule = (include: string[] = [], exclude: string[] = []): PageRule => ({ include, exclude });

const RULES: PageRule[] = [
  rule(),
  rule(['/offers/battery*']),
  rule(['/offers/**']),
  rule(['/offers/*/deal']),
  rule(['/solar', '/battery/']),
  rule(['/**']),
  rule(['/']),
  rule([], ['/careers*']),
  rule([], ['/blog/**']),
  rule(['/offers/**'], ['/offers/old*']),
  rule(['/*'], ['/about/']),
  rule(['/a.b+c(d)']),
];

const PATHS: Array<string | null> = [
  null,
  '/',
  '',
  '/solar',
  '/solar/',
  '/battery',
  '/battery/',
  '/offers',
  '/offers/',
  '/offers/battery',
  '/offers/battery-2026',
  '/offers/battery/more',
  '/offers/heat/deal',
  '/offers/heat/pump/deal',
  '/offers/old-deal',
  '/careers',
  '/careers/jobs',
  '/blog',
  '/blog/2026/11/post',
  '/about',
  '/about/',
  '/a.b+c(d)',
  '/aXb+c(d)',
];

describe('pathMatches in the page and in @sunny/contracts', () => {
  for (const r of RULES) {
    it(`agree for include ${JSON.stringify(r.include)} and exclude ${JSON.stringify(r.exclude)}`, () => {
      for (const path of PATHS) {
        expect({ path, matches: pagePathMatches(r, path) }, `path ${JSON.stringify(path)}`).toEqual(
          { path, matches: contractsPathMatches(r, path) },
        );
      }
    });
  }

  it('cover both answers across the table', () => {
    const answers = new Set(RULES.flatMap((r) => PATHS.map((p) => contractsPathMatches(r, p))));
    expect(answers).toEqual(new Set([true, false]));
  });
});
