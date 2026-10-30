import type { Metadata, MetadataRoute } from 'next';

/**
 * What search engines and link previews are told about the website.
 *
 * The site's own address is read at build time, like the API's (config.ts):
 * production builds with no value and gets heysunny.co.uk, staging builds with
 * its own hostname. Only production may be indexed, so a staging page that is
 * shared or crawled never competes with the real one.
 */
export const PRODUCTION_SITE_URL = 'https://heysunny.co.uk';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? PRODUCTION_SITE_URL;

export const SITE_NAME = 'Sunny';

/** The home page's title and description, which are also the site's defaults. */
export const HOME_TITLE = 'Meet Sunny, your brightest employee';
export const HOME_DESCRIPTION =
  'Sunny is a friendly AI assistant for solar installers. It answers visitor questions from your own documents, qualifies enquiries and hands you ready-to-call leads.';

/** Whether search engines may index a site served from `siteUrl`. */
export function isIndexable(siteUrl: string): boolean {
  return siteUrl === PRODUCTION_SITE_URL;
}

/** robots.txt for a site served from `siteUrl`. */
export function robotsFor(siteUrl: string): MetadataRoute.Robots {
  if (!isIndexable(siteUrl)) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/dashboard', '/api/'] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

/** The public pages, in the order the sitemap lists them. */
export const PUBLIC_PATHS = [
  '/',
  '/product',
  '/meet-sunny',
  '/how-it-works',
  '/integrations',
  '/pricing',
  '/resources',
  '/privacy',
  '/terms',
] as const;

/**
 * A public page's metadata: its title and description, its canonical URL, and
 * the same title and description for link previews.
 *
 * Next.js merges metadata shallowly, so a page that set only `title` would
 * share the home page's `openGraph` and preview with the home page's title.
 * For the same reason the share image is named here: a page's `openGraph`
 * replaces the layout's whole, including the image `app/opengraph-image.png`
 * would otherwise add.
 */
/** The share image (`app/opengraph-image.png`, from scripts/og). */
const SHARE_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Sunny, the smiling sun, beside the headline "Meet Sunny. Your brightest employee."',
};

export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: (typeof PUBLIC_PATHS)[number];
}): Metadata {
  const previewTitle = path === '/' ? title : `${title} · ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_GB',
      url: path,
      title: previewTitle,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: previewTitle,
      description,
      images: [SHARE_IMAGE],
    },
  };
}
