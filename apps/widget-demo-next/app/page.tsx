import { API_URL, PUBLIC_ID } from './config';

/**
 * Our documented snippet, pasted into a Server Component exactly as an
 * integrator would paste it.
 *
 * The point of this route is that the snippet is unmodified: two data attributes
 * and a src, with no Next-specific adaptation. If our own snippet needs
 * framework-specific rewriting to work, that is worth knowing here rather than
 * in a customer's inbox.
 *
 * React 19 -- underneath Next 16 -- hoists this `async` script into the document
 * head, wherever it is written. That used to place the widget's host in the head
 * too, where it was never rendered (D-13); the widget now owns that decision
 * rather than inheriting it from the host.
 */
export default function Home() {
  return (
    <>
      <h1>Our snippet, unchanged, in a Next.js page.</h1>
      <p>
        This route renders the two-attribute embed from the documentation with no adaptation. Next
        is free to move the tag; the widget is expected not to care.
      </p>

      <pre>{`<script
  src="/widget/sunny-widget.js"
  data-widget-id="${PUBLIC_ID}"
  data-api-url="${API_URL}"
  async>
</script>`}</pre>

      <script
        src="/widget/sunny-widget.js"
        data-widget-id={PUBLIC_ID}
        data-api-url={API_URL}
        async
      />
    </>
  );
}
