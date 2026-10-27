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

/** Inline runs: **bold** becomes <strong>, everything else stays text. */
function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part === '') continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    out.push(bold ? el('strong', { text: bold[1]! }) : part.replace(/\*\*/g, ''));
  }
  return out;
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
