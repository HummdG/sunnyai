'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  applyEmailCode,
  confirmNewPassword,
  finishMagicLink,
  finishVerification,
  friendlyAuthError,
  isMagicLink,
  rememberedLinkEmail,
  resetEmailFor,
} from '../../lib/auth-client.js';
import { AuthHeading, EmailField, FormError, FormNote, PasswordField } from './auth-kit.js';

/**
 * Where Firebase's email links land (set as the custom action URL in the
 * Firebase console): `mode=signIn` (passwordless link), `resetPassword`,
 * `verifyEmail`, `recoverEmail` and `verifyAndChangeEmail`.
 */
export function AuthAction(): React.JSX.Element {
  const params = useSearchParams();
  const mode = params.get('mode') ?? '';
  const code = params.get('oobCode') ?? '';
  if (mode === 'resetPassword') return <ResetPassword code={code} />;
  if (mode === 'signIn') return <FinishLink />;
  if (mode === 'verifyEmail' || mode === 'recoverEmail' || mode === 'verifyAndChangeEmail') {
    return <ApplyCode code={code} mode={mode} />;
  }
  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title="That link doesn’t look right"
        lead="It may be incomplete. Ask for a new one."
      />
      <p className="auth-switch">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </section>
  );
}

function ResetPassword({ code }: { code: string }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    resetEmailFor(code)
      .then(setEmail)
      .catch((failure: unknown) => setError(friendlyAuthError(failure)));
  }, [code]);
  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title="Choose a new password"
        lead={email ? <>For {email}.</> : 'Checking your link…'}
      />
      <FormError message={error} />
      {email ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            confirmNewPassword(code, password)
              .then(() => router.replace('/sign-in?reset=1'))
              .catch((failure: unknown) => {
                setError(friendlyAuthError(failure));
                setBusy(false);
              });
          }}
        >
          <PasswordField
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint="At least 8 characters."
          />
          <button className="button wide" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save my new password'}
          </button>
        </form>
      ) : null}
      <p className="auth-switch">
        <Link href="/forgot-password">Ask for a new link</Link>
      </p>
    </section>
  );
}

function FinishLink() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [needsEmail, setNeedsEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (address: string) => {
    setError(null);
    finishMagicLink(address, window.location.href)
      .then(() => router.replace('/dashboard'))
      .catch((failure: unknown) => setError(friendlyAuthError(failure)));
  };

  useEffect(() => {
    void isMagicLink(window.location.href).then((ok) => {
      if (!ok) {
        setError('That sign-in link isn’t valid any more. Ask for a new one.');
        return;
      }
      const remembered = rememberedLinkEmail();
      if (remembered) finish(remembered);
      else setNeedsEmail(true);
    });
    // A one-shot effect on arrival; `finish` reads nothing that changes.
  }, []);

  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title="Signing you in"
        lead={needsEmail ? 'Confirm the email address the link was sent to.' : 'One moment…'}
      />
      <FormError message={error} />
      {needsEmail ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            finish(email);
          }}
        >
          <EmailField value={email} onChange={setEmail} />
          <button className="button wide" type="submit">
            Sign in
          </button>
        </form>
      ) : null}
      <p className="auth-switch">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </section>
  );
}

function ApplyCode({ code, mode }: { code: string; mode: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    applyEmailCode(code)
      .then(async () => {
        setDone(true);
        if (mode === 'verifyEmail' && (await finishVerification().catch(() => false))) {
          router.replace('/dashboard/onboarding');
        }
      })
      .catch((failure: unknown) => setError(friendlyAuthError(failure)));
  }, [code, mode, router]);
  const title =
    mode === 'verifyEmail'
      ? 'Email confirmed'
      : mode === 'recoverEmail'
        ? 'Email address restored'
        : 'Email address updated';
  return (
    <section aria-labelledby="auth-title">
      <AuthHeading title={done ? title : 'Confirming…'} />
      <FormError message={error} />
      {done ? <FormNote>All set. Sign in to carry on.</FormNote> : null}
      <p className="auth-switch">
        <Link href="/sign-in">Go to sign in</Link>
      </p>
    </section>
  );
}
