import type { CatalogueIssue } from '@sunny/contracts';

/**
 * A small RFC 4180 reader, in the direction this product needs it.
 *
 * Installers do not export tidy files. They export what their spreadsheet or
 * their distributor's portal produced, which means quoted fields containing the
 * delimiter, addresses spanning two lines inside one cell, CRLF endings, a byte
 * order mark at the front, a semicolon instead of a comma because the machine
 * that wrote it is set to a European locale, and a trailing blank row. A parser
 * that handles the easy case and mangles the hard one does not fail loudly -- it
 * produces a row with a postcode for a model number, which is worse.
 *
 * So this is a real scanner rather than a split on a delimiter, and it returns
 * the problems it found instead of throwing: a file with one unreadable row
 * should import the other ninety-nine. What it deliberately does *not* do is
 * guess at a schema. Column meaning is `rows.ts`'s job; here a row is just
 * strings, keyed by the header exactly as the file spelled it.
 */

export interface CsvRow {
  /** 1-based line the record started on, so an error can point at the file. */
  line: number;
  /** Header name as written, to the cell's unescaped text. */
  values: Record<string, string>;
}

export type CsvDelimiter = ',' | ';' | '\t';

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
  delimiter: CsvDelimiter;
  /** Headers that appear more than once, in order of first appearance. */
  repeatedHeaders: string[];
  /** Structurally unusable: an unterminated quoted field, or nothing at all. */
  issues: CatalogueIssue[];
}

/**
 * Which separator the file uses, decided by counting candidates in the header
 * line -- outside quotes, because a single-column file whose only header is
 * "Notes, internal" would otherwise be read as comma-separated.
 *
 * Comma wins a tie, which is the common case and the safe default: a file with
 * no delimiter at all is more likely to be one comma-separated column than a
 * semicolon-separated one.
 */
function sniffDelimiter(firstLine: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) counts[char] += 1;
  }
  const ranked = (Object.entries(counts) as [CsvDelimiter, number][]).sort(
    (a, b) =>
      b[1] - a[1] ||
      // Comma, then semicolon, then tab, as the tie-break order.
      [',', ';', '\t'].indexOf(a[0]) - [',', ';', '\t'].indexOf(b[0]),
  );
  return ranked[0]![0];
}

export function parseCsv(text: string): CsvParseResult {
  // The BOM is invisible and would otherwise become part of the first header's
  // name, so "category" would not match the alias "category". One character of
  // trimming prevents a whole file failing to map.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const firstBreak = input.search(/\r\n|\n|\r/);
  const firstLine = firstBreak === -1 ? input : input.slice(0, firstBreak);
  const delimiter = sniffDelimiter(firstLine);

  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let unterminated = false;

  // A trailing newline must not produce a phantom empty record, so a record is
  // only pushed when something has been written into it. `cell.length` alone is
  // not enough: a row of empty quoted cells is `""`, which is a record.
  let started = false;

  const pushCell = (): void => {
    cells.push(cell);
    cell = '';
  };
  const pushRecord = (): void => {
    pushCell();
    if (started || cells.some((value) => value.trim() !== '')) {
      records.push({ line: recordLine, cells });
    }
    cells = [];
    started = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          // A doubled quote inside a quoted field is one literal quote.
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        else if (char === '\r') {
          // CRLF counts once; the LF that follows is skipped by the `\r\n` test.
          if (input[i + 1] !== '\n') line += 1;
        }
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      started = true;
      continue;
    }
    if (char === delimiter) {
      started = true;
      pushCell();
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      pushRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    cell += char;
  }

  if (quoted) unterminated = true;
  pushRecord();

  if (records.length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter,
      repeatedHeaders: [],
      issues: [
        {
          code: 'empty-file',
          severity: 'error',
          message: 'The file is empty.',
          rowNumber: null,
          column: null,
        },
      ],
    };
  }

  const headerCells = records.shift()!;
  const headers = headerCells.cells.map((value) => value.trim());
  const repeatedHeaders: string[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    if (header === '') continue;
    if (seen.has(header)) repeatedHeaders.push(header);
    seen.add(header);
  }

  const rows: CsvRow[] = records.map((record) => {
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header === '') return;
      // A short row is padded with empty strings and a long one is truncated
      // rather than shifting every later column by one -- the two readings of a
      // ragged row that do not silently mislabel the data.
      values[header] = (record.cells[index] ?? '').trim();
    });
    return { line: record.line, values };
  });

  // The header line is not reported in row numbers: a file whose problem is its
  // columns should not tell the installer to look at line 2 for it.
  return {
    headers,
    rows,
    delimiter,
    repeatedHeaders,
    issues: [
      ...repeatedHeaders.map<CatalogueIssue>((header) => ({
        code: 'duplicate-column',
        severity: 'error',
        message: `The column "${header}" appears twice; only the last one can be read.`,
        rowNumber: null,
        column: header,
      })),
      ...(unterminated
        ? [
            {
              code: 'unterminated-quote' as const,
              severity: 'error' as const,
              message: 'A quoted field is never closed, so the end of the file is missing.',
              rowNumber: null,
              column: null,
            },
          ]
        : []),
    ],
  };
}
