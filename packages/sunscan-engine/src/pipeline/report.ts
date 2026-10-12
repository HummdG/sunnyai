// Markdown report of a model build (CLI report.md): summary, parts, fit, quality flags, provenance, timings.
import type { HouseModelSpec } from '@sunny/sunscan-core';
import type { BuildDiagnostics } from './types.js';

const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Extra facts for the report (files written, timings, warnings). */
export interface ReportExtras {
  timings?: Record<string, number>;
  warnings?: string[];
  files?: { name: string; bytes: number; note?: string }[];
  /** How the pipeline decided (front-edge method, built-form reasons, model used). */
  diagnostics?: BuildDiagnostics;
}

const FRONT_METHOD: Record<NonNullable<BuildDiagnostics['front']>['method'], string> = {
  entrance: 'mapped entrance', road: 'facing the street (ray)', 'nearest-road': 'nearest street', 'longest-edge': 'guessed: longest wall',
};

/** Render a HouseModelSpec (+ build facts) as a Markdown report. */
export function renderReport(spec: HouseModelSpec, extras: ReportExtras = {}): string {
  const L: string[] = [];
  const attached = spec.context.neighbours.filter((n) => n.attached).length;
  L.push(`# House model: ${esc(spec.address.display)}`, '');
  L.push(`Generated ${spec.generatedAt} by ${spec.generator} — schema \`${spec.schema}\`, id \`${spec.id}\`.`, '');
  L.push('## Summary', '', '| Item | Value |', '|---|---|');
  if (spec.address.input) L.push(`| Input | ${esc(spec.address.input)} |`);
  L.push(`| Postcode / nation | ${spec.address.postcode ?? '—'} / ${spec.address.nation ?? '—'} |`);
  L.push(`| Building | \`${spec.id}\` |`);
  L.push(`| Built form | ${spec.builtForm} |`);
  L.push(`| Era | ${spec.era} |`);
  L.push(`| Origin (WGS84) | ${spec.origin.lat.toFixed(7)}, ${spec.origin.lon.toFixed(7)} |`);
  L.push(`| Ground datum | ${spec.groundElevation === null ? 'unknown' : `${f(spec.groundElevation)} m ODN`} |`);
  L.push(`| Parts | ${spec.parts.length} |`);
  L.push(`| Neighbours | ${spec.context.neighbours.length} (${attached} attached) |`);
  if (spec.context.terrain) L.push(`| Terrain grid | ${spec.context.terrain.width} × ${spec.context.terrain.height} @ ${spec.context.terrain.cellSize} m |`);
  if (spec.evidence) L.push(`| LiDAR evidence | ${spec.evidence.points.length / 3} samples @ ${spec.evidence.resolution} m (${esc(spec.evidence.source)}${spec.evidence.surveyDate ? `, ${spec.evidence.surveyDate}` : ''}) |`);
  if (spec.facade.front) {
    const how = extras.diagnostics?.front ? FRONT_METHOD[extras.diagnostics.front.method] : undefined;
    const why = [spec.facade.streetName ? esc(spec.facade.streetName) : '', how ?? ''].filter(Boolean).join(', ');
    L.push(`| Front edge | part ${spec.facade.front.partId}, edge ${spec.facade.front.edge}${why ? ` (${why})` : ''} |`);
  }
  if (extras.diagnostics) L.push(`| Model used | ${extras.diagnostics.parts === 'fit' ? 'LiDAR roof fit' : extras.diagnostics.parts === 'lod13' ? 'LoD1.3 blocks at LiDAR heights' : 'UK house-type priors'} |`);
  if (spec.context.imagery) L.push(`| Aerial ground texture | live layer only, not in the files (${esc(spec.context.imagery.attribution)}) |`);
  L.push('', '## Parts', '', '| Part | Role | Eave (m) | Roof | Pitch (°) | Storeys | Walls / roof | Chimneys | Heights / roof from |', '|---|---|---|---|---|---|---|---|---|');
  for (const p of spec.parts) {
    L.push(
      `| ${p.id} | ${p.role} | ${f(p.eaveHeight)} | ${p.roof.type} | ${p.roof.type === 'flat' ? '—' : f(p.roof.pitchDeg, 1)} | ${p.storeys} | ${p.material.wall} / ${p.material.roof} | ${p.chimneys.length} | ${p.source.heights} / ${p.source.roof} |`,
    );
  }
  L.push('', '## Fit', '');
  const fit = spec.fit;
  if (!fit) L.push('No LiDAR roof fit (see quality notes).');
  else {
    L.push('| Item | Value |', '|---|---|');
    L.push(`| Method | ${fit.method} |`);
    L.push(`| Selected | ${fit.selected} (P = ${f(fit.pModel, 3)}) |`);
    L.push(`| Residual scale σ* / RMSE | ${f(fit.sigma, 3)} m / ${f(fit.rmse, 3)} m |`);
    L.push(`| Inliers / pixels | ${f(fit.inlierFraction * 100, 1)} % of ${fit.nPixels} |`);
    L.push(`| Registration | ${fit.registration.method}, shift (${f(fit.registration.shift[0])}, ${f(fit.registration.shift[1])}) m E/N, σ ${f(fit.registration.sigmaMajor)}/${f(fit.registration.sigmaMinor)} m${fit.registration.flag ? `, ${fit.registration.flag}` : ''} |`);
    L.push(`| Unreliable | ${fit.unreliable ? '**yes**' : 'no'} |`);
    if (fit.alternatives.length) L.push(`| Alternatives | ${fit.alternatives.map((a) => `${a.label} (+${f(a.deltaCriterion, 1)})`).join(', ')} |`);
    if (fit.parts.length) {
      L.push('', '| Part | Family | Eave (m) | Ridge (m) | Pitch (°) | SE eave / pitch |', '|---|---|---|---|---|---|');
      for (const p of fit.parts) L.push(`| ${p.partId} | ${p.family} | ${f(p.eaveHeight)} | ${f(p.ridgeHeight)} | ${f(p.pitchDeg, 1)}${p.crossPitchDeg !== undefined ? ` / ${f(p.crossPitchDeg, 1)} (cross)` : ''} | ${f(p.eaveSE)} m / ${f(p.pitchSE, 1)}° |`);
    }
  }
  const q = spec.quality;
  L.push('', '## Quality', '', `Geocode **${q.geocode}** · footprint **${q.footprint}** · heights **${q.heights}** · roof **${q.roof}** · openings ${q.openings} · interior ${q.interior}`, '');
  L.push(`Flags: ${q.flags.length ? q.flags.map((x) => `\`${x}\``).join(', ') : 'none'}`, '');
  for (const n of q.notes) L.push(`- ${esc(n)}`);
  L.push('', '## Provenance and licences', '');
  for (const p of spec.provenance) L.push(`- **${esc(p.title)}** — ${esc(p.attribution)} (${p.licence})${p.date ? `, ${p.date}` : ''}${p.url ? ` <${p.url}>` : ''}`);
  if (extras.timings) {
    L.push('', '## Timings', '', '| Stage | ms |', '|---|---|');
    for (const [k, v] of Object.entries(extras.timings)) L.push(`| ${k} | ${f(v, 1)} |`);
  }
  if (extras.warnings?.length) {
    L.push('', '## Warnings', '');
    for (const w of extras.warnings) L.push(`- ${esc(w)}`);
  }
  if (extras.files?.length) {
    L.push('', '## Files', '');
    for (const x of extras.files) L.push(`- \`${x.name}\` (${x.bytes} bytes)${x.note ? ` — ${esc(x.note)}` : ''}`);
  }
  return L.join('\n') + '\n';
}
