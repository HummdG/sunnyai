/**
 * Personal data that must not reach the index (Blueprint §4.5).
 *
 * The knowledge base is what the assistant quotes to strangers. An installer's
 * shared Drive folder is also where someone will, sooner or later, drop a
 * customer's utility bill or signed contract by mistake. Indexing it would put
 * a private person's bank details one cleverly worded question away from any
 * visitor, so ingestion scans every document first and decides one of three
 * things:
 *
 *   - **clean**: index it as written;
 *   - **redact**: index it with low-risk personal details masked (an
 *     individual's email address or phone number in otherwise ordinary text);
 *   - **quarantine**: do not index it at all, and tell the installer why. Any
 *     financial identifier, national insurance or social security number, or a
 *     document that reads like one customer's bill or contract.
 *
 * Checksums are used where the format has one (Luhn for cards, mod-97 for IBAN)
 * so a product code that happens to be sixteen digits long does not quarantine a
 * spec sheet. The scanner is deliberately conservative about *quarantining* and
 * says what it found; it never silently drops a document.
 */

export type PiiKind =
  | 'card-number'
  | 'iban'
  | 'uk-bank-account'
  | 'uk-national-insurance'
  | 'us-ssn'
  | 'customer-record'
  | 'personal-email'
  | 'personal-phone';

export type PiiVerdict = 'clean' | 'redact' | 'quarantine';

export interface PiiFinding {
  kind: PiiKind;
  risk: 'high' | 'low';
  count: number;
}

export interface PiiScan {
  verdict: PiiVerdict;
  findings: PiiFinding[];
  /** The text with low-risk matches masked; equal to the input when clean. */
  redacted: string;
  /** One line an installer can act on, or null when clean. */
  reason: string | null;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;
/** UK sort code followed (within a short distance) by an 8-digit account number. */
const UK_ACCOUNT =
  /\b\d{2}-\d{2}-\d{2}\b[^\n]{0,40}?\b\d{8}\b|\b\d{8}\b[^\n]{0,40}?\b\d{2}-\d{2}-\d{2}\b/g;
/** National insurance: two letters (with the official exclusions), six digits, A-D. */
const UK_NINO =
  /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gi;
const US_SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const UK_PHONE = /(?:\+44\s?7\d{3}|\b07\d{3})\s?\d{3}\s?\d{3}\b/g;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/gi;

/**
 * Words that make a page read like one customer's bill or contract rather than
 * an installer's public material. Two or more of these together with a personal
 * contact detail and a postcode is a customer record.
 */
const RECORD_MARKERS = [
  /\baccount (?:number|no\.?)\b/i,
  /\bmpan\b/i,
  /\bmeter (?:serial|number|reading)\b/i,
  /\bbilling (?:period|address)\b/i,
  /\bamount due\b/i,
  /\bdirect debit\b/i,
  /\bcustomer (?:name|signature|reference)\b/i,
  /\bsigned\b.*\bdate\b/i,
  /\bdate of birth\b/i,
  /\bcontract (?:number|reference)\b/i,
];

/**
 * Addresses that belong to a business rather than a person: an installer's own
 * `info@` or `sales@` is public contact detail, not personal data.
 */
const ROLE_MAILBOX =
  /^(info|sales|hello|contact|enquiries|enquiry|support|service|admin|office|team|help|accounts|quotes|bookings|noreply|no-reply)@/i;

export interface PiiOptions {
  /**
   * The installer's own domains. Email addresses at these are the business's
   * contact details and are neither redacted nor counted.
   */
  businessDomains?: readonly string[];
}

export function scanForPii(text: string, options: PiiOptions = {}): PiiScan {
  const business = (options.businessDomains ?? []).map((d) =>
    d.toLowerCase().replace(/^www\./, ''),
  );
  const counts = new Map<PiiKind, number>();
  const add = (kind: PiiKind, n = 1) => counts.set(kind, (counts.get(kind) ?? 0) + n);

  for (const match of text.match(CARD) ?? []) {
    const digits = match.replace(/\D/g, '');
    // A card number has a scheme prefix (Visa, Mastercard, Amex, Discover/Maestro)
    // and passes Luhn; a long serial or part number almost never does both.
    if (
      digits.length >= 13 &&
      digits.length <= 19 &&
      /^(4|5[1-5]|2[2-7]|3[47]|6)/.test(digits) &&
      luhn(digits) &&
      !/^(\d)\1+$/.test(digits)
    ) {
      add('card-number');
    }
  }
  for (const match of text.match(IBAN) ?? []) if (ibanValid(match)) add('iban');
  add('uk-bank-account', (text.match(UK_ACCOUNT) ?? []).length);
  add('uk-national-insurance', (text.match(UK_NINO) ?? []).length);
  add('us-ssn', (text.match(US_SSN) ?? []).length);

  const personalEmails = (text.match(EMAIL) ?? []).filter((address) => {
    const domain = address.split('@')[1]?.toLowerCase() ?? '';
    if (ROLE_MAILBOX.test(address)) return false;
    return !business.some((b) => domain === b || domain.endsWith(`.${b}`));
  });
  add('personal-email', personalEmails.length);
  const phones = text.match(UK_PHONE) ?? [];
  add('personal-phone', phones.length);

  const markers = RECORD_MARKERS.filter((marker) => marker.test(text)).length;
  const hasPostcode = UK_POSTCODE.test(text);
  UK_POSTCODE.lastIndex = 0;
  if (markers >= 2 && hasPostcode && (personalEmails.length > 0 || phones.length > 0)) {
    add('customer-record');
  }

  const HIGH: readonly PiiKind[] = [
    'card-number',
    'iban',
    'uk-bank-account',
    'uk-national-insurance',
    'us-ssn',
    'customer-record',
  ];
  const findings: PiiFinding[] = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([kind, count]) => ({ kind, count, risk: HIGH.includes(kind) ? 'high' : 'low' }));

  const high = findings.filter((f) => f.risk === 'high');
  if (high.length > 0) {
    return {
      verdict: 'quarantine',
      findings,
      redacted: text,
      reason: `Not indexed: it appears to contain ${high
        .map((f) => DESCRIPTIONS[f.kind])
        .join(
          ', ',
        )}. Remove it from the knowledge folder, or remove the personal details and sync again.`,
    };
  }
  if (findings.length > 0) {
    let redacted = text;
    for (const address of personalEmails)
      redacted = redacted.split(address).join('[email removed]');
    redacted = redacted.replace(UK_PHONE, '[phone removed]');
    return {
      verdict: 'redact',
      findings,
      redacted,
      reason: `Indexed with ${findings.map((f) => DESCRIPTIONS[f.kind]).join(' and ')} removed.`,
    };
  }
  return { verdict: 'clean', findings: [], redacted: text, reason: null };
}

const DESCRIPTIONS: Readonly<Record<PiiKind, string>> = {
  'card-number': 'a payment card number',
  iban: 'a bank account (IBAN)',
  'uk-bank-account': 'a sort code and account number',
  'uk-national-insurance': 'a National Insurance number',
  'us-ssn': 'a social security number',
  'customer-record': "what looks like one customer's bill or contract",
  'personal-email': "a private individual's email address",
  'personal-phone': "a private individual's mobile number",
};
