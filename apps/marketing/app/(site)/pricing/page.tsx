import type { Metadata } from 'next';

import { PricingScene } from '../../../components/scenes/pages.js';
import { CtaBand, PageIntro, PricingCards } from '../../../components/blocks.js';
import { pageMetadata } from '../../seo.js';

export const metadata: Metadata = pageMetadata({
  title: 'Pricing',
  description: 'Plans for solar installers of every size. Contact sales for a price.',
  path: '/pricing',
});

const FAQ = [
  {
    q: 'Is there a setup fee?',
    a: 'No. Every plan includes setup help, your branding and the full Sunny character.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes. Move up or down at any time; changes apply from your next billing month.',
  },
  {
    q: 'Do my visitors need an account?',
    a: 'No. Visitors simply chat with Sunny on your website.',
  },
  {
    q: 'How much does it cost?',
    a: 'Contact sales and we will put together a price for the plan that suits your team.',
  },
] as const;

export default function PricingPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Pricing"
        title="Plans that grow with your business"
        lede="Every plan includes the full Sunny assistant and character. Pick the one that matches the size of your team."
        scene={<PricingScene />}
      />
      <section className="section" id="pricing">
        <div className="wrap">
          <span className="eyebrow">Plans</span>
          <h2>Pick the plan that fits</h2>
          <p className="intro">Start with Base, and add email or voice when you are ready.</p>
          <PricingCards />
        </div>
      </section>
      <section className="section tinted">
        <div className="wrap">
          <h2>Questions about pricing</h2>
          <dl className="faq">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <CtaBand />
    </main>
  );
}
