import Link from 'next/link';

import { formatPrice, PLANS } from '../app/site.js';
import type { LimbPoseName } from '@sunny/character';

import { PeekingSunny } from './cameo/peeking-sunny.js';
import { SunnyCameo } from './cameo/sunny-cameo.js';
import { Hills } from './hills.js';
import { Icon } from './icons.js';

/** The top of an inner page: eyebrow, headline, lede, and the hills beneath. */
export function PageIntro({
  eyebrow,
  title,
  lede,
  cameo,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  /** Sunny beside the headline: a pose, what Sunny does, and what Sunny says. */
  cameo?: IntroCameo;
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
        {cameo ? (
          <div className="intro-cameo">
            <SunnyCameo
              pose={cameo.pose}
              sequence={cameo.sequence}
              size={150}
              bubble={cameo.say}
              bubbleSide="left"
              priority={3}
            />
          </div>
        ) : null}
      </section>
      <Hills />
    </>
  );
}

export interface IntroCameo {
  pose: LimbPoseName;
  sequence?: string;
  say: string;
}

export interface Feature {
  icon: string;
  title: string;
  body: string;
}

export function FeatureGrid({ features }: { features: readonly Feature[] }): React.JSX.Element {
  return (
    <ul className="feature-grid">
      {features.map((f, i) => (
        <li className={`card feature${i === 1 ? ' has-peek' : ''}`} key={f.title}>
          {i === 1 ? <PeekingSunny bubble="Psst — I do all of these. At once." /> : null}
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

export interface StepCameo {
  pose: LimbPoseName;
  sequence: string;
  say: string;
}

/** The home page's three steps, acted out. */
const STEP_CAMEOS: readonly StepCameo[] = [
  { pose: 'point', sequence: 'guiding-point', say: 'Copy, paste, done. I’ll take it from here.' },
  { pose: 'idea', sequence: 'thinking-eureka', say: 'Teach me once — I never forget a warranty.' },
  { pose: 'cheer', sequence: 'celebrate-bounce', say: 'Leads, served warm.' },
];

export function Steps({
  steps,
  cameos = STEP_CAMEOS,
}: {
  steps: readonly { title: string; body: string }[];
  /** Sunny acting out each step (by position); pass `[]` for none. */
  cameos?: readonly StepCameo[];
}): React.JSX.Element {
  return (
    <ol className="steps">
      {steps.map((step, i) => (
        <li className="card" key={step.title}>
          {cameos[i] ? (
            <span className="step-cameo">
              <SunnyCameo
                pose={cameos[i].pose}
                sequence={cameos[i].sequence}
                size={92}
                bubble={cameos[i].say}
                bubbleSide="left"
                bubbleOn="hover"
              />
            </span>
          ) : null}
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
          {plan.highlighted ? (
            <span className="plan-cameo">
              <SunnyCameo
                pose="hips"
                sequence="balloon-sway"
                loop
                size={120}
                bubble="My favourite. Don’t tell the others."
                bubbleSide="left"
                priority={2}
              />
            </span>
          ) : null}
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
    <section className="cta-band">
      <div className="wrap">
        <span className="cta-cameo">
          <SunnyCameo
            pose="point"
            sequence="guiding-point"
            size={130}
            bubble="Go on — it’s free to try."
            bubbleSide="top"
            priority={2}
          />
        </span>
        <div className="cta-bubbles" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
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
    </section>
  );
}
