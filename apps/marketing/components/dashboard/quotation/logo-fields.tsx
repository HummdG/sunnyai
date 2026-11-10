'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import {
  api,
  portalUrl,
  tenantPath,
  type BrandAssetView,
  type TenantView,
} from '../../../lib/portal-api.js';
import { rasterizeToPng } from '../brand-section.js';
import { errorText, ErrorNote } from '../ui.js';

/**
 * Upload one image for the PDF, as Your brand uploads its logo: a PNG (an SVG
 * is drawn into one first) through the same branding route and storage.
 */
export function useUpload(tenantId: string, kind: 'pdf-logo' | 'accreditation') {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An upload that answers after the tab has gone belongs to a draft that no longer exists.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function upload(
    event: ChangeEvent<HTMLInputElement>,
    onUploaded: (asset: BrandAssetView) => void,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const png = await rasterizeToPng(file);
      const { asset } = await api<{ asset: BrandAssetView }>(
        tenantPath(tenantId, `/brand/${kind}`),
        {
          body: { png },
        },
      );
      if (mounted.current) onUploaded(asset);
    } catch (failure) {
      if (mounted.current) setError(errorText(failure));
    } finally {
      if (mounted.current) setUploading(false);
    }
  }

  return { uploading, error, upload };
}

/** An uploaded image on the plate it reads best on. */
export function AssetThumb({ asset, alt }: { asset: BrandAssetView; alt: string }) {
  return (
    <div className="brand-thumb wide" data-plate={asset.plate ?? 'light'}>
      <img src={portalUrl(asset.url)} alt={alt} width={asset.width} height={asset.height} />
    </div>
  );
}

/** The logo Your brand gives the PDF: the wordmark, else the icon, else the company's name. */
function brandLogo(tenant: TenantView): BrandAssetView | null {
  const { mode, icon, wordmark } = tenant.branding;
  if (mode !== 'logo' || !icon) return null;
  return wordmark ?? icon;
}

/**
 * The PDF's logo: Your brand's by default, or one uploaded just for the PDF.
 * Read-only for viewers through the form's disabled fieldset.
 */
export function LogoFields({
  tenant,
  logo,
  onChange,
}: {
  tenant: TenantView;
  logo: BrandAssetView | null;
  onChange: (asset: BrandAssetView | null) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const { uploading, error, upload } = useUpload(tenant.id, 'pdf-logo');
  const fromBrand = brandLogo(tenant);

  return (
    <>
      <p className="hint">
        {logo
          ? 'The PDF uses this logo. Your brand keeps its own.'
          : 'Uses the logo from Your brand. You can use a different one just for the PDF.'}
      </p>
      <div className="quote-logo-row">
        {logo ? (
          <AssetThumb asset={logo} alt="Your PDF logo" />
        ) : fromBrand ? (
          <AssetThumb asset={fromBrand} alt="Your brand's logo" />
        ) : (
          <div className="quote-logo-name" title="No logo yet: the PDF prints your name">
            {tenant.companyName}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/svg+xml,.png,.svg"
          aria-label="PDF logo file"
          hidden
          onChange={(event) => void upload(event, onChange)}
        />
        <div className="quote-logo-actions">
          <button
            type="button"
            className="link-button"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading
              ? 'Uploading…'
              : logo
                ? 'Replace the PDF logo'
                : 'Use a different logo for the PDF'}
          </button>
          {logo ? (
            <button
              type="button"
              className="link-button"
              disabled={uploading}
              onClick={() => onChange(null)}
            >
              Use the logo from Your brand
            </button>
          ) : null}
        </div>
      </div>
      <ErrorNote error={error} />
    </>
  );
}
