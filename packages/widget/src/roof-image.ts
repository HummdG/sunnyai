import { el } from './dom.js';

/**
 * The visitor's house from above (GET /v1/quote/roof-picture): Google's aerial
 * photo with each roof face washed in its own colour. It is there for one
 * thing: the visitor looks at it and says whether it is their house. How many
 * panels fit, and where, is Sunny's sum to do, so nothing of it is shown here
 * (the response still carries the panels, for the installer's dashboard).
 *
 * The photo is a data URL from Sunny's own API, so nothing here is parsed as
 * markup. Every word goes in through `el()`'s textContent.
 */

export interface RoofPicture {
  width: number;
  height: number;
  image: string;
  imageryYear: number | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The picture, if the response has the shape the card reads; else null. */
export function parseRoofPicture(value: unknown): RoofPicture | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  if (!isNum(p['width']) || !isNum(p['height']) || p['width'] <= 0 || p['height'] <= 0) return null;
  if (typeof p['image'] !== 'string' || !p['image'].startsWith('data:image/jpeg;base64,'))
    return null;
  return {
    width: p['width'],
    height: p['height'],
    image: p['image'],
    imageryYear: isNum(p['imageryYear']) ? p['imageryYear'] : null,
  };
}

/** The card: the photo, and where it came from. The question is Sunny's message. */
export function roofPictureCard(picture: RoofPicture): HTMLElement {
  const img = el('img', {
    src: picture.image,
    alt: 'The address from above, with each part of the roof in its own colour',
    width: String(picture.width),
    height: String(picture.height),
  });
  return el('figure', { class: 'roof-pic' }, [
    el('div', { class: 'roof-pic-frame' }, [img]),
    el('figcaption', {}, [
      el('p', {
        class: 'roof-pic-credit',
        text: `Aerial imagery: Google${picture.imageryYear ? `, ${picture.imageryYear}` : ''}.`,
      }),
    ]),
  ]);
}
