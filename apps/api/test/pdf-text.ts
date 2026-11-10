/** Test helper: the text of each page of a PDF, one string per page. */
export async function pdfText(buf: Buffer | Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  await loadingTask.destroy();
  return pages;
}

export interface PdfTextItem {
  str: string;
  /** Left edge, PDF points from the page's left. */
  x: number;
  /** Baseline, PDF points from the page's bottom (PDF y grows upwards). */
  y: number;
  width: number;
  height: number;
  /** The text matrix [a, b, c, d, e, f]; level text has b = c = 0 and a > 0. */
  transform: number[];
}

/** Test helper: each page's text items with their positions. */
export async function pdfItems(buf: Buffer | Uint8Array): Promise<PdfTextItem[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false });
  const doc = await loadingTask.promise;
  const pages: PdfTextItem[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      items.push({
        str: item.str,
        x: item.transform[4] as number,
        y: item.transform[5] as number,
        width: item.width,
        height: item.height,
        transform: item.transform as number[],
      });
    }
    pages.push(items);
  }
  await loadingTask.destroy();
  return pages;
}
