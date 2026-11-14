/**
 * Reading a visitor's electricity bill for their usage.
 *
 * The visitor uploads a photo or PDF of a bill from the widget; the model
 * reads off the electricity figures and nothing else. The file is never
 * stored: it goes to the model once and is dropped, and only the figures are
 * kept with the session. A bill carries a name, an address and an account
 * number, none of which Sunny needs, so the model is not asked for them.
 */

import { z } from 'zod';

/** What the widget may upload. Phones send HEIC; Gemini reads all of these. */
export const BILL_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** The largest file read, before base64. A phone photo of a bill is well under. */
export const BILL_MAX_BYTES = 10 * 1024 * 1024;

export interface BillFile {
  /** The file, base64-encoded. */
  data: string;
  mimeType: (typeof BILL_MIME_TYPES)[number];
}

export type BillReading =
  | {
      status: 'read';
      /** Electricity used in a year, kWh. */
      annualKwh: number;
      /** The bill's own yearly estimate, or worked out from the billing period. */
      basis: 'stated_annual' | 'period';
      /** The electricity unit rate, pence per kWh, when the bill shows one. */
      unitRatePence: number | null;
    }
  | { status: 'unreadable'; reason: 'not_a_bill' | 'no_usage' | 'failed' };

export const BILL_PROMPT = `This is a photo or PDF of a UK household energy bill or statement.
Read the ELECTRICITY figures only. Ignore gas.
Return:
- isElectricityBill: true only if this shows electricity usage for a home.
- estimatedAnnualKwh: the electricity "estimated annual consumption" (or "annual usage", "last 12 months") in kWh, if the bill states one.
- periodKwh: the electricity kWh used in this billing period, if shown.
- periodDays: the number of days in that billing period, if shown or if both dates are shown.
- unitRatePence: the electricity unit rate in pence per kWh (for example 24.5), if shown. With several rates, the day or main rate.
Use null for anything not shown. Do not return names, addresses, account numbers or anything else.`;

/** The model's reply, as the schema asks for it. Anything else reads as unreadable. */
const replySchema = z.object({
  isElectricityBill: z.boolean(),
  estimatedAnnualKwh: z.number().nullable().optional(),
  periodKwh: z.number().nullable().optional(),
  periodDays: z.number().nullable().optional(),
  unitRatePence: z.number().nullable().optional(),
});

/** A UK home's yearly electricity, kWh: anything outside is a misread. */
const ANNUAL_MIN = 300;
const ANNUAL_MAX = 100_000;

/** The figures from the model's reply, checked and turned into a yearly use. */
export function readingFrom(raw: unknown): BillReading {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return { status: 'unreadable', reason: 'failed' };
  const r = parsed.data;
  if (!r.isElectricityBill) return { status: 'unreadable', reason: 'not_a_bill' };
  const inRange = (n: number | null | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= ANNUAL_MIN && n <= ANNUAL_MAX;
  const rate =
    typeof r.unitRatePence === 'number' && r.unitRatePence >= 5 && r.unitRatePence <= 100
      ? Math.round(r.unitRatePence * 100) / 100
      : null;
  if (inRange(r.estimatedAnnualKwh)) {
    return {
      status: 'read',
      annualKwh: Math.round(r.estimatedAnnualKwh),
      basis: 'stated_annual',
      unitRatePence: rate,
    };
  }
  // A period of a week or more scales to a year; a shorter one says too little.
  if (
    typeof r.periodKwh === 'number' &&
    r.periodKwh > 0 &&
    typeof r.periodDays === 'number' &&
    r.periodDays >= 7 &&
    r.periodDays <= 400
  ) {
    const annual = (r.periodKwh / r.periodDays) * 365;
    if (inRange(annual)) {
      return {
        status: 'read',
        annualKwh: Math.round(annual),
        basis: 'period',
        unitRatePence: rate,
      };
    }
  }
  return { status: 'unreadable', reason: 'no_usage' };
}

/** Something that can read a bill: the Gemini provider, or a test double. */
export interface BillReader {
  readBill(file: BillFile, signal?: AbortSignal): Promise<unknown>;
}

/** Read a bill. Never throws: a failed call is an unreadable bill. */
export async function readBill(
  reader: BillReader,
  file: BillFile,
  opts: { timeoutMs?: number; warn?: (object: object, message: string) => void } = {},
): Promise<BillReading> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  try {
    return readingFrom(await reader.readBill(file, controller.signal));
  } catch (error) {
    // The error only: never the file.
    opts.warn?.(
      { err: error instanceof Error ? error.message : String(error) },
      'bill read failed',
    );
    return { status: 'unreadable', reason: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** What is kept with the session: the figures, and whether the visitor has been told. */
export interface BillRecord {
  status: BillReading['status'];
  annualKwh?: number;
  basis?: 'stated_annual' | 'period';
  unitRatePence?: number | null;
  reason?: string;
  /** Set once the assistant has passed the result on. */
  told: boolean;
}

export function billRecord(reading: BillReading): BillRecord {
  return reading.status === 'read'
    ? {
        status: 'read',
        annualKwh: reading.annualKwh,
        basis: reading.basis,
        unitRatePence: reading.unitRatePence,
        told: false,
      }
    : { status: 'unreadable', reason: reading.reason, told: false };
}

export function parseBillRecord(raw: string | undefined): BillRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BillRecord>;
    return value.status === 'read' || value.status === 'unreadable' ? (value as BillRecord) : null;
  } catch {
    return null;
  }
}

/** The sentence the visitor is told once a bill has been read. */
export function billSentence(record: BillRecord): string | null {
  if (record.status !== 'read' || !record.annualKwh) return null;
  const kwh = record.annualKwh.toLocaleString('en-GB');
  return record.basis === 'stated_annual'
    ? `Thanks, your bill shows you use about ${kwh} kWh of electricity a year.`
    : `Thanks, from your bill you use about ${kwh} kWh of electricity a year.`;
}

/** What the model is told about an unreadable bill, so it can ask in its own words. */
export function billProblem(record: BillRecord): string | null {
  if (record.status !== 'unreadable') return null;
  const why =
    record.reason === 'not_a_bill'
      ? 'the file did not look like an electricity bill'
      : record.reason === 'no_usage'
        ? 'no electricity usage could be read from it'
        : 'it could not be read';
  return `The visitor uploaded a bill, but ${why}. Say so kindly in one sentence and ask for their yearly kWh or roughly what they pay each month instead. Do not offer the upload again.`;
}
