/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The `@sunny/*` packages point `main` at TypeScript source rather than a
  // build output — see, for example, `packages/character/package.json`. That is
  // deliberate in a workspace whose tests run the same source: there is no
  // compiled copy that can fall behind. It does mean the framework has to be
  // told to compile them, because by default it treats anything under
  // `node_modules` as already-built JavaScript.
  transpilePackages: ['@sunny/character', '@sunny/animation-engine', '@sunny/ui'],

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
