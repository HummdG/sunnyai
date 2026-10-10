import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Harbourline Solar — a Next.js host page',
  description: 'A fixture that mounts the Sunny widget from a Next.js app.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <header>
          <strong>Harbourline Solar</strong>
          <nav>
            <Link href="/">Our snippet</Link>
            <Link href="/script">next/script</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>A Next.js host for the Sunny widget. Not a real installer.</footer>
      </body>
    </html>
  );
}
