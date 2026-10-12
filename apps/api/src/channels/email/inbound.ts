/**
 * Inbound email: one normalised shape from every provider, and the
 * sanitisation that turns an untrusted email into text the core can be given.
 *
 * Everything in an email is untrusted -- the body, the subject, the display
 * name, the quoted thread. The tenant is never read from it (the webhook route
 * or the mailbox decides that), the HTML is reduced to text, invisible and
 * direction-changing characters are removed, and the result is capped before
 * the core wraps it in <user_query> (Blueprint §4.3, §5 "indirect prompt
 * injection").
 */

export interface Address {
  address: string;
  name: string | null;
}

export interface InboundEmail {
  source: 'postmark' | 'sendgrid' | 'gmail';
  /** The provider's own id (Gmail message id), when there is one. */
  providerMessageId: string | null;
  /** The provider's thread id (Gmail), used to file the draft in the thread. */
  providerThreadId: string | null;
  /** RFC 5322 Message-ID, with angle brackets. */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  /** Envelope recipients, when the provider reports them (routing, not content). */
  recipients: string[];
  subject: string;
  /** The body as plain text (HTML already reduced). */
  text: string;
  date: string | null;
  /** Lower-cased header names. */
  headers: Record<string, string>;
}

// ─── text ────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  pound: '£',
  euro: '€',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * HTML to plain text. Not a renderer: enough to read what a person wrote, with
 * everything that could carry hidden content (scripts, styles, comments, the
 * head) removed rather than flattened into the text.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|head|title|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
      // Text styled to be invisible is a classic hiding place for instructions.
      .replace(
        /<([a-z]+)\b[^>]*style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi,
        '',
      )
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<blockquote\b[^>]*>/gi, '\n> ')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Zero-width, bidi-override and other invisible formatting characters. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split the new part of a message from the thread it quotes. The quoted part is
 * still the current thread (Blueprint: "the current incoming email thread"), so
 * it is kept -- but second, and shorter.
 */
export function splitQuoted(text: string): { latest: string; quoted: string } {
  const lines = text.split('\n');
  const markers = [
    /^On .{4,200} wrote:\s*$/,
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^From:\s.+$/,
    /^_{10,}$/,
  ];
  let cut = lines.findIndex((line, i) => {
    if (markers.some((m) => m.test(line.trim()))) return true;
    // A run of quoted lines (">") that continues to the end of the message.
    return (
      line.startsWith('>') && lines.slice(i).every((l) => l.startsWith('>') || l.trim() === '')
    );
  });
  if (cut === -1) cut = lines.length;
  return {
    latest: lines.slice(0, cut).join('\n').trim(),
    quoted: lines
      .slice(cut)
      .map((l) => l.replace(/^>+\s?/, ''))
      .join('\n')
      .trim(),
  };
}

/** The characters of an email the core is given: new text first, then thread. */
export const MAX_LATEST_CHARS = 3000;
export const MAX_QUOTED_CHARS = 1500;
export const MAX_SUBJECT_CHARS = 200;

/**
 * The message the core answers. Plain text with the subject and the new text;
 * the quoted thread follows under a label, cut short. The core escapes and
 * wraps all of it in <user_query>, so nothing here can close the tag.
 */
export function messageForCore(email: InboundEmail): string {
  const { latest, quoted } = splitQuoted(email.text);
  const subject = email.subject.slice(0, MAX_SUBJECT_CHARS);
  const parts = [`Subject: ${subject}`, '', clip(latest || '(no message text)', MAX_LATEST_CHARS)];
  if (quoted) {
    parts.push('', '[Earlier in this email thread]', clip(quoted, MAX_QUOTED_CHARS));
  }
  return parts.join('\n');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()} […]`;
}

/**
 * Phrases that try to give the assistant instructions from inside an email.
 * Detection does not change the defence -- the email is untrusted data either
 * way -- but a suspicious email is never auto-sent and the draft is marked for
 * the reviewer.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)\b/i,
  /\b(system|developer) prompt\b/i,
  /\byou are now\b/i,
  /\b(forward|send|bcc|cc) (all|every|the other|other customers'?) (emails?|messages|inbox)\b/i,
  /\bdisregard (your|the) (rules|instructions|guidelines)\b/i,
  /<\/?(system_instructions|verified_context|user_query)>/i,
  /\bnew instructions?:/i,
  /\bact as\b.{0,40}\b(admin|developer|system)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

/**
 * Mail that is not a person writing: auto-replies, bounces, newsletters. The
 * assistant never answers these -- answering an out-of-office with a draft is
 * noise, and auto-replying to an auto-reply is a mail loop.
 */
export function isAutomated(email: InboundEmail): string | null {
  const h = email.headers;
  const auto = h['auto-submitted'];
  if (auto && auto.trim().toLowerCase() !== 'no') return 'auto-submitted';
  const precedence = h['precedence']?.toLowerCase();
  if (precedence && /\b(bulk|junk|list|auto_reply)\b/.test(precedence)) return 'bulk';
  if (h['list-id'] || h['list-unsubscribe']) return 'mailing list';
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']?.match(/all|oof/i)) {
    return 'auto-reply';
  }
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)@/i.test(email.from.address)) {
    return 'system sender';
  }
  if (
    /^(out of (the )?office|automatic reply|auto(matic)?[- ]?reply|undeliverable|delivery status notification)/i.test(
      email.subject.trim(),
    )
  ) {
    return 'auto-reply';
  }
  return null;
}

// ─── addresses ───────────────────────────────────────────────────────────────

const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function isAddress(text: string): boolean {
  return ADDRESS.test(text);
}

/** Parse `Name <addr@x>` / `addr@x`, comma-separated. Invalid entries are dropped. */
export function parseAddressList(raw: string | undefined | null): Address[] {
  if (!raw) return [];
  const out: Address[] = [];
  for (const part of raw.match(/(?:"[^"]*"|[^,])+/g) ?? []) {
    const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(part);
    const address = (match ? match[2]! : part).trim().toLowerCase();
    if (!isAddress(address)) continue;
    const name = match?.[1]?.trim() || null;
    out.push({ address, name });
  }
  return out;
}

function headerMap(entries: Array<{ name: string; value: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { name, value } of entries) {
    const key = name.toLowerCase();
    map[key] = map[key] ? `${map[key]}, ${value}` : value;
  }
  return map;
}

function referencesFrom(value: string | undefined): string[] {
  return (value ?? '').match(/<[^<>\s]+>/g) ?? [];
}

function firstId(value: string | undefined): string | null {
  return referencesFrom(value)[0] ?? null;
}

// ─── Postmark ────────────────────────────────────────────────────────────────

interface PostmarkInbound {
  MessageID?: string;
  From?: string;
  FromFull?: { Email?: string; Name?: string };
  To?: string;
  ToFull?: Array<{ Email?: string; Name?: string }>;
  Cc?: string;
  CcFull?: Array<{ Email?: string; Name?: string }>;
  OriginalRecipient?: string;
  Subject?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: Array<{ Name?: string; Value?: string }>;
}

function fullList(list: Array<{ Email?: string; Name?: string }> | undefined): Address[] {
  return (list ?? [])
    .map((e) => ({ address: (e.Email ?? '').trim().toLowerCase(), name: e.Name?.trim() || null }))
    .filter((e) => isAddress(e.address));
}

export function parsePostmark(body: unknown): InboundEmail {
  if (typeof body !== 'object' || body === null) throw new Error('Expected a JSON object.');
  const p = body as PostmarkInbound;
  const headers = headerMap(
    (p.Headers ?? [])
      .filter((h) => typeof h.Name === 'string' && typeof h.Value === 'string')
      .map((h) => ({ name: h.Name!, value: h.Value! })),
  );
  const fromAddress = (p.FromFull?.Email ?? parseAddressList(p.From)[0]?.address ?? '')
    .trim()
    .toLowerCase();
  if (!isAddress(fromAddress)) throw new Error('The message has no valid sender address.');
  const to = p.ToFull ? fullList(p.ToFull) : parseAddressList(p.To);
  const text = p.TextBody?.trim() ? p.TextBody : p.HtmlBody ? htmlToText(p.HtmlBody) : '';
  return {
    source: 'postmark',
    providerMessageId: typeof p.MessageID === 'string' ? p.MessageID : null,
    providerThreadId: null,
    messageId: firstId(headers['message-id']),
    inReplyTo: firstId(headers['in-reply-to']),
    references: referencesFrom(headers['references']),
    from: { address: fromAddress, name: p.FromFull?.Name?.trim() || null },
    to,
    cc: p.CcFull ? fullList(p.CcFull) : parseAddressList(p.Cc),
    recipients: [p.OriginalRecipient, ...to.map((t) => t.address)]
      .filter((a): a is string => typeof a === 'string' && isAddress(a.trim().toLowerCase()))
      .map((a) => a.trim().toLowerCase()),
    subject: normaliseText(p.Subject ?? ''),
    text: normaliseText(text),
    date: p.Date ?? null,
    headers,
  };
}

// ─── SendGrid Inbound Parse ──────────────────────────────────────────────────

/** Parse a raw header block (`Name: value` lines, folded continuations). */
export function parseHeaderBlock(block: string): Record<string, string> {
  const entries: Array<{ name: string; value: string }> = [];
  for (const line of block.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && entries.length > 0) {
      entries[entries.length - 1]!.value += ` ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(':');
    if (idx > 0)
      entries.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  return headerMap(entries);
}

/**
 * SendGrid posts `multipart/form-data` text fields (`from`, `to`, `subject`,
 * `text`, `html`, `headers`, `envelope`). Attachments arrive as file parts and
 * are ignored: the assistant does not open customers' attachments.
 */
export function parseSendGrid(fields: Record<string, string>): InboundEmail {
  const headers = fields['headers'] ? parseHeaderBlock(fields['headers']) : {};
  const from = parseAddressList(fields['from'])[0];
  if (!from) throw new Error('The message has no valid sender address.');
  let envelopeTo: string[] = [];
  try {
    const envelope = JSON.parse(fields['envelope'] ?? '{}') as { to?: unknown };
    if (Array.isArray(envelope.to)) {
      envelopeTo = envelope.to.filter((a): a is string => typeof a === 'string');
    }
  } catch {
    envelopeTo = [];
  }
  const to = parseAddressList(fields['to']);
  const text = fields['text']?.trim()
    ? fields['text']
    : fields['html']
      ? htmlToText(fields['html'])
      : '';
  return {
    source: 'sendgrid',
    providerMessageId: null,
    providerThreadId: null,
    messageId: firstId(headers['message-id']),
    inReplyTo: firstId(headers['in-reply-to']),
    references: referencesFrom(headers['references']),
    from,
    to,
    cc: parseAddressList(fields['cc']),
    recipients: [...envelopeTo, ...to.map((t) => t.address)]
      .map((a) => a.trim().toLowerCase())
      .filter(isAddress),
    subject: normaliseText(fields['subject'] ?? ''),
    text: normaliseText(text),
    date: headers['date'] ?? null,
    headers,
  };
}

/**
 * The text fields of a `multipart/form-data` body. File parts are skipped. Not a
 * general multipart parser -- just enough for an inbound-parse webhook, with no
 * dependency.
 */
export function parseMultipartFields(body: Buffer, contentType: string): Record<string, string> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) throw new Error('The multipart body has no boundary.');
  const fields: Record<string, string> = {};
  const raw = body.toString('utf8');
  for (const part of raw.split(`--${marker.trim()}`)) {
    const split = part.indexOf('\r\n\r\n') !== -1 ? part.indexOf('\r\n\r\n') : part.indexOf('\n\n');
    if (split === -1) continue;
    const head = part.slice(0, split);
    const disposition = /content-disposition:[^\n]*?name="([^"]+)"([^\n]*)/i.exec(head);
    if (!disposition || /filename=/i.test(disposition[2] ?? '')) continue;
    const value = part
      .slice(split)
      .replace(/^\r?\n\r?\n/, '')
      .replace(/\r?\n$/, '');
    fields[disposition[1]!] = value;
  }
  return fields;
}

// ─── Gmail (format=full) ─────────────────────────────────────────────────────

export interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
}

function decodeGmailBody(data: string | undefined): string {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function findPart(part: GmailMessagePart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && !part.filename && part.body?.data) {
    return decodeGmailBody(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found !== null) return found;
  }
  return null;
}

export function parseGmailMessage(message: GmailMessage): InboundEmail {
  const headers = headerMap(message.payload?.headers ?? []);
  const from = parseAddressList(headers['from'])[0];
  if (!from) throw new Error('The message has no valid sender address.');
  const plain = findPart(message.payload, 'text/plain');
  const html = plain === null ? findPart(message.payload, 'text/html') : null;
  const to = parseAddressList(headers['to']);
  return {
    source: 'gmail',
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    messageId: firstId(headers['message-id']),
    inReplyTo: firstId(headers['in-reply-to']),
    references: referencesFrom(headers['references']),
    from,
    to,
    cc: parseAddressList(headers['cc']),
    recipients: to.map((t) => t.address),
    subject: normaliseText(headers['subject'] ?? ''),
    text: normaliseText(plain ?? (html ? htmlToText(html) : '')),
    date: headers['date'] ?? null,
    headers,
  };
}
