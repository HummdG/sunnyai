/**
 * The lab's one DOM helper.
 *
 * In its own module rather than in `lab.ts` because two surfaces need it --
 * the page itself and the tic-tac-toe board -- and a shared import would be a
 * cycle: `lab.ts` builds the board, so the board cannot import from `lab.ts`.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children);
  return node;
}
