/**
 * Web pages into Markdown the chunker can cut well.
 *
 * The crawler hands this the raw HTML of an installer's page. What comes back
 * keeps the three things retrieval depends on -- headings (so a passage keeps
 * its "Warranty" title), tables (so a price stays next to its product), and
 * link URLs (so a citation can point somewhere) -- and drops the chrome every
 * page repeats: navigation, footers, cookie banners, scripts and styles. A
 * footer indexed two hundred times is two hundred passages that all match
 * "contact us" and say nothing.
 *
 * Pure and dependency-free, like the rest of this package. It is not a full
 * HTML parser and does not need to be: it reads well-formed-enough markup the
 * way a browser's reader mode does, and anything it cannot place it keeps as
 * text rather than dropping.
 */

export interface ConvertedPage {
  title: string | null;
  markdown: string;
}

/** Elements whose whole content is noise for retrieval. */
const DROP_WITH_CONTENT = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'canvas',
  'nav',
  'footer',
  'aside',
  'form',
  'button',
  'select',
  'dialog',
];

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  pound: '£',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  times: '×',
  frac12: '½',
  sup2: '²',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
}

function absolute(href: string, base: string | null): string | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  if (/^(javascript|mailto|tel|data):/i.test(trimmed)) {
    return /^(mailto|tel):/i.test(trimmed) ? trimmed : null;
  }
  try {
    return new URL(trimmed, base ?? undefined).toString();
  } catch {
    return null;
  }
}

/** Remove an element and everything inside it, nesting-aware for the same tag. */
function dropElements(html: string, tag: string): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const any = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  let out = '';
  let index = 0;
  for (;;) {
    open.lastIndex = index;
    const start = open.exec(html);
    if (!start) break;
    out += html.slice(index, start.index);
    // Self-closing (`<svg/>`) has no content to drop.
    if (/\/>$/.test(start[0])) {
      index = start.index + start[0].length;
      continue;
    }
    let depth = 1;
    any.lastIndex = start.index + start[0].length;
    let end = html.length;
    for (let m = any.exec(html); m; m = any.exec(html)) {
      depth += m[1] === '/' ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    index = end;
  }
  return out + html.slice(index);
}

/** The inner HTML of the first `<tag>`, nesting-aware, or null. */
function innerOf(html: string, tag: string): string | null {
  const start = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html);
  if (!start) return null;
  const any = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  any.lastIndex = start.index + start[0].length;
  let depth = 1;
  for (let m = any.exec(html); m; m = any.exec(html)) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start.index + start[0].length, m.index);
  }
  return html.slice(start.index + start[0].length);
}

function collapse(text: string): string {
  return text.replace(/[ \t\r\n\f\v\u00a0]+/g, ' ');
}

/** Text of a fragment with all tags removed, for table cells and titles. */
function plainText(fragment: string): string {
  return collapse(
    decodeEntities(fragment.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')),
  ).trim();
}

function tableToMarkdown(tableHtml: string): string {
  const rows: { cells: string[]; header: boolean }[] = [];
  for (const row of tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells: string[] = [];
    let header = false;
    for (const cell of row.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []) {
      if (/^<th/i.test(cell)) header = true;
      cells.push(plainText(cell.replace(/^<t[hd]\b[^>]*>|<\/t[hd]>$/gi, '')).replace(/\|/g, '\\|'));
    }
    if (cells.length > 0) rows.push({ cells, header });
  }
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.cells.length));
  const pad = (cells: string[]) => [...cells, ...Array<string>(width - cells.length).fill('')];
  const line = (cells: string[]) => `| ${pad(cells).join(' | ')} |`;
  const [head, ...rest] = rows;
  // The first row is the header whether or not it used <th>: a Markdown table
  // needs one, and the first row of a spec table is nearly always the labels.
  return [
    line(head!.cells),
    line(Array<string>(width).fill('---')),
    ...rest.map((r) => line(r.cells)),
  ].join('\n');
}

/**
 * Convert one page.
 *
 * `baseUrl` resolves relative links, so a link in a citation is one a visitor
 * can follow.
 */
export function htmlToMarkdown(html: string, baseUrl: string | null = null): ConvertedPage {
  let source = html.replace(/<!--[\s\S]*?-->/g, '');
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  let title = titleMatch ? plainText(titleMatch[1] ?? '') || null : null;

  const body = innerOf(source, 'body') ?? source;
  source = body;
  for (const tag of DROP_WITH_CONTENT) source = dropElements(source, tag);
  // Prefer the page's own statement of its main content when it makes one;
  // fall back to the whole body with the chrome removed.
  const main = innerOf(source, 'main') ?? innerOf(source, 'article');
  if (main !== null && plainText(main).length > 80) source = main;
  // A site header is mostly a logo and links; drop it unless it is all there is.
  const withoutHeader = dropElements(source, 'header');
  if (plainText(withoutHeader).length > 80) source = withoutHeader;

  // Tables first, as placeholders, so the inline pass cannot flatten them.
  const tables: string[] = [];
  source = source.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    tables.push(tableToMarkdown(table));
    return `\n\nTABLE${tables.length - 1}\n\n`;
  });

  const out: string[] = [];
  const lists: { ordered: boolean; count: number }[] = [];
  let link: { href: string | null; text: string } | null = null;
  let inPre = 0;

  const emit = (text: string): void => {
    if (link) link.text += text;
    else out.push(text);
  };

  const tokens = source.split(/(<[^>]+>)/);
  for (const token of tokens) {
    if (token === '') continue;
    if (token[0] !== '<') {
      const text = decodeEntities(token);
      emit(inPre > 0 ? text : collapse(text));
      continue;
    }
    const match = /^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/.exec(token);
    if (!match) {
      emit(collapse(decodeEntities(token)));
      continue;
    }
    const closing = match[1] === '/';
    const tag = (match[2] ?? '').toLowerCase();
    const attrs = match[3] ?? '';

    if (/^h[1-6]$/.test(tag)) {
      out.push(closing ? '\n\n' : `\n\n${'#'.repeat(Number(tag[1]))} `);
      continue;
    }
    switch (tag) {
      case 'p':
      case 'div':
      case 'section':
      case 'article':
      case 'main':
      case 'header':
      case 'blockquote':
      case 'figure':
      case 'figcaption':
      case 'dl':
      case 'dt':
      case 'dd':
      case 'address':
        out.push('\n\n');
        break;
      case 'br':
        out.push('\n');
        break;
      case 'hr':
        out.push('\n\n');
        break;
      case 'ul':
      case 'ol':
        if (closing) lists.pop();
        else lists.push({ ordered: tag === 'ol', count: 0 });
        out.push('\n');
        break;
      case 'li':
        if (!closing) {
          const list = lists[lists.length - 1];
          const depth = Math.max(0, lists.length - 1);
          const marker = list?.ordered ? `${(list.count += 1)}.` : '-';
          out.push(`\n${'  '.repeat(depth)}${marker} `);
        }
        break;
      case 'a':
        if (closing) {
          if (link) {
            const text = collapse(link.text).trim();
            if (text !== '') out.push(link.href ? `[${text}](${link.href})` : text);
            link = null;
          }
        } else {
          link = { href: absolute(attribute(attrs, 'href') ?? '', baseUrl), text: '' };
        }
        break;
      case 'strong':
      case 'b':
        emit('**');
        break;
      case 'pre':
        inPre += closing ? -1 : 1;
        out.push(closing ? '\n```\n\n' : '\n\n```\n');
        break;
      case 'td':
      case 'th':
        emit(' ');
        break;
      default:
        break;
    }
  }
  if (link) out.push(collapse(link.text));

  let markdown = out
    .join('')
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?![-\d])/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(#{1,6}) *\n+/gm, '')
    .trim();
  // Private-use sentinels: they cannot occur in a page's text.
  markdown = markdown.replace(/TABLE(\d+)/g, (_, i: string) => tables[Number(i)] ?? '');
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

  if (title === null) {
    const h1 = /^# (.+)$/m.exec(markdown);
    title = h1 ? (h1[1] ?? '').trim() || null : null;
  }
  return { title, markdown };
}
