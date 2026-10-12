# Sign-in and sessions (website + dashboard)

The website and the installer dashboard are one Next.js app (`apps/marketing`):
the public site at `/`, sign-in pages at `/sign-in`, `/sign-up`,
`/forgot-password`, `/verify-email`, `/auth/action`, `/invite/:token`, and the
dashboard at `/dashboard/*`. The API (`apps/api`) stays a separate service.

## How a session works

1. The browser proves who someone is with **Firebase Authentication**
   (email + password with a verified address, Google, or a passwordless email
   link) — or, locally only, the API's development sign-in.
2. It posts that proof to the app's `POST /api/session`. The app forwards it to
   the API's `POST /v1/portal/session`, which verifies it (Firebase ID token
   signature, audience, issuer, expiry, verified email) and returns a **Sunny
   session token**: HMAC-SHA256 with `SESSION_SECRET`, valid for one hour.
3. The app stores it in an **HttpOnly, SameSite=Lax** cookie (`Secure` in
   production). Page script never sees it. A second cookie holds only the expiry
   time, so the header can show "Dashboard" and the dashboard can refresh in time.
4. Dashboard calls go to the same-origin proxy `/api/portal/v1/...`, which adds
   the session as a bearer token. Only `v1/portal/*` and `v1/sunscan/*` are
   reachable; state-changing calls must be same-origin **and** carry the
   `x-sunny-csrf: 1` header.
5. `proxy.ts` sends signed-out visitors from `/dashboard/*` to
   `/sign-in?next=…`; `next` is honoured only for same-site paths.
6. The dashboard refreshes the session before it expires
   (`POST /api/session/refresh` → `POST /v1/portal/session/refresh`); a chain of
   refreshes ends seven days after the original sign-in.
7. **Sign out** clears the cookies and signs out of Firebase. **Sign out
   everywhere** (`POST /v1/portal/sessions/revoke`) moves a per-person epoch
   forward; every session issued before it is refused by the API.

Roles (`owner`, `admin`, `sales`, `viewer`) are still resolved by the API from
memberships on every request.

## Team invitations

Adding a colleague (`POST /v1/portal/tenants/:id/members`) creates their
membership and returns an `inviteUrl` (`/invite/<signed token>`, 14 days). The
page previews the invitation (`GET /v1/portal/invite?token=`) and accepts it
(`POST /v1/portal/invite/accept`) only when the signed-in email is the invited one.

## Owner setup (Firebase)

1. Create a Firebase project (or use the Google Cloud project) and enable
   **Authentication** with the **Email/Password** provider (tick **Email link
   (passwordless sign-in)**) and the **Google** provider.
2. **Authorised domains:** add the website's domain (e.g. `sunny.ai`) and any
   staging domain.
3. **Templates → Customise action URL:** `https://<site>/auth/action`, so
   verification and password-reset emails land on the app's own pages.
4. Environment:
   - App (build time): `NEXT_PUBLIC_FIREBASE_API_KEY`,
     `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
     `NEXT_PUBLIC_SUNNY_API_URL`; (run time) `SUNNY_API_URL`.
   - API: `FIREBASE_PROJECT_ID`, `SESSION_SECRET` (a long random secret),
     `SUNNY_DASHBOARD_URL` (the website's origin), `WIDGET_ALLOWED_ORIGINS`
     (the website's own origin(s)).

## Local development and tests

- Without Firebase settings, set `SUNNY_DEV_AUTH=1` on the API: the sign-in
  pages show an email-only development form (refused when `NODE_ENV=production`).
- `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` (app) and
  `FIREBASE_AUTH_EMULATOR_HOST` (API, ignored in production) point both at the
  Firebase Auth emulator, whose unsigned tokens the API then accepts.
- `tests/e2e/auth.spec.ts` covers the protected redirect, sign-up from the
  header, the HttpOnly cookie, sign-out, `next=` handling and the proxy's CSRF
  checks with development sign-in.

### The Firebase flows, against the Auth emulator

`tests/e2e/auth-firebase.spec.ts` runs the Firebase-only flows end to end:
email + password sign-up → verification link → onboarding; sign out and the
protected redirect; sign in again; a wrong password refused; forgot password →
reset link → sign in with the new password (the old one refused);
passwordless email-link sign-in; and Google sign-in through the emulator's
account chooser. Every signed-in step asserts the session cookie is HttpOnly
and SameSite=Lax and that nothing token-shaped is in `localStorage`.

```bash
npm run test:e2e:auth-firebase
```

That one command does everything (config: `tests/e2e/auth-firebase.config.ts`):

1. **Java** — `scripts/ensure-jre.mjs` downloads an Eclipse Temurin LTS JRE for
   this OS/architecture from the official Adoptium API, verifies the archive's
   SHA-256 against the checksum the API publishes, and extracts it to
   `.cache/jre/` (gitignored). Nothing is installed system-wide; it does nothing
   if a JRE is already there. `SUNNY_JAVA` overrides it.
2. **The emulator** — `scripts/auth-emulator.mjs` (also `npm run
test:auth-emulator` on its own) starts the Firebase Auth emulator from
   `firebase-tools` with `firebase.json` (Auth only, `127.0.0.1:9099`) for the
   project `demo-sunny`. A `demo-` project needs no Firebase account or
   credentials and never reaches Google.
3. **The API** on port 8898 with `FIREBASE_PROJECT_ID=demo-sunny` and
   `FIREBASE_AUTH_EMULATOR_HOST`, so it accepts the emulator's unsigned tokens —
   only outside production (`portal-session.test.ts` proves production refuses
   them whatever the environment says).
4. **The site** on port 4198, built into `apps/marketing/.next-auth-e2e` with
   the Firebase settings and the emulator host inlined, so a developer's own
   `.next` and servers on 4176/8787 are untouched.

The emails Firebase would send are read back from the emulator's REST API
(`/emulator/v1/projects/demo-sunny/oobCodes`) and each link is followed through
the site's own `/auth/action` page, exactly as the production action URL is.
The main Playwright config ignores this spec (`testIgnore`).

Writing this suite found one real bug: after a full page load Firebase
restores the signed-in user from IndexedDB asynchronously, so opening the
verification link confirmed the email but never started the session.
`firebaseAuth()` in `apps/marketing/lib/auth-client.ts` now waits for
`authStateReady()` before handing out the Auth instance.
