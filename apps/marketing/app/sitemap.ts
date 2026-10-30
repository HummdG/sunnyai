import type { MetadataRoute } from 'next';

import { PUBLIC_PATHS, SITE_URL } from './seo.js';

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: path === '/' ? SITE_URL : `${SITE_URL}${path}`,
    changeFrequency: 'monthly',
    priority: path === '/' ? 1 : 0.7,
  }));
}
