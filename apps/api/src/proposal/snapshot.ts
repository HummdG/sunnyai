/**
 * The installer's quotation settings as they stood when a quote was made,
 * resolved against the company's own details, so every later render of that
 * quote uses the same words, deposit and validity.
 */

import {
  defaultQuotationSettings,
  quotationSettingsSchema,
  type QuotationSettings,
} from '@sunny/contracts';

import type { Tenant } from '../tenants.js';
import { DEFAULT_BRAND } from './layout.js';

export interface QuotationSnapshot extends Omit<QuotationSettings, 'signer' | 'colours'> {
  /** Resolved: the settings' signer, or the company and its contact details. */
  signer: { name: string; role: string; phone: string; email: string };
  companyName: string;
  colour: string;
  /** Resolved: chosen colours, else the brand colour (or the theme's fallback when invalid). */
  colours: { rail: string; accent: string };
  website: string | null;
}

export function snapshotFor(
  tenant: Tenant,
  settings: QuotationSettings | undefined,
): QuotationSnapshot {
  // Stored settings are never parsed on the way in, so they may predate a
  // field: parse here so every field has its default.
  const parsed = quotationSettingsSchema.safeParse(settings);
  const base = parsed.success ? parsed.data : defaultQuotationSettings();
  const brand = /^#[0-9a-f]{6}$/i.test(tenant.config.primaryColor)
    ? tenant.config.primaryColor.toLowerCase()
    : DEFAULT_BRAND;
  const contact = tenant.config.supportContact;
  const { signer, colours, ...rest } = structuredClone(base);
  return {
    ...rest,
    signer: signer ?? {
      name: tenant.config.companyName,
      role: '',
      phone: contact?.phone ?? '',
      email: contact?.email ?? '',
    },
    companyName: tenant.config.companyName,
    colour: tenant.config.primaryColor,
    colours: { rail: colours.rail ?? brand, accent: colours.accent ?? brand },
    website: tenant.websiteUrl ?? null,
  };
}
