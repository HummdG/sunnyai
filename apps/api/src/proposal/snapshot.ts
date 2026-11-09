/**
 * The installer's quotation settings as they stood when a quote was made,
 * resolved against the company's own details, so every later render of that
 * quote uses the same words, deposit and validity.
 */

import { defaultQuotationSettings, type QuotationSettings } from '@sunny/contracts';

import type { Tenant } from '../tenants.js';

export interface QuotationSnapshot extends Omit<QuotationSettings, 'signer'> {
  /** Resolved: the settings' signer, or the company and its contact details. */
  signer: { name: string; role: string; phone: string; email: string };
  companyName: string;
  colour: string;
  website: string | null;
}

export function snapshotFor(
  tenant: Tenant,
  settings: QuotationSettings | undefined,
): QuotationSnapshot {
  const base = settings ?? defaultQuotationSettings();
  const contact = tenant.config.supportContact;
  const { signer, ...rest } = structuredClone(base);
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
    website: tenant.websiteUrl ?? null,
  };
}
