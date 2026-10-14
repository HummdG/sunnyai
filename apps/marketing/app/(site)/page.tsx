import Link from 'next/link';
import type { JSX } from 'react';

import { CtaBand, FeatureGrid, PricingCards, Steps } from '../../components/blocks.js';
import { ColourSwitcher } from '../../components/colour-switcher.js';
import { OpenChatButton } from '../../components/open-chat.js';
import { HeroDock } from '../../components/sun/hero-dock.js';
import { RayDivider } from '../../components/sun/ray-divider.js';
import { PUBLIC_ID } from '../config.js';

const SNIPPET = `<script
  src="https://cdn.sunny.ai/sunny-widget.js"
  data-widget-id="${PUBLIC_ID}"
  async
></script>`;

const FEATURES = [
  {
    icon: 'chat',
    title: 'Answers, day and night',
    body: 'Sunny answers questions about panels, batteries and the installation process from your own documents, in your tone, whenever visitors are browsing.',
  },
  {
    icon: 'check',
    title: 'Qualifies every enquiry',
    body: 'Roof, ownership, timescale and budget are gathered naturally in conversation, so you know who is ready before you pick up the phone.',
  },
  {
    icon: 'sun',
    title: 'Recommends your packages',
    body: 'Sunny suggests systems from your own catalogue, checks what works together, and is clear about what is an estimate and what needs a survey.',
  },
  {
    icon: 'inbox',
    title: 'Hands over complete leads',
    body: 'Every lead arrives with contact details, consent, answers and the full conversation, ready for your team to follow up.',
  },
] as const;

const STEPS = [
  {
    title: 'Add one line to your site',
    body: 'Paste a single script tag. Sunny works on WordPress, plain HTML, React and Next.js sites without touching your design.',
  },
  {
    title: 'Teach Sunny your business',
    body: 'Upload your product catalogue and the documents your team already uses. Pick your colours and the questions you want asked.',
  },
  {
    title: 'Welcome your new leads',
    body: 'Sunny greets visitors, answers their questions and passes the ready ones to you with everything you need to call them.',
  },
] as const;

export default function Home(): JSX.Element {
  return (
    <main id="main">
      <section className="hero" id="top" data-sunny-act="wave">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">The AI assistant for solar installers</span>
            <h1>
              Meet Sunny.
              <br />
              <span className="accent">
                Your <span className="squiggle">brightest</span> employee.
              </span>
            </h1>
            <p className="lede">
              Sunny lives on your website, answers every visitor&rsquo;s solar questions, works out
              who is ready to buy, and hands you warm leads with the whole conversation attached.
            </p>
            <div className="actions">
              <Link className="button" href="/sign-up">
                Get started — it&rsquo;s free to try
              </Link>
              <a className="button secondary" href="#demo">
                Chat with Sunny
              </a>
            </div>
          </div>

          <HeroDock />
        </div>
      </section>

      <RayDivider />

      <section className="section" id="features" data-sunny-act="magnifier">
        <div className="wrap">
          <h2>Everything a great first conversation needs</h2>
          <p className="intro">
            Visitors arrive with questions at all hours. Sunny makes sure every one of them gets a
            friendly, accurate answer and a clear next step.
          </p>
          <FeatureGrid features={FEATURES} />
        </div>
      </section>

      <section className="section tinted" id="how" data-sunny-act="laptop">
        <div className="wrap">
          <h2>Live on your website, without a rebuild</h2>
          <p className="intro">
            No new website platform and no redesign. Sunny fits the site you already have.
          </p>
          <Steps steps={STEPS} />
        </div>
      </section>

      <section className="section demo" id="demo" data-sunny-act="point">
        <div className="wrap demo-grid">
          <div>
            <span className="eyebrow on-dark">Try it now</span>
            <h2>Say hello to Sunny</h2>
            <p className="intro">
              Sunny is running on this page right now, exactly as it would on your site. Tap the sun
              in the corner and ask about savings, batteries or what a survey involves.
            </p>
            <OpenChatButton />
          </div>
          <div className="browser">
            <div className="browser-bar">
              <div className="dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span className="browser-url">your-solar-company.co.uk</span>
            </div>
            <div className="browser-body">
              <p className="browser-caption">All it takes on your site:</p>
              <pre className="snippet">
                <code>{SNIPPET}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      <RayDivider />

      <section className="section" id="character" data-sunny-act="peace">
        <div className="wrap">
          <span className="eyebrow">Your colours</span>
          <h2>Sunny wears your brand</h2>
          <p className="intro">
            Choose a colour and watch Sunny change in real time &mdash; down in the corner, and in
            the chat. Your visitors meet a character that feels like part of your company.
          </p>
          <ColourSwitcher />
        </div>
      </section>

      <section className="section tinted" id="pricing" data-sunny-act="point">
        <div className="wrap">
          <h2>Simple monthly plans</h2>
          <p className="intro">
            Every plan includes the full Sunny character and assistant. Prices exclude VAT.
          </p>
          <PricingCards />
          <p className="more-link">
            <Link href="/pricing">Compare plans in detail →</Link>
          </p>
        </div>
      </section>

      <CtaBand />
    </main>
  );
}
