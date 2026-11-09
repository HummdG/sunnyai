import type { Metadata } from 'next';

import { PageIntro } from '../../../components/blocks.js';
import { pageMetadata } from '../../seo.js';

/**
 * What SunnyBot is, for the web hosts and site owners who meet it in their
 * logs. Its user agent links here, and a host's support team checks this page
 * before allowing it past bot protection, so every figure is the crawler's own
 * (apps/api/src/ingest: sync.ts, crawler.ts, fetcher.ts, robots.ts).
 */

export const metadata: Metadata = pageMetadata({
  title: 'SunnyBot',
  description:
    'SunnyBot reads a solar installer’s public web pages so Sunny can answer their customers. What it does, how often it visits, and how to allow or block it.',
  path: '/bot',
});

const USER_AGENT = 'SunnyBot/1.0 (+https://heysunny.co.uk/bot; knowledge sync for the site owner)';

export default function BotPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="SunnyBot"
        title="About SunnyBot"
        lede="SunnyBot reads a solar installer’s public web pages, at that installer’s request, so Sunny can answer their customers’ questions accurately."
      />
      <section className="section">
        <div className="wrap prose">
          <h2>How to recognise it</h2>
          <p>Every request SunnyBot makes carries this user agent:</p>
          <pre>
            <code>{USER_AGENT}</code>
          </pre>
          <p>
            It runs on Google Cloud, so it has no single fixed IP address. Please allow it by its
            user agent.
          </p>

          <h2>What it does</h2>
          <ul>
            <li>
              It only visits a website after the business that owns it has connected it to Sunny.
            </li>
            <li>
              It reads public pages only. It never logs in, fills in forms or submits anything.
            </li>
            <li>
              It follows robots.txt: a group for <code>SunnyBot</code> if there is one, otherwise
              the rules for every bot.
            </li>
          </ul>

          <h2>How often, and how hard</h2>
          <ul>
            <li>About once a week, plus whenever the site owner asks for a refresh.</li>
            <li>Up to 200 pages per visit, with no more than 3 requests at a time.</li>
            <li>It gives up on a page after 15 seconds and skips files over 3 MB.</li>
          </ul>

          <h2>Allowing SunnyBot</h2>
          <p>
            If your web host’s bot protection shows SunnyBot a check page (such as “One moment,
            please...”), Sunny cannot read the site. Ask your host to add an exception for the user
            agent above.
          </p>

          <h2>Blocking SunnyBot</h2>
          <p>Add this to your robots.txt and it will stop reading your site:</p>
          <pre>
            <code>{'User-agent: SunnyBot\nDisallow: /'}</code>
          </pre>

          <h2>Contact</h2>
          <p>
            Questions about SunnyBot:{' '}
            <a href="mailto:support@heysunny.co.uk">support@heysunny.co.uk</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
