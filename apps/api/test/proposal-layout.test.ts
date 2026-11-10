import PDFDocument from 'pdfkit';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import {
  PAGE,
  drawLogo,
  footer,
  header,
  registerFonts,
  readableAccent,
  readableRail,
  themeFor,
  type PageContext,
} from '../src/proposal/layout.js';
import { pdfText } from './pdf-text.js';

function channel(hex: string, i: number) {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}
function luminance(hex: string) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(channel(hex, 0)) + 0.7152 * f(channel(hex, 1)) + 0.0722 * f(channel(hex, 2));
}
const whiteContrast = (hex: string) => 1.05 / (luminance(hex) + 0.05);

function png(w: number, h: number, rgb = [200, 60, 20]): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    p.data[i * 4] = rgb[0]!;
    p.data[i * 4 + 1] = rgb[1]!;
    p.data[i * 4 + 2] = rgb[2]!;
    p.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(p);
}

function render(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  registerFonts(doc);
  draw(doc);
  doc.end();
  return done;
}

const ctx = (over: Partial<PageContext> = {}): PageContext => ({
  companyName: 'GreenRoof Solar Ltd',
  logo: null,
  theme: themeFor('#1f5c3d'),
  mcsNumber: 'MCS 12345',
  accreditationLogos: [],
  contact: { phone: '01603 000000', email: 'hello@greenroof.co.uk', website: null },
  ...over,
});

describe('themeFor', () => {
  it('darkens a bright brand until white text has 7:1 contrast', () => {
    const t = themeFor('#FF7900');
    expect(whiteContrast(t.railBg)).toBeGreaterThanOrEqual(7);
    expect(channel(t.railBg, 0)).toBeGreaterThan(channel(t.railBg, 2)); // still orange-hued
  });
  it('keeps navy as it is', () => {
    expect(themeFor('#0f2a3d').railBg.toLowerCase()).toBe('#0f2a3d');
  });
  it('falls back for a malformed colour', () => {
    expect(whiteContrast(themeFor('nope').railBg)).toBeGreaterThanOrEqual(7);
  });
  it('takes the rail from opts, darkened for white text, and flags it adjusted', () => {
    const t = themeFor('#0f2a3d', { rail: '#ffe066' });
    expect(whiteContrast(t.railBg)).toBeGreaterThanOrEqual(7);
    expect(t.railBg).not.toBe('#0f2a3d');
    expect(readableRail('#ffe066').adjusted).toBe(true);
    expect(readableRail('#ffe066').hex).toBe(t.railBg);
    expect(readableRail('#0f2a3d')).toEqual({ hex: '#0f2a3d', adjusted: false });
  });
  it('uses an explicit accent, darkened only if needed', () => {
    expect(themeFor('#0f2a3d', { accent: '#1f5c3d' }).accent).toBe('#1f5c3d');
    expect(readableAccent('#1f5c3d')).toEqual({ hex: '#1f5c3d', adjusted: false });
    const light = themeFor('#0f2a3d', { accent: '#ffe066' });
    expect(whiteContrast(light.accent)).toBeGreaterThanOrEqual(4.5);
    expect(readableAccent('#ffe066').adjusted).toBe(true);
  });
});

describe('fonts', () => {
  it('registers every face without throwing', async () => {
    const buf = await render((doc) => {
      for (const f of ['sans-300', 'sans-400', 'sans-600', 'sans-800', 'mono-400', 'mono-500']) {
        doc.font(f).fontSize(10).text(f);
      }
    });
    expect(buf.length).toBeGreaterThan(1000);
  });
});

describe('drawLogo', () => {
  const box = { x: 100, y: 100, w: 120, h: 40 };
  const within = (r: { x: number; y: number; w: number; h: number }) => {
    expect(r.x).toBeGreaterThanOrEqual(box.x - 0.01);
    expect(r.y).toBeGreaterThanOrEqual(box.y - 0.01);
    expect(r.x + r.w).toBeLessThanOrEqual(box.x + box.w + 0.01);
    expect(r.y + r.h).toBeLessThanOrEqual(box.y + box.h + 0.01);
  };
  it('fits a 10:1 wordmark and a square icon keeping aspect ratio', async () => {
    await render((doc) => {
      const wide = drawLogo(doc, png(500, 50), 'X', box, false);
      expect(wide.w / wide.h).toBeCloseTo(10, 1);
      within(wide);
      const square = drawLogo(doc, png(64, 64), 'X', box, false);
      expect(square.w / square.h).toBeCloseTo(1, 2);
      within(square);
    });
  });
  it('keeps the logo inside the box with a light plate on the dark rail', async () => {
    await render((doc) => {
      const r = drawLogo(doc, png(300, 100, [250, 250, 250]), 'X', box, true);
      within(r);
      expect(r.w / r.h).toBeCloseTo(3, 1);
    });
  });
  it('writes the company name when there is no logo', async () => {
    const buf = await render((doc) => {
      drawLogo(doc, null, 'GreenRoof Solar', box, false);
    });
    expect((await pdfText(buf))[0]).toContain('GreenRoof Solar');
  });
});

describe('header and footer', () => {
  it('stamps the footer with page count and the Sunny credit', async () => {
    const buf = await render((doc) => {
      doc.fontSize(12).text('body');
      header(doc, ctx({ logo: png(200, 40) }));
      footer(doc, ctx({ accreditationLogos: [png(80, 80)] }), 1, 6);
    });
    const pages = await pdfText(buf);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('01 / 06');
    expect(pages[0]).toContain('Prepared with Sunny');
    expect(pages[0]).toContain('MCS 12345');
    expect(pages[0]).toContain('GreenRoof Solar Ltd');
    expect(pages[0]).toContain('hello@greenroof.co.uk');
  });
  it('does not add pages or move the cursor', async () => {
    let before = 0;
    let after = 0;
    const buf = await render((doc) => {
      doc.text('body');
      before = doc.y;
      header(doc, ctx());
      footer(doc, ctx(), 1, 1);
      after = doc.y;
    });
    expect(after).toBe(before);
    expect(await pdfText(buf)).toHaveLength(1);
  });
  it('contains no em dashes', async () => {
    const buf = await render((doc) => footer(doc, ctx(), 2, 6));
    expect((await pdfText(buf)).join('')).not.toContain('—');
  });
  it('stamps buffered pages with their own numbers and adds none', async () => {
    const buf = await render((doc) => {
      doc.text('one');
      doc.addPage().text('two');
      doc.addPage().text('three');
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        header(doc, ctx());
        footer(doc, ctx(), i + 1, range.count);
      }
    });
    const pages = await pdfText(buf);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('01 / 03');
    expect(pages[1]).toContain('02 / 03');
    expect(pages[2]).toContain('03 / 03');
  });

  it('starts the footer at the page margin without a rail', async () => {
    const buf = await render((doc) =>
      footer(doc, ctx({ companyName: 'Zed' }), 1, 1, { hasRail: false }),
    );
    expect((await pdfText(buf))[0]).toContain('Zed');
  });

  it('embeds each logo once however many pages are stamped', async () => {
    const logo = png(200, 40);
    const acc = png(60, 60);
    const images = (buf: Buffer) =>
      (buf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
    const stamp = (pages: number) =>
      render((doc) => {
        for (let i = 1; i < pages; i++) doc.addPage();
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(range.start + i);
          const c = ctx({ logo, accreditationLogos: [acc] });
          header(doc, c);
          footer(doc, c, i + 1, range.count);
        }
      });
    const one = images(await stamp(1));
    const many = images(await stamp(12));
    expect(one).toBeGreaterThan(0);
    expect(many).toBe(one);
  });
});
