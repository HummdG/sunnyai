'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { sessionExpiresAt } from '../../lib/auth-client.js';
import { api, ApiFailure } from '../../lib/portal-api.js';
import { AuthHeading, FormError } from './auth-kit.js';

interface InvitePreview {
  companyName: string;
  email: string;
  role: string;
  accepted: boolean;
}

const ROLE_TEXT: Record<string, string> = {
  owner: 'an owner',
  admin: 'an admin',
  sales: 'a member of the sales team',
  viewer: 'a viewer',
};

/** A colleague's invitation link: see who invited you, then join. */
export function AcceptInvite({ token }: { token: string }): React.JSX.Element {
  const router = useRouter();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn((sessionExpiresAt() ?? 0) > Date.now());
    api<InvitePreview>(`/v1/portal/invite?token=${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((failure: unknown) =>
        setError(
          failure instanceof Error ? failure.message : 'This invitation is no longer valid.',
        ),
      );
  }, [token]);

  const here = `/invite/${encodeURIComponent(token)}`;
  return (
    <section aria-labelledby="auth-title">
      <AuthHeading
        title={invite ? `Join ${invite.companyName}` : 'Your invitation'}
        lead={
          invite ? (
            <>
              You’ve been invited as {ROLE_TEXT[invite.role] ?? invite.role}, using{' '}
              <strong>{invite.email}</strong>.
            </>
          ) : null
        }
      />
      <FormError message={error} />
      {invite && signedIn ? (
        <button
          type="button"
          className="button wide"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            api('/v1/portal/invite/accept', { body: { token } })
              .then(() => router.replace('/dashboard'))
              .catch((failure: unknown) => {
                setError(
                  failure instanceof ApiFailure
                    ? failure.message
                    : 'We couldn’t accept that invitation.',
                );
                setBusy(false);
              });
          }}
        >
          {busy ? 'Joining…' : `Join ${invite.companyName}`}
        </button>
      ) : null}
      {invite && !signedIn ? (
        <div className="auth-actions">
          <Link className="button" href={`/sign-in?next=${encodeURIComponent(here)}`}>
            Sign in as {invite.email}
          </Link>
          <Link className="button secondary" href={`/sign-up?next=${encodeURIComponent(here)}`}>
            Create an account
          </Link>
        </div>
      ) : null}
    </section>
  );
}
