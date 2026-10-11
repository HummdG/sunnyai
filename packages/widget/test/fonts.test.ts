import { FONT_FACES, FONT_FAMILY, FONT_WEIGHT } from '@sunny/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareFontFaces, preloadFontFaces, releaseFontFaces } from '../src/fonts.js';

/**
 * The typeface, registered with the document.
 *
 * There is no DOM here, and that is not a limitation to work around — it is what
 * makes these tests worth having. The browser-side question ("is the face
 * actually used?") is answered in `tests/e2e/typography.spec.ts`, against a real
 * Chromium, because that is the only place the answer lives. What is left for
 * this file is the part a browser cannot tell you: exactly which faces get
 * created, from which URLs, with which descriptors, and that nothing is left in
 * the document after `destroy()`.
 *
 * Which is also why the two globals are faked rather than the module being
 * refactored to take them as arguments: the code's whole job is to talk to
 * `document.fonts`, and a fake that records the calls is a truer test of that
 * than an injected interface would be.
 */

interface Constructed {
  family: string;
  source: string;
  descriptors: FontFaceDescriptors;
}

interface FakeDocument {
  constructed: Constructed[];
  added: unknown[];
  deleted: unknown[];
  loads: string[];
}

/**
 * Installs a `FontFace` and a `document` that record what they are asked to do.
 *
 * `throwOn` makes one construction fail, which is the branch that matters most:
 * a browser refusing one descriptor must not cost the caller the other subsets.
 */
function fakeDom(options: { throwOn?: string; loadRejects?: boolean } = {}): FakeDocument {
  const state: FakeDocument = { constructed: [], added: [], deleted: [], loads: [] };

  class FontFaceStub {
    constructor(family: string, source: string, descriptors: FontFaceDescriptors = {}) {
      if (options.throwOn && source.includes(options.throwOn)) {
        throw new Error(`refused: ${source}`);
      }
      state.constructed.push({ family, source, descriptors });
    }

    load(): Promise<FontFaceStub> {
      return options.loadRejects ? Promise.reject(new Error('offline')) : Promise.resolve(this);
    }
  }

  vi.stubGlobal('FontFace', FontFaceStub);
  vi.stubGlobal('document', {
    fonts: {
      add: (face: unknown) => state.added.push(face),
      delete: (face: unknown) => {
        state.deleted.push(face);
        return true;
      },
      load: (font: string) => {
        state.loads.push(font);
        return Promise.resolve([]);
      },
    },
  });

  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DIRECTORY = 'https://cdn.example.test/assets/sunny/v2/';

describe('declareFontFaces', () => {
  it('registers one face per committed subset, resolved against the given directory', () => {
    const dom = fakeDom();

    declareFontFaces(DIRECTORY);

    expect(dom.constructed).toHaveLength(FONT_FACES.length);
    expect(dom.added).toHaveLength(FONT_FACES.length);

    for (const face of FONT_FACES) {
      const constructed = dom.constructed.find((candidate) => candidate.source.includes(face.file));
      expect(constructed, `${face.file} was never constructed`).toBeDefined();
      // Absolute, and pointing at the file the provenance table has a digest
      // for. A relative URL here would be resolved by the customer's page.
      expect(constructed!.source).toBe(`url("${DIRECTORY}fonts/${face.file}") format("woff2")`);
      expect(constructed!.family).toBe(FONT_FAMILY);
    }
  });

  it('describes the face the same way the stylesheet does', () => {
    // The descriptors are what make two subsets of one variable family work:
    // the weight range is why a 650-weight heading can be served at all, and the
    // unicode-range is why accented text costs a second file and ASCII does not.
    const dom = fakeDom();

    declareFontFaces(DIRECTORY);

    FONT_FACES.forEach((face, index) => {
      const { descriptors } = dom.constructed[index]!;
      expect(descriptors.weight).toBe(FONT_WEIGHT);
      expect(descriptors.style).toBe('normal');
      // Not `block`: invisible text for the length of the request is worse than
      // one reflow.
      expect(descriptors.display).toBe('swap');
      expect(descriptors.unicodeRange).toBe(face.unicodeRange);
    });
  });

  it('does nothing at all when it does not know where its files are', () => {
    // A script tag with no readable `src`, or a caller mounting the class
    // directly. Registering a face with no source would be claiming the document
    // has a typeface it cannot fetch -- and the family is still named in the
    // stack, so the panel is set in the system fonts and nothing else changes.
    for (const missing of [null, undefined, '']) {
      const dom = fakeDom();
      expect(declareFontFaces(missing)).toEqual([]);
      expect(dom.constructed).toEqual([]);
      expect(dom.added).toEqual([]);
    }
  });

  it('keeps the subsets it can register when the browser refuses one', () => {
    // The failure this guards is not hypothetical: a browser that will not take
    // the `unicodeRange` descriptor, or a source string it dislikes, would
    // otherwise cost the caller the whole typeface rather than one subset.
    const dom = fakeDom({ throwOn: 'latin-ext' });

    const added = declareFontFaces(DIRECTORY);

    expect(added).toHaveLength(FONT_FACES.length - 1);
    expect(dom.constructed.map((face) => face.source)).toEqual([
      `url("${DIRECTORY}fonts/plus-jakarta-sans-latin.woff2") format("woff2")`,
    ]);
  });

  it('stays quiet on a page with no FontFace API and on a page with no document', () => {
    // Neither should throw: this runs on a customer's page, and a typeface is
    // not worth an exception in their console.
    vi.stubGlobal('FontFace', undefined);
    vi.stubGlobal('document', { fonts: { add: () => {}, delete: () => {} } });
    expect(declareFontFaces(DIRECTORY)).toEqual([]);

    vi.stubGlobal('FontFace', function FontFace() {});
    vi.stubGlobal('document', undefined);
    expect(declareFontFaces(DIRECTORY)).toEqual([]);
  });

  it('adds every face to the document, so a shadow root can use them', () => {
    // The whole reason this module exists rather than a `@font-face` in the
    // sheet: a face inside a shadow tree is parsed and never matched, while one
    // in the document's font set is available inside the tree.
    const dom = fakeDom();

    const faces = declareFontFaces(DIRECTORY);

    expect(dom.added).toEqual(faces);
    expect(faces).toHaveLength(FONT_FACES.length);
  });
});

describe('releaseFontFaces', () => {
  it('takes out exactly what was put in', () => {
    const dom = fakeDom();
    const ours = declareFontFaces(DIRECTORY);

    releaseFontFaces(ours);

    expect(dom.deleted).toEqual(ours);
  });

  it('does not touch a document it never added to', () => {
    const dom = fakeDom();

    releaseFontFaces([]);

    expect(dom.deleted).toEqual([]);
  });

  it('survives a document that is already gone', () => {
    const dom = fakeDom();
    const ours = declareFontFaces(DIRECTORY);
    dom.deleted.length = 0;
    vi.stubGlobal('document', undefined);

    expect(() => releaseFontFaces(ours)).not.toThrow();
  });
});

describe('preloadFontFaces', () => {
  it('asks for the family at the weight the panel sets its text in', async () => {
    // Without this the download starts when the panel first opens -- the
    // launcher is an icon, so the widget has no text until then -- and the face
    // swaps in under the reader. 650 is the weight `.header .name` uses.
    const dom = fakeDom();

    preloadFontFaces();
    await Promise.resolve();

    expect(dom.loads).toEqual([`650 16px "${FONT_FAMILY}"`]);
  });

  it('says nothing when the request fails', async () => {
    // A typeface is an enhancement. A rejected load must not reach the page as
    // an unhandled rejection, which is what a bare `void` on a promise gives.
    fakeDom({ loadRejects: true });
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);

    preloadFontFaces();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onUnhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', onUnhandled);
  });

  it('does nothing when the API is missing', () => {
    vi.stubGlobal('document', undefined);

    expect(() => preloadFontFaces()).not.toThrow();
  });
});
