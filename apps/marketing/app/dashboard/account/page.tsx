'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EmailField, PasswordField } from '../../../components/auth/auth-kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import { Card, ErrorNote, PageHeader } from '../../../components/dashboard/ui.js';
import { useToast } from '../../../components/dashboard/toast.js';
import {
  changeEmail,
  changePassword,
  firebaseEnabled,
  friendlyAuthError,
  signOut,
  signOutEverywhere,
} from '../../../lib/auth-client.js';

function Account() {
  const { me } = usePortal();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, work: () => Promise<void>, done: string) {
    setBusy(label);
    setError(null);
    try {
      await work();
      toast.success(done);
    } catch (failure) {
      setError(friendlyAuthError(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Your account" lead={`Signed in as ${me.user.email ?? 'you'}.`} />
      <ErrorNote error={error} />
      <div className="grid two">
        {firebaseEnabled ? (
          <Card title="Change your password">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  'password',
                  async () => {
                    await changePassword(current, next);
                    setCurrent('');
                    setNext('');
                  },
                  'Password changed.',
                );
              }}
            >
              <PasswordField
                label="Current password"
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
              />
              <PasswordField
                label="New password"
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                hint="At least 8 characters."
              />
              <button className="button" type="submit" disabled={busy !== null}>
                {busy === 'password' ? 'Saving…' : 'Change password'}
              </button>
            </form>
          </Card>
        ) : null}
        {firebaseEnabled ? (
          <Card title="Change your email">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  'email',
                  () => changeEmail(email),
                  'Check your new inbox to confirm the change.',
                );
              }}
            >
              <EmailField value={email} onChange={setEmail} label="New email address" />
              <p className="small muted">
                We’ll send a confirmation link to the new address. Your team access moves with it
                once you confirm.
              </p>
              <button className="button" type="submit" disabled={busy !== null}>
                {busy === 'email' ? 'Sending…' : 'Send confirmation link'}
              </button>
            </form>
          </Card>
        ) : (
          <Card title="Sign-in details">
            <p className="muted">
              This environment uses development sign-in, so there’s no password to change.
            </p>
          </Card>
        )}
        <Card title="Signed-in devices">
          <p className="muted">
            Lost a laptop or shared a computer? Sign out everywhere ends every session on every
            device, including this one.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy !== null}
              onClick={() => void signOut().then(() => router.replace('/'))}
            >
              Sign out
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy !== null}
              onClick={() =>
                void run('everywhere', signOutEverywhere, 'Signed out everywhere.').then(() =>
                  router.replace('/sign-in'),
                )
              }
            >
              {busy === 'everywhere' ? 'Signing out…' : 'Sign out everywhere'}
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <PortalShell>
      <Account />
    </PortalShell>
  );
}
