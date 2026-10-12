'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The header's sign-in area. Signed out: "Sign in" and "Get started". Signed
 * in: "Dashboard" and an account menu.
 *
 * Decided from the public `sunny_signed_in` cookie, which holds only the
 * session's expiry time -- never the credential, which is HttpOnly. Reading it
 * in the browser keeps every marketing page static.
 */
function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const match = /(?:^|;\s*)sunny_signed_in=(\d+)/.exec(document.cookie);
    setSignedIn(match !== null && Number(match[1]) > Date.now());
  }, []);
  return signedIn;
}

async function signOutHere(): Promise<void> {
  const { signOut } = await import('../lib/auth-client.js');
  await signOut();
}

export function HeaderAccount(): React.JSX.Element {
  const signedIn = useSignedIn();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && menu.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!signedIn) {
    return (
      <div className="header-actions">
        <Link className="link-quiet" href="/sign-in">
          Sign in
        </Link>
        <Link className="button small" href="/sign-up">
          Get started
        </Link>
      </div>
    );
  }
  return (
    <div className="header-actions" ref={menu}>
      <Link className="button small" href="/dashboard">
        Dashboard
      </Link>
      <div className="account-menu">
        <button
          type="button"
          className="account-trigger"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen(!open)}
        >
          Account
        </button>
        {open ? (
          <div className="account-popover" role="menu">
            <Link role="menuitem" href="/dashboard" onClick={() => setOpen(false)}>
              Dashboard
            </Link>
            <Link role="menuitem" href="/dashboard/account" onClick={() => setOpen(false)}>
              Your account
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOutHere().then(() => {
                  router.refresh();
                  window.location.assign('/');
                });
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The mobile menu's version: plain links. */
export function MobileAccountLinks(): React.JSX.Element {
  const signedIn = useSignedIn();
  if (signedIn) {
    return (
      <>
        <Link href="/dashboard/account">Your account</Link>
        <Link className="button" href="/dashboard">
          Dashboard
        </Link>
      </>
    );
  }
  return (
    <>
      <Link href="/sign-in">Sign in</Link>
      <Link className="button" href="/sign-up">
        Get started
      </Link>
    </>
  );
}
