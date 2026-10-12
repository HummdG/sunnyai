import {
  mountRoofViewer,
  type RoofViewerHandle,
  type SavingsSimulationHandle,
  type SavingsTimelineLike,
} from '@sunny/sunscan-viewer';

export type { SavingsTimelineLike };

/**
 * The 3D roof view (SunScan), shipped as its own file -- `sunny-roof.js`, next
 * to the widget -- because three.js and the house synthesis are several times
 * the size of the whole widget, and a visitor who never asks to see their roof
 * should never download them.
 *
 * It opens as an overlay inside the panel: the model with the roof planes the
 * summary called suitable highlighted, a time-of-day slider for the shadows, a
 * plane list that highlights one plane on hover or focus, and a text summary of
 * the same facts for anyone who cannot use the canvas.
 */

export interface RoofPlaneLite {
  id: number;
  facing: string;
  pitchDeg: number;
  areaM2: number;
  suitable: boolean;
}

export interface OpenRoofOptions {
  apiUrl: string;
  token: string;
  specUrl: string;
  address: string;
  planes: readonly RoofPlaneLite[];
  label: string;
  reliable: boolean;
  /** A chosen package: lay its panels on the roof and play the savings simulation. */
  simulation?: {
    panelCount: number;
    timeline: SavingsTimelineLike;
    onComplete?: () => void;
  };
  onClose: () => void;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function openRoofView(host: HTMLElement, opts: OpenRoofOptions): Promise<() => void> {
  const overlay = node('div', {
    class: 'roof-view',
    role: 'dialog',
    'aria-label': `3D model of ${opts.address}`,
  });
  const bar = node('div', { class: 'roof-bar' });
  bar.append(node('strong', {}, 'Your roof in 3D'));
  const close = node(
    'button',
    { type: 'button', class: 'roof-close', 'aria-label': 'Close the 3D view' },
    '×',
  );
  bar.append(close);
  const stage = node('div', { class: 'roof-stage' });
  const status = node('p', { class: 'roof-status', role: 'status' }, 'Loading the model…');
  stage.append(status);
  overlay.append(bar, stage);
  host.append(overlay);

  let viewer: RoofViewerHandle | null = null;
  let sim: SavingsSimulationHandle | null = null;
  let simTimer = 0;
  const teardown = () => {
    clearTimeout(simTimer);
    sim?.dispose();
    viewer?.dispose();
    viewer = null;
    overlay.remove();
  };
  close.addEventListener('click', () => {
    teardown();
    opts.onClose();
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      teardown();
      opts.onClose();
    }
  });
  close.focus();

  try {
    const response = await fetch(`${opts.apiUrl}${opts.specUrl}`, {
      headers: { authorization: `Bearer ${opts.token}` },
    });
    if (!response.ok) throw new Error(`The model could not be loaded (${response.status}).`);
    const spec: unknown = await response.json();
    status.remove();
    const suitable = opts.planes.filter((p) => p.suitable).map((p) => p.id);
    viewer = mountRoofViewer(stage, {
      spec,
      highlight: suitable,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  } catch (error) {
    status.textContent = (error as Error).message;
    return teardown;
  }

  // Time of day: the shadows move with the sun over the house.
  const controls = node('div', { class: 'roof-controls' });
  const timeLabel = node('label', { class: 'roof-time' });
  const time = node('input', { type: 'range', min: '360', max: '1260', step: '15', value: '780' });
  const shown = node('span', {}, hhmm(780));
  timeLabel.append('Sun at ', shown, time);
  time.addEventListener('input', () => {
    const minutes = Number(time.value);
    shown.textContent = hhmm(minutes);
    viewer?.setTime(minutes);
  });
  controls.append(timeLabel);

  // The planes, as a list that points at each one in the model.
  const list = node('ul', { class: 'roof-planes', 'aria-label': 'Roof planes' });
  const suitableIds = opts.planes.filter((p) => p.suitable).map((p) => p.id);
  for (const plane of opts.planes.slice(0, 8)) {
    const item = node('li');
    const button = node(
      'button',
      { type: 'button' },
      `${plane.facing === 'flat' ? 'Flat' : `Faces ${plane.facing}`} · ${Math.round(plane.pitchDeg)}° · ${Math.round(plane.areaM2)} m²${plane.suitable ? ' ✓' : ''}`,
    );
    const on = () => viewer?.highlight([plane.id]);
    const off = () => viewer?.highlight(suitableIds);
    button.addEventListener('mouseenter', on);
    button.addEventListener('focus', on);
    button.addEventListener('mouseleave', off);
    button.addEventListener('blur', off);
    item.append(button);
    list.append(item);
  }
  const note = node(
    'p',
    { class: 'roof-note' },
    `${opts.reliable ? '' : 'Low-confidence measurement. '}Highlighted: planes facing east to west. ${opts.label}.`,
  );
  overlay.append(controls, list, note);

  // A chosen package: its panels drop onto the best planes, then the months play.
  if (opts.simulation && viewer) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const placed = viewer.showPanels({ count: opts.simulation.panelCount, planeIds: suitableIds });
    if (placed.unplaced > 0) {
      note.textContent += ` ${placed.placed} of ${opts.simulation.panelCount} panels shown; the rest are placed at survey.`;
    }
    const begin = () => {
      if (!viewer || !opts.simulation) return;
      sim = viewer.playSavingsSimulation(opts.simulation.timeline, {
        reducedMotion: reduced,
        ...(opts.simulation.onComplete ? { onComplete: opts.simulation.onComplete } : {}),
      });
    };
    if (reduced) begin();
    else simTimer = window.setTimeout(begin, Math.min(1600, placed.placed * 45 + 600));
  }
  return teardown;
}
