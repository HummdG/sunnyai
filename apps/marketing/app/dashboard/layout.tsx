import type { Metadata } from 'next';

import '../dashboard.css';
import '../dashboard-v2.css';

export const metadata: Metadata = {
  title: { default: 'Dashboard', template: '%s · Sunny dashboard' },
  description:
    'Manage your Sunny assistant: inbox, leads, knowledge, products, add-ons and billing.',
  robots: { index: false, follow: false },
};

/** The installer dashboard. Signed-in only (see `proxy.ts`). */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="dash">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {children}
    </div>
  );
}
