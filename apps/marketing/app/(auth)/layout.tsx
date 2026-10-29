import Link from 'next/link';

import '../dashboard.css';
import '../dashboard-v2.css';
import '../auth.css';

import { AuthSunny } from '../../components/auth/auth-sunny.js';

/**
 * Sign-in, sign-up and account links. A calm form on the left; on the right
 * Sunny waves hello on the static hills (brand guidelines C2, E3). Reached
 * from the website header ("Sign in", "Get started").
 */
export default function AuthLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="dash auth-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main className="auth-main" id="main">
        <Link className="auth-brand" href="/" aria-label="Sunny home">
          <img src="/brand/sunny-logo-64.png" width={36} height={36} alt="" />
          <span>Sunny</span>
        </Link>
        <div className="auth-form">{children}</div>
        <p className="auth-legal small muted">
          By continuing you agree to our <Link href="/terms">terms</Link> and{' '}
          <Link href="/privacy">privacy notice</Link>.
        </p>
      </main>
      <aside className="auth-stage" aria-hidden="true">
        <AuthSunny />
        <p className="auth-stage-line">Your brightest employee is ready when you are.</p>
        <svg className="auth-hills" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path
            d="M0 220 C 240 150 480 260 720 210 C 960 160 1200 240 1440 190 L1440 320 L0 320 Z"
            fill="var(--sunny-brand-orange-pale)"
          />
          <path
            d="M0 260 C 260 210 520 300 780 255 C 1040 210 1260 280 1440 250 L1440 320 L0 320 Z"
            fill="var(--sunny-brand-orange-soft)"
          />
          <path
            d="M0 295 C 300 265 560 320 860 290 C 1120 265 1300 305 1440 290 L1440 320 L0 320 Z"
            fill="var(--sunny-brand-orange)"
          />
        </svg>
      </aside>
    </div>
  );
}
