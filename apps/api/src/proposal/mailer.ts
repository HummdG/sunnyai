/**
 * Outbound email for "email me my quote": one transactional message with the
 * proposal attached, sent through Postmark's HTTP API. Configured by
 *
 *   SUNNY_POSTMARK_SERVER_TOKEN   the Postmark server token
 *   SUNNY_PROPOSAL_FROM           the sender, a verified Postmark signature
 *
 * Unconfigured, `mailerFromEnv` returns null and the option is not offered:
 * the widget hides the button and the route refuses with `not_enabled`.
 */

export interface ProposalEmail {
  to: string;
  /** Replies go to the installer, never to Sunny. */
  replyTo: string | null;
  /** Shown as the sender's name ("Brightside Solar via Sunny"). */
  fromName: string;
  subject: string;
  text: string;
  attachment: { filename: string; data: Buffer };
}

export interface ProposalMailer {
  send(email: ProposalEmail): Promise<{ messageId: string }>;
}

export class MailerError extends Error {}

const POSTMARK = 'https://api.postmarkapp.com/email';

/** Drop anything that could start a new header or break the display name. */
const clean = (s: string) => s.replace(/[\r\n"<>]+/g, ' ').trim();

export function postmarkMailer(options: {
  token: string;
  from: string;
  fetch?: typeof fetch;
}): ProposalMailer {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(email) {
      const response = await doFetch(POSTMARK, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-postmark-server-token': options.token,
        },
        body: JSON.stringify({
          From: `"${clean(email.fromName)}" <${clean(options.from)}>`,
          To: clean(email.to),
          ...(email.replyTo ? { ReplyTo: clean(email.replyTo) } : {}),
          Subject: clean(email.subject),
          TextBody: email.text,
          MessageStream: 'outbound',
          Attachments: [
            {
              Name: clean(email.attachment.filename),
              Content: email.attachment.data.toString('base64'),
              ContentType: 'application/pdf',
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new MailerError(`The email service refused the message (${response.status}).`);
      }
      const body = (await response.json().catch(() => ({}))) as { MessageID?: string };
      return { messageId: body.MessageID ?? 'sent' };
    },
  };
}

/** The configured mailer, or null when outbound email is not set up. */
export function mailerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): ProposalMailer | null {
  const token = env['SUNNY_POSTMARK_SERVER_TOKEN'];
  const from = env['SUNNY_PROPOSAL_FROM'];
  if (!token || !from) return null;
  return postmarkMailer({ token, from, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

/** Whether outbound email is configured, so the "email me my quote" option can be offered. */
export function proposalEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['SUNNY_POSTMARK_SERVER_TOKEN'] && env['SUNNY_PROPOSAL_FROM']);
}
