import { publicWidgetIdSchema } from '@sunny/contracts';

import { SunnyWidget, type MountOptions } from './widget.js';

export { SunnyWidget } from './widget.js';
export type { MountOptions } from './widget.js';

const MOUNT_FLAG = 'data-sunny-mounted';

/**
 * The origin the script tag itself was served from, or null if it cannot be read.
 *
 * `new URL` throws on an empty `src`, which is a real state: a script inserted by
 * an integration that forgot the attribute. Returning null rather than throwing
 * keeps that a refused mount instead of an unhandled error in the host page.
 */
function scriptOrigin(script: HTMLScriptElement): string | null {
  try {
    return new URL(script.src).origin;
  } catch {
    return null;
  }
}

/**
 * The directory the script was served from — where its fonts are, if they are.
 *
 * The directory and not the origin, because the fonts are published *with the
 * bundle*: an integrator who serves their own copy from a subdirectory gets the
 * fonts from that subdirectory, and one who puts the file on a CDN gets them
 * from the CDN. Deriving a path from the origin would be right in exactly the
 * deployment where the bundle sits at the root, which is the deployment we
 * happen to test on.
 *
 * `new URL('.', ...)` is what makes this a directory: it resolves the reference
 * against the script's own URL and drops the file name, so the trailing slash is
 * the resolver's rather than a string we appended to something that may or may
 * not have had one. It throws on an empty `src` for the same reason
 * `scriptOrigin` does, and null is the same answer.
 */
function scriptDirectory(script: HTMLScriptElement): string | null {
  try {
    return new URL('.', script.src).href;
  } catch {
    return null;
  }
}

/**
 * Read the embed snippet's configuration off the script tag.
 *
 * The public widget id is validated here rather than trusted: it is the only
 * value a customer's page supplies, and a malformed one should mean the widget
 * does not mount, not that it queries the API with arbitrary text.
 *
 * `data-api-url` wins over the script's own origin. That precedence is the whole
 * point of the attribute -- an installer serving the bundle from a CDN has the
 * script on the CDN's origin and the API somewhere else entirely -- and reading
 * it into a value the expression then ignores is a bug this used to have. Every
 * request went to the origin serving the JavaScript, which looks correct in the
 * one deployment where both are the same host and fails everywhere else.
 */
export function optionsFromScript(script: HTMLScriptElement): MountOptions | null {
  const publicId = script.getAttribute('data-widget-id') ?? '';
  const parsed = publicWidgetIdSchema.safeParse(publicId);
  if (!parsed.success) {
    console.error(
      `[sunny] this script tag has no valid data-widget-id (got "${publicId}"). ` +
        'Expected something like w_abc1234567. The widget will not mount.',
    );
    return null;
  }

  const base = script.getAttribute('data-api-url') ?? scriptOrigin(script);
  if (!base) return null;

  // Deliberately *not* `data-api-url`, unlike the line above it. The fonts ship
  // with the script, so the script's own directory is the only address that is
  // right when the bundle is on a CDN and the API is not -- which is the case
  // `data-api-url` exists for. A missing directory is not fatal: the font is the
  // one thing the widget can do without (D-48).
  return {
    apiUrl: base.replace(/\/+$/, ''),
    publicId: parsed.data,
    fontDirectoryUrl: scriptDirectory(script),
  };
}

/**
 * Mount on every script tag that asked for a widget.
 *
 * The script tag is a bootstrap, not a lifecycle. It runs once, and nothing
 * unmounts the widget afterwards: a widget belongs to the *document*, not to
 * whatever element the snippet happened to sit in. That is what makes it behave
 * on a single-page site, where the route changes under it and the assistant
 * stays put -- and it is why removing the tag tears nothing down. The
 * alternative, watching the whole document for the tag's removal, is a
 * MutationObserver on every customer's page, which is too high a price for a
 * teardown nobody asked for.
 *
 * A page may host several widgets, keyed by public id, but never two of the
 * same. Two script tags carrying one id is a duplicated bootstrap -- a CMS
 * rendering a footer snippet twice, or a framework remounting a component that
 * contains one -- and the readable outcome is one widget, not two launchers
 * stacked on each other.
 */
async function boot(): Promise<void> {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[data-widget-id]:not([' + MOUNT_FLAG + '])',
  );

  for (const script of scripts) {
    const options = optionsFromScript(script);
    if (!options) continue;
    script.setAttribute(MOUNT_FLAG, 'true');

    // Safe to interpolate: `optionsFromScript` has already validated the id
    // against `publicWidgetIdSchema`, so this cannot leave the attribute value.
    const alreadyMounted = document.querySelector(`[data-sunny-widget="${options.publicId}"]`);
    if (alreadyMounted) continue;

    const host = document.createElement('div');
    // The host is a bare marker: every style the widget needs is inside the
    // shadow root, so the page's own CSS cannot collide with it.
    host.setAttribute('data-sunny-widget', options.publicId);

    // The host is appended to the body, not inserted beside the script tag.
    //
    // "Put it next to my own script" reads as the tidy choice and is wrong in
    // both of the placements that matter most. A snippet pasted into <head> --
    // which is where an embed is usually told to go -- would leave a <div> in
    // the document head, where the browser never renders it. And an integrator
    // who puts the tag inside a component tree does not get to choose: React 19
    // hoists `<script async src>` into the head itself. On the React host page
    // in `apps/widget-demo-react` the widget mounted, reported itself through
    // `window.sunny`, and was invisible, because this line put it in the head.
    //
    // Nothing is lost by moving it. The widget is fixed-positioned and painted
    // inside a shadow root, so its place in the document affects only paint
    // order -- and the end of the body is where an overlay belongs.
    (document.body ?? document.documentElement).append(host);

    const widget = new SunnyWidget(host, options);
    await widget.mount();

    // A small, stable handle for the host page: enough to open or close the
    // assistant programmatically, and nothing that could be used to drive it
    // from outside the approved vocabulary.
    (window as unknown as { sunny?: unknown }).sunny = {
      widgets: [
        ...((window as unknown as { sunny?: { widgets?: SunnyWidget[] } }).sunny?.widgets ?? []),
        widget,
      ],
      open: () => widget.open(),
      close: () => widget.close(),
    };
  }
}

/**
 * Auto-mount, which is a side effect of being *loaded on a page*.
 *
 * Guarded by `typeof document` because there is not always a page: a test
 * importing this module to exercise `optionsFromScript` got a ReferenceError
 * from this line, and so would any bundler that evaluates the file outside a
 * browser. The guard says the intent -- mount when there is a document to mount
 * into -- instead of assuming one.
 */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
  } else {
    void boot();
  }
}
