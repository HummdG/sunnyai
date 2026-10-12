import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ForgotPasswordForm } from '../../../components/auth/forgot-password-form.js';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default function ForgotPasswordPage(): React.JSX.Element {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
