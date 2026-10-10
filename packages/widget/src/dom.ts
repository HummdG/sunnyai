/**
 * A very small element builder.
 *
 * The widget has to create its whole UI in the shadow root without shipping a
 * framework to every customer's page, and without `innerHTML` for anything that
 * contains a value from the network. Every message the assistant writes goes
 * through `textContent`, so a model that emits `<img onerror=...>` renders it as
 * those literal characters rather than as markup. That is the entire reason this
 * helper exists instead of a template string.
 */

type Attrs = Record<string, string | number | boolean | undefined | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Replace an element's children with a parsed SVG document. */
export function setSvg(host: Element, markup: string): void {
  // `renderSunny` produces the markup, so this is the one `innerHTML` in the
  // widget -- and its input is a rig we computed, never a string from a server
  // or a model.
  host.innerHTML = markup;
}
