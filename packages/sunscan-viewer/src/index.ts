// @sunny/sunscan-viewer — SunScan's three.js house viewer (vendored from
// SunScanV2 apps/web/src/three) behind one framework-free call, so the widget can
// embed it from a lazily-loaded bundle and the dashboard can wrap it in React.
//
// The model is rebuilt in the browser from the engine's HouseModelSpec by the
// same core synthesis the server used for the GLB, which is what lets the viewer
// highlight individual roof planes and cast real shadows.

import type { HouseModelSpec, RoofFaceInfo } from '@sunny/sunscan-core/types';

import { ukLocalToUtc } from './lib/time';
import { buildPanelObjects, layoutPanels, type PanelObjects } from './panels';
import {
  createSavingsOverlay,
  type SavingsSimulationHandle,
  type SavingsSimulationOptions,
  type SavingsTimelineLike,
} from './simulation';
import { sunState } from './sun';
import { corePalette, synthesize } from './synthesize';
import { Viewer } from './Viewer';

export interface RoofViewerOptions {
  /** The engine's HouseModelSpec (as served at `/v1/sunscan/assessments/:id/spec.json`). */
  spec: unknown;
  /** Roof faces to highlight at first; usually the plane list's suitable faces. */
  highlight?: readonly number[];
  /** The day the sun is drawn for; defaults to today. */
  date?: Date;
  /** Local clock minutes past midnight for the sun (default 13:00). */
  minutes?: number;
  /** Turn off camera easing (prefers-reduced-motion). */
  reducedMotion?: boolean;
  onWarning?: (message: string) => void;
}

export interface RoofFace {
  id: number;
  partId: string;
  pitchDeg: number;
  azimuthDeg: number | null;
  areaM2: number;
}

export interface ShowPanelsOptions {
  /** How many panels the chosen package has. */
  count: number;
  /** Roof planes to fill, best first (e.g. the summary's suitable plane ids); defaults to the viewer's ranking. */
  planeIds?: readonly number[];
  moduleLongM?: number;
  moduleShortM?: number;
  /** Drop the panels in one by one (default true; off under reduced motion). */
  animate?: boolean;
}

export interface ShowPanelsResult {
  placed: number;
  /** Panels that did not fit the chosen planes. */
  unplaced: number;
  perPlane: { faceId: number; count: number; capacity: number }[];
}

export type { SavingsSimulationHandle, SavingsSimulationOptions, SavingsTimelineLike };

export interface RoofViewerHandle {
  /** The model's roof planes, as the viewer numbers them. */
  readonly faces: readonly RoofFace[];
  highlight(ids: readonly number[] | null): void;
  /** Move the sun to `minutes` past local midnight on the viewer's day. */
  setTime(minutes: number): void;
  view(preset: 'front' | 'top' | 'side' | 'reset'): void;
  /** Lay the package's panels on the roof (replacing any shown). */
  showPanels(opts: ShowPanelsOptions): ShowPanelsResult;
  clearPanels(): void;
  /** Play the month-by-month savings simulation over the model. */
  playSavingsSimulation(timeline: SavingsTimelineLike, opts?: SavingsSimulationOptions): SavingsSimulationHandle;
  dispose(): void;
}

function isSpec(value: unknown): value is HouseModelSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schema?: unknown }).schema === 'sunscan.house/1' &&
    Array.isArray((value as { parts?: unknown }).parts)
  );
}

export function mountRoofViewer(host: HTMLElement, opts: RoofViewerOptions): RoofViewerHandle {
  if (!isSpec(opts.spec)) throw new Error('Not a SunScan house model.');
  const spec = opts.spec;
  const { mesh } = synthesize(spec);
  const viewer = new Viewer(host, { onWarning: (m) => opts.onWarning?.(m) }, corePalette());
  // The roof is the point: no windows or doors on the walls, nothing inside.
  viewer.setToggles({ openings: false, interior: false, floors: false, stairs: false, evidence: false });
  viewer.setModel(spec, mesh, { resetCamera: true });
  if (opts.reducedMotion) viewer.controls.enableDamping = false;

  // UK clock time on the chosen day (GMT or BST, from the Europe/London rules).
  const day = (opts.date ?? new Date()).toISOString().slice(0, 10);
  const setTime = (minutes: number) =>
    viewer.setSun(sunState(ukLocalToUtc(day, minutes), spec.origin.lat, spec.origin.lon), true);
  setTime(opts.minutes ?? 13 * 60);

  const roofKinds = new Set<RoofFaceInfo['kind']>(['roof', 'flat']);
  const faces: RoofFace[] = mesh.roofFaces
    .filter((f) => roofKinds.has(f.kind))
    .map((f) => ({
      id: f.id,
      partId: f.partId,
      pitchDeg: f.pitchDeg,
      azimuthDeg: Number.isFinite(f.azimuthDeg) ? f.azimuthDeg : null,
      areaM2: f.area,
    }));

  let panels: PanelObjects | null = null;
  let panelAnchor: [number, number, number] | null = null;
  let dropRaf = 0;
  const clearPanels = () => {
    cancelAnimationFrame(dropRaf);
    if (panels) {
      viewer.removeHelper(panels.group);
      panels.dispose();
      panels = null;
    }
    panelAnchor = null;
  };
  const showPanels = (o: ShowPanelsOptions): ShowPanelsResult => {
    clearPanels();
    const layout = layoutPanels(mesh, o);
    const result = { placed: layout.placements.length, unplaced: layout.unplaced, perPlane: layout.perPlane };
    if (layout.placements.length === 0) return result;
    const objects = buildPanelObjects(layout);
    panels = objects;
    const n = layout.placements.length;
    const sum = layout.placements.reduce(
      (a, p) => [a[0] + p.center[0], a[1] + p.center[1], Math.max(a[2], p.center[2])] as [number, number, number],
      [0, 0, -Infinity] as [number, number, number],
    );
    panelAnchor = [sum[0] / n, sum[1] / n, sum[2] + 1.2];
    viewer.addHelper(objects.group);
    const animate = (o.animate ?? true) && !opts.reducedMotion && typeof requestAnimationFrame === 'function';
    if (!animate) {
      objects.setProgress(() => 1);
      viewer.requestRender();
      return result;
    }
    // Staggered drop-in: each panel lands in 560 ms, 75 ms after the one before.
    const start = performance.now();
    const step = (now: number) => {
      const t = now - start;
      objects.setProgress((i) => (t - i * 75) / 560);
      viewer.requestRender();
      if (t < (n - 1) * 75 + 580) dropRaf = requestAnimationFrame(step);
    };
    objects.setProgress(() => 0);
    dropRaf = requestAnimationFrame(step);
    return result;
  };

  let simulation: SavingsSimulationHandle | null = null;
  const year = (opts.date ?? new Date()).getFullYear();
  const playSavingsSimulation = (timeline: SavingsTimelineLike, so: SavingsSimulationOptions = {}) => {
    simulation?.dispose();
    const roofTop = (): [number, number, number] => {
      if (panelAnchor) return panelAnchor;
      const best = faces.find((f) => f.pitchDeg > 0) ?? faces[0];
      const info = best ? mesh.roofFaces.find((f) => f.id === best.id) : undefined;
      return info ? [info.centroid[0], info.centroid[1], info.centroid[2] + 2] : [0, 0, 8];
    };
    simulation = createSavingsOverlay(
      host,
      timeline,
      {
        anchor: () => viewer.projectToScreen(roofTop()),
        // Mid-month, sweeping the daylight hours (07:30 to 18:30 UK time) as the month plays.
        setSun: (index, dayFraction) => {
          const day = new Date(Date.UTC(year, index, 15)).toISOString().slice(0, 10);
          const minutes = 7.5 * 60 + Math.max(0, Math.min(1, dayFraction)) * 11 * 60;
          viewer.setSun(sunState(ukLocalToUtc(day, minutes), spec.origin.lat, spec.origin.lon), true);
        },
        requestRender: () => viewer.requestRender(),
      },
      { ...so, reducedMotion: so.reducedMotion ?? opts.reducedMotion ?? false },
    );
    return simulation;
  };

  const handle: RoofViewerHandle = {
    faces,
    highlight: (ids) => viewer.highlightRoofFaces(mesh, ids),
    setTime,
    view: (preset) => viewer.viewPreset(preset),
    showPanels,
    clearPanels,
    playSavingsSimulation,
    dispose: () => {
      simulation?.dispose();
      clearPanels();
      viewer.dispose();
    },
  };
  if (opts.highlight?.length) handle.highlight(opts.highlight);
  return handle;
}
