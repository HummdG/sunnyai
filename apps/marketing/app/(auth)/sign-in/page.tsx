import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignInForm } from '../../../components/auth/sign-in-form.js';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Sunny.ai dashboard.',
  robots: { index: false },
};

export default function SignInPage(): React.JSX.Element {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
