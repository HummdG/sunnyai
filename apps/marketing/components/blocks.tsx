import Link from 'next/link';

import { formatPrice, PLANS } from '../app/site.js';

import { Hills } from './hills.js';
import { Icon } from './icons.js';
import { CtaRays } from './sun/cta-rays.js';

/**
 * The top of an inner page: eyebrow, headline, lede, and the hills beneath.
 * No Sunny of its own -- the site's one Sunny, the guide, is already on screen.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <section className="page-intro">
        <div className="wrap">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          {children}
        </div>
      </section>
      <Hills />
    </>
  );
}

export interface Feature {
  icon: string;
  title: string;
  body: string;
}

export function FeatureGrid({ features }: { features: readonly Feature[] }): React.JSX.Element {
  return (
    <ul className="feature-grid">
      {features.map((f) => (
        <li className="card feature" key={f.title}>
          <span className="feature-icon">
            <Icon name={f.icon} />
          </span>
          <h3>{f.title}</h3>
          <p>{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function Steps({
  steps,
}: {
  steps: readonly { title: string; body: string }[];
}): React.JSX.Element {
  return (
    <ol className="steps">
      {steps.map((step, i) => (
        <li className="card" key={step.title}>
          <span className="step-number" aria-hidden="true">
            {i + 1}
          </span>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function PricingCards(): React.JSX.Element {
  return (
    <ul className="plans">
      {PLANS.map((plan) => (
        <li className={`card plan${plan.highlighted ? ' highlighted' : ''}`} key={plan.name}>
          {plan.highlighted ? <span className="plan-badge">Most popular</span> : null}
          <h3>{plan.name}</h3>
          <p className="plan-price">
            <strong>{formatPrice(plan.monthly)}</strong>
            <span>/month</span>
          </p>
          <p className="plan-summary">{plan.summary}</p>
          <ul className="plan-features">
            {plan.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <Link className={`button${plan.highlighted ? '' : ' secondary'}`} href="/sign-up">
            Choose {plan.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CtaBand({
  title = 'Put Sunny to work on your website',
  body = 'One line of code, your colours, your products. Your next enquiry could be talking to Sunny this week.',
}: {
  title?: string;
  body?: string;
}): React.JSX.Element {
  return (
    <section className="cta-band" data-sunny-act="cheer">
      <div className="wrap">
        <div className="cta-bubbles" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="actions">
          <CtaRays>
            <Link className="button inverse" href="/sign-up">
              Get started
            </Link>
          </CtaRays>
          <Link className="button ghost" href="/how-it-works">
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
