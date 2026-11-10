'use client';

import { useRef } from 'react';

import { QUOTATION_LIMITS, type BrandAssetView } from '../../../lib/portal-api.js';
import { ErrorNote } from '../ui.js';
import { AssetThumb, useUpload } from './logo-fields.js';

const MAX = QUOTATION_LIMITS.accreditationLogos;

/** The MCS certificate number and up to eight small logos for the PDF's footer. */
export function Accreditations({
  tenantId,
  mcsNumber,
  logos,
  onMcsNumber,
  onLogos,
}: {
  tenantId: string;
  mcsNumber: string;
  logos: BrandAssetView[];
  onMcsNumber: (value: string) => void;
  onLogos: (change: (current: BrandAssetView[]) => BrandAssetView[]) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const { uploading, error, upload } = useUpload(tenantId, 'accreditation');
  const full = logos.length >= MAX;

  return (
    <>
      <label className="field">
        <span>MCS certificate number</span>
        <input
          value={mcsNumber}
          maxLength={QUOTATION_LIMITS.line}
          placeholder="For example NAP-12345"
          onChange={(event) => onMcsNumber(event.target.value)}
        />
      </label>
      <div className="quote-accreditations-head">
        <span className="quote-label">Logos</span>
        <span className="muted small">
          {logos.length} of {MAX}
        </span>
      </div>
      <p className="hint">NICEIC, HIES, TrustMark and the like, shown small in the footer.</p>
      {logos.length > 0 ? (
        <ul className="quote-accreditations" aria-label="Accreditation logos">
          {logos.map((logo, index) => (
            <li key={logo.id}>
              <AssetThumb asset={logo} alt={`Accreditation logo ${index + 1}`} />
              <button
                type="button"
                className="link-button small"
                aria-label={`Remove accreditation logo ${index + 1}`}
                onClick={() => onLogos((current) => current.filter((l) => l.id !== logo.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/png,image/svg+xml,.png,.svg"
        aria-label="Accreditation logo file"
        hidden
        onChange={(event) =>
          void upload(event, (asset) =>
            // The same image twice is one logo (its id is its content).
            onLogos((current) =>
              current.some((l) => l.id === asset.id) || current.length >= MAX
                ? current
                : [...current, asset],
            ),
          )
        }
      />
      <button
        type="button"
        className="pill"
        disabled={uploading || full}
        onClick={() => input.current?.click()}
      >
        {uploading ? 'Uploading…' : full ? `Up to ${MAX} logos` : 'Add a logo'}
      </button>
      <ErrorNote error={error} />
    </>
  );
}
