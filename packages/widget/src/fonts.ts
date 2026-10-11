/**
 * The brand typeface, registered with the document rather than declared in CSS.
 *
 * This is not the obvious implementation, and the reason is a measurement.
 * The first version of this emitted an `@font-face` into the widget's shadow
 * root, on the reasoning that a page's rules cannot reach into a shadow root so
 * the root has to declare its own. That reasoning conflates two different kinds
 * of scoping, and it is wrong: **Chromium does not use a face declared in a
 * shadow tree at all.** Measured on a hand-built shadow root, text inside it:
 *
 * | Where the face is declared                 | Applied? |
 * | ------------------------------------------ | -------- |
 * | `@font-face` inside the shadow root        | no       |
 * | `@font-face` in the document               | yes      |
 * | `new FontFace()` added to `document.fonts` | yes      |
 *
 * The face parsed correctly in every case — `CSSFontFaceRule`s were present in
 * `style.sheet.cssRules` — and was simply never matched, so the failure was a
 * panel that looked entirely plausible in the system font and a font file that
 * was never requested. Styles are tree-scoped; fonts are a document resource. A
 * document-scoped face is available inside a shadow root, which is exactly the
 * property this module uses.
 *
 * So the face is built with the CSS Font Loading API and added to
 * `document.fonts`. That does touch the host page's font set, which is a real
 * cost and is accepted deliberately: it is additive, it is namespaced by a
 * family name the page is unlikely to own, and it is undone on `destroy()`.
 * There is no way to attach a font to a shadow tree instead.
 */
import { FONT_FACES, FONT_FAMILY, FONT_WEIGHT, fontFileUrl } from '@sunny/ui';

/**
 * The weight the panel's own text is set in.
 *
 * Used to name the face when asking the browser to fetch it early. Any weight in
 * the declared `FONT_WEIGHT` range selects the same file, which is the point of
 * shipping a variable font; this one is named because it is the weight the
 * panel's headings actually use, so the request is for the face the panel wants
 * rather than a proxy for it.
 */
const PANEL_WEIGHT = 650;

/**
 * Register every subset with the document, and return what was added.
 *
 * The caller keeps the return value and hands it back to `releaseFontFaces`,
 * because a removed widget should not leave its fonts behind: a page that
 * mounts and unmounts the widget — a single-page app re-rendering a route — would
 * otherwise accumulate a copy of the face on every pass, and there is no bound
 * on how many passes there could be.
 *
 * `null` means the widget could not read its own `<script src>`, so it has no
 * idea where its files are. That is not a reason to refuse a mount: no faces are
 * added, and the stack falls through to the system fonts.
 */
export function declareFontFaces(directoryUrl: string | null | undefined): FontFace[] {
  if (!directoryUrl) return [];
  // Feature-detected rather than assumed, because this runs on a customer's page
  // and not only in the browsers we develop against. The API is in every browser
  // that runs a shadow root, but the guard costs one comparison and turns an
  // exception into the same graceful fallback the whole module is designed
  // around. It is also what lets the unit tests run without a DOM.
  if (typeof FontFace !== 'function' || typeof document === 'undefined') return [];

  const added: FontFace[] = [];

  for (const face of FONT_FACES) {
    try {
      const fontFace = new FontFace(
        FONT_FAMILY,
        `url("${fontFileUrl(directoryUrl, face)}") format("woff2")`,
        {
          style: 'normal',
          weight: FONT_WEIGHT,
          // `swap` rather than `block` or `optional`: the panel is a surface
          // whose text is a conversation, and two seconds of invisible bubbles
          // on a slow link is worse than one reflow of a paragraph.
          display: 'swap',
          unicodeRange: face.unicodeRange,
        },
      );
      document.fonts.add(fontFace);
      added.push(fontFace);
    } catch {
      // A face the browser will not take is not a reason to fail a mount. The
      // remaining subsets are still attempted, and the family is still named
      // first in the stack, so a browser that has it from anywhere else uses it.
    }
  }

  return added;
}

/**
 * Take the faces back out of the document.
 *
 * `document.fonts.delete` is keyed by object identity, so this removes exactly
 * what `declareFontFaces` added and nothing the host page declared.
 */
export function releaseFontFaces(faces: readonly FontFace[]): void {
  if (typeof document === 'undefined' || !document.fonts) return;
  for (const face of faces) {
    try {
      document.fonts.delete(face);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Ask the browser to fetch the face now, without waiting for it.
 *
 * Without this the download starts when text first needs the font — which is
 * when the visitor opens the panel, because the launcher is an icon and the
 * widget's only words are inside it. The face would then swap in under the
 * reader's eyes, on the first open, every session. Asking up front costs one
 * request in the background and removes that entirely.
 *
 * The sample string is deliberately plain ASCII: a face is chosen per codepoint,
 * so this fetches the Latin subset — the one the widget's own chrome is set in —
 * and leaves the wider subset to be fetched on demand, when a visitor's own
 * words need it. That split is the reason there are two files.
 *
 * Rejections are swallowed on purpose. A typeface is an enhancement, and nothing
 * this function does should be able to surface as an error on a customer's page.
 */
export function preloadFontFaces(): void {
  if (typeof document === 'undefined' || typeof document.fonts?.load !== 'function') return;
  try {
    void document.fonts.load(`${PANEL_WEIGHT} 16px "${FONT_FAMILY}"`).catch(() => {});
  } catch {
    /* nothing to do, and nothing worth telling the page about */
  }
}
