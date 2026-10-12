import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignUpForm } from '../../../components/auth/sign-up-form.js';

export const metadata: Metadata = {
  title: 'Get started',
  description: 'Create your Sunny.ai account and put Sunny to work on your website.',
};

export default function SignUpPage(): React.JSX.Element {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
