import type { Metadata } from 'next';

import '../dashboard.css';
import '../dashboard-v2.css';
import '../admin.css';

import { AdminShell } from '../../components/admin/shell.js';

export const metadata: Metadata = {
  title: { default: 'Staff', template: '%s · Sunny staff' },
  description: 'How the Sunny platform is running: usage, health, issues and cost.',
  robots: { index: false, follow: false },
};

/** The staff dashboard. Signed-in only (see `proxy.ts`); staff only (the API decides). */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="dash">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AdminShell>{children}</AdminShell>
    </div>
  );
}
