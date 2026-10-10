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

  return { apiUrl: base.replace(/\/+$/, ''), publicId: parsed.data };
}

/**
 * Mount on every script tag that asked for a widget.
 *
 * Idempotent and multi-instance by design: a CMS that renders the snippet twice
 * gets two widgets rather than two copies fighting over one host, and a page
 * that loads the script twice does not double-mount.
 */
async function boot(): Promise<void> {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[data-widget-id]:not([' + MOUNT_FLAG + '])',
  );

  for (const script of scripts) {
    const options = optionsFromScript(script);
    if (!options) continue;
    script.setAttribute(MOUNT_FLAG, 'true');

    const host = document.createElement('div');
    // The host is a bare marker: every style the widget needs is inside the
    // shadow root, so the page's own CSS cannot collide with it.
    host.setAttribute('data-sunny-widget', options.publicId);
    const anchor = script.parentNode ?? document.body;
    anchor.insertBefore(host, script.nextSibling);

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
