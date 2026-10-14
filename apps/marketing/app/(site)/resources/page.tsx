import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand, PageIntro } from '../../../components/blocks.js';

export const metadata: Metadata = {
  title: 'Resources',
  description: 'Guides and answers for installers getting started with Sunny.',
};

const GUIDES = [
  {
    title: 'Installing Sunny on your website',
    body: 'Where to paste the script tag on WordPress, plain HTML, React and Next.js sites.',
    href: '/how-it-works',
  },
  {
    title: 'Preparing your product catalogue',
    body: 'Which details to include for each panel, inverter, battery and package so recommendations are accurate.',
    href: '/how-it-works',
  },
  {
    title: 'Choosing Sunny’s personality',
    body: 'Colours, greetings and how lively Sunny should be on your site.',
    href: '/meet-sunny',
  },
] as const;

const FAQ = [
  {
    q: 'Will Sunny slow my website down?',
    a: 'Sunny loads in the background after your page has loaded, and your site keeps working even if Sunny is unavailable.',
  },
  {
    q: 'What happens when Sunny does not know an answer?',
    a: 'Sunny says so honestly and offers to pass the question to your team, rather than guessing.',
  },
  {
    q: 'Does Sunny quote prices?',
    a: 'Sunny can show prices from your own catalogue and labels anything else as an estimate that needs a survey to confirm.',
  },
  {
    q: 'How are visitors’ details handled?',
    a: 'Contact details are only shared with you when the visitor gives consent. See our privacy page for more.',
  },
] as const;

export default function ResourcesPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Resources"
        title="Everything you need to get started"
        lede="Practical guides for setting Sunny up, and answers to the questions installers ask most."
      />
      <section className="section" data-sunny-act="book">
        <div className="wrap">
          <h2>Guides</h2>
          <ul className="feature-grid three">
            {GUIDES.map((guide) => (
              <li className="card" key={guide.title}>
                <h3>{guide.title}</h3>
                <p>{guide.body}</p>
                <Link className="card-link" href={guide.href}>
                  Read more →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="section tinted" data-sunny-act="magnifier">
        <div className="wrap">
          <h2>Frequently asked questions</h2>
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
