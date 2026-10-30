import type { MetadataRoute } from 'next';

import { robotsFor, SITE_URL } from './seo.js';

export default function robots(): MetadataRoute.Robots {
  return robotsFor(SITE_URL);
}
