import type { Metadata } from 'next';

import { CtaBand, PageIntro } from '../../../components/blocks.js';
import { ColourSwitcher } from '../../../components/colour-switcher.js';
import { LazyGallery } from '../../../components/lazy-gallery.js';

export const metadata: Metadata = {
  title: 'Meet Sunny',
  description:
    'Meet the character behind the assistant: cheerful, confident and a little bit cheeky.',
};

const TRAITS = [
  {
    title: 'Cheerful, never childish',
    body: 'Sunny’s cartoon charm makes a first conversation feel easy, while the answers stay clear and professional.',
  },
  {
    title: 'Reacts to the conversation',
    body: 'Sunny listens while visitors type, thinks while it works and celebrates when a lead is saved. Every reaction matches what is really happening.',
  },
  {
    title: 'Never in the way',
    body: 'Animations stop the moment a visitor interacts, pause when Sunny is off screen, and soften for anyone who prefers reduced motion.',
  },
] as const;

export default function MeetSunnyPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Meet Sunny"
        title="The friendliest face on your website"
        lede="Sunny is an orange sun with a big smile and plenty of personality. Visitors remember Sunny, and they finish their conversations."
      />
      <section className="section" data-sunny-act="away">
        <div className="wrap split">
          <div>
            <h2>Play with Sunny</h2>
            <p className="intro">
              Pick a moment and watch Sunny act it out. These are the same reactions your visitors
              see while they chat.
            </p>
            <ul className="traits">
              {TRAITS.map((trait) => (
                <li key={trait.title}>
                  <strong>{trait.title}</strong>
                  <p>{trait.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="split-art">
            <LazyGallery />
          </div>
        </div>
      </section>
      <section className="section tinted" data-sunny-act="peace">
        <div className="wrap">
          <h2>In your colours</h2>
          <p className="intro">
            Choose a colour and Sunny changes instantly, here and in the chat in the corner.
          </p>
          <ColourSwitcher />
        </div>
      </section>
      <CtaBand />
    </main>
  );
}
