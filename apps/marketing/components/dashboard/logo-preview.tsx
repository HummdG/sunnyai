'use client';

import { createLogoView, type LogoArt } from '@sunny/logo-effects';
import { useEffect, useRef, useState } from 'react';

import { portalUrl, type LogoEffect } from '../../lib/portal-api.js';
import { artFor, effectiveColors, type BrandDraft } from './brand-section.js';

/** How long "Play" keeps the logo busy: long enough to see an effect change. */
const PLAY_MS = 6000;

/** One logo drawn by the widget's own view, busy or still. */
function LogoView({
  art,
  effects,
  busy,
  className,
  label,
}: {
  art: LogoArt;
  effects: readonly LogoEffect[];
  busy: boolean;
  className: string;
  label?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<ReturnType<typeof createLogoView> | null>(null);
  const key = JSON.stringify([art, effects]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const next = createLogoView(node, art, effects, label === undefined ? {} : { label });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) next.setMotion('reduced');
    view.current = next;
    return () => {
      next.destroy();
      view.current = null;
      node.innerHTML = '';
    };
    // `key` stands for `art` and `effects`, which are rebuilt on every render.
  }, [key, label]);

  useEffect(() => {
    view.current?.setBusy(busy);
  }, [busy, key]);

  return <div className={className} ref={host} />;
}

/**
 * The live preview for an installer's own logo: the chat header (icon beside the
 * wordmark, or the company name) and the round chat button, drawn the way the
 * widget draws them. "Play" makes it busy for a few seconds, as if replying.
 */
export function LogoPreview({
  draft,
  busy = false,
  companyName,
}: {
  draft: BrandDraft;
  busy?: boolean;
  companyName: string;
}) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(false), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing]);

  const { icon, wordmark } = draft;
  if (!icon) {
    return <p className="muted small">Upload an icon to see it here.</p>;
  }
  const art = artFor(icon, effectiveColors(draft));
  const effects = draft.effects.filter((e) => icon.availableEffects.includes(e));
  const active = busy || playing;

  return (
    <div className="logo-preview">
      <div className="logo-preview-header">
        <LogoView className="logo-preview-icon" art={art} effects={effects} busy={active} />
        {wordmark ? (
          <img
            className="logo-preview-wordmark"
            src={portalUrl(wordmark.url)}
            alt={companyName}
            width={wordmark.width}
            height={wordmark.height}
          />
        ) : (
          <strong>{companyName}</strong>
        )}
      </div>
      <LogoView
        className="logo-preview-launcher"
        art={art}
        effects={effects}
        busy={active}
        label="Chat button"
      />
      <button
        type="button"
        className="button secondary"
        disabled={playing || effects.length === 0}
        onClick={() => setPlaying(true)}
      >
        {playing ? 'Playing…' : 'Play'}
      </button>
    </div>
  );
}
