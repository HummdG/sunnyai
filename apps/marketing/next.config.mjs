import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // A separate output directory lets a test or review build run beside a
  // developer's (or the owner's) server without overwriting its `.next`.
  distDir: process.env.SUNNY_NEXT_DIST ?? '.next',

  // The container build (apps/marketing/Dockerfile) asks for a standalone
  // server: a `server.js` with only the files the pages trace to, so the image
  // carries no workspace install. Traced from the repo root, because the
  // `@sunny/*` packages the pages import live outside this folder. Local
  // builds keep the default output, so `next start` works as it always has.
  ...(process.env.SUNNY_NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone',
        outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
      }
    : {}),

  // The old "coming soon" sign-up page.
  async redirects() {
    return [{ source: '/start', destination: '/sign-up', permanent: true }];
  },

  /**
   * The headers the widget's own files need when they are served from here.
   *
   * `/widget/` is the published artefact: the script an integrator's snippet
   * loads, and the typeface it declares. A script needs nothing special from a
   * host — a classic `<script src>` is fetched without CORS — but the font does,
   * and without `access-control-allow-origin` the widget embedded on any other
   * origin renders in the system stack while the failure stays invisible on the
   * page (D-48).
   *
   * `public, max-age=86400` rather than an immutable year: the file names carry
   * no content hash, so "this URL never changes" would be a promise the file name
   * cannot keep — a release that changes a subset would be invisible to anyone
   * who had visited within the year. A day of freshness plus a week of
   * `stale-while-revalidate` costs one small request per visitor per release and
   * keeps the panel's first open from waiting on a revalidation.
   *
   * Measured, not assumed: `next start` served this path as
   * `cache-control: public, max-age=0` with no CORS header at all, which is what
   * makes the block below worth its lines.
   */
  async headers() {
    return [
      {
        source: '/widget/fonts/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },

  // The `@sunny/*` packages point `main` at TypeScript source rather than a
  // build output — see, for example, `packages/character/package.json`. That is
  // deliberate in a workspace whose tests run the same source: there is no
  // compiled copy that can fall behind. It does mean the framework has to be
  // told to compile them, because by default it treats anything under
  // `node_modules` as already-built JavaScript.
  // The SunScan viewer (and the house model it rebuilds from) are loaded only
  // by the lead page's 3D view, through a dynamic import.
  transpilePackages: [
    '@sunny/character',
    '@sunny/animation-engine',
    '@sunny/ui',
    '@sunny/sunscan-viewer',
    '@sunny/sunscan-core',
    '@sunny/contracts',
  ],

  /**
   * Resolve `./tokens.js` to `./tokens.ts`.
   *
   * This repository writes relative imports with a `.js` extension, which is
   * what Node's ESM resolver requires of the emitted JavaScript and what
   * `typescript`'s own docs recommend. Bundlers generally infer it: esbuild does,
   * which is why `npm run build:widget` has never needed this. Webpack for Next
   * does not, and fails with `Can't resolve './tokens.js'` on the first package
   * it reaches.
   *
   * `extensionAlias` is the supported switch for exactly this, and it is the
   * reason this app builds with webpack rather than the default Turbopack:
   * Turbopack has no equivalent, so under it the choice would be to compile
   * every shared package to a `dist/` directory purely to satisfy the bundler —
   * trading a real property (tests and the page run identical source) for a
   * build-tool detail. See D-15.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
