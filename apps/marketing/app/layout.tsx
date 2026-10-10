import { defaultRig, renderSunny } from '@sunny/character';
import type { Metadata } from 'next';

// The design tokens first, then the page's own styles, which consume them.
// Static imports, so they are extracted into real stylesheets at build time
// rather than injected at runtime.
import '@sunny/ui/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sunny — the solar assistant that answers like a person',
  description:
    'Sunny is an embeddable AI assistant for solar installers. It qualifies enquiries, answers questions from your own documents and hands the good ones over.',
};

/**
 * The brand mark is the character itself, rendered from the same rig the widget
 * uses. There is no separate logo file to fall out of date with the artwork.
 */
const BRAND_MARK = renderSunny(defaultRig(), { decorative: true, size: 32 });

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>

        <header className="site-header">
          <div className="wrap">
            <a className="brand" href="#main">
              <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND_MARK }} />
              Sunny
            </a>
            <nav className="site-nav" aria-label="Sections">
              <a href="#how">How it works</a>
              <a href="#demo">Try it</a>
              <a href="#character">The character</a>
              <a href="#pricing">Pricing</a>
            </nav>
          </div>
        </header>

        {children}

        <footer className="site-footer">
          <div className="wrap">
            <span>Sunny — an assistant for solar installers.</span>
            {/*
              No address, phone number or company registration is invented here.
              Those are facts about a real business, and there is no business
              yet to state them about. The plan forbids inventing them, so the
              footer says what is true and stops.
            */}
            <span>Contact details are added when the company is set up.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
