import type { Metadata } from 'next';

import { CtaBand, PageIntro, PricingCards } from '../../../components/blocks.js';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Simple monthly plans for solar installers of every size.',
};

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
    q: 'Do prices include VAT?',
    a: 'Prices are shown excluding VAT, which is added at checkout where it applies.',
  },
] as const;

export default function PricingPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Pricing"
        title="Plans that grow with your business"
        lede="Every plan includes the full Sunny assistant and character. Pick the one that matches the size of your team."

        cameo={{
          pose: 'thumbsUp',
          sequence: 'cool-shades',
          say: 'Works nights and weekends. Never asks for a pay rise.',
        }}
      />
      <section className="section" id="pricing">
        <div className="wrap">
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
