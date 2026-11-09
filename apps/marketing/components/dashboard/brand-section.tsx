'use client';

import { effectMarkup, logoSvg, stillMarkup, type LogoArt } from '@sunny/logo-effects';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';

import {
  api,
  portalUrl,
  tenantPath,
  type BrandAssetView,
  type BrandColors,
  type LogoEffect,
  type TenantView,
} from '../../lib/portal-api.js';
import { errorText, ErrorNote } from './ui.js';

/** The logo choices being edited, before Save sends them as `branding`. */
export interface BrandDraft {
  mode: 'sunny' | 'logo';
  icon: BrandAssetView | null;
  wordmark: BrandAssetView | null;
  effects: LogoEffect[];
  /** Null until the owner edits a colour, so the server's suggestion applies. */
  colors: BrandColors | null;
}

export function draftFrom(tenant: TenantView): BrandDraft {
  const { mode, icon, wordmark, effects, colors } = tenant.branding;
  return { mode, icon, wordmark, effects, colors };
}

/** The seven animations, in the order Studio lists them. */
const EFFECT_LABELS: Record<LogoEffect, string> = {
  comet: 'Comet trace',
  draw: 'Draw and undraw',
  charge: 'Charge up',
  shimmer: 'Shimmer',
  rings: 'Echo rings',
  march: 'Marching outline',
  segments: 'Segment chase',
};
const EFFECTS = Object.keys(EFFECT_LABELS) as LogoEffect[];
const OUTLINE_EFFECTS: readonly LogoEffect[] = ['comet', 'draw', 'rings', 'march'];

const FALLBACK_COLORS: BrandColors = { primary: '#FFFFFF', glow: '#FFFFFF' };

/** The colours the animations use: the owner's, else the ones read from the logo. */
export function effectiveColors(draft: BrandDraft): BrandColors {
  return draft.colors ?? draft.icon?.suggestedColors ?? FALLBACK_COLORS;
}

/** An uploaded asset as `@sunny/logo-effects` draws it. */
export function artFor(asset: BrandAssetView, colors: BrandColors): LogoArt {
  return {
    src: portalUrl(asset.url),
    maskSrc: asset.maskUrl === null ? null : portalUrl(asset.maskUrl),
    width: asset.width,
    height: asset.height,
    outline: asset.outline,
    colors,
  };
}

/** `#rrggbb` as `<input type="color">` wants it. */
const lower = (hex: string) => hex.toLowerCase();

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const MAX_SIDE = 1024;

/**
 * The upload body for a logo file: plain base64 of a PNG. The server only ever
 * accepts PNG, so an SVG is drawn into a canvas at its own size (no more than
 * 1024 px on the long side) and sent as the PNG that canvas makes.
 */
export async function rasterizeToPng(file: File): Promise<string> {
  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (!svg) return await base64Of(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const w = image.naturalWidth || 512;
    const h = image.naturalHeight || 512;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error("This browser couldn't read that SVG. Upload a PNG instead.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error("This browser couldn't read that SVG. Upload a PNG instead.");
    return await base64Of(png);
  } catch (failure) {
    if (failure instanceof Error && failure.message.startsWith('This browser')) throw failure;
    throw new Error("That SVG couldn't be read. Check the file, or upload a PNG instead.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** What the server made of an icon, in one line. */
function iconStatus(icon: BrandAssetView): string {
  const available = icon.availableEffects.length;
  if (available === 0) {
    return 'This image has no clear shape to animate, so it will be shown still. A PNG with a transparent or plain background works best.';
  }
  if (available === EFFECTS.length) {
    return 'Outline traced and checked. All animations are available.';
  }
  return "We couldn't trace the outline exactly, so only the fill animations are available.";
}

function unavailableReason(effect: LogoEffect): string {
  return OUTLINE_EFFECTS.includes(effect) ? 'Needs a clean outline trace' : 'Needs a clear shape';
}

/** CSS-safe ids for the markup: `useId` gives colons, which break keyframe names. */
function useUid(prefix: string): string {
  return prefix + useId().replace(/[^a-zA-Z0-9]/g, '');
}

/** The uploaded image with the traced outline drawn over it. */
function Thumb({ asset, colour }: { asset: BrandAssetView; colour: string }) {
  const icon = asset.kind === 'icon';
  return (
    <div className={`brand-thumb${icon ? '' : ' wide'}`}>
      <img src={portalUrl(asset.url)} alt="" width={asset.width} height={asset.height} />
      {asset.outline ? (
        <svg
          viewBox={`0 0 ${asset.width} ${asset.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <path
            d={asset.outline}
            fill="none"
            fillRule="evenodd"
            stroke={colour}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
}

function Slot({
  tenantId,
  kind,
  label,
  hint,
  asset,
  colour,
  status,
  onUploaded,
  onRemove,
}: {
  tenantId: string;
  kind: 'icon' | 'wordmark';
  label: string;
  hint: string;
  asset: BrandAssetView | null;
  colour: string;
  status: string | null;
  onUploaded: (asset: BrandAssetView) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An upload that answers after this slot has gone (the owner switched
  // installer, or left Studio) belongs to a draft that no longer exists.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function choose(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const png = await rasterizeToPng(file);
      const { asset: next } = await api<{ asset: BrandAssetView }>(
        tenantPath(tenantId, `/brand/${kind}`),
        { body: { png } },
      );
      if (mounted.current) onUploaded(next);
    } catch (failure) {
      if (mounted.current) setError(errorText(failure));
    } finally {
      if (mounted.current) setUploading(false);
    }
  }

  return (
    <div className="brand-slot">
      {asset ? <Thumb asset={asset} colour={colour} /> : null}
      <div className="brand-slot-text">
        <strong>{label}</strong>
        <p className="muted small">{hint}</p>
        {status ? <p className="small">{status}</p> : null}
        <input
          ref={input}
          type="file"
          accept="image/png,image/svg+xml,.png,.svg"
          aria-label={`${label} file`}
          hidden
          onChange={(event) => void choose(event)}
        />
        <div className="pills">
          <button
            type="button"
            className="pill"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? 'Uploading…' : asset ? 'Replace' : `Upload ${label.toLowerCase()}`}
          </button>
          {asset ? (
            <button type="button" className="pill" disabled={uploading} onClick={onRemove}>
              Remove
            </button>
          ) : null}
        </div>
        <ErrorNote error={error} />
      </div>
    </div>
  );
}

/** One animation choice with its live tile. */
function EffectChoice({
  effect,
  art,
  available,
  checked,
  onToggle,
}: {
  effect: LogoEffect;
  art: LogoArt;
  available: boolean;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const uid = useUid(`st${effect}`);
  const inner = available ? effectMarkup(effect, art, uid) : stillMarkup(art, uid);
  return (
    <label className={`effect-choice${available ? '' : ' unavailable'}`}>
      <input
        type="checkbox"
        checked={available && checked}
        disabled={!available}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <span className="effect-tile" dangerouslySetInnerHTML={{ __html: logoSvg(art, inner) }} />
      <span>
        {EFFECT_LABELS[effect]}
        {available ? null : (
          <span className="muted small" style={{ display: 'block' }}>
            {unavailableReason(effect)}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * Studio's "Your logo": the installer's own icon and wordmark in place of the
 * Sunny character, the animations it plays while busy, and their colours.
 */
export function BrandSection({
  tenant,
  value,
  onChange,
}: {
  tenant: TenantView;
  value: BrandDraft;
  onChange: (draft: BrandDraft) => void;
}) {
  const heading = useUid('brand');
  // An upload answers after the owner may have changed something else; it
  // applies to the draft as it is then, not as it was when the file was chosen.
  const latest = useRef(value);
  latest.current = value;
  const colors = effectiveColors(value);
  const { icon, wordmark } = value;

  return (
    <section className="brand-section" role="group" aria-labelledby={heading}>
      <h3 id={heading}>Your logo</h3>
      <div className="pills" role="radiogroup" aria-label="Chat character">
        <label className="pill">
          <input
            type="radio"
            name={`${heading}-mode`}
            checked={value.mode === 'sunny'}
            onChange={() => onChange({ ...value, mode: 'sunny' })}
          />{' '}
          Use Sunny
        </label>
        <label className="pill">
          <input
            type="radio"
            name={`${heading}-mode`}
            checked={value.mode === 'logo'}
            onChange={() => onChange({ ...value, mode: 'logo' })}
          />{' '}
          Use my logo
        </label>
      </div>

      {value.mode === 'logo' ? (
        <>
          <Slot
            tenantId={tenant.id}
            kind="icon"
            label="Icon"
            hint="For the chat button and the top of the chat. Square PNG or SVG, at least 256 × 256. A simple mark works best."
            asset={icon}
            colour={colors.primary}
            status={icon ? iconStatus(icon) : null}
            onUploaded={(next) =>
              onChange({ ...latest.current, icon: next, effects: [...next.availableEffects] })
            }
            onRemove={() => onChange({ ...value, icon: null })}
          />
          <Slot
            tenantId={tenant.id}
            kind="wordmark"
            label="Wordmark"
            hint="Shown beside your icon at the top of the chat. Optional. Wide PNG or SVG."
            asset={wordmark}
            colour={colors.primary}
            status={null}
            onUploaded={(next) => onChange({ ...latest.current, wordmark: next })}
            onRemove={() => onChange({ ...value, wordmark: null })}
          />

          {icon ? (
            <>
              <fieldset className="field">
                <legend>Animations</legend>
                <p className="hint">Your logo plays these while the assistant is busy.</p>
                <div className="effect-choices">
                  {EFFECTS.map((effect) => (
                    <EffectChoice
                      key={effect}
                      effect={effect}
                      art={artFor(icon, colors)}
                      available={icon.availableEffects.includes(effect)}
                      checked={value.effects.includes(effect)}
                      onToggle={(on) =>
                        onChange({
                          ...value,
                          effects: on
                            ? EFFECTS.filter((e) => e === effect || value.effects.includes(e))
                            : value.effects.filter((e) => e !== effect),
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset className="field">
                <legend>Colours from your logo</legend>
                <div className="pills">
                  {(['primary', 'glow'] as const).map((key) => (
                    <label
                      key={key}
                      className="pill"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      {key === 'primary' ? 'Highlight' : 'Glow'}
                      <input
                        type="color"
                        value={lower(colors[key])}
                        onChange={(event) =>
                          onChange({ ...value, colors: { ...colors, [key]: event.target.value } })
                        }
                        style={{
                          width: 28,
                          height: 22,
                          border: 0,
                          padding: 0,
                          background: 'none',
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
