'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import {
  AuthProblem,
  friendlyAuthError,
  sendMagicLink,
  signInWithPassword,
} from '../../lib/auth-client.js';
import {
  AuthHeading,
  DevSignIn,
  Divider,
  EmailField,
  FormError,
  FormNote,
  GoogleButton,
  NotConfigured,
  PasswordField,
  useNext,
  useSignInMode,
} from './auth-kit.js';

export function SignInForm(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = useNext();
  const mode = useSignInMode();
  const [method, setMethod] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title="Welcome back"
        lead="Sign in to your Sunny dashboard: conversations, leads and everything Sunny knows."
      />
      {params.get('reset') ? (
        <FormNote>Password changed. Sign in with your new one.</FormNote>
      ) : null}

      {mode === 'loading' ? <p className="muted">Getting sign-in ready…</p> : null}
      {mode === 'none' ? <NotConfigured /> : null}
      {mode === 'dev' ? <DevSignIn next={next} cta="Sign in" /> : null}

      {mode === 'firebase' ? (
        <>
          <GoogleButton label="Continue with Google" next={next} />
          <Divider />
          {linkSent ? (
            <FormNote>
              Check your inbox: we’ve sent a sign-in link to <strong>{email}</strong>. It works
              once, for an hour.
            </FormNote>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError(null);
                const attempt =
                  method === 'password'
                    ? signInWithPassword(email, password).then(() => router.replace(next))
                    : sendMagicLink(email).then(() => setLinkSent(true));
                attempt
                  .catch((failure: unknown) => {
                    if (failure instanceof AuthProblem && failure.code === 'unverified') {
                      router.replace(
                        `/verify-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
                      );
                      return;
                    }
                    setError(friendlyAuthError(failure));
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <EmailField value={email} onChange={setEmail} />
              {method === 'password' ? (
                <PasswordField
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                />
              ) : null}
              <FormError message={error} />
              <button className="button wide" type="submit" disabled={busy}>
                {busy
                  ? method === 'password'
                    ? 'Signing in…'
                    : 'Sending…'
                  : method === 'password'
                    ? 'Sign in'
                    : 'Email me a sign-in link'}
              </button>
              <div className="auth-links">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setMethod(method === 'password' ? 'link' : 'password');
                    setError(null);
                  }}
                >
                  {method === 'password' ? 'Email me a link instead' : 'Use my password instead'}
                </button>
                <Link href="/forgot-password">Forgot your password?</Link>
              </div>
            </form>
          )}
        </>
      ) : null}

      <p className="auth-switch">
        New to Sunny? <Link href={`/sign-up?next=${encodeURIComponent(next)}`}>Get started</Link>
      </p>
    </section>
  );
}
