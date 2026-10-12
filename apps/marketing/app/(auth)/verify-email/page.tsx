import type { Metadata } from 'next';
import { Suspense } from 'react';

import { VerifyEmail } from '../../../components/auth/verify-email.js';

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false } };

export default function VerifyEmailPage(): React.JSX.Element {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
