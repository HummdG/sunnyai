import { el } from './dom.js';

/**
 * The visitor's house from above (GET /v1/quote/roof-picture): Google's aerial
 * photo with the panels it fits on each roof face drawn over it, one colour a
 * face, and a key under it saying which way each face points.
 *
 * The photo is a data URL from Sunny's own API and the panels are SVG built
 * with `createElementNS` and numeric attributes, so nothing here is parsed as
 * markup. Every word goes in through `el()`'s textContent.
 */

export interface RoofPicture {
  width: number;
  height: number;
  image: string;
  imageryYear: number | null;
  faces: {
    facing: string;
    pitchDeg: number;
    areaM2: number;
    panelCount: number;
    colour: string;
    panels: [number, number, number, number, number][];
  }[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const COLOUR = /^#[0-9a-f]{6}$/i;

/** The picture, if the response has the shape the card reads; else null. */
export function parseRoofPicture(value: unknown): RoofPicture | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  if (!isNum(p['width']) || !isNum(p['height'])) return null;
  if (typeof p['image'] !== 'string' || !p['image'].startsWith('data:image/jpeg;base64,'))
    return null;
  if (!Array.isArray(p['faces'])) return null;
  for (const f of p['faces'] as Record<string, unknown>[]) {
    if (typeof f !== 'object' || f === null) return null;
    if (typeof f['facing'] !== 'string' || !isNum(f['pitchDeg']) || !isNum(f['areaM2']))
      return null;
    if (!isNum(f['panelCount'])) return null;
    if (typeof f['colour'] !== 'string' || !COLOUR.test(f['colour'])) return null;
    if (!Array.isArray(f['panels'])) return null;
    for (const r of f['panels'] as unknown[]) {
      if (!Array.isArray(r) || r.length !== 5 || !r.every(isNum)) return null;
    }
  }
  return value as RoofPicture;
}

const NS = 'http://www.w3.org/2000/svg';

function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The card: photo, panels over it, and the key. */
export function roofPictureCard(picture: RoofPicture): HTMLElement {
  const img = el('img', {
    src: picture.image,
    alt: 'Your house from above',
    width: String(picture.width),
    height: String(picture.height),
  });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${picture.width} ${picture.height}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'roof-pic-panels');
  for (const face of picture.faces) {
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('fill', face.colour);
    group.setAttribute('fill-opacity', '0.55');
    group.setAttribute('stroke', face.colour);
    group.setAttribute('stroke-width', '0.8');
    for (const [x, y, w, h, deg] of face.panels) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(x - w / 2));
      rect.setAttribute('y', String(y - h / 2));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('transform', `rotate(${deg} ${x} ${y})`);
      group.append(rect);
    }
    svg.append(group);
  }

  const key = el(
    'ul',
    { class: 'roof-pic-key' },
    picture.faces.map((f) => {
      const swatch = el('span', { class: 'roof-pic-swatch', 'aria-hidden': 'true' });
      swatch.style.background = f.colour;
      return el('li', {}, [
        swatch,
        `${capitalised(f.facing)}-facing, ${f.pitchDeg}° pitch, ${f.panelCount} panel${f.panelCount === 1 ? '' : 's'}`,
      ]);
    }),
  );
  const total = picture.faces.reduce((n, f) => n + f.panelCount, 0);
  return el('figure', { class: 'roof-pic' }, [
    el('div', { class: 'roof-pic-frame' }, [img, svg]),
    el('figcaption', {}, [
      el('p', {
        class: 'roof-pic-title',
        text:
          picture.faces.length > 1
            ? `Your roof from above: room for about ${total} panels across ${picture.faces.length} faces.`
            : `Your roof from above: room for about ${total} panels.`,
      }),
      key,
      el('p', {
        class: 'roof-pic-credit',
        text: `Aerial imagery: Google${picture.imageryYear ? `, ${picture.imageryYear}` : ''}. Panel positions are Google's estimate.`,
      }),
    ]),
  ]);
}
