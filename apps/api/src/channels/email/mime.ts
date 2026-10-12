import { randomBytes } from 'node:crypto';

/**
 * An RFC 5322 / MIME message built by hand, for Gmail's `drafts.create` and
 * `messages.send` (both take the whole message, base64url-encoded, as `raw`).
 *
 * Small on purpose: one plain-text body, optional PDF attachments, and the
 * threading headers that make the reply land in the customer's conversation
 * (`In-Reply-To`, `References`). Every header value is checked for line breaks,
 * because a CR/LF in a subject is how a header gets injected.
 */

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface MimeMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: readonly string[];
  attachments?: readonly MimeAttachment[];
  date?: Date;
  messageId?: string;
}

/** Strip anything that could end a header line. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** RFC 2047 encoded-word for a header that is not plain ASCII. */
export function encodeHeader(value: string): string {
  const clean = headerValue(value);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function wrap76(base64: string): string {
  return base64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

function safeFilename(name: string): string {
  return headerValue(name).replace(/["\\]/g, '').slice(0, 120) || 'attachment.pdf';
}

export function buildMime(message: MimeMessage): string {
  const headers = [
    `From: ${headerValue(message.from)}`,
    `To: ${headerValue(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${(message.date ?? new Date()).toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  if (message.messageId) headers.push(`Message-ID: ${headerValue(message.messageId)}`);
  if (message.inReplyTo) headers.push(`In-Reply-To: ${headerValue(message.inReplyTo)}`);
  const references = [...(message.references ?? [])];
  if (message.inReplyTo && !references.includes(message.inReplyTo)) {
    references.push(message.inReplyTo);
  }
  if (references.length > 0) headers.push(`References: ${headerValue(references.join(' '))}`);
  // Mark the reply as machine-assisted for any auto-responder on the other end,
  // so two assistants cannot answer each other in a loop.
  headers.push('Auto-Submitted: auto-replied');

  const body = wrap76(Buffer.from(message.text, 'utf8').toString('base64'));
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      body,
      '',
    ].join('\r\n');
  }

  const boundary = `sunny_${randomBytes(12).toString('hex')}`;
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ];
  for (const attachment of attachments) {
    const name = safeFilename(attachment.filename);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${headerValue(attachment.mimeType)}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(attachment.data.toString('base64')),
    );
  }
  parts.push(`--${boundary}--`, '');
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts].join(
    '\r\n',
  );
}

export function base64url(text: string | Buffer): string {
  return Buffer.from(text)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** "Re: " once, however many the subject already carries. */
export function replySubject(subject: string): string {
  const stripped = subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
  return `Re: ${stripped || 'Your enquiry'}`;
}
