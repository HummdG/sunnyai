import { createHmac, timingSafeEqual } from 'node:crypto';

import type { TwilioConfig } from './config.js';

/**
 * Twilio: request signing, TwiML, and the two REST calls the phone agent makes.
 *
 * No SDK. The signature scheme is four lines of HMAC and is pinned by Twilio's
 * own worked example in the tests; the REST calls are two form POSTs.
 * Sources: https://www.twilio.com/docs/usage/security,
 * https://www.twilio.com/docs/voice/twiml/stream,
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages.
 */

/**
 * Compute `X-Twilio-Signature` for a POST: the full URL, then each form
 * parameter's name and value in case-sensitive sorted order, HMAC-SHA1 with the
 * auth token, base64.
 */
export function twilioSignature(
  url: string,
  params: Readonly<Record<string, string>>,
  authToken: string,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/** Constant-time check of a presented signature. */
export function validateTwilioSignature(
  url: string,
  params: Readonly<Record<string, string>>,
  signature: string | undefined,
  authToken: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(url, params, authToken));
  const presented = Buffer.from(signature);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/** Escape text for an XML text node or attribute. */
export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const twiml = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

const say = (text: string): string => `<Say language="en-GB">${xmlEscape(text)}</Say>`;

/**
 * Answer an inbound call: the AI disclosure first, then the media stream. What
 * follows `</Connect>` plays when our stream closes, which is how the 5-minute
 * cap and a normal goodbye end the call without another REST round trip.
 */
export function connectStreamTwiml(opts: {
  streamUrl: string;
  disclosure: string;
  goodbye: string;
  parameters: Readonly<Record<string, string>>;
}): string {
  const params = Object.entries(opts.parameters)
    .map(([name, value]) => `<Parameter name="${xmlEscape(name)}" value="${xmlEscape(value)}"/>`)
    .join('');
  return twiml(
    say(opts.disclosure) +
      `<Connect><Stream url="${xmlEscape(opts.streamUrl)}">${params}</Stream></Connect>` +
      say(opts.goodbye) +
      '<Hangup/>',
  );
}

/** A spoken message then a transfer to the installer. */
export function transferTwiml(message: string, installerPhone: string): string {
  return twiml(say(message) + `<Dial>${xmlEscape(installerPhone)}</Dial>`);
}

/** A spoken message then hang up. */
export function sayAndHangupTwiml(message: string): string {
  return twiml(say(message) + '<Hangup/>');
}

export type Fetch = typeof fetch;

async function twilioPost(
  fetchImpl: Fetch,
  config: TwilioConfig,
  path: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
  const response = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof json.message === 'string' ? json.message : `HTTP ${response.status}`;
    throw new Error(`Twilio ${path} failed: ${message}`);
  }
  return json;
}

/** Send an SMS (Messages API). */
export async function sendSms(
  fetchImpl: Fetch,
  config: TwilioConfig,
  opts: { to: string; from: string; body: string },
): Promise<{ sid: string }> {
  const json = await twilioPost(fetchImpl, config, 'Messages.json', {
    To: opts.to,
    From: opts.from,
    Body: opts.body,
  });
  return { sid: typeof json.sid === 'string' ? json.sid : '' };
}

/** Replace a live call's instructions (Calls API update), e.g. to transfer it. */
export async function updateCall(
  fetchImpl: Fetch,
  config: TwilioConfig,
  callSid: string,
  twimlBody: string,
): Promise<void> {
  await twilioPost(fetchImpl, config, `Calls/${encodeURIComponent(callSid)}.json`, {
    Twiml: twimlBody,
  });
}

/** Place an outbound call that runs `url` (our incoming webhook) when answered. */
export async function startCall(
  fetchImpl: Fetch,
  config: TwilioConfig,
  opts: { to: string; from: string; url: string },
): Promise<{ sid: string }> {
  const json = await twilioPost(fetchImpl, config, 'Calls.json', {
    To: opts.to,
    From: opts.from,
    Url: opts.url,
  });
  return { sid: typeof json.sid === 'string' ? json.sid : '' };
}

/** Parse an `application/x-www-form-urlencoded` body into a flat record. */
export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) out[key] = value;
  return out;
}
