/**
 * Unfinished text an installer has not filled in yet.
 *
 * Knowledge bases are written from templates, and templates are full of things
 * like "call us on XXXXX XXXXXX", "[insert support link]", or a checklist whose
 * every row still says "To do". Indexing them is fine -- the surrounding advice
 * is real -- but quoting them is not: an assistant that tells a customer with a
 * safety concern to ring "XXXXX XXXXXX" has failed them at exactly the moment
 * it mattered.
 *
 * So ingestion finds them, reports them to the installer as warnings on the
 * source (with the section they sit in, so they can be fixed), and marks every
 * chunk that contains one. Retrieval then masks the placeholder in what it hands
 * the model, so it cannot be quoted verbatim.
 */

export type PlaceholderKind = 'placeholder' | 'unfinished';

export interface PlaceholderFinding {
  kind: PlaceholderKind;
  /** The text as it appears in the document. */
  text: string;
  /** The heading path it sits under, joined with " › ", or null at the top. */
  section: string | null;
}

interface Pattern {
  kind: PlaceholderKind;
  regex: RegExp;
}

const PATTERNS: readonly Pattern[] = [
  // Masked numbers and names: "XXXXX XXXXXX", "0800 XXX XXXX", "xx-xx-xx".
  { kind: 'placeholder', regex: /\b(?:[0-9]+[ -]?)?X{3,}(?:[ -]?X{2,})*\b/g },
  { kind: 'placeholder', regex: /\bx{2}-x{2}-x{2}\b/gi },
  // Bracketed and templated fields: "[insert phone]", "{{company}}", "<<link>>".
  {
    kind: 'placeholder',
    regex:
      /\[(?:insert|add|your|company|installer|phone|telephone|number|email|e-mail|link|url|website|name|address|tbc|tbd|todo|to do|placeholder|details?)\b[^\]\n]{0,80}\]/gi,
  },
  { kind: 'placeholder', regex: /\{\{[^}\n]{1,60}\}\}|<<[^>\n]{1,60}>>/g },
  { kind: 'placeholder', regex: /\b(?:TBC|TBD|lorem ipsum)\b/g },
  // Notes to the author rather than to the customer.
  {
    kind: 'unfinished',
    regex:
      /\b(?:replace|fill in|update) (?:all|the|these)? ?(?:bracketed )?placeholders?\b[^\n.]*\.?/gi,
  },
  // A checklist row still marked as outstanding.
  { kind: 'unfinished', regex: /^\|\s*(?:to do|todo|tbc|pending)\s*\|[^\n]*$/gim },
];

/** Every placeholder in a piece of text, in order of appearance, without sections. */
export function placeholdersIn(
  text: string,
): { kind: PlaceholderKind; text: string; index: number }[] {
  const found: { kind: PlaceholderKind; text: string; index: number }[] = [];
  for (const { kind, regex } of PATTERNS) {
    regex.lastIndex = 0;
    for (let m = regex.exec(text); m; m = regex.exec(text)) {
      const value = m[0].trim();
      if (value !== '') found.push({ kind, text: value, index: m.index });
      if (m[0].length === 0) regex.lastIndex += 1;
    }
  }
  // Drop matches wholly inside another (a masked number inside a template note).
  found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  return found.filter(
    (f, i) =>
      !found.some(
        (g, j) =>
          j !== i &&
          g.index <= f.index &&
          g.index + g.text.length >= f.index + f.text.length &&
          g.text.length > f.text.length,
      ),
  );
}

/**
 * Placeholders in a whole Markdown document, each with the heading path it sits
 * under -- the warning an installer needs in order to find and fix it.
 */
export function findPlaceholders(markdown: string): PlaceholderFinding[] {
  const out: PlaceholderFinding[] = [];
  const path: string[] = [];
  let offset = 0;
  const lines = markdown.split('\n');
  const starts: { index: number; section: string | null }[] = [];
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      const level = heading[1]!.length;
      path.length = Math.min(path.length, level - 1);
      path[level - 1] = (heading[2] ?? '').trim();
    }
    starts.push({ index: offset, section: path.filter(Boolean).join(' › ') || null });
    offset += line.length + 1;
  }
  for (const found of placeholdersIn(markdown)) {
    let section: string | null = null;
    for (const start of starts) {
      if (start.index > found.index) break;
      section = start.section;
    }
    out.push({ kind: found.kind, text: found.text, section });
  }
  return out;
}

/**
 * The text with every placeholder replaced by a marker the model can read but
 * cannot pass off as a real detail.
 */
export function maskPlaceholders(text: string): string {
  let out = text;
  for (const found of placeholdersIn(text).sort((a, b) => b.index - a.index)) {
    const marker =
      found.kind === 'placeholder'
        ? '[not yet provided by the installer]'
        : '[internal note to the installer, not for customers]';
    out = out.slice(0, found.index) + marker + out.slice(found.index + found.text.length);
  }
  return out;
}
