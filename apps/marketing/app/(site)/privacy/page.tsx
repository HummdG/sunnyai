import type { Metadata } from 'next';

import { PrivacyScene } from '../../../components/scenes/pages.js';
import { PageIntro } from '../../../components/blocks.js';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How Sunny handles the information visitors and installers share.',
};

export default function PrivacyPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Privacy"
        title="Your visitors’ trust comes first"
        lede="A plain-English summary of how Sunny handles personal information. Our full privacy policy is published here before Sunny opens to customers."
        scene={<PrivacyScene />}
      />
      <section className="section">
        <div className="wrap prose">
          <h2>What Sunny collects</h2>
          <p>
            When a visitor chats with Sunny on an installer’s website, Sunny keeps the conversation
            so the installer can follow up and so the visitor can pick up where they left off. If
            the visitor chooses to share contact details, Sunny records them along with the answers
            they gave.
          </p>
          <h2>Consent</h2>
          <p>
            Contact details are only passed to the installer when the visitor explicitly agrees.
            Visitors can review and correct what they have shared before anything is sent.
          </p>
          <h2>How long information is kept</h2>
          <p>
            Conversations and leads are kept for a fixed retention period and then deleted
            automatically. Installers can delete a lead at any time.
          </p>
          <h2>What Sunny never does</h2>
          <ul>
            <li>Read the cookies, passwords or other data of the website it sits on.</li>
            <li>Send personal information to analytics tools.</li>
            <li>Share one installer’s data with another.</li>
          </ul>
          <h2>Your rights</h2>
          <p>
            Under UK GDPR you can ask for a copy of your information, ask for it to be corrected, or
            ask for it to be deleted. If you chatted with Sunny on an installer’s website, contact
            that installer, who controls your information.
          </p>
        </div>
      </section>
    </main>
  );
}
