/**
 * Sign-in from the website, in the browser.
 *
 * Firebase Authentication proves who someone is (email + password with a
 * verified address, Google, or a passwordless email link); the proof is then
 * traded at `/api/session` for a Sunny session in an HttpOnly cookie. Firebase
 * is imported lazily, so marketing pages never download it.
 *
 * Local development without a Firebase project uses the API's dev sign-in
 * (refused in production) through the same `/api/session` route.
 */
import type { Auth, User } from 'firebase/auth';

import { api, ApiFailure } from './portal-api.js';

const CONFIG = {
  apiKey: process.env['NEXT_PUBLIC_FIREBASE_API_KEY'] ?? '',
  authDomain: process.env['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'] ?? '',
  projectId: process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] ?? '',
};
const EMULATOR = process.env['NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST'] ?? '';

/** Whether real (or emulated) Firebase sign-in is configured for this build. */
export const firebaseEnabled = CONFIG.apiKey !== '' && CONFIG.projectId !== '';

const LINK_EMAIL_KEY = 'sunny.signin.email';

export class AuthProblem extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let authPromise: Promise<Auth> | null = null;

/** The Firebase Auth instance, created on first use. */
export function firebaseAuth(): Promise<Auth> {
  if (!firebaseEnabled) {
    return Promise.reject(new AuthProblem('not-configured', 'Sign-in is not configured.'));
  }
  authPromise ??= (async () => {
    const [{ getApps, initializeApp }, auth] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app = getApps()[0] ?? initializeApp(CONFIG);
    const instance = auth.getAuth(app);
    if (EMULATOR) {
      auth.connectAuthEmulator(instance, `http://${EMULATOR}`, { disableWarnings: true });
    }
    // Firebase restores a signed-in user from IndexedDB asynchronously; until
    // it has, `currentUser` is null. Without this wait, opening the
    // verification link in a fresh page confirmed the email but never started
    // the session (found by tests/e2e/auth-firebase.spec.ts).
    await instance.authStateReady();
    return instance;
  })();
  return authPromise;
}

/** Plain-English messages for the Firebase errors people actually hit. */
export function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential':
      'That email and password don’t match. Try again, or reset your password.',
    'auth/wrong-password':
      'That email and password don’t match. Try again, or reset your password.',
    'auth/user-not-found':
      'That email and password don’t match. Try again, or reset your password.',
    'auth/email-already-in-use': 'There’s already an account with that email. Sign in instead.',
    'auth/weak-password': 'Choose a password of at least 8 characters.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute, then try again.',
    'auth/popup-closed-by-user': 'The Google window was closed before you finished.',
    'auth/expired-action-code': 'That link has expired. Ask for a new one.',
    'auth/invalid-action-code':
      'That link has already been used or isn’t valid. Ask for a new one.',
    'auth/requires-recent-login': 'For your security, sign in again before changing this.',
    'auth/network-request-failed': 'We couldn’t reach the sign-in service. Check your connection.',
  };
  if (map[code]) return map[code];
  if (error instanceof AuthProblem || error instanceof ApiFailure) return error.message;
  return 'Something stopped the sign-in. Try again in a moment.';
}

// ── the Sunny session ───────────────────────────────────────────────────────

async function postSession(body: Record<string, string>): Promise<void> {
  const response = await fetch('/api/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new AuthProblem(
      'session',
      failure?.error?.message ?? 'We couldn’t start your session. Try again.',
    );
  }
}

async function startSessionFor(user: User): Promise<void> {
  if (!user.emailVerified) {
    throw new AuthProblem('unverified', 'Confirm your email address first. Check your inbox.');
  }
  await postSession({ idToken: await user.getIdToken(true) });
}

/** Local development only: the API refuses this unless dev sign-in is on. */
export async function devSignIn(email: string): Promise<void> {
  await postSession({ devEmail: email });
}

export async function authConfig(): Promise<{ devAuth: boolean }> {
  try {
    return await api<{ devAuth: boolean }>('/v1/portal/auth-config');
  } catch {
    return { devAuth: false };
  }
}

// ── sign-up and sign-in ─────────────────────────────────────────────────────

function continueUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

/**
 * Where the verification email's link carries on to. The page the person was
 * heading for travels inside it as `next`, so following the link from the
 * email, in a new tab, still ends where they meant to go: an invited colleague
 * back on their invitation rather than in the owner's setup wizard.
 */
function verifyContinueUrl(next: string): string {
  return continueUrl(`/verify-email?done=1&next=${encodeURIComponent(next)}`);
}

/** The page a verification link should finish on: `next` if it is one of ours. */
export function nextFromContinueUrl(continueUrlParam: string | null, fallback: string): string {
  if (!continueUrlParam) return fallback;
  try {
    const url = new URL(continueUrlParam);
    if (url.origin !== window.location.origin) return fallback;
    const next = url.searchParams.get('next') ?? '';
    return next.startsWith('/') && !next.startsWith('//') ? next : fallback;
  } catch {
    return fallback;
  }
}

export async function signUpWithPassword(
  email: string,
  password: string,
  next = '/dashboard/onboarding',
): Promise<void> {
  const auth = await firebaseAuth();
  const { createUserWithEmailAndPassword, sendEmailVerification } = await import('firebase/auth');
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(user, { url: verifyContinueUrl(next) });
}

export async function resendVerification(next = '/dashboard/onboarding'): Promise<void> {
  const auth = await firebaseAuth();
  const { sendEmailVerification } = await import('firebase/auth');
  if (!auth.currentUser) throw new AuthProblem('signed-out', 'Sign in again to resend the email.');
  await sendEmailVerification(auth.currentUser, { url: verifyContinueUrl(next) });
}

/** After the verification link: refresh the account and start the session. */
export async function finishVerification(): Promise<boolean> {
  const auth = await firebaseAuth();
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  if (!user.emailVerified) return false;
  await startSessionFor(user);
  return true;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const auth = await firebaseAuth();
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  await startSessionFor(user);
}

export async function signInWithGoogle(): Promise<void> {
  const auth = await firebaseAuth();
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
  await startSessionFor(user);
}

export async function sendMagicLink(email: string): Promise<void> {
  const auth = await firebaseAuth();
  const { sendSignInLinkToEmail } = await import('firebase/auth');
  await sendSignInLinkToEmail(auth, email, {
    url: continueUrl('/auth/action?mode=signIn'),
    handleCodeInApp: true,
  });
  // Not a credential: lets the link finish without retyping the address.
  window.localStorage.setItem(LINK_EMAIL_KEY, email);
}

export async function isMagicLink(href: string): Promise<boolean> {
  const auth = await firebaseAuth();
  const { isSignInWithEmailLink } = await import('firebase/auth');
  return isSignInWithEmailLink(auth, href);
}

export function rememberedLinkEmail(): string {
  return window.localStorage.getItem(LINK_EMAIL_KEY) ?? '';
}

export async function finishMagicLink(email: string, href: string): Promise<void> {
  const auth = await firebaseAuth();
  const { signInWithEmailLink } = await import('firebase/auth');
  const { user } = await signInWithEmailLink(auth, email, href);
  window.localStorage.removeItem(LINK_EMAIL_KEY);
  await startSessionFor(user);
}

// ── passwords and verification codes from email links ───────────────────────

export async function sendPasswordReset(email: string): Promise<void> {
  const auth = await firebaseAuth();
  const { sendPasswordResetEmail } = await import('firebase/auth');
  await sendPasswordResetEmail(auth, email, { url: continueUrl('/sign-in?reset=1') });
}

export async function resetEmailFor(oobCode: string): Promise<string> {
  const auth = await firebaseAuth();
  const { verifyPasswordResetCode } = await import('firebase/auth');
  return await verifyPasswordResetCode(auth, oobCode);
}

export async function confirmNewPassword(oobCode: string, password: string): Promise<void> {
  const auth = await firebaseAuth();
  const { confirmPasswordReset } = await import('firebase/auth');
  await confirmPasswordReset(auth, oobCode, password);
}

export async function applyEmailCode(oobCode: string): Promise<void> {
  const auth = await firebaseAuth();
  const { applyActionCode } = await import('firebase/auth');
  await applyActionCode(auth, oobCode);
}

// ── account ─────────────────────────────────────────────────────────────────

export async function changePassword(current: string, next: string): Promise<void> {
  const auth = await firebaseAuth();
  const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } =
    await import('firebase/auth');
  const user = auth.currentUser;
  if (!user?.email) {
    throw new AuthProblem('signed-out', 'Sign in again on this device to change your password.');
  }
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
  await updatePassword(user, next);
}

export async function changeEmail(next: string): Promise<void> {
  const auth = await firebaseAuth();
  const { verifyBeforeUpdateEmail } = await import('firebase/auth');
  if (!auth.currentUser) {
    throw new AuthProblem('signed-out', 'Sign in again on this device to change your email.');
  }
  await verifyBeforeUpdateEmail(auth.currentUser, next, { url: continueUrl('/sign-in') });
}

/** Sign out of this browser. */
export async function signOut(): Promise<void> {
  await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
  if (firebaseEnabled && authPromise) {
    const [auth, { signOut: firebaseSignOut }] = await Promise.all([
      authPromise,
      import('firebase/auth'),
    ]);
    await firebaseSignOut(auth).catch(() => null);
  }
}

/** Every session this person has, on every device, ends now. */
export async function signOutEverywhere(): Promise<void> {
  await api('/v1/portal/sessions/revoke', { method: 'POST', body: {} });
  await signOut();
}

/** Keep the session alive while the dashboard is open. */
export async function refreshSession(): Promise<boolean> {
  const response = await fetch('/api/session/refresh', {
    method: 'POST',
    credentials: 'same-origin',
  });
  return response.ok;
}

/** The public expiry cookie (not a credential), for UI decisions only. */
export function sessionExpiresAt(): number | null {
  const match = /(?:^|;\s*)sunny_signed_in=(\d+)/.exec(document.cookie);
  return match ? Number(match[1]) : null;
}
