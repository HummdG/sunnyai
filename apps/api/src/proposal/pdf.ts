import PDFDocument from 'pdfkit';

import type { ProposalDoc } from './doc.js';
import { PAGE, footer, header, registerFonts, themeFor, type PageContext } from './layout.js';
import { drawCover } from './pages/cover.js';
import { drawPerformance, PERFORMANCE_HAS_RAIL } from './pages/performance.js';
import { MAIN_W, MAIN_X } from './pages/parts.js';
import { drawQuotation, type QuotationEnd } from './pages/quotation.js';
import { drawSavings, SAVINGS_HAS_RAIL } from './pages/savings.js';
import { drawSystem, SYSTEM_HAS_RAIL } from './pages/system.js';
import { drawTerms, hasTerms, TERMS_HAS_RAIL } from './pages/terms.js';

/**
 * The quotation PDF ("the survey drawing"): a stored quote, branded as the
 * installer, in the installer's settings as they stood when the quote was made
 * (`doc.snapshot`). Sunny appears only as "Prepared with Sunny" in the footer.
 *
 * Pages, in order: Cover, Your system, Performance, Savings, Estimated
 * quotation, Terms and conditions. Cover and Quotation are always on; the
 * others follow the snapshot's section switches (Terms only when there is text
 * to print). With Performance off the Quotation carries the MCS block; with
 * Your system off it carries "Other options we looked at".
 *
 * Each page module draws its own content (and any continuation pages). The
 * document is rendered with buffered pages, then every page gets the footer
 * (`NN / MM`) and, on pages without the dark rail, the header logo: the rail
 * already carries the installer's logo or name.
 *
 * Everything printed comes from `doc`, which comes from the stored quote, so a
 * re-download is the same document, byte for byte: the PDF's dates are the
 * quote's `createdAt`, never the render time.
 */

/** The roof facts the System page lists, from the quote's roof assessment. */
export interface ProposalRoof {
  bestFacing: string | null;
  pitchDeg: number | null;
  usableRoofAreaM2: number | null;
  estimatedMaxPanels: number | null;
  reliable: boolean;
  label: string | null;
}

/** Render the quotation PDF; resolves to the PDF bytes. */
export async function renderProposal(doc: ProposalDoc): Promise<Buffer> {
  const snap = doc.snapshot;
  const theme = themeFor(snap.colour, {
    ...(snap.colours?.rail ? { rail: snap.colours.rail } : {}),
    ...(snap.colours?.accent ? { accent: snap.colours.accent } : {}),
  });
  const created = new Date(doc.quote.createdAt);
  const forWhom =
    doc.customer.name ?? doc.customer.address ?? `postcode ${doc.quote.basis.postcode}`;

  const pdf = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `Solar estimate for ${forWhom}`,
      Author: snap.companyName,
      Creator: 'Sunny',
      // The quote's date, so the same quote always renders the same bytes.
      CreationDate: Number.isNaN(created.getTime()) ? new Date(0) : created,
    },
  });
  registerFonts(pdf);
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const on = snap.sections;
  const termsOn = on.terms && hasTerms(doc);
  /** Whether each page carries the dark rail, by page index. */
  const rail: boolean[] = [];
  const pageCount = () => pdf.bufferedPageRange().count;
  const section = (hasRail: boolean, draw: () => void) => {
    if (rail.length > 0) pdf.addPage();
    const first = pageCount() - 1;
    draw();
    for (let i = first; i < pageCount(); i++) rail[i] = hasRail;
  };

  section(true, () => drawCover(pdf, doc, theme));
  if (on.system) section(SYSTEM_HAS_RAIL, () => drawSystem(pdf, doc, theme, { othersHere: true }));
  if (on.performance) section(PERFORMANCE_HAS_RAIL, () => drawPerformance(pdf, doc, theme));
  if (on.savings) section(SAVINGS_HAS_RAIL, () => drawSavings(pdf, doc, theme));
  let end: QuotationEnd = { y: 0, continued: false };
  section(true, () => {
    end = drawQuotation(pdf, doc, theme, {
      mcsBlock: !on.performance,
      termsFollow: termsOn,
      othersHere: !on.system,
    });
  });
  if (termsOn && end.continued) {
    // The quotation ran onto a page of its own: the terms start beneath it
    // there, so that page is never left nearly empty.
    const from = pageCount();
    drawTerms(pdf, doc, theme, { x: MAIN_X, w: MAIN_W, y: end.y + 22 });
    for (let i = from; i < pageCount(); i++) rail[i] = TERMS_HAS_RAIL;
  } else if (termsOn) {
    section(TERMS_HAS_RAIL, () => drawTerms(pdf, doc, theme));
  }

  const ctx: PageContext = {
    companyName: snap.companyName,
    logo: doc.logo,
    theme,
    mcsNumber: snap.accreditations.mcsNumber,
    accreditationLogos: doc.accreditationLogos,
    // The company's contact; older snapshots without it fall back to the signer's.
    contact: snap.contact ?? {
      phone: snap.signer.phone,
      email: snap.signer.email,
      website: snap.website,
    },
  };
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    const hasRail = rail[i] ?? false;
    if (!hasRail) header(pdf, ctx);
    footer(pdf, ctx, i + 1, range.count, { hasRail });
  }

  pdf.end();
  return done;
}
