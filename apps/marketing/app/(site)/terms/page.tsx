import type { Metadata } from 'next';

import { PageIntro } from '../../../components/blocks.js';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The principles behind Sunny’s terms of service.',
};

export default function TermsPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Terms"
        title="Terms of service"
        lede="The key principles of using Sunny. Full terms of service are published here before Sunny opens to customers."
      />
      <section className="section">
        <div className="wrap prose">
          <h2>Using Sunny</h2>
          <p>
            Sunny is a subscription service for solar installers. You choose a plan, add Sunny to
            the websites you own or manage, and can cancel at any time.
          </p>
          <h2>Your content stays yours</h2>
          <p>
            Your catalogue, documents and leads belong to you. We use them only to run Sunny for
            your business.
          </p>
          <h2>Estimates, not guarantees</h2>
          <p>
            Sunny gives indicative information to help visitors decide on next steps. Final prices,
            savings and system suitability are confirmed by you, the installer, after a survey.
          </p>
        </div>
      </section>
    </main>
  );
}
