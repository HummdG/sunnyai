'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import {
  WAITLIST_CONSENT_VERSION,
  WAITLIST_CONSENT_WORDINGS,
} from '@sunny/contracts/waitlist-wording';

import { API_URL } from '../app/config.js';

type State =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'joined' } | { kind: 'failed'; message: string };

/**
 * The home page's waitlist form, posting to the API's `POST /v1/waitlist`.
 *
 * The consent box is the wording the API records (`WAITLIST_CONSENT_WORDINGS`),
 * read from the contract rather than restated, so what a person sees is exactly
 * what their entry says they agreed to.
 */
export function WaitlistForm(): React.JSX.Element {
  const ids = { email: useId(), company: useId(), consent: useId(), status: useId() };
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  if (state.kind === 'joined') {
    return (
      <div className="waitlist-done" role="status">
        <p className="waitlist-done-title">You&rsquo;re on the list.</p>
        <p>
          We&rsquo;ll email {email.trim()} when Sunny is ready for your business. Want to try it
          now? <Link href="/sign-up">Create an account</Link>.
        </p>
      </div>
    );
  }

  return (
    <form
      className="waitlist-form"
      aria-describedby={ids.status}
      onSubmit={(event) => {
        event.preventDefault();
        setState({ kind: 'sending' });
        fetch(`${API_URL}/v1/waitlist`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            ...(company.trim() ? { company } : {}),
            consent,
          }),
        })
          .then((res) => {
            if (res.ok) return setState({ kind: 'joined' });
            setState({
              kind: 'failed',
              message:
                res.status === 429
                  ? 'Too many tries from here. Please wait a minute and try again.'
                  : res.status === 400
                    ? 'Please check your email address.'
                    : 'We couldn’t add you just now. Please try again in a moment.',
            });
          })
          .catch(() =>
            setState({
              kind: 'failed',
              message:
                'We couldn’t reach Sunny just now. Please check your connection and try again.',
            }),
          );
      }}
    >
      <div className="waitlist-fields">
        <div className="waitlist-field">
          <label htmlFor={ids.email}>Work email</label>
          <input
            id={ids.email}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="waitlist-field">
          <label htmlFor={ids.company}>
            Company <span className="optional">(optional)</span>
          </label>
          <input
            id={ids.company}
            type="text"
            autoComplete="organization"
            maxLength={120}
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
        </div>
      </div>
      <div className="waitlist-consent">
        <input
          id={ids.consent}
          type="checkbox"
          required
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <label htmlFor={ids.consent}>
          {WAITLIST_CONSENT_WORDINGS[WAITLIST_CONSENT_VERSION]} See our{' '}
          <Link href="/privacy#waitlist">privacy policy</Link>.
        </label>
      </div>
      <button className="button" type="submit" disabled={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Adding you…' : 'Join the waitlist'}
      </button>
      <p id={ids.status} className="waitlist-error" role="alert">
        {state.kind === 'failed' ? state.message : ''}
      </p>
    </form>
  );
}
