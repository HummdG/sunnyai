import Script from 'next/script';

import { API_URL, PUBLIC_ID } from '../config';

/**
 * The integration Next's own documentation recommends.
 *
 * `next/script` is not a plain `<script>` tag with extra steps: Next owns when
 * the element is created and injected, which for `afterInteractive` is after
 * hydration and not during the server render. So the widget arrives later than
 * it does on the other route, into a document that Next has already arranged,
 * and it has to cope with both.
 *
 * Tested separately from the plain snippet because it fails differently -- a
 * widget that mounts before the API is ready is a different bug from one that
 * mounts into the wrong parent.
 */
export default function ScriptRoute() {
  return (
    <>
      <h1>
        The same widget, through <code>next/script</code>.
      </h1>
      <p>
        Next decides when this element exists and where it lands, rather than the page author. The
        widget is expected to work without knowing that.
      </p>

      <Script
        src="/widget/sunny-widget.js"
        data-widget-id={PUBLIC_ID}
        data-api-url={API_URL}
        strategy="afterInteractive"
      />
    </>
  );
}
