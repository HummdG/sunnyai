'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { friendlyAuthError, signUpWithPassword } from '../../lib/auth-client.js';
import {
  AuthHeading,
  DevSignIn,
  Divider,
  EmailField,
  FormError,
  GoogleButton,
  NotConfigured,
  PasswordField,
  useNext,
  useSignInMode,
} from './auth-kit.js';

/** "Get started": create an account, confirm the email, then onboarding. */
export function SignUpForm(): React.JSX.Element {
  const router = useRouter();
  const next = useNext('/dashboard/onboarding');
  const mode = useSignInMode();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title="Get started — it’s free to try"
        lead="Create your account and Sunny will be answering your website visitors in about ten minutes."
      />
      {mode === 'loading' ? <p className="muted">Getting sign-up ready…</p> : null}
      {mode === 'none' ? <NotConfigured /> : null}
      {mode === 'dev' ? <DevSignIn next={next} cta="Create my account" /> : null}

      {mode === 'firebase' ? (
        <>
          <GoogleButton label="Sign up with Google" next={next} />
          <Divider />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              signUpWithPassword(email, password)
                .then(() =>
                  router.replace(
                    `/verify-email?email=${encodeURIComponent(email)}&sent=1&next=${encodeURIComponent(next)}`,
                  ),
                )
                .catch((failure: unknown) => {
                  setError(friendlyAuthError(failure));
                  setBusy(false);
                });
            }}
          >
            <EmailField value={email} onChange={setEmail} />
            <PasswordField
              label="Choose a password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint="At least 8 characters."
            />
            <FormError message={error} />
            <button className="button wide" type="submit" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create my account'}
            </button>
          </form>
        </>
      ) : null}

      <p className="auth-switch">
        Already have an account?{' '}
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
      </p>
    </section>
  );
}
