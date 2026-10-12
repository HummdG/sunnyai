/**
 * Cloudflare Turnstile, loaded only when the deployment asks for it.
 *
 * The script is fetched on first use, never with the widget, so a deployment
 * without Turnstile ships nothing extra to the installer's page. The challenge
 * is invisible unless Cloudflare decides it needs an interaction, in which case
 * its own small panel appears in the page corner.
 */

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'error-callback': () => void;
    },
  ): string;
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<TurnstileApi> {
  const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error('turnstile unavailable'));
    };
    script.onerror = () => reject(new Error('turnstile unavailable'));
    document.head.append(script);
  });
}

/** A Turnstile token, or null if the challenge could not run within the timeout. */
export async function turnstileToken(siteKey: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const api = await loadScript();
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646';
    document.body.append(container);
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      api.render(container, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (token) => {
          clearTimeout(timer);
          container.remove();
          resolve(token);
        },
        'error-callback': () => {
          clearTimeout(timer);
          container.remove();
          resolve(null);
        },
      });
    });
  } catch {
    return null;
  }
}
