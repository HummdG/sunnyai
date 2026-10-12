'use client';

import type { RoofViewerHandle } from '@sunny/sunscan-viewer';
import { useEffect, useRef, useState } from 'react';

import { api, ApiFailure } from '../../lib/portal-api.js';
import { EmptyState, SunnyLoading } from './kit.js';

export interface RoofPlaneView {
  id: number | string;
  facing: string;
  pitchDeg: number;
  usableAreaM2: number;
  areaM2?: number;
  suitable: boolean;
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * The lead's house in 3D, for the installer: the SunScan viewer (three.js,
 * imported only when this component mounts, so no other page pays for it)
 * with the suitable planes highlighted, a sun-time slider for the shadows, a
 * plane list that points at each plane, a text summary of the same facts and
 * the GLB download. Indicative, like everything the assessment says.
 */
export function RoofViewer3D({
  basePath,
  address,
  planes,
  reliable,
}: {
  /** `/v1/portal/tenants/:t/leads/:l/assessment` */
  basePath: string;
  address: string | null;
  planes: readonly RoofPlaneView[];
  reliable: boolean;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<RoofViewerHandle | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [minutes, setMinutes] = useState(780);

  const suitable = planes
    .filter((p) => p.suitable)
    .map((p) => Number(p.id))
    .filter((id) => Number.isFinite(id));

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    void (async () => {
      try {
        const [spec, viewerModule] = await Promise.all([
          api<unknown>(`${basePath}/spec.json`),
          import('@sunny/sunscan-viewer'),
        ]);
        if (cancelled || !stageRef.current) return;
        viewerRef.current = viewerModule.mountRoofViewer(stageRef.current, {
          spec,
          highlight: suitable,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiFailure && err.status === 404) setState('missing');
        else {
          setError(err instanceof Error ? err.message : 'The model could not be loaded.');
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
    // `suitable` is derived from `planes`; re-mount only when the lead changes.
  }, [basePath]);

  const best = planes.filter((p) => p.suitable);
  const summary =
    `${address ?? 'This house'}: ${planes.length} roof plane${planes.length === 1 ? '' : 's'}` +
    (best.length > 0
      ? `, ${best.length} suitable for panels (${best
          .map((p) => `${p.facing} at ${Math.round(p.pitchDeg)}°`)
          .join(', ')}).`
      : ', none suitable for panels.');

  if (state === 'missing') {
    return (
      <EmptyState pose="shrug" title="No 3D model for this roof">
        The assessment finished without a model, so there is nothing to show in 3D. The summary
        above still applies.
      </EmptyState>
    );
  }

  return (
    <div className="roof-3d">
      {state === 'loading' ? <SunnyLoading text="Building the 3D model of the house…" /> : null}
      {state === 'error' ? (
        <EmptyState pose="droop" title="The 3D model didn't load">
          {error} Refresh the page to try again.
        </EmptyState>
      ) : null}
      <div
        ref={stageRef}
        className="roof-3d-stage"
        role="img"
        aria-label={`3D model of ${address ?? 'the house'}. ${summary}`}
        hidden={state !== 'ready'}
      />
      {state === 'ready' ? (
        <>
          <div className="roof-3d-controls">
            <label className="roof-3d-time">
              <span>
                Sun at <strong>{hhmm(minutes)}</strong>
              </span>
              <input
                type="range"
                min={360}
                max={1260}
                step={15}
                value={minutes}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setMinutes(m);
                  viewerRef.current?.setTime(m);
                }}
              />
            </label>
            <div className="pills" role="group" aria-label="Camera">
              {(['front', 'top', 'side', 'reset'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="pill"
                  onClick={() => viewerRef.current?.view(preset)}
                >
                  {preset === 'reset'
                    ? 'Reset view'
                    : `${preset[0]!.toUpperCase()}${preset.slice(1)}`}
                </button>
              ))}
            </div>
          </div>
          <ul className="pills roof-3d-planes" aria-label="Roof planes">
            {planes.slice(0, 10).map((plane) => {
              const on = () => viewerRef.current?.highlight([Number(plane.id)]);
              const off = () => viewerRef.current?.highlight(suitable);
              return (
                <li key={plane.id}>
                  <button
                    type="button"
                    className={`pill${plane.suitable ? ' suitable' : ''}`}
                    onMouseEnter={on}
                    onFocus={on}
                    onMouseLeave={off}
                    onBlur={off}
                  >
                    {plane.facing === 'flat' ? 'Flat' : `Faces ${plane.facing}`} ·{' '}
                    {Math.round(plane.pitchDeg)}° · {Math.round(plane.usableAreaM2)} m² usable
                    {plane.suitable ? ' ✓' : ''}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <p className="small muted">
        {reliable ? '' : 'Low-confidence measurement — confirm on the survey. '}
        {summary} Indicative — subject to an on-site survey.{' '}
        <a href={`/api/portal${basePath}/model.glb`} download>
          Download the 3D model (GLB)
        </a>
      </p>
    </div>
  );
}
