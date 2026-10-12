'use client';

import Link from 'next/link';
import { useState } from 'react';

import { friendlyAuthError, sendPasswordReset } from '../../lib/auth-client.js';
import {
  AuthHeading,
  EmailField,
  FormError,
  FormNote,
  NotConfigured,
  useSignInMode,
} from './auth-kit.js';

export function ForgotPasswordForm(): React.JSX.Element {
  const mode = useSignInMode();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title="Reset your password"
        lead="Tell us your email and we’ll send a link to choose a new password."
      />
      {mode === 'firebase' ? (
        sent ? (
          <FormNote>
            If there’s an account for <strong>{email}</strong>, a reset link is on its way. Check
            your inbox (and spam folder).
          </FormNote>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              sendPasswordReset(email)
                // The same answer whether or not the account exists, so this
                // page cannot be used to find out who has one.
                .then(() => setSent(true))
                .catch((failure: unknown) => {
                  const code = (failure as { code?: string }).code;
                  if (code === 'auth/user-not-found') setSent(true);
                  else setError(friendlyAuthError(failure));
                })
                .finally(() => setBusy(false));
            }}
          >
            <EmailField value={email} onChange={setEmail} />
            <FormError message={error} />
            <button className="button wide" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )
      ) : mode === 'loading' ? null : (
        <NotConfigured />
      )}
      <p className="auth-switch">
        Remembered it? <Link href="/sign-in">Back to sign in</Link>
      </p>
    </section>
  );
}
