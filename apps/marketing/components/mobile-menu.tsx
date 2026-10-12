'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { NAV } from '../app/site.js';
import { MobileAccountLinks } from './account-links.js';

/**
 * The small-screen menu. A `<details>` disclosure, so it opens without
 * JavaScript; this component only closes it again after client-side navigation,
 * which would otherwise leave it hanging open over the new page.
 */
export function MobileMenu(): React.JSX.Element {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  return (
    <details className="mobile-menu" ref={menu}>
      <summary aria-label="Menu">
        <span aria-hidden="true" />
      </summary>
      <nav aria-label="Main (mobile)">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
        <MobileAccountLinks />
      </nav>
    </details>
  );
}
