import type { Metadata } from 'next';

import { CtaBand, PageIntro, Steps, type StepCameo } from '../../../components/blocks.js';
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

const SETUP_CAMEOS: readonly StepCameo[] = [
  { pose: 'wave', sequence: 'listening-perk', say: 'Hello, new colleague!' },
  { pose: 'chin', sequence: 'thinking-whirr', say: 'Spec sheets? Warranties? Feed me.' },
  { pose: 'thumbsUp', sequence: 'cool-shades', say: 'Your colours. My good looks.' },
  { pose: 'point', sequence: 'guiding-point', say: 'One line. That’s genuinely it.' },
];

const VISIT_CAMEOS: readonly StepCameo[] = [
  { pose: 'wave', sequence: 'listening-perk', say: 'I always say hello first.' },
  {
    pose: 'idea',
    sequence: 'thinking-eureka',
    say: 'Answers from your documents, not my imagination.',
  },
  { pose: 'point', sequence: 'guiding-point', say: 'Three options, all from your price list.' },
  { pose: 'cheer', sequence: 'celebrate-bounce', say: 'A lead! With the whole chat attached.' },
];

export default function HowItWorksPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="How it works"
        title="From one line of code to your next customer"
        lede="Setting Sunny up takes four steps. After that, every visitor gets a helpful conversation and every serious one becomes a lead."

        cameo={{
          pose: 'point',
          sequence: 'guiding-point',
          say: 'Four steps. I counted them myself.',
        }}
      />
      <section className="section">
        <div className="wrap">
          <h2>Setting up</h2>
          <Steps steps={SETUP} cameos={SETUP_CAMEOS} />
          <h3 className="snippet-title">The only code you add</h3>
          <pre className="snippet standalone">
            <code>{SNIPPET}</code>
          </pre>
        </div>
      </section>
      <section className="section tinted">
        <div className="wrap">
          <h2>What your visitors experience</h2>
          <Steps steps={VISIT} cameos={VISIT_CAMEOS} />
        </div>
      </section>
      <CtaBand />
    </main>
  );
}
