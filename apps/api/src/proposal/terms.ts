/**
 * The installer's terms and conditions, as pasted into Studio (often straight
 * from Word): split into headings, paragraphs and list items, keeping every
 * word and every list marker as written.
 *
 * Rules:
 * - `\r\n` (and a lone `\r` or a form feed) is a line break; tabs and runs of
 *   spaces become one space.
 * - A blank line ends a paragraph. A line that ends a sentence followed by a
 *   line that starts like a new one (a capital, a digit or a quote) also
 *   starts a new paragraph, because Word pastes one line per paragraph with
 *   no blank lines between. Any other line carries on the paragraph above (a
 *   hard-wrapped plain-text paste). A list item carries on only over a line
 *   that starts in lower case or was indented in the paste: Word bullets often
 *   have no full stop, so a capitalised line after one is read afresh (and
 *   may be a heading).
 * - A heading is a line under 80 characters that is in capitals, or that has
 *   no terminal punctuation and is followed by more text (not by a line that
 *   starts in lower case, which would be the same sentence carrying on).
 *   A numbered line in capitals (`1. DEFINITIONS`) is a heading, number kept,
 *   and so is a short unpunctuated numbered line above a paragraph that is
 *   not part of a numbered list (`2. Survey`).
 * - Lines starting `1.`, `2)`, `1.2`, `a)`, `(a)`, `(iv)`, `-`, `•`, `◦` or `*`
 *   are items; the marker is kept. A number with a dot needs a space after it,
 *   so `3.5% interest` and `12.30pm` stay text.
 */

export type TermsBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'item'; marker: string; text: string };

const ITEM =
  /^(\d+(?:\.\d+)+\.?(?=\s|$)|\d+\.(?=\s|$)|\d+\)|\(?[a-z]\)|\([ivx]+\)|[-*](?=\s)|[\u2022\u25e6\u2023\u25aa\u25cf\u25cb])\s*(.*)$/iu;
const TERMINAL = /[.!?;:,]["'\u201d\u2019)\]]*$/u;
const ENDS_SENTENCE = /[.!?;:]["'\u201d\u2019)\]]*$/u;
const STARTS_SENTENCE = /^["'\u201c\u2018(]?[\p{Lu}\d]/u;
const STARTS_LOWER = /^\p{Ll}/u;

function isCaps(line: string): boolean {
  const letters = line.match(/\p{L}/gu) ?? [];
  return letters.length >= 2 && !/\p{Ll}/u.test(line);
}

/**
 * A numbered line that titles what follows (`2. Survey` above a paragraph):
 * short, unpunctuated, not part of a numbered list (no numbered item just
 * before it or just after it) and followed by more text that is not its tail.
 */
function numberedHeading(
  marker: string,
  rest: string,
  prev: TermsBlock | undefined,
  next: { line: string; adjacent: boolean } | null,
): boolean {
  if (!/^\d/.test(marker) || rest === '' || TERMINAL.test(rest)) return false;
  if (prev?.kind === 'item' && /^\d/.test(prev.marker)) return false;
  if (!next || (next.adjacent && STARTS_LOWER.test(next.line))) return false;
  const after = ITEM.exec(next.line);
  return !(after && /^\d/.test(after[1]!));
}

export function parseTerms(text: string): TermsBlock[] {
  const raw = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').split('\n');
  const lines = raw.map((l) => l.replace(/[ \t]+/g, ' ').trim());
  // Indented in the paste: the wrapped tail of the list item above it.
  const indented = raw.map((l) => /^[ \t]/.test(l));

  const out: TermsBlock[] = [];
  let open: { kind: 'para' | 'item'; marker: string; parts: string[] } | null = null;
  const flush = () => {
    if (!open) return;
    const t = open.parts.join(' ');
    out.push(
      open.kind === 'item'
        ? { kind: 'item', marker: open.marker, text: t }
        : { kind: 'para', text: t },
    );
    open = null;
  };
  const nextLine = (i: number): { line: string; adjacent: boolean } | null => {
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] !== '') return { line: lines[j]!, adjacent: j === i + 1 };
    }
    return null;
  };

  lines.forEach((line, i) => {
    if (line === '') {
      flush();
      return;
    }
    const short = [...line].length < 80;
    const item = ITEM.exec(line);
    if (item) {
      const rest = item[2] ?? '';
      if (short && /^\d/.test(item[1]!) && isCaps(rest)) {
        flush();
        out.push({ kind: 'heading', text: line });
        return;
      }
      flush();
      if (short && numberedHeading(item[1]!, rest, out.at(-1), nextLine(i))) {
        out.push({ kind: 'heading', text: line });
        return;
      }
      open = { kind: 'item', marker: item[1]!, parts: rest ? [rest] : [] };
      return;
    }
    if (short && isCaps(line)) {
      flush();
      out.push({ kind: 'heading', text: line });
      return;
    }
    const current = open;
    const last = current?.parts.at(-1);
    // Word ends a bullet without a full stop, so an item only carries on over
    // a line that is plainly its wrapped tail (lower case or indented); any
    // other line goes through the heading test below.
    const carriesOn =
      current === null
        ? false
        : last === undefined ||
          (current.kind === 'item'
            ? STARTS_LOWER.test(line) || indented[i]!
            : !ENDS_SENTENCE.test(last) || !STARTS_SENTENCE.test(line));
    if (current !== null && carriesOn) {
      current.parts.push(line);
      return;
    }
    flush();
    const next = nextLine(i);
    if (short && !TERMINAL.test(line) && next && !(next.adjacent && STARTS_LOWER.test(next.line))) {
      out.push({ kind: 'heading', text: line });
      return;
    }
    open = { kind: 'para', marker: '', parts: [line] };
  });
  flush();
  return out;
}

// ---- Glyphs the bundled fonts lack ----------------------------------------

const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/gu;
// eslint-disable-next-line no-control-regex -- control characters are what it removes
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/gu;
const BULLETS = new Set([...'\u25e6\u2023\u25aa\u25a0\u25cf\u25cb\u25d8\u25d9\u2981\u2219\u2043']);
const DASHES = new Set([...'\u2010\u2011\u2012\u2013\u2014\u2015\u2212']);
const SINGLE_QUOTES = new Set([...'\u2018\u2019\u201a\u201b\u2032']);
const DOUBLE_QUOTES = new Set([...'\u201c\u201d\u201e\u201f\u2033']);
const SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/u;
const COMBINING = /\p{M}/gu;

/**
 * `text` with every character the font cannot draw replaced by one it can:
 * bullets by `•` (or `-`), dashes by `-`, curly quotes by straight ones,
 * odd spaces by a space, accented letters by their base letter, and anything
 * else by `?`, so the page never shows a missing-glyph box. Invisible
 * characters (zero-width spaces, soft hyphens, byte-order marks) are dropped
 * and control characters become spaces. Characters the font has, including
 * any em dashes the installer pasted, are kept as written.
 */
export function glyphSafe(text: string, has: (codePoint: number) => boolean): string {
  const ok = (s: string) => [...s].every((c) => has(c.codePointAt(0)!));
  let out = '';
  for (const ch of text.replace(INVISIBLE, '').replace(CONTROL, ' ')) {
    if (ch === '\n' || ok(ch)) {
      out += ch;
      continue;
    }
    if (BULLETS.has(ch) || ch === '•') out += has(0x2022) ? '•' : '-';
    else if (DASHES.has(ch)) out += '-';
    else if (SINGLE_QUOTES.has(ch)) out += "'";
    else if (DOUBLE_QUOTES.has(ch)) out += '"';
    else if (SPACES.test(ch)) out += ' ';
    else {
      const base = ch.normalize('NFKD').replace(COMBINING, '');
      out += base && base !== ch && ok(base) ? base : '?';
    }
  }
  return out;
}
