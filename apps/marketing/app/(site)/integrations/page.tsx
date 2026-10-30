import type { Metadata } from 'next';

import { IntegrationsScene } from '../../../components/scenes/pages.js';
import { CtaBand, PageIntro } from '../../../components/blocks.js';
import { Icon } from '../../../components/icons.js';
import { pageMetadata } from '../../seo.js';

export const metadata: Metadata = pageMetadata({
  title: 'Integrations',
  description: 'Sunny works with the website and tools you already have.',
  path: '/integrations',
});

interface Integration {
  icon: string;
  name: string;
  body: string;
  status: 'available' | 'soon';
}

const INTEGRATIONS: readonly Integration[] = [
  {
    icon: 'globe',
    name: 'Any website',
    body: 'Plain HTML, WordPress, React and Next.js sites. One script tag, no plugin required.',
    status: 'available',
  },
  {
    icon: 'battery',
    name: 'Your product catalogue',
    body: 'Upload panels, inverters, batteries and packages as a spreadsheet. Sunny recommends only what you sell.',
    status: 'available',
  },
  {
    icon: 'doc',
    name: 'Your documents',
    body: 'Warranties, finance options, FAQs and service areas become the knowledge Sunny answers from.',
    status: 'available',
  },
  {
    icon: 'sun',
    name: 'SunScan property assessments',
    body: 'Start a roof assessment from the conversation and share the result with your visitor.',
    status: 'soon',
  },
  {
    icon: 'doc',
    name: 'Google Drive',
    body: 'Keep Sunny’s knowledge in sync with the folders your team already maintains.',
    status: 'soon',
  },
  {
    icon: 'inbox',
    name: 'Email drafts',
    body: 'Sunny prepares follow-up emails for your team to review and send.',
    status: 'soon',
  },
];

export default function IntegrationsPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Integrations"
        title="Fits the way you already work"
        lede="Sunny drops into your existing website and learns from the catalogue and documents you already have."
        scene={<IntegrationsScene />}
      />
      <section className="section">
        <div className="wrap">
          <ul className="integration-grid">
            {INTEGRATIONS.map((item) => (
              <li className="card integration" key={item.name}>
                <span className="feature-icon">
                  <Icon name={item.icon} />
                </span>
                <div>
                  <h3>
                    {item.name}
                    {item.status === 'soon' ? <span className="tag">Coming soon</span> : null}
                  </h3>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <CtaBand />
    </main>
  );
}
