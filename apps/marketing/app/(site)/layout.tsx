import '../site.css';

import { SiteFooter, SiteHeader } from '../../components/site-chrome.js';
import { API_URL, PUBLIC_ID } from '../config.js';

/** The public website: header, footer and the live widget on every page. */
export default function SiteLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>

      <SiteHeader />

      {children}

      <SiteFooter />

      {/*
        The real widget, loaded by the same snippet an installer pastes on
        their own site. It appends itself to <body> and is fixed to the
        viewport, so it is present on every page of the website (and only
        there: the dashboard and sign-in pages do not load it).
      */}
      <script
        src="/widget/sunny-widget.js"
        data-widget-id={PUBLIC_ID}
        data-api-url={API_URL}
        async
      />
    </div>
  );
}
