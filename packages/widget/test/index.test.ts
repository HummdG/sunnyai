import { describe, expect, it, vi } from 'vitest';

import { optionsFromScript } from '../src/index.js';

/**
 * The embed snippet's two attributes, and which one wins.
 *
 * This exists because of a real defect, not for coverage. `data-api-url` was read
 * into a value the next expression ignored, so every request went to whichever
 * origin served the JavaScript. That is invisible in the one deployment where the
 * script and the API share a host -- the demo page -- and wrong in the one the
 * attribute exists for, a bundle on a CDN calling an API elsewhere. The browser
 * end-to-end suite caught it; these are the fast tests that stop it coming back.
 *
 * No DOM is needed: `optionsFromScript` reads two attributes and an origin, and a
 * fake that answers those is a truer test of the decision than a real element
 * would be, because it makes the interesting input explicit.
 */
function fakeScript(attributes: Record<string, string>, src: string): HTMLScriptElement {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    src,
  } as unknown as HTMLScriptElement;
}

describe('optionsFromScript', () => {
  it('prefers data-api-url over the origin serving the script', () => {
    // The CDN case: the script is on one host, the API on another.
    const script = fakeScript(
      { 'data-widget-id': 'w_demo000001', 'data-api-url': 'https://api.example.test' },
      'https://cdn.example.test/sunny-widget.js',
    );

    expect(optionsFromScript(script)).toEqual({
      apiUrl: 'https://api.example.test',
      publicId: 'w_demo000001',
    });
  });

  it('falls back to the script origin when data-api-url is absent', () => {
    const script = fakeScript(
      { 'data-widget-id': 'w_demo000001' },
      'https://cdn.example.test/sunny-widget.js',
    );

    expect(optionsFromScript(script)?.apiUrl).toBe('https://cdn.example.test');
  });

  it('strips trailing slashes so paths never double up', () => {
    const script = fakeScript(
      { 'data-widget-id': 'w_demo000001', 'data-api-url': 'https://api.example.test//' },
      'https://cdn.example.test/sunny-widget.js',
    );

    expect(optionsFromScript(script)?.apiUrl).toBe('https://api.example.test');
  });

  it('refuses a malformed widget id rather than querying the API with it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const script = fakeScript(
      { 'data-widget-id': '../../etc/passwd', 'data-api-url': 'https://api.example.test' },
      'https://cdn.example.test/sunny-widget.js',
    );

    expect(optionsFromScript(script)).toBeNull();
    // The integrator has to be told; a silent no-mount is the failure that sends
    // someone reading minified source.
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('refuses a script with no id at all', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const script = fakeScript({}, 'https://cdn.example.test/sunny-widget.js');

    expect(optionsFromScript(script)).toBeNull();
    error.mockRestore();
  });

  it('refuses rather than throwing when the script has no readable src', () => {
    // An integration that inserted the tag without a src. `new URL('')` throws,
    // and a throw here would surface as an unhandled error in the host page.
    const script = fakeScript({ 'data-widget-id': 'w_demo000001' }, '');

    expect(optionsFromScript(script)).toBeNull();
  });
});
