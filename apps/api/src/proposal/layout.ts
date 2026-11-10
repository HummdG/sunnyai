import { fileURLToPath } from 'node:url';

/**
 * Layout primitives for the quotation PDF ("the survey drawing"): fonts, a
 * theme derived from the installer's brand colour, a dark side rail, a logo
 * that always fits its box, and the running header and footer.
 *
 * Page modules never draw the header or footer. The orchestrator renders with
 * `bufferPages` and stamps both onto every page at the end, so `header` and
 * `footer` draw inside the page margins and leave `doc.x` / `doc.y` as found.
 */

export const PAGE = { width: 595.28, height: 841.89, margin: 40 } as const;
/** The dark rail's share of the page width on the cover and quotation pages. */
export const RAIL_FRACTION = 0.3;

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));

export interface Theme {
  ink: string;
  muted: string;
  rule: string;
  railBg: string;
  railText: string;
  railLabel: string;
  accent: string;
}

export interface PageContext {
  companyName: string;
  logo: Buffer | null;
  theme: Theme;
  mcsNumber: string;
  accreditationLogos: Buffer[];
  contact: { phone: string; email: string; website: string | null };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Doc = PDFKit.PDFDocument;
type Rgb = [number, number, number];

/** pdfkit decodes an image (to get its size) with `openImage`, which its typings omit. */
const openImage = (doc: Doc, buf: Buffer) =>
  (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(buf);

// ---- Theme ---------------------------------------------------------------

const DEFAULT_BRAND = '#0f2a3d';

function parse(hex: string): Rgb {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRAND;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}
const toHex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrastOnWhite = (rgb: Rgb) => 1.05 / (luminance(rgb) + 0.05);
const contrastBetween = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Scale towards black (keeping hue) until white text on it reaches `ratio`. */
function darkenUntil(rgb: Rgb, ratio: number): Rgb {
  let c = rgb;
  for (let i = 0; i < 60 && contrastOnWhite(c) < ratio; i++) {
    c = c.map((v) => v * 0.93) as Rgb;
  }
  return c;
}

/** Theme from the brand colour. The rail is the brand, darkened for 7:1 white text. */
export function themeFor(brandHex: string): Theme {
  const brand = parse(brandHex);
  const rail = darkenUntil(brand, 7);
  // Rail labels: the rail colour mixed towards white until 4.5:1 against it.
  let label = rail;
  for (let i = 1; i <= 20 && contrastBetween(label, rail) < 4.5; i++) {
    const t = i / 20;
    label = rail.map((v) => v + (255 - v) * t) as Rgb;
  }
  return {
    ink: '#171f26',
    muted: '#5b6b77',
    rule: '#c9d4db',
    railBg: toHex(rail),
    railText: '#ffffff',
    railLabel: toHex(label),
    accent: toHex(darkenUntil(brand, 4.5)),
  };
}

// ---- Fonts ---------------------------------------------------------------

const FONTS: Record<string, string> = {
  'sans-300': 'InterTight-Light.ttf',
  'sans-400': 'InterTight-Regular.ttf',
  'sans-600': 'InterTight-SemiBold.ttf',
  'sans-800': 'InterTight-ExtraBold.ttf',
  'mono-400': 'IBMPlexMono-Regular.ttf',
  'mono-500': 'IBMPlexMono-Medium.ttf',
};

export function registerFonts(doc: Doc): void {
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, `${FONT_DIR}${file}`);
}

// ---- Primitives ----------------------------------------------------------

/** A small uppercase monospace label. Returns the y just below it. */
export function label(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  opts: { width?: number; color?: string; align?: 'left' | 'right' | 'center'; size?: number } = {},
): number {
  const size = opts.size ?? 6.8;
  const width = opts.width ?? PAGE.width - PAGE.margin - x;
  const upper = text.toUpperCase();
  doc
    .font('mono-400')
    .fontSize(size)
    .fillColor(opts.color ?? '#5b6b77');
  const o = { width, align: opts.align ?? 'left', characterSpacing: 0.6 } as const;
  const h = doc.heightOfString(upper, o);
  doc.text(upper, x, y, o);
  return y + h + 3;
}

/** Fills the left rail; returns the inner content column (x and width). */
export function rail(doc: Doc, theme: Theme, widthFraction: number): { x: number; width: number } {
  const w = PAGE.width * widthFraction;
  doc.save().rect(0, 0, w, PAGE.height).fill(theme.railBg).restore();
  const pad = 22;
  return { x: pad, width: w - pad * 2 };
}

const PLATE_PAD = 4;

/**
 * Draws the logo inside `box`, keeping its aspect ratio (left aligned,
 * vertically centred) and returns the rect it drew. With no PNG, the company
 * name is set in sans-800. On the dark rail (`onDark`) a PNG always sits on a
 * white plate (the logo is inset by the plate padding so the plate stays in the
 * box): we cannot know a logo is near-white without decoding it, and a white
 * plate is harmless behind a dark one.
 */
export function drawLogo(
  doc: Doc,
  png: Buffer | null,
  fallbackName: string,
  box: Rect,
  onDark: boolean,
): Rect {
  const saveX = doc.x;
  const saveY = doc.y;
  let drawn: Rect;
  let image: { width: number; height: number } | null = null;
  if (png) {
    try {
      image = openImage(doc, png);
    } catch {
      image = null;
    }
  }
  if (png && image) {
    const pad = onDark ? PLATE_PAD : 0;
    const aw = Math.max(1, box.w - pad * 2);
    const ah = Math.max(1, box.h - pad * 2);
    const scale = Math.min(aw / image.width, ah / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    drawn = { x: box.x + pad, y: box.y + pad + (ah - h) / 2, w, h };
    if (onDark) {
      doc
        .save()
        .roundedRect(drawn.x - pad, drawn.y - pad, w + pad * 2, h + pad * 2, 2)
        .fill('#ffffff')
        .restore();
    }
    doc.image(png, drawn.x, drawn.y, { width: w, height: h });
  } else {
    doc.font('sans-800');
    let size = Math.min(box.h * 0.7, 20);
    doc.fontSize(size);
    while (size > 6 && doc.widthOfString(fallbackName) > box.w) doc.fontSize((size -= 0.5));
    const w = Math.min(doc.widthOfString(fallbackName), box.w);
    const h = doc.currentLineHeight();
    drawn = { x: box.x, y: box.y + (box.h - h) / 2, w, h };
    doc
      .fillColor(onDark ? '#ffffff' : '#171f26')
      .text(fallbackName, drawn.x, drawn.y, { width: box.w, height: h, lineBreak: false });
  }
  doc.x = saveX;
  doc.y = saveY;
  return drawn;
}

// ---- Header and footer ---------------------------------------------------

/** Runs `draw` with the page margins removed so text in them cannot add a page. */
function inMargins(doc: Doc, draw: () => void): void {
  const { x, y } = doc;
  const margins = doc.page.margins;
  const saved = { ...margins };
  margins.top = 0;
  margins.bottom = 0;
  try {
    draw();
  } finally {
    Object.assign(margins, saved);
    doc.x = x;
    doc.y = y;
  }
}

/** The installer's logo (or name), top right, clear of the rail. */
export function header(doc: Doc, ctx: PageContext): void {
  inMargins(doc, () => {
    const w = 120;
    drawLogo(
      doc,
      ctx.logo,
      ctx.companyName,
      { x: PAGE.width - PAGE.margin - w, y: 12, w, h: 22 },
      false,
    );
  });
}

const FOOT_LEFT = PAGE.width * 0.34;
const DOT = '  ·  ';

/** Company, MCS number, accreditations, contact, `NN / MM`, and the Sunny credit. */
export function footer(doc: Doc, ctx: PageContext, page: number, of: number): void {
  inMargins(doc, () => {
    const right = PAGE.width - PAGE.margin;
    const line1 = PAGE.height - 38;
    const line2 = PAGE.height - 25;
    doc
      .save()
      .moveTo(FOOT_LEFT, line1 - 6)
      .lineTo(right, line1 - 6)
      .lineWidth(0.5)
      .stroke(ctx.theme.rule)
      .restore();

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const left = [ctx.companyName, ctx.mcsNumber].filter(Boolean).join(DOT);
    const pageText = `${pad2(page)} / ${pad2(of)}`;

    doc.font('mono-400').fontSize(6.8).fillColor(ctx.theme.muted);
    const pageW = doc.widthOfString(pageText, { characterSpacing: 0.4 });
    doc.text(pageText, right - pageW, line1, { lineBreak: false, characterSpacing: 0.4 });

    const leftMax = right - pageW - 12 - FOOT_LEFT;
    doc.font('sans-600').fontSize(7).fillColor(ctx.theme.ink);
    doc.text(left, FOOT_LEFT, line1, { width: leftMax, lineBreak: false, ellipsis: true });
    let cursor = FOOT_LEFT + Math.min(doc.widthOfString(left), leftMax) + 8;
    for (const logo of ctx.accreditationLogos.slice(0, 8)) {
      let image: { width: number; height: number };
      try {
        image = openImage(doc, logo);
      } catch {
        continue;
      }
      // At most 14pt tall, and no wider than 40pt.
      const scale = Math.min(14 / image.height, 40 / image.width);
      const w = image.width * scale;
      const h = image.height * scale;
      if (cursor + w > right - pageW - 12) break;
      doc.image(logo, cursor, line1 - 3 + (14 - h) / 2, { width: w, height: h });
      cursor += w + 5;
    }

    const contact = [ctx.contact.phone, ctx.contact.email, ctx.contact.website]
      .filter(Boolean)
      .join(DOT);
    doc.font('sans-400').fontSize(6.8).fillColor(ctx.theme.muted);
    const credit = 'Prepared with Sunny';
    const creditW = doc.widthOfString(credit);
    doc.text(credit, right - creditW, line2, { lineBreak: false });
    doc.text(contact, FOOT_LEFT, line2, {
      width: right - creditW - 12 - FOOT_LEFT,
      lineBreak: false,
      ellipsis: true,
    });
  });
}
