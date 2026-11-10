/**
 * An assistant reply as the visitor saw it in the widget: paragraphs, bullet
 * and numbered lists, **bold** and links, with the source markers ("[S1]",
 * "[S6, S7]") dropped. The same light Markdown the widget draws
 * (packages/widget/src/rich.ts), parsed to plain data so the inbox can render
 * it as React elements and never as HTML.
 */

export type RichRun =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string };

export type RichBlock = { kind: 'p'; runs: RichRun[] } | { kind: 'ul' | 'ol'; items: RichRun[][] };

const CITATION = /\s*\[S\d+(?:\s*,\s*S\d+)*\]/g;
const BULLET = /^\s*(?:[*•-])\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const LINKISH =
  /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<>"')\]]{1,2000})/g;

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function boldRuns(text: string): RichRun[] {
  const out: RichRun[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (part === '') continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    out.push(
      bold ? { kind: 'bold', text: bold[1]! } : { kind: 'text', text: part.replace(/\*\*/g, '') },
    );
  }
  return out;
}

export function richRuns(text: string): RichRun[] {
  const out: RichRun[] = [];
  let at = 0;
  for (const match of text.matchAll(LINKISH)) {
    const start = match.index ?? 0;
    if (start > at) out.push(...boldRuns(text.slice(at, start)));
    const label = match[1];
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

export function richBlocks(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<RichBlock, { kind: 'ul' | 'ol' }> | null = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'p', runs: richRuns(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of text.replace(CITATION, '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const heading = HEADING.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push(richRuns((bullet ? bullet[1] : numbered![2])!));
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'p', runs: [{ kind: 'bold', text: heading[1]!.replace(/\*\*/g, '') }] });
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
