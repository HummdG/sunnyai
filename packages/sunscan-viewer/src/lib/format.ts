// Display formatting and plain-language labels used across the panels.
import type { BuiltForm, Confidence, Era, HouseModelSpec, RoofType } from '@sunny/sunscan-core/types';

const nf = (digits: number) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtNumber = (v: number, digits = 1) => (Number.isFinite(v) ? nf(digits).format(v) : '–');
export const fmtMetres = (v: number, digits = 2) => (Number.isFinite(v) ? `${nf(digits).format(v)} m` : '–');
export const fmtArea = (v: number, digits = 1) => (Number.isFinite(v) ? `${nf(digits).format(v)} m²` : '–');
export const fmtVolume = (v: number) => (Number.isFinite(v) ? `${nf(0).format(v)} m³` : '–');
export const fmtDegrees = (v: number, digits = 0) => (Number.isFinite(v) ? `${nf(digits).format(v)}°` : '–');

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 16-point compass name for a bearing in degrees (0 = N, 90 = E). */
export function compassPoint(bearing: number): string {
  if (!Number.isFinite(bearing)) return '–';
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

export const BUILT_FORM_LABEL: Record<BuiltForm, string> = {
  detached: 'Detached', 'semi-detached': 'Semi-detached', 'end-terrace': 'End of terrace', 'mid-terrace': 'Mid-terrace',
  block: 'Block or flats', unknown: 'Unknown form',
};

export const ERA_LABEL: Record<Era, string> = {
  'pre-1919': 'Before 1919', '1919-1944': '1919–1944', '1945-1964': '1945–1964', '1965-1980': '1965–1980',
  '1981-2000': '1981–2000', 'post-2000': 'After 2000', unknown: 'Age unknown',
};

export const ROOF_TYPE_LABEL: Record<RoofType, string> = {
  gabled: 'Gabled', hipped: 'Hipped', 'half-hipped': 'Half-hipped', 'dutch-gable': 'Dutch gable', pyramidal: 'Pyramid',
  skillion: 'Mono-pitch', gambrel: 'Gambrel', mansard: 'Mansard', flat: 'Flat', skeleton: 'Hipped (complex)',
};

/** Measured / estimated wording for a confidence level, plus whether it is an estimate (drawn dashed). */
export function confidenceInfo(c: Confidence | 'high' | 'medium' | 'low' | 'manual' | 'procedural'): { label: string; estimate: boolean; tone: 'good' | 'fair' | 'weak' } {
  switch (c) {
    case 'measured': return { label: 'Measured', estimate: false, tone: 'good' };
    case 'high': return { label: 'High confidence', estimate: false, tone: 'good' };
    case 'medium': return { label: 'Medium confidence', estimate: false, tone: 'fair' };
    case 'low': return { label: 'Low confidence', estimate: false, tone: 'weak' };
    case 'manual': return { label: 'Placed by you', estimate: false, tone: 'fair' };
    case 'procedural': return { label: 'Indicative estimate', estimate: true, tone: 'fair' };
    default: return { label: 'Estimated', estimate: true, tone: 'weak' };
  }
}

const FLAG_TEXT: Record<string, string> = {
  'lidar-unavailable': 'No open LiDAR covers this address, so heights come from typical values for the house type.',
  'fit-unreliable': 'The roof shape did not fit the LiDAR well. Treat roof pitch and height as approximate.',
  'registration-ambiguous': 'The building outline could not be lined up with the LiDAR with certainty.',
  'survey-old': 'The LiDAR survey is several years old. Later extensions or loft conversions may be missing.',
  'terrace-block': 'OpenStreetMap maps this terrace as one outline, so the model shows the whole block.',
  'footprint-from-overture': 'The outline comes from Overture Maps because OpenStreetMap has none here.',
  'footprint-user-drawn': 'The outline was drawn by you on the map.',
  'outside-library': 'The roof is more complex than the shapes we can fit. It is shown simplified.',
  'chimney-prior': 'The chimney position is assumed from the house type.',
  'geocode-low': 'The address could only be placed approximately.',
};

/** Plain-language explanation of a machine-readable quality flag. */
export function flagText(flag: string): string {
  return FLAG_TEXT[flag] ?? flag.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) + '.';
}

/** Attribution string embedded in exports (`asset.copyright`), de-duplicated in provenance order. */
export function attributionText(spec: Pick<HouseModelSpec, 'provenance'>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const s of spec.provenance) {
    const a = s.attribution.trim();
    if (a && !seen.has(a)) { seen.add(a); parts.push(a); }
  }
  return parts.length ? parts.join('; ') : '© OpenStreetMap contributors (ODbL)';
}

/** File-name friendly slug of the address. */
export function slugify(text: string, fallback = 'house'): string {
  const s = text.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60).replace(/-$/, '');
  return s || fallback;
}

/** UK solar-PV orientation guide for a roof plane (rule of thumb used by installers). */
export function pvAspect(azimuthDeg: number, pitchDeg: number): { label: string; rank: 0 | 1 | 2 | 3 } {
  if (!Number.isFinite(azimuthDeg) || pitchDeg < 5) return { label: 'Good (flat, tilt panels)', rank: 2 };
  const fromSouth = Math.abs(((azimuthDeg - 180 + 540) % 360) - 180);
  if (fromSouth <= 45) return { label: 'Best (south)', rank: 3 };
  if (fromSouth <= 67.5) return { label: 'Good (south-east/west)', rank: 2 };
  if (fromSouth <= 112.5) return { label: 'Fair (east/west)', rank: 1 };
  return { label: 'Poor (north)', rank: 0 };
}
