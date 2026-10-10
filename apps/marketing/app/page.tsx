import { THEME_PRESETS } from '@sunny/character';
import type { JSX } from 'react';

import { SunnyHero } from '../components/sunny-hero.js';
import { API_URL, PUBLIC_ID } from './config.js';

/**
 * The marketing page.
 *
 * What is deliberately *not* on this page: customer logos, testimonials,
 * install counts, star ratings, "trusted by" strips, and prices. None of those
 * can be written truthfully yet — there are no customers, and the plan forbids
 * inventing the numbers and the pricing. A page that makes them up is the one
 * kind of marketing asset that can never be corrected, because it ships a claim
 * before anyone has checked it. So the page argues from the thing that does
 * exist: a working assistant you can use, right here, without filling in a form.
 */

const SNIPPET = `<script
  src="https://cdn.example.com/sunny-widget.js"
  data-widget-id="${PUBLIC_ID}"
  data-api-url="https://api.example.com"
  async
></script>`;

export default function Home(): JSX.Element {
  const presets = Object.entries(THEME_PRESETS);

  return (
    <main id="main">
      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">For solar installers</span>
            <h1>Every visitor gets an answer. Every good lead gets a name.</h1>
            <p className="lede">
              Sunny is an assistant you embed on your own site. It answers the questions you keep
              being asked, works out who is serious, and hands those people over — with the
              conversation already written down.
            </p>
            <div className="actions">
              <a className="button" href="#demo">
                Try it now
              </a>
              <a className="button secondary" href="#how">
                How it works
              </a>
            </div>
          </div>

          <SunnyHero />
        </div>
      </section>

      <div className="hills" aria-hidden="true" />

      <section className="section" id="how">
        <div className="wrap">
          <h2>Three steps, and the first one is a script tag</h2>
          <p className="intro">
            There is no dashboard to learn before the assistant works, and no page builder to
            migrate to. It goes on the site you already have.
          </p>

          <ol className="steps">
            <li className="card">
              <span className="step-number" aria-hidden="true">
                1
              </span>
              <h3>Paste one script</h3>
              <p>
                One async tag, on any page you choose. Everything it adds lives in a shadow root, so
                your stylesheet cannot reach it and it cannot reach yours. It works on a plain HTML
                site, WordPress, React and Next.js.
              </p>
            </li>
            <li className="card">
              <span className="step-number" aria-hidden="true">
                2
              </span>
              <h3>Sunny asks and answers</h3>
              <p>
                It qualifies the enquiry — roof, timescale, whether the property is owned — and
                answers product questions from documents you give it, not from whatever a model
                happens to remember.
              </p>
            </li>
            <li className="card">
              <span className="step-number" aria-hidden="true">
                3
              </span>
              <h3>The lead arrives complete</h3>
              <p>
                A named contact, the answers, and the transcript. A visitor who is not ready yet can
                ask for a callback instead, and that is a lead too.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section demo" id="demo">
        <div className="wrap">
          <h2>This is the widget, not a screenshot of it</h2>
          <p className="intro">
            The assistant is running on this page right now, loaded by the same script you would
            paste on your own site. Look at the corner of the window you are reading this in — the
            launcher is the real one, and it will answer.
          </p>

          <div className="browser">
            <div className="browser-bar">
              <div className="dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span className="browser-url">your-installer-site.co.uk</span>
            </div>
            <div className="browser-body">
              <h3>Solar panels, fitted by people who live nearby</h3>
              <p>This frame is the snippet, and the site it goes on:</p>

              {/*
                The real embed, added by the real snippet. Note where it lands:
                the widget appends itself to the document body rather than
                inside this frame, because it is fixed to the viewport (D-13).
                So it is anchored to the page you are reading, not to the
                illustration of a page above — which is also why the copy
                points at the window corner rather than at this box.
              */}
              <pre className="snippet">
                <code>{SNIPPET}</code>
              </pre>

              <script
                src="/widget/sunny-widget.js"
                data-widget-id={PUBLIC_ID}
                data-api-url={API_URL}
                async
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="character">
        <div className="wrap">
          <h2>The character is part of the product</h2>
          <p className="intro">
            Sunny is a face, not a chat bubble. It blinks while it waits, looks up when someone
            arrives, and reacts when it has done something useful — which is why people finish
            conversations with it. It also takes your colours, so it looks like yours rather than
            ours.
          </p>

          <ul className="cards">
            {presets.map(([name, theme]) => (
              <li className="card" key={name}>
                {/* The swatch is painted from the theme's own values, so this
                    cannot show a colour the engine would not actually use. */}
                <span
                  aria-hidden="true"
                  style={{
                    display: 'block',
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: theme.body,
                    border: `2px solid ${theme.ink}`,
                    marginBottom: 'var(--space-3)',
                  }}
                />
                <h3>
                  {name[0]?.toUpperCase() ?? ''}
                  {name.slice(1)}
                </h3>
                <p>
                  {name === 'orange'
                    ? 'The canonical Sunny, drawn from the reference artwork.'
                    : `The same character, re-themed to ${name}.`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="wrap">
          <h2>Pricing</h2>
          <p className="intro">
            There is no price list on this page, and that is not an oversight — we have not
            published one yet, so there is nothing here to quote.
          </p>

          <div className="pricing-note">
            <strong>What we can tell you today</strong>
            <p>
              Sunny is licensed per site, and the demo above is the whole product rather than a
              cut-down one. Anything more specific than that would be a number we made up, so we
              would rather you asked us.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
