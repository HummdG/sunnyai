import { createHash } from 'node:crypto';

import { LOGO_EFFECTS, OUTLINE_EFFECTS, STENCIL_EFFECTS, type LogoEffect } from '@sunny/contracts';

import {
  cropAndFit,
  decodePng,
  encodePng,
  extractMask,
  maskToPng,
  suggestColors,
} from './image.js';
import { outlinePath, traceMask, verifyTrace } from './trace.js';

export type LogoKind = 'icon' | 'wordmark';

export interface ProcessedLogo {
  id: string;
  kind: LogoKind;
  width: number;
  height: number;
  png: Uint8Array;
  maskPng: Uint8Array | null;
  outline: string | null;
  availableEffects: LogoEffect[];
  suggestedColors: { primary: string; glow: string } | null;
}

const MIN_IOU = 0.98;
const MAX_OUTLINE = 60000;

/**
 * Decode, crop and fit an uploaded PNG, then work out which effects it can
 * carry. Outline effects need a trace that provably matches the logo; stencil
 * effects only need its mask.
 */
export function processLogo(bytes: Uint8Array, kind: LogoKind): ProcessedLogo {
  const raster = decodePng(bytes);
  const icon = kind === 'icon';
  const fitted = icon
    ? cropAndFit(raster, extractMask(raster), 512, 512)
    : cropAndFit(raster, null, 1200, 300);
  const { image, mask } = fitted;
  const png = encodePng(image);
  const id = createHash('sha256').update(png).digest('hex').slice(0, 16);

  let outline: string | null = null;
  const effects = new Set<LogoEffect>();
  if (mask) {
    STENCIL_EFFECTS.forEach((e) => effects.add(e));
    const polys = traceMask(mask);
    const path = outlinePath(polys);
    const { iou, farMismatch } = verifyTrace(polys, mask);
    if (iou >= MIN_IOU && farMismatch === 0 && path.length <= MAX_OUTLINE) {
      outline = path;
      OUTLINE_EFFECTS.forEach((e) => effects.add(e));
    }
  }

  return {
    id,
    kind,
    width: image.width,
    height: image.height,
    png,
    maskPng: mask ? maskToPng(mask) : null,
    outline,
    availableEffects: LOGO_EFFECTS.filter((e) => effects.has(e)),
    suggestedColors: mask ? suggestColors(image, mask) : null,
  };
}
