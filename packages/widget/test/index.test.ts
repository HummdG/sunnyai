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
  it('hides the launcher only when the host page asks for none', () => {
    const own = fakeScript(
      { 'data-widget-id': 'w_demo000001', 'data-launcher': 'none' },
      'https://cdn.example.test/sunny-widget.js',
    );
    const plain = fakeScript(
      { 'data-widget-id': 'w_demo000001' },
      'https://cdn.example.test/sunny-widget.js',
    );
    expect(optionsFromScript(own)?.launcher).toBe(false);
    expect(optionsFromScript(plain)?.launcher).toBe(true);
  });

  it('prefers data-api-url over the origin serving the script', () => {
    // The CDN case: the script is on one host, the API on another.
    const script = fakeScript(
      { 'data-widget-id': 'w_demo000001', 'data-api-url': 'https://api.example.test' },
      'https://cdn.example.test/sunny-widget.js',
    );

    expect(optionsFromScript(script)).toEqual({
      apiUrl: 'https://api.example.test',
      publicId: 'w_demo000001',
      fontDirectoryUrl: 'https://cdn.example.test/',
      launcher: true,
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

describe('where the widget looks for its own files', () => {
  it('takes the font directory from the script, never from data-api-url', () => {
    // The whole point of the CDN case. The fonts are published with the bundle,
    // so a script served from a CDN is next to the CDN's copy of them -- and an
    // API on another host says nothing about where the script came from. Reading
    // the API URL here would 404 the font on exactly the deployment that sets
    // the attribute, and the failure is invisible: the panel renders, in the
    // system stack, with a CORS or 404 warning as the only trace (D-48).
    const script = fakeScript(
      { 'data-widget-id': 'w_demo000001', 'data-api-url': 'https://api.example.test' },
      'https://cdn.example.test/sunny-widget.js',
    );

    expect(optionsFromScript(script)?.fontDirectoryUrl).toBe('https://cdn.example.test/');
  });

  it('resolves a bundle served from a subdirectory against that subdirectory', () => {
    const script = fakeScript(
      { 'data-widget-id': 'w_demo000001' },
      'https://cdn.example.test/assets/sunny/v2/sunny-widget.js?build=41',
    );

    const directory = optionsFromScript(script)?.fontDirectoryUrl;

    // The query string goes with the file name, which is what `new URL('.')`
    // gives and what string-slicing the `src` would not: a directory ending in
    // `?build=41/` is a URL no host answers.
    expect(directory).toBe('https://cdn.example.test/assets/sunny/v2/');

    // And the property that makes deriving the directory worth it at all:
    // resolving "the fonts beside the script" against it is exactly what the
    // browser will do with the `@font-face`, so there is no second rule to keep
    // in step with this one.
    expect(new URL('fonts/plus-jakarta-sans-latin.woff2', directory!).href).toBe(
      'https://cdn.example.test/assets/sunny/v2/fonts/plus-jakarta-sans-latin.woff2',
    );
  });

  it('mounts with no font directory when data-api-url answers but src does not', () => {
    // A typeface is not worth refusing a mount over. This is the branch that
    // says so: the widget runs, and the panel is set in the system stack.
    const script = fakeScript(
      { 'data-widget-id': 'w_demo000001', 'data-api-url': 'https://api.example.test' },
      '',
    );

    expect(optionsFromScript(script)).toMatchObject({
      apiUrl: 'https://api.example.test',
      fontDirectoryUrl: null,
    });
  });
});
