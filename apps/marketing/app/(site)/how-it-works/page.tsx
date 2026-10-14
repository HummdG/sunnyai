import type { Metadata } from 'next';

import { CtaBand, PageIntro } from '../../../components/blocks.js';
import { HowItWorksScene, SETUP_PANELS, VISIT_PANELS } from '../../../components/scenes/pages.js';
import { Storyboard } from '../../../components/scenes/storyboard.js';
import { PUBLIC_ID } from '../../config.js';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'From one line of code to qualified solar leads.',
};

const SETUP = [
  {
    title: 'Create your account',
    body: 'Tell us your company name and the website Sunny will live on. Only the domains you approve can show your assistant.',
  },
  {
    title: 'Add your knowledge',
    body: 'Upload your product catalogue and the documents you already give customers: warranties, finance options, service areas and FAQs.',
  },
  {
    title: 'Make Sunny yours',
    body: 'Set your colour, greeting and suggested questions, choose how lively Sunny should be, and preview it before going live.',
  },
  {
    title: 'Paste one line',
    body: 'Add the script tag to your site. Sunny loads in the background and appears in the corner of the pages you choose.',
  },
] as const;

const VISIT = [
  {
    title: 'A visitor says hello',
    body: 'They tap Sunny, who bubbles open into a chat and offers a few helpful questions to start with.',
  },
  {
    title: 'Sunny answers and asks',
    body: 'Questions are answered from your documents. Along the way Sunny gathers the details your team needs, without it feeling like a form.',
  },
  {
    title: 'Options that fit',
    body: 'Sunny suggests packages from your catalogue that suit the home, and is clear about what a survey needs to confirm.',
  },
  {
    title: 'A lead lands with you',
    body: 'With the visitor’s consent, their details, answers and conversation are sent to your team, ready for a call.',
  },
] as const;

const SNIPPET = `<script
  src="https://cdn.sunny.ai/sunny-widget.js"
  data-widget-id="${PUBLIC_ID}"
  async
></script>`;

export default function HowItWorksPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="How it works"
        title="From one line of code to your next customer"
        lede="Setting Sunny up takes four steps. After that, every visitor gets a helpful conversation and every serious one becomes a lead."
        scene={<HowItWorksScene />}
      />
      <section className="section">
        <div className="wrap">
          <span className="eyebrow">Setting up</span>
          <h2>Four steps, about an afternoon</h2>
          <Storyboard steps={SETUP} panels={SETUP_PANELS} />
          <h3 className="snippet-title">The only code you add</h3>
          <pre className="snippet standalone">
            <code>{SNIPPET}</code>
          </pre>
        </div>
      </section>
      <section className="section tinted">
        <div className="wrap">
          <span className="eyebrow">For your visitors</span>
          <h2>What your visitors experience</h2>
          <Storyboard steps={VISIT} panels={VISIT_PANELS} />
        </div>
      </section>
      <CtaBand />
    </main>
  );
}
