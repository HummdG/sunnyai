import { publicWidgetIdSchema } from '@sunny/contracts';

import { SunnyWidget, type MountOptions } from './widget.js';

export { SunnyWidget } from './widget.js';
export type { MountOptions } from './widget.js';

const MOUNT_FLAG = 'data-sunny-mounted';

/**
 * Read the embed snippet's configuration off the script tag.
 *
 * The public widget id is validated here rather than trusted: it is the only
 * value a customer's page supplies, and a malformed one should mean the widget
 * does not mount, not that it queries the API with arbitrary text.
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

  const configured = script.getAttribute('data-api-url');
  const apiUrl = ((configured ?? script.src) ? new URL(script.src).origin : '').replace(/\/$/, '');
  if (apiUrl === '') return null;

  return { apiUrl, publicId: parsed.data };
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
} else {
  void boot();
}
