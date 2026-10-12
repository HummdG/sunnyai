'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  finishVerification,
  friendlyAuthError,
  resendVerification,
} from '../../lib/auth-client.js';
import { AuthHeading, FormError, FormNote, useNext } from './auth-kit.js';

/**
 * "Confirm your email". The dashboard needs a confirmed address (it is how
 * team invitations and leads find people). This page checks every few seconds,
 * so confirming in another tab carries straight on.
 */
export function VerifyEmail(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = useNext('/dashboard/onboarding');
  const email = params.get('email') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = () => {
      finishVerification()
        .then((ok) => {
          if (ok && !stopped) router.replace(next);
        })
        .catch(() => null);
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [next, router]);

  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title="Check your inbox"
        lead={
          <>
            We’ve sent a confirmation link to {email ? <strong>{email}</strong> : 'your email'}.
            Open it and you’ll come straight back here.
          </>
        }
      />
      {resent ? <FormNote>Sent again. It can take a minute to arrive.</FormNote> : null}
      <FormError message={error} />
      <div className="auth-actions">
        <button
          type="button"
          className="button"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            setError(null);
            finishVerification()
              .then((ok) => {
                if (ok) router.replace(next);
                else setError('Not confirmed yet. Open the link in the email, then try again.');
              })
              .catch((failure: unknown) => setError(friendlyAuthError(failure)))
              .finally(() => setChecking(false));
          }}
        >
          {checking ? 'Checking…' : 'I’ve confirmed it'}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setError(null);
            resendVerification()
              .then(() => setResent(true))
              .catch((failure: unknown) => setError(friendlyAuthError(failure)));
          }}
        >
          Send it again
        </button>
      </div>
      <p className="auth-switch">
        Wrong address? <Link href="/sign-up">Start again</Link>
      </p>
    </section>
  );
}
