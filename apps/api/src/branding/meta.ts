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

/** How long an upload that was never saved is kept, so a Studio session in progress keeps its draft. */
export const UNSAVED_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove the tenant's uploads that no saved branding uses and that are older
 * than the grace period. `keep` is the ids still in use (the saved icon and
 * wordmark, kept in Sunny mode too, so switching back needs no re-upload).
 * Returns the ids removed.
 */
export async function pruneBrandAssets(
  store: BrandAssetStore,
  tenantId: string,
  keep: ReadonlySet<string>,
  now: number,
): Promise<string[]> {
  const removed = new Set<string>();
  for (const file of await store.list(tenantId)) {
    const id = file.name.slice(0, 16);
    if (keep.has(id) || now - file.createdAt < UNSAVED_UPLOAD_GRACE_MS) continue;
    await store.delete(tenantId, file.name);
    removed.add(id);
  }
  return [...removed];
}

/** The asset ids a saved branding still uses. */
export function brandingIds(branding: StoredBranding | undefined): Set<string> {
  const ids = new Set<string>();
  if (branding?.icon) ids.add(branding.icon.id);
  if (branding?.wordmark) ids.add(branding.wordmark.id);
  return ids;
}

/**
 * `pruneBrandAssets`, but a failure is logged rather than thrown: tidying up
 * must never fail the upload or save that triggered it.
 */
export async function pruneQuietly(
  store: BrandAssetStore,
  tenantId: string,
  keep: ReadonlySet<string>,
  now: number,
  log: { warn: (object: object, message: string) => void },
): Promise<void> {
  try {
    await pruneBrandAssets(store, tenantId, keep, now);
  } catch (error) {
    log.warn({ err: error, tenantId }, 'brand asset cleanup failed');
  }
}
