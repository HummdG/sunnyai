import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthAction } from '../../../../components/auth/auth-action.js';

export const metadata: Metadata = { title: 'One moment', robots: { index: false } };

/** Where Firebase email links land: sign-in links, password resets, email confirmation. */
export default function AuthActionPage(): React.JSX.Element {
  return (
    <Suspense>
      <AuthAction />
    </Suspense>
  );
}
