import type { LogoEffect } from '@sunny/contracts';

import type { ProcessedLogo } from './process.js';
import type { BrandAssetStore } from './store.js';

/** What `<id>.json` holds: a processed logo without its bytes. */
export type BrandAssetMeta = Omit<ProcessedLogo, 'png' | 'maskPng'> & { hasMask: boolean };

/** The installer's saved branding, as kept on the tenant. */
export interface StoredBranding {
  mode: 'sunny' | 'logo';
  icon: BrandAssetMeta | null;
  wordmark: BrandAssetMeta | null;
  effects: LogoEffect[];
  colors: { primary: string; glow: string } | null;
}

/** Read one stored asset's metadata, or null when it is missing or unreadable. */
export async function loadBrandAsset(
  store: BrandAssetStore,
  tenantId: string,
  id: string,
): Promise<BrandAssetMeta | null> {
  const bytes = await store.get(tenantId, `${id}.json`);
  if (!bytes) return null;
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as BrandAssetMeta;
  } catch {
    return null;
  }
}
