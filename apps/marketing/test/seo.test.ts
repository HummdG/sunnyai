import { describe, expect, it } from 'vitest';

import { isIndexable, robotsFor } from '../app/seo.js';

describe('search indexing by environment', () => {
  it('lets search engines index production only', () => {
    expect(isIndexable('https://heysunny.co.uk')).toBe(true);
    expect(isIndexable('https://staging.heysunny.co.uk')).toBe(false);
    expect(isIndexable('https://sunny-web-staging-530721776397.europe-west2.run.app')).toBe(false);
  });

  it('gives staging a robots.txt that refuses every crawler', () => {
    const robots = robotsFor('https://staging.heysunny.co.uk');
    expect(robots.rules).toEqual({ userAgent: '*', disallow: '/' });
    expect(robots.sitemap).toBeUndefined();
  });

  it('gives production a robots.txt with its sitemap', () => {
    const robots = robotsFor('https://heysunny.co.uk');
    expect(robots.rules).toEqual({
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/api/'],
    });
    expect(robots.sitemap).toBe('https://heysunny.co.uk/sitemap.xml');
  });
});
