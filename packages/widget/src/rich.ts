import { el } from './dom.js';

/**
 * The assistant's reply, drawn from the light Markdown the model writes:
 * paragraphs, bullet and numbered lists, and **bold**. Built as elements with
 * text nodes, never `innerHTML`, so a reply carrying markup still shows it as
 * characters (see dom.ts).
 *
 * Citation markers ("[S1]", "[S2, S3]") are dropped from the prose: the sources
 * they point at are listed, as links, under the reply.
 */

const CITATION = /\s*\[S\d+(?:\s*,\s*S\d+)*\]/g;
const BULLET = /^\s*(?:[*•-])\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** One inline run of a reply: plain text, **bold**, or a link. */
export type InlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string };

// [label](https://...) or a bare https:// address. Only http(s) ever becomes a
// link: anything else (javascript:, data:) stays as the characters it is.
const LINKISH =
  /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<>"')\]]{1,2000})/g;

/** A safe http(s) address, or null. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function boldRuns(text: string): InlineRun[] {
  const out: InlineRun[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (part === '') continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    out.push(
      bold ? { kind: 'bold', text: bold[1]! } : { kind: 'text', text: part.replace(/\*\*/g, '') },
    );
  }
  return out;
}

/** A line of reply text as runs: links first, then **bold** in what is left. */
export function inlineRuns(text: string): InlineRun[] {
  const out: InlineRun[] = [];
  let at = 0;
  for (const match of text.matchAll(LINKISH)) {
    const start = match.index ?? 0;
    if (start > at) out.push(...boldRuns(text.slice(at, start)));
    const label = match[1];
    // A bare address keeps sentence punctuation (a trailing full stop) outside the link.
    const bare = match[3]?.replace(/[.,;:!?]+$/, '');
    const href = safeHref(match[2] ?? bare ?? '');
    if (href) {
      out.push({ kind: 'link', text: label ?? bare ?? href, href });
      at = start + (label !== undefined ? match[0].length : bare!.length);
    } else {
      out.push(...boldRuns(match[0]));
      at = start + match[0].length;
    }
  }
  if (at < text.length) out.push(...boldRuns(text.slice(at)));
  return out;
}

/** Inline runs as nodes: <strong> for bold, a new-tab <a> for links, text otherwise. */
function inline(text: string): (Node | string)[] {
  return inlineRuns(text).map((run) => {
    if (run.kind === 'bold') return el('strong', { text: run.text });
    if (run.kind === 'link') {
      return el('a', {
        text: run.text,
        href: run.href,
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    }
    return run.text;
  });
}

/** The reply text without citation markers, for anything that reads it as text. */
export function plainReply(text: string): string {
  return text.replace(CITATION, '');
}

/** Replace `target`'s contents with the formatted reply. Safe to call on every token. */
export function renderRich(target: HTMLElement, text: string): void {
  const blocks: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(el('p', {}, inline(paragraph.join(' '))));
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of plainReply(text).split('\n')) {
    const line = raw.trimEnd();
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const heading = HEADING.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) {
        flushList();
        list = el(tag);
      }
      list.append(el('li', {}, inline((bullet ? bullet[1] : numbered![2])!)));
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push(el('p', {}, [el('strong', { text: heading[1]!.replace(/\*\*/g, '') })]));
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  target.replaceChildren(...blocks);
}
