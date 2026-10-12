import Link from 'next/link';

import './site.css';

import { NotFoundSunny } from '../components/not-found-sunny.js';
import { SiteFooter, SiteHeader } from '../components/site-chrome.js';

/** 404 (guidelines G): Sunny, confused, and a way home. */
export default function NotFound(): React.JSX.Element {
  return (
    <div className="site">
      <SiteHeader />
      <main id="main" className="not-found">
        <NotFoundSunny />
        <h1>This page has wandered off.</h1>
        <p className="lede">Let&rsquo;s get you home.</p>
        <div className="actions">
          <Link className="button" href="/">
            Back to the home page
          </Link>
          <Link className="button secondary" href="/dashboard">
            Go to your dashboard
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
