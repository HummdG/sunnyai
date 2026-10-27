import Link from 'next/link';

import { CONTACT_SALES_HREF, formatPrice, PLANS, SHOW_PLAN_PRICES } from '../app/site.js';

import { Icon } from './icons.js';
import { SunriseScene } from './scenes/home.js';

/**
 * The top of an inner page: eyebrow, headline and lede, beside the page's own
 * illustrated scene when it has one.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
  scene,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  /** The page's illustration: a `Scene` that shows what the page is about. */
  scene?: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="page-intro">
      <div className={`wrap${scene ? ' has-scene' : ''}`}>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          {children}
        </div>
        {scene}
      </div>
    </section>
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

export function PricingCards(): React.JSX.Element {
  return (
    <ul className="plans">
      {PLANS.map((plan) => (
        <li className={`card plan${plan.highlighted ? ' highlighted' : ''}`} key={plan.name}>
          {plan.highlighted ? <span className="plan-badge">Most popular</span> : null}
          <h3>{plan.name}</h3>
          {SHOW_PLAN_PRICES ? (
            <p className="plan-price">
              <strong>{formatPrice(plan.monthly)}</strong>
              <span>/month</span>
            </p>
          ) : (
            <p className="plan-price plan-price-contact">
              <strong>Contact sales</strong>
            </p>
          )}
          <p className="plan-summary">{plan.summary}</p>
          <ul className="plan-features">
            {plan.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <Link
            className={`button${plan.highlighted ? '' : ' secondary'}`}
            href={SHOW_PLAN_PRICES ? '/sign-up' : CONTACT_SALES_HREF}
          >
            {SHOW_PLAN_PRICES ? `Choose ${plan.name}` : 'Contact sales'}
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
    <section className="cta-band">
      <div className="wrap">
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
          <div className="actions">
            <Link className="button inverse" href="/sign-up">
              Get started
            </Link>
            <Link className="button ghost" href="/how-it-works">
              See how it works
            </Link>
          </div>
        </div>
        <SunriseScene />
      </div>
    </section>
  );
}
