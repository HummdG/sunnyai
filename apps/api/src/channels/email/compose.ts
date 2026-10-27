import { EMAIL_DISCLAIMER_FOOTER } from '../../agent/channels.js';

/**
 * The email reply, in the channel matrix's "formal email template + legal
 * disclaimer footer" shape: a greeting, the grounded answer, any source links,
 * a sign-off from the installer's team, and the footer -- which the system adds,
 * so no answer can go out without it.
 */

export interface ComposeInput {
  /** The core's answer. May already carry the footer (the core appends it). */
  answer: string;
  companyName: string;
  /** The sender's display name, untrusted. */
  senderName: string | null;
  sources: ReadonlyArray<{ title: string; url: string | null }>;
  /** Who replies are signed as (the Email Assistant's "Sign replies as"); the company's team otherwise. */
  signatureName?: string;
}

/** Only a plausible first name from an untrusted display name; otherwise none. */
export function firstName(display: string | null): string | null {
  if (!display) return null;
  const first = display.trim().split(/[\s,]+/)[0] ?? '';
  return /^[\p{L}][\p{L}'-]{0,29}$/u.test(first) ? first : null;
}

export function stripFooter(text: string): string {
  const at = text.lastIndexOf(EMAIL_DISCLAIMER_FOOTER);
  const body = at === -1 ? text : text.slice(0, at);
  return body.replace(/\n+--\s*\n*$/, '').trimEnd();
}

const GREETING = /^(dear|hello|hi|good (morning|afternoon|evening))\b/i;
const SIGN_OFF =
  /(kind regards|best regards|regards|best wishes|many thanks|thanks|sincerely|yours)[,!.]?\s*\n?.*$/i;

export function composeReply(input: ComposeInput): string {
  let body = stripFooter(input.answer)
    // Citation markers are for the chat widget; an email lists its sources.
    .replace(/\s*\[S\d+\]/g, '')
    .trim();
  const lines: string[] = [];
  if (!GREETING.test(body)) {
    lines.push(`Hello ${firstName(input.senderName) ?? 'there'},`, '');
  }
  const signedOff = SIGN_OFF.test(body.split('\n').slice(-3).join('\n'));
  lines.push(body);

  const links = input.sources.filter((s) => s.url && /^https?:\/\//i.test(s.url));
  if (links.length > 0) {
    lines.push('', 'Further information:');
    for (const source of links.slice(0, 5)) lines.push(`- ${source.title}: ${source.url}`);
  }
  if (!signedOff) {
    lines.push('', 'Kind regards,', input.signatureName?.trim() || `The ${input.companyName} team`);
  }
  lines.push('', '--', EMAIL_DISCLAIMER_FOOTER);
  body = lines.join('\n');
  return body;
}
