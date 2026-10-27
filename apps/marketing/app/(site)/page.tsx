import Link from 'next/link';
import type { JSX } from 'react';

import { CtaBand, PricingCards } from '../../components/blocks.js';
import { ColourSwitcher } from '../../components/colour-switcher.js';
import { OpenChatButton } from '../../components/open-chat.js';
import {
  ColoursScene,
  HandoverScene,
  HeroScene,
  NightShiftScene,
  PasteScene,
  QualifyScene,
  RecommendScene,
  TeachScene,
  WaitlistScene,
  WelcomeScene,
} from '../../components/scenes/home.js';
import { WaitlistForm } from '../../components/waitlist-form.js';
import { PUBLIC_ID } from '../config.js';

const SNIPPET = `<script
  src="https://cdn.sunny.ai/sunny-widget.js"
  data-widget-id="${PUBLIC_ID}"
  async
></script>`;

/** What Sunny does, one illustrated chapter each. */
const STORIES = [
  {
    eyebrow: 'Always on',
    title: 'Answers, day and night',
    body: 'Sunny answers questions about panels, batteries and the installation process from your own documents, in your tone, whenever visitors are browsing, including the ones who browse at 2am.',
    points: ['Grounded in your own documents', 'Your tone of voice', 'Never closes for the night'],
    scene: <NightShiftScene />,
  },
  {
    eyebrow: 'Qualifies',
    title: 'Knows who is ready',
    body: 'Roof, ownership, timescale and budget are gathered naturally in conversation, so you know who is ready before you pick up the phone.',
    points: ['Roof and property details', 'Ownership and timescale', 'Budget, asked kindly'],
    scene: <QualifyScene />,
  },
  {
    eyebrow: 'Recommends',
    title: 'Suggests your packages',
    body: 'Sunny suggests systems from your own catalogue, checks what works together, and is clear about what is an estimate and what needs a survey.',
    points: [
      'From your catalogue and price list',
      'Checks compatibility',
      'Honest about estimates',
    ],
    scene: <RecommendScene />,
  },
  {
    eyebrow: 'Hands over',
    title: 'Delivers complete leads',
    body: 'Every lead arrives with contact details, consent, answers and the full conversation, ready for your team to follow up.',
    points: ['Contact details with consent', 'Every answer they gave', 'The whole conversation'],
    scene: <HandoverScene />,
  },
] as const;

const STEPS = [
  {
    title: 'Add one line to your site',
    body: 'Paste a single script tag. Sunny works on WordPress, plain HTML, React and Next.js sites without touching your design.',
    scene: <PasteScene />,
  },
  {
    title: 'Teach Sunny your business',
    body: 'Upload your product catalogue and the documents your team already uses. Pick your colours and the questions you want asked.',
    scene: <TeachScene />,
  },
  {
    title: 'Welcome your new leads',
    body: 'Sunny greets visitors, answers their questions and passes the ready ones to you with everything you need to call them.',
    scene: <WelcomeScene />,
  },
] as const;

export default function Home(): JSX.Element {
  return (
    <main id="main">
      <section className="hero" id="top">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">The AI assistant for solar installers</span>
            <h1>
              Meet Sunny.
              <br />
              Your <span className="mark">brightest</span> employee.
            </h1>
            <p className="lede">
              Sunny lives on your website, answers every visitor&rsquo;s solar questions, works out
              who is ready to buy, and hands you warm leads with the whole conversation attached.
            </p>
            <div className="actions">
              <Link className="button" href="/sign-up">
                Get started: it&rsquo;s free to try
              </Link>
              <OpenChatButton className="button secondary">Chat with Sunny</OpenChatButton>
            </div>
            <p className="hero-note">
              One line of code. Your colours. Live on your site in minutes.
            </p>
          </div>
          <HeroScene />
        </div>
      </section>

      {STORIES.map((story, i) => (
        <section
          className={`section${i % 2 === 1 ? ' tinted' : ''}`}
          id={i === 0 ? 'features' : undefined}
          key={story.title}
        >
          <div className={`wrap story${i % 2 === 1 ? ' is-flipped' : ''}`}>
            <div className="story-copy">
              <span className="story-number">{String(i + 1).padStart(2, '0')}</span>
              <span className="eyebrow">{story.eyebrow}</span>
              <h2>{story.title}</h2>
              <p className="intro">{story.body}</p>
              <ul className="story-points">
                {story.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <div className="story-art">{story.scene}</div>
          </div>
        </section>
      ))}

      <section className="section" id="how">
        <div className="wrap">
          <span className="eyebrow">How it works</span>
          <h2>Live on your website, without a rebuild</h2>
          <p className="intro">
            No new website platform and no redesign. Sunny fits the site you already have.
          </p>
          <ol className="storyboard">
            {STEPS.map((step) => (
              <li key={step.title}>
                {step.scene}
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section demo" id="demo">
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

      <section className="section" id="character">
        <div className="wrap story is-flipped">
          <div className="story-copy">
            <span className="eyebrow">Your colours</span>
            <h2>Sunny wears your brand</h2>
            <p className="intro">
              Choose a colour and watch Sunny change in real time, here and in the chat in the
              corner. Your visitors meet a character that feels like part of your company.
            </p>
            <ColourSwitcher />
          </div>
          <div className="story-art">
            <ColoursScene />
          </div>
        </div>
      </section>

      <section className="section tinted" id="pricing">
        <div className="wrap">
          <span className="eyebrow">Pricing</span>
          <h2>Plans for every installer</h2>
          <p className="intro">
            Every plan includes the full Sunny character and assistant. Contact sales for a price.
          </p>
          <PricingCards />
          <p className="more-link">
            <Link href="/pricing">Compare plans in detail →</Link>
          </p>
        </div>
      </section>

      <section className="section" id="waitlist">
        <div className="wrap story">
          <div className="story-copy">
            <span className="eyebrow">Waitlist</span>
            <h2>Save your place</h2>
            <p className="intro">
              Sunny is opening to UK solar installers a few at a time, so every company gets a
              proper welcome. Leave your email and we&rsquo;ll tell you when yours is ready.
            </p>
            <WaitlistForm />
          </div>
          <div className="story-art">
            <WaitlistScene />
          </div>
        </div>
      </section>

      <CtaBand />
    </main>
  );
}
