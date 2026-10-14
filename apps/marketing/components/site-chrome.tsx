import Link from 'next/link';

import { NAV } from '../app/site.js';
import { HeaderAccount } from './account-links.js';
import { MobileMenu } from './mobile-menu.js';
import { ProgressDial } from './sun/progress-dial.js';

/** The logo is the reference artwork itself (sunny.png); the product is Sunny.ai. */
function Brand(): React.JSX.Element {
  return (
    <Link className="brand" href="/" aria-label="Sunny.ai home">
      <img src="/brand/sunny-logo-128.png" width={36} height={36} alt="" />
      Sunny.ai
    </Link>
  );
}

export function SiteHeader(): React.JSX.Element {
  return (
    <header className="site-header">
      <div className="wrap">
        <Brand />
        <ProgressDial />
        <nav className="site-nav" aria-label="Main">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <HeaderAccount />
        <MobileMenu />
      </div>
    </header>
  );
}

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/product', label: 'Features' },
      { href: '/meet-sunny', label: 'Meet Sunny' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Get going',
    links: [
      { href: '/integrations', label: 'Integrations' },
      { href: '/resources', label: 'Resources' },
      { href: '/sign-up', label: 'Get started' },
      { href: '/sign-in', label: 'Sign in' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
] as const;

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="site-footer" data-sunny-act="deckchair">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Brand />
          <p>The friendly assistant that turns your website visitors into solar leads.</p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2>{column.title}</h2>
            <ul>
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="wrap footer-base">
        <span>© {new Date().getFullYear()} Sunny.ai. Made for UK solar installers.</span>
      </div>
    </footer>
  );
}
