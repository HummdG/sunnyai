import type { Metadata } from 'next';

import { CtaBand, FeatureGrid, PageIntro } from '../../../components/blocks.js';

export const metadata: Metadata = {
  title: 'Product',
  description:
    'What Sunny does for solar installers: grounded answers, qualification, recommendations and leads.',
};

const CONVERSATION = [
  {
    icon: 'chat',
    title: 'Grounded answers',
    body: 'Sunny answers from the documents and product details you provide. When it does not know, it says so and offers to put the visitor in touch with your team.',
  },
  {
    icon: 'check',
    title: 'Natural qualification',
    body: 'Visitors can share several details at once. Sunny picks them up, never asks twice, and lets them review and correct their answers before anything is sent.',
  },
  {
    icon: 'battery',
    title: 'Package recommendations',
    body: 'Sunny filters your catalogue for compatible systems, remembers requests like “add a battery” or “something cheaper”, and explains why each option fits.',
  },
  {
    icon: 'inbox',
    title: 'Leads with context',
    body: 'Each lead includes contact details, explicit consent, the answers gathered and the full conversation, so your first call starts where Sunny left off.',
  },
] as const;

const TRUST = [
  {
    icon: 'shield',
    title: 'Clear about estimates',
    body: 'Prices from your catalogue are shown as yours; anything indicative is labelled as an estimate that needs a survey. Sunny never promises savings or grants.',
  },
  {
    icon: 'palette',
    title: 'Looks like your company',
    body: 'Your name, your greeting, your brand colour. Sunny fits into your website and leaves your own styles untouched.',
  },
  {
    icon: 'globe',
    title: 'Fast and light',
    body: 'The assistant loads in the background after your page, so your site stays quick. If Sunny is ever unavailable, your website keeps working as normal.',
  },
  {
    icon: 'people',
    title: 'Accessible to everyone',
    body: 'Full keyboard support, screen-reader announcements and a calmer experience for visitors who prefer reduced motion.',
  },
] as const;

export default function ProductPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Product"
        title="A sales assistant that never misses an enquiry"
        lede="Sunny greets your visitors, answers their questions, suggests the right system and turns interest into a lead your team can call."
      />
      <section className="section" data-sunny-act="book">
        <div className="wrap">
          <h2>In every conversation</h2>
          <FeatureGrid features={CONVERSATION} />
        </div>
      </section>
      <section className="section tinted" data-sunny-act="magnifier">
        <div className="wrap">
          <h2>Built to earn your visitors’ trust</h2>
          <FeatureGrid features={TRUST} />
        </div>
      </section>
      <CtaBand />
    </main>
  );
}
