import { renderSunny } from '@sunny/character';
import Link from 'next/link';

import { NAV } from '../app/site.js';
import { HeaderAccount } from './account-links.js';
import { MobileMenu } from './mobile-menu.js';
import { stillRig } from './scenes/still.js';

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

/** Sunny off duty in the deckchair: a still ink drawing, drawn once. */
const FOOTER_ART = renderSunny(stillRig({ pose: 'hips', act: 'relax-sunbathe', at: 0.5 }), {
  decorative: true,
});

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Brand />
          <p>The friendly assistant that turns your website visitors into solar leads.</p>
          <div
            className="footer-art"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: FOOTER_ART }}
          />
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
