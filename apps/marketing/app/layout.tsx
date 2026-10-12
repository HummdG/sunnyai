import type { Metadata } from 'next';
import localFont from 'next/font/local';

// The design tokens first, then the page's own styles, which consume them.
// Static imports, so they are extracted into real stylesheets at build time
// rather than injected at runtime.
import '@sunny/ui/tokens.css';
import './base.css';
import './cameo.css';

export const metadata: Metadata = {
  title: {
    default: 'Sunny.ai — Meet Sunny, your brightest employee',
    template: '%s · Sunny.ai',
  },
  description:
    'Sunny is a friendly AI assistant for solar installers. It answers visitor questions from your own documents, qualifies enquiries and hands you ready-to-call leads.',
};

/**
 * The brand typeface, self-hosted.
 *
 * `next/font/local` rather than a link to a font service: the file is committed
 * in `packages/ui/fonts/` and served from this origin, so the first paint does
 * not wait on a third party, the visitor's browser does not announce itself to
 * one, and the build works with no network. It also generates the measured
 * fallback — `size-adjust` with the ascent and descent overrides, which is what
 * keeps a font swap from moving the layout under the reader.
 *
 * `src` points at the copy `npm run prepare-font` stages inside this app, not at
 * the original: `next/font/local` resolves the path through the app's module
 * graph and answered a relative hop into `packages/` with "Module not found".
 * The canonical bytes and their digest stay in one place, in `packages/ui/fonts/`.
 *
 * The Latin subset only. This page's text is ours and it is English; the wider
 * subset the widget ships is for the names and place names a customer's visitors
 * type into *their* panel, which this page never renders. A character outside the
 * subset falls back per glyph, which is the same thing that happens on a page
 * with no webfont at all.
 *
 * The widget declares its own `@font-face` for the same family inside its shadow
 * root — it cannot use this one, because a page's rules do not reach into a
 * shadow root — and both read the family name from `@sunny/ui` (D-48).
 */
const brandFont = localFont({
  src: './fonts/plus-jakarta-sans-latin.woff2',
  weight: '400 800',
  style: 'normal',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html
      lang="en-GB"
      // `--font-sans` on the element itself rather than a class, because it is
      // the one value that has to beat the stylesheet: `tokens.css` sets the same
      // property on `:root`, and which of two rules of equal specificity wins is
      // decided by stylesheet order — which for a generated font stylesheet is
      // the bundler's business, not a thing to rely on. An inline declaration
      // wins that contest by construction, and it keeps the token file's own
      // value (the family, then the system stack) as what any page without a
      // loaded font still resolves to.
      className={brandFont.className}
      style={{ ...brandFont.style, '--font-sans': brandFont.style.fontFamily }}
    >
      {/*
        One app, three surfaces with their own layouts: the website
        (`(site)`), the sign-in pages (`(auth)`) and the installer dashboard
        (`dashboard`). Each wraps its pages in a scoped class (`.site` /
        `.dash`), so the two stylesheets cannot reach each other's elements.
      */}
      <body>{children}</body>
    </html>
  );
}
