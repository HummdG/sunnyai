import { joinSunnyParts, renderSunnyParts, type RenderOptions, type SunnyParts } from './render.js';
import type { PartDrawing } from './traced-render.js';
import type { SunnyRig } from './rig.js';

/**
 * A long-lived Sunny on the page.
 *
 * `renderSunny` is a pure rig -> markup function, which is what makes frames
 * reproducible and testable. Rebuilding the whole SVG every frame is not: it
 * costs string building, parsing, style and layout sixty times a second and
 * destroys the node under the pointer mid-click. A view builds the SVG once
 * and afterwards:
 *
 * - skips a frame entirely when the rig and boil drawing are unchanged (the
 *   cartoon clock holds each pose for two or three display frames);
 * - updates the body and face transforms as attributes;
 * - re-parses only the named parts whose markup changed -- a blink touches one
 *   eye, a wave touches one arm.
 */
export interface SunnyView {
  /**
   * Draw a rig. Identical frames cost one comparison. Pass the `boil` from
   * `cartoonClock` for the hand-inked line shimmer.
   */
  draw(rig: SunnyRig, frame?: { boil?: number }): void;
  /** Remove the character from its host. */
  destroy(): void;
}

let viewCounter = 0;

export function createSunnyView(
  host: Element,
  options: Omit<RenderOptions, 'uniqueIds' | 'idPrefix'> = {},
): SunnyView {
  const idPrefix = `v${viewCounter++}-`;
  const doc = host.ownerDocument;
  let lastKey = '';
  let svgAttributes = '';
  let label = '';
  let rootNode: Element | null = null;
  let faceNode: Element | null = null;
  /**
   * Each part keeps one child group per boil drawing. A static part (a ray, a
   * brow) is parsed once per drawing and afterwards a boil tick only switches
   * which child is shown; a moving part rewrites only the visible child.
   */
  interface Slot {
    node: Element;
    transform: string;
    slots: Element[];
    inner: string[];
    shown: number;
  }
  const parts = new Map<string, Slot>();

  const rebuild = (drawn: SunnyParts): void => {
    // `renderSunny` output only: a computed rig whose one external string (the
    // tenant colour) is validated by `safePaint` before it reaches an attribute.
    const template = doc.createElement('template');
    template.innerHTML = joinSunnyParts(drawn);
    const svg = template.content.firstElementChild;
    if (!svg) return;
    host.replaceChildren(svg);
    svgAttributes = drawn.svgAttributes;
    label = drawn.label;
    rootNode = svg.querySelector('[data-layer="root"]');
    faceNode = svg.querySelector('[data-layer="face"]');
    parts.clear();
    for (const [key] of [...drawn.under, ...drawn.behind, ...drawn.face, ...drawn.over]) {
      const node = svg.querySelector(`[data-part="${key}"]`);
      if (!node) continue;
      node.replaceChildren();
      node.removeAttribute('transform');
      parts.set(key, { node, transform: '', slots: [], inner: [], shown: -1 });
    }
  };

  const slotFor = (part: Slot, index: number): Element => {
    while (part.slots.length <= index) {
      const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('display', 'none');
      part.node.append(g);
      part.slots.push(g);
      part.inner.push('');
    }
    return part.slots[index]!;
  };

  const update = (key: string, drawing: PartDrawing, boil: number): void => {
    const part = parts.get(key);
    if (!part) return;
    if (part.transform !== drawing.transform) {
      part.transform = drawing.transform;
      if (drawing.transform) part.node.setAttribute('transform', drawing.transform);
      else part.node.removeAttribute('transform');
    }
    const slot = slotFor(part, boil);
    if (part.inner[boil] !== drawing.inner) {
      part.inner[boil] = drawing.inner;
      slot.innerHTML = drawing.inner;
    }
    if (part.shown !== boil) {
      if (part.shown >= 0) part.slots[part.shown]?.setAttribute('display', 'none');
      slot.removeAttribute('display');
      part.shown = boil;
    }
  };

  return {
    draw(rig, frame) {
      const boil = frame?.boil;
      const key = `${boil ?? ''}|${JSON.stringify(rig)}`;
      if (key === lastKey) return;
      lastKey = key;
      const drawn = renderSunnyParts(rig, { ...options, idPrefix, boil });
      if (
        !rootNode ||
        !host.contains(rootNode) ||
        drawn.svgAttributes !== svgAttributes ||
        drawn.label !== label
      ) {
        rebuild(drawn);
      }
      if (rootNode && rootNode.getAttribute('transform') !== drawn.root) {
        rootNode.setAttribute('transform', drawn.root);
      }
      if (faceNode && faceNode.getAttribute('transform') !== drawn.faceTransform) {
        faceNode.setAttribute('transform', drawn.faceTransform);
      }
      const slot = boil ?? 0;
      for (const [k, drawing] of [...drawn.under, ...drawn.behind, ...drawn.face, ...drawn.over]) {
        update(k, drawing, slot);
      }
    },
    destroy() {
      lastKey = '';
      rootNode = null;
      faceNode = null;
      parts.clear();
      host.replaceChildren();
    },
  };
}

/**
 * Bring `host`'s SVG in line with `markup`, keeping every node whose tag and
 * position are unchanged. Exported for hosts that render markup themselves.
 */
export function patchSvg(host: Element, markup: string): void {
  const current = host.firstElementChild;
  // `renderSunny` output only: a computed rig whose one external string (the
  // tenant colour) is validated by `safePaint` before it reaches an attribute.
  const template = host.ownerDocument.createElement('template');
  template.innerHTML = markup;
  const next = template.content.firstElementChild;
  if (!next) return;
  if (!current || current.tagName !== next.tagName) {
    host.replaceChildren(next);
    return;
  }
  morph(current, next);
}

function morph(target: Element, source: Element): void {
  // Attributes: set what changed, drop what is gone.
  for (const attr of Array.from(source.attributes)) {
    if (target.getAttribute(attr.name) !== attr.value) target.setAttribute(attr.name, attr.value);
  }
  for (const attr of Array.from(target.attributes)) {
    if (!source.hasAttribute(attr.name)) target.removeAttribute(attr.name);
  }
  // Text-only nodes (a <title>) carry their content as text.
  if (source.childElementCount === 0) {
    if (target.childElementCount !== 0 || target.textContent !== source.textContent) {
      target.textContent = source.textContent;
    }
    return;
  }
  const targetKids = Array.from(target.children);
  const sourceKids = Array.from(source.children);
  for (let i = 0; i < sourceKids.length; i++) {
    const s = sourceKids[i]!;
    const t = targetKids[i];
    if (t && t.tagName === s.tagName) morph(t, s);
    else if (t) t.replaceWith(s);
    else target.append(s);
  }
  for (let i = sourceKids.length; i < targetKids.length; i++) targetKids[i]!.remove();
}

/** Drawings per second for character motion: film rate, animated "on ones". */
export const CARTOON_FPS = 24;
/** How often the ink "boils" to a new drawing, and how many drawings it cycles. */
export const BOIL_FPS = 8;
export const BOIL_DRAWINGS = 3;

/**
 * The 1930s cartoon clock.
 *
 * Hand-drawn animation does not move continuously: it advances in whole film
 * frames, and the ink lines are redrawn a few times a second so they never sit
 * quite still. Feed a frame loop's timestamp through this and pass `time` to
 * the animator and `boil` to the view, and the character moves on film frames
 * with a living line instead of gliding like a vector graphic.
 */
export function cartoonClock(now: number): { time: number; boil: number } {
  const frame = Math.floor((now * CARTOON_FPS) / 1000);
  return {
    time: (frame * 1000) / CARTOON_FPS,
    boil: Math.floor((now * BOIL_FPS) / 1000) % BOIL_DRAWINGS,
  };
}
