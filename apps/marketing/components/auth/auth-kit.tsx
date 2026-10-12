'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';

import {
  authConfig,
  devSignIn,
  firebaseEnabled,
  friendlyAuthError,
  signInWithGoogle,
} from '../../lib/auth-client.js';

/**
 * Where to go after signing in. Only same-site paths are honoured, so a
 * crafted `?next=https://evil.example` cannot bounce someone off-site.
 */
export function useNext(fallback = '/dashboard'): string {
  const params = useSearchParams();
  const next = params.get('next') ?? '';
  return next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

/** Whether this deployment offers Firebase sign-in, dev sign-in, or neither. */
export function useSignInMode(): 'firebase' | 'dev' | 'none' | 'loading' {
  const [mode, setMode] = useState<'firebase' | 'dev' | 'none' | 'loading'>(
    firebaseEnabled ? 'firebase' : 'loading',
  );
  useEffect(() => {
    if (firebaseEnabled) return;
    void authConfig().then((config) => setMode(config.devAuth ? 'dev' : 'none'));
  }, []);
  return mode;
}

export function AuthHeading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header className="auth-heading">
      <h1 id="auth-title">{title}</h1>
      {lead ? <p className="muted">{lead}</p> : null}
    </header>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p className="error-note" role="alert">
      <span className="status-icon" aria-hidden="true">
        !
      </span>
      {message}
    </p>
  ) : null;
}

export function FormNote({ children }: { children: ReactNode }) {
  return (
    <p className="ok-note" role="status">
      <span className="status-icon" aria-hidden="true">
        ✓
      </span>
      {children}
    </p>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-row">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          required
          minLength={autoComplete === 'new-password' ? 8 : undefined}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function EmailField({
  value,
  onChange,
  label = 'Work email',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="email"
        value={value}
        required
        autoComplete="email"
        inputMode="email"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function Divider({ children = 'or' }: { children?: string }) {
  return (
    <div className="auth-divider" role="separator">
      <span>{children}</span>
    </div>
  );
}

export function GoogleButton({ label, next }: { label: string; next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="button secondary google-button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          signInWithGoogle()
            .then(() => router.replace(next))
            .catch((failure: unknown) => {
              setError(friendlyAuthError(failure));
              setBusy(false);
            });
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
          />
        </svg>
        {busy ? 'Opening Google…' : label}
      </button>
      <FormError message={error} />
    </>
  );
}

/**
 * Local development without a Firebase project: the API's dev sign-in
 * (refused in production), through the same session cookie as the real thing.
 */
export function DevSignIn({ next, cta }: { next: string; cta: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        devSignIn(email)
          .then(() => router.replace(next))
          .catch((failure: unknown) => {
            setError(friendlyAuthError(failure));
            setBusy(false);
          });
      }}
    >
      <EmailField value={email} onChange={setEmail} />
      <FormError message={error} />
      <button className="button wide" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : cta}
      </button>
      <p className="small muted dev-note">
        Development sign-in is on: no password, and any address signs straight in. It is refused in
        production.
      </p>
    </form>
  );
}

export function NotConfigured() {
  return (
    <p className="warning-note" role="status">
      Sign-in isn’t set up on this deployment yet. If you run it, add the Firebase settings (see
      README_DEPLOY.md), or turn on development sign-in locally.
    </p>
  );
}
