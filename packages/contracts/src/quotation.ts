import { z } from 'zod';

/**
 * An installer's settings for the quotation PDF. Text limits apply after
 * trimming. Empty letter lines mean the PDF uses only its fixed sentences.
 */

export const QUOTATION_LIMITS = {
  terms: 40000,
  line: 200,
  accreditationLogos: 8,
  validityMin: 1,
  validityMax: 365,
  percentMin: 1,
  percentMax: 100,
  fixedMin: 1,
  fixedMax: 1000000,
} as const;

const line = z.string().trim().max(QUOTATION_LIMITS.line);

export type DepositRule =
  { kind: 'none' } | { kind: 'percent'; percent: number } | { kind: 'fixed'; amountGbp: number };

export interface QuotationSettings {
  version: number;
  updatedAt: string;
  logoAssetId: string | null;
  signer: { name: string; role: string; phone: string; email: string } | null;
  accreditations: { mcsNumber: string; logoAssetIds: string[] };
  sections: { system: boolean; performance: boolean; savings: boolean; terms: boolean };
  deposit: DepositRule;
  balanceDue: string;
  validityDays: number;
  letter: { opening: string; closing: string };
  terms: string;
  /** `#rrggbb`; null means use Your brand colour. */
  colours: { rail: string | null; accent: string | null };
}

const depositSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('percent'),
    percent: z.number().int().min(QUOTATION_LIMITS.percentMin).max(QUOTATION_LIMITS.percentMax),
  }),
  z.object({
    kind: z.literal('fixed'),
    amountGbp: z.number().int().min(QUOTATION_LIMITS.fixedMin).max(QUOTATION_LIMITS.fixedMax),
  }),
]);

const colour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((v) => v.toLowerCase())
  .nullable();

export const quotationSettingsSchema: z.ZodType<QuotationSettings, unknown> = z.object({
  version: z.number().int().min(0),
  updatedAt: z.string(),
  logoAssetId: z.string().min(1).nullable(),
  signer: z.object({ name: line, role: line, phone: line, email: line }).nullable(),
  accreditations: z.object({
    mcsNumber: line,
    logoAssetIds: z.array(z.string().min(1)).max(QUOTATION_LIMITS.accreditationLogos),
  }),
  sections: z.object({
    system: z.boolean(),
    performance: z.boolean(),
    savings: z.boolean(),
    terms: z.boolean(),
  }),
  deposit: depositSchema,
  balanceDue: line,
  validityDays: z
    .number()
    .int()
    .min(QUOTATION_LIMITS.validityMin)
    .max(QUOTATION_LIMITS.validityMax),
  letter: z.object({ opening: line, closing: line }),
  terms: z.string().trim().max(QUOTATION_LIMITS.terms),
  colours: z
    .object({ rail: colour.default(null), accent: colour.default(null) })
    .default({ rail: null, accent: null }),
});

export function defaultQuotationSettings(): QuotationSettings {
  return {
    version: 0,
    updatedAt: '',
    logoAssetId: null,
    signer: null,
    accreditations: { mcsNumber: '', logoAssetIds: [] },
    sections: { system: true, performance: true, savings: true, terms: false },
    deposit: { kind: 'none' },
    balanceDue: 'within 7 days of completion',
    validityDays: 30,
    letter: { opening: '', closing: '' },
    terms: '',
    colours: { rail: null, accent: null },
  };
}
