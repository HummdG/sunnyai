import {
  SEQUENCES,
  GROUPS,
  INTENSITIES,
  SunnyAnimator,
  bestInGroup,
  machineEventForStreamEvent,
  sequencesInGroup,
} from '@sunny/animation-engine';
import type { Intensity, Sequence } from '@sunny/animation-engine';
import { defaultRig, renderSunny, SUNNY_THEME, type SunnyRig } from '@sunny/character';

/**
 * The animation playground.
 *
 * This exists to answer one question that a unit test cannot: does the character
 * actually look like the reference artwork when it moves? A test can prove a
 * pose is deterministic and inside the viewBox; only eyes can judge whether the
 * eureka reads as a eureka.
 *
 * Every sequence in the build is listed, and every one can be scrubbed. The
 * scrub is a real `frame(t)` call rather than a CSS animation, so what is on
 * screen here is byte-identical to what the widget would render at that instant.
 */

const FLAGSHIPS = ['idle', 'think', 'eureka', 'cool', 'charge', 'open'] as const;

/** Intensity as a comparable number, so "hidden below X" is a simple test. */
const RANK: Record<Intensity, number> = { off: 0, minimal: 1, balanced: 2, playful: 3 };

interface Card {
  readonly id: string;
  readonly group: string;
  /** Rank of the sequence's own intensity, so the grid can grey out the rest. */
  readonly rank: number;
  readonly svg: SVGSVGElement;
  readonly note: HTMLElement;
}

const state = {
  t: 0,
  playing: true,
  speed: 1,
  intensity: 'balanced' as Intensity,
  reducedMotion: false,
  scrubSource: 'idle' as string,
  scrubLength: 6000,
  zoom: 1,
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children);
  return node;
}

// ─── rendering ───────────────────────────────────────────────────────────────

/**
 * A named sequence, driven directly rather than through the scheduler.
 *
 * The lab deliberately bypasses the machine for this grid: the question here is
 * "what does this sequence look like", and routing each card through the state
 * machine would mean either faking eleven states or showing the wrong ones.
 */
function poseAt(sequence: Sequence, base: SunnyRig, t: number): SunnyRig {
  const progress = sequence.loop ? (t / sequence.duration) % 1 : Math.min(1, t / sequence.duration);
  return sequence.pose(base, progress);
}

let cards: Card[] = [];
let host: HTMLElement;

function buildGrid(): void {
  cards = SEQUENCES.map((sequence) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('width', '128');
    svg.setAttribute('height', '128');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${sequence.id} at the current scrub position`);

    const note = el('div', { class: 'card-note' });
    const card = el('button', { class: 'card', type: 'button', 'data-group': sequence.group }, [
      el('div', { class: 'card-art' }, [svg]),
      el('div', { class: 'card-id', text: sequence.id }),
      note,
    ]);
    card.addEventListener('click', () => {
      state.scrubSource = sequence.id;
      state.scrubLength = sequence.duration;
      renderScrubber();
    });
    host.append(card);
    return { id: sequence.id, group: sequence.group, rank: RANK[sequence.intensity], svg, note };
  });
}

function frame(): void {
  const base = defaultRig();
  for (const card of cards) {
    const sequence = SEQUENCES.find((s) => s.id === card.id)!;
    const rig = poseAt(sequence, base, state.t);
    card.svg.innerHTML = renderSunny(rig, { title: sequence.id, uniqueIds: true });

    const eligible = card.rank <= RANK[state.intensity];
    card.note.textContent = [
      sequence.group,
      `${sequence.duration}ms`,
      sequence.loop ? 'loops' : 'once',
      sequence.intensity,
      eligible ? '' : `· hidden below ${sequence.intensity}`,
    ]
      .filter(Boolean)
      .join(' · ');
    card.svg.parentElement?.classList.toggle('ineligible', !eligible);
    card.svg.parentElement?.classList.toggle(
      'has-props',
      rig.props.some((p) => p.opacity > 0.01),
    );
  }
  renderBigStage();
}

// ─── the single-character stage ──────────────────────────────────────────────

let stageSvg: SVGSVGElement | null = null;
let stageLabel: HTMLElement | null = null;
let animator = new SunnyAnimator(defaultRig(), { intensity: 'balanced' });

function renderBigStage(): void {
  if (!stageSvg) return;
  const rig = animator.frame(state.t, {
    reducedMotion: state.reducedMotion,
    intensity: state.intensity,
  }).rig;
  stageSvg.innerHTML = renderSunny(rig, { title: 'Sunny', uniqueIds: true });
  if (stageLabel) {
    const result = animator.lastFrame;
    stageLabel.textContent = [
      `state: ${animator.state}`,
      `sequence: ${result?.sequenceId ?? 'none'}`,
      `${state.t.toFixed(0)}ms`,
    ].join('   ·   ');
  }
}

// ─── controls ────────────────────────────────────────────────────────────────

function controls(): HTMLElement {
  const playButton = el('button', { class: 'btn', type: 'button', text: 'Pause' });
  playButton.addEventListener('click', () => {
    state.playing = !state.playing;
    playButton.textContent = state.playing ? 'Pause' : 'Play';
  });

  const speed = el('input', {
    type: 'range',
    min: '0.1',
    max: '2',
    step: '0.1',
    value: '1',
    'aria-label': 'Playback speed',
  });
  const speedLabel = el('span', { class: 'mono', text: '1.0×' });
  speed.addEventListener('input', () => {
    state.speed = Number(speed.value);
    speedLabel.textContent = `${state.speed.toFixed(1)}×`;
  });

  const intensity = el('select', { 'aria-label': 'Intensity' });
  for (const value of INTENSITIES) {
    intensity.append(el('option', { value, text: value, selected: value === state.intensity }));
  }
  intensity.addEventListener('change', () => {
    state.intensity = intensity.value as Intensity;
    animator = new SunnyAnimator(defaultRig(), {
      intensity: state.intensity,
      reducedMotion: state.reducedMotion,
    });
    renderScrubber();
  });

  const reduced = el('input', { type: 'checkbox', id: 'reduced' });
  reduced.addEventListener('change', () => {
    state.reducedMotion = reduced.checked;
    animator = new SunnyAnimator(defaultRig(), {
      intensity: state.intensity,
      reducedMotion: state.reducedMotion,
    });
    renderScrubber();
  });

  const zoom = el('input', {
    type: 'range',
    min: '0.5',
    max: '3',
    step: '0.25',
    value: '1',
    'aria-label': 'Zoom',
  });
  zoom.addEventListener('input', () => {
    state.zoom = Number(zoom.value);
    document.documentElement.style.setProperty('--zoom', String(state.zoom));
  });

  return el('div', { class: 'controls' }, [
    playButton,
    labelled('Speed', speed, speedLabel),
    labelled('Intensity', intensity),
    labelled('Zoom', zoom),
    el('label', { class: 'check' }, [reduced, el('span', { text: 'prefers-reduced-motion' })]),
  ]);
}

function labelled(label: string, control: HTMLElement, suffix?: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    control,
    ...(suffix ? [suffix] : []),
  ]);
}

// ─── the scrubber ────────────────────────────────────────────────────────────

let scrubInput: HTMLInputElement | null = null;
let scrubLabel: HTMLElement | null = null;
let eventLog: HTMLElement | null = null;

function scrubber(): HTMLElement {
  scrubInput = el('input', {
    type: 'range',
    min: '0',
    max: String(state.scrubLength),
    step: '1',
    value: '0',
    'aria-label': 'Scrub the selected sequence',
  });
  scrubInput.addEventListener('input', () => {
    state.t = Number(scrubInput!.value);
    state.playing = false;
    renderScrubber();
    frame();
  });

  const picker = el('select', { 'aria-label': 'Sequence to scrub' });
  for (const group of GROUPS) {
    const optgroup = el('optgroup', { label: group });
    for (const sequence of sequencesInGroup(group)) {
      optgroup.append(
        el('option', {
          value: sequence.id,
          text: `${sequence.id} (${sequence.duration}ms)`,
          selected: sequence.id === state.scrubSource,
        }),
      );
    }
    picker.append(optgroup);
  }
  picker.addEventListener('change', () => {
    state.scrubSource = picker.value;
    state.scrubLength = SEQUENCES.find((s) => s.id === picker.value)?.duration ?? 1000;
    renderScrubber();
  });

  eventLog = el('div', { class: 'event-log' });

  const events: Array<[string, string]> = [
    ['attention', 'attention'],
    ['turn_started', 'turn_started'],
    ['turn_finished', 'turn_finished'],
    ['turn_failed', 'turn_failed'],
    ['celebrate', 'celebrate'],
    ['impress', 'impress'],
    ['confused', 'confused'],
    ['guiding_started', 'guiding_started'],
    ['dismissed', 'dismissed'],
  ];
  const eventButtons = events.map(([label, type]) => {
    const button = el('button', { class: 'btn small', type: 'button', text: label });
    button.addEventListener('click', () => {
      animator.dispatch({ type } as never, state.t);
      if (eventLog) {
        eventLog.textContent = `${state.t.toFixed(0)}ms  ${label} → ${animator.state}`;
      }
      renderBigStage();
    });
    return button;
  });

  // The stream events, so the wiring from a chat event to a behaviour is
  // visible rather than having to be inferred from the source.
  const streamButtons = [
    'tool_started',
    'tool_finished',
    'recommendation_ready',
    'lead_saved',
    'error',
    'message_finished',
  ].map((type) => {
    const button = el('button', { class: 'btn small ghost', type: 'button', text: type });
    button.addEventListener('click', () => {
      const mapped = machineEventForStreamEvent({ type });
      if (mapped) animator.dispatch(mapped, state.t);
      if (eventLog) {
        eventLog.textContent = `${type} → ${mapped ? mapped.type : 'no behavioural meaning'} → ${animator.state}`;
      }
      renderBigStage();
    });
    return button;
  });

  return el('div', { class: 'scrubber' }, [
    labelled('Sequence', picker),
    el('div', { class: 'scrub-row' }, [scrubInput, (scrubLabel = el('span', { class: 'mono' }))]),
    el('div', { class: 'btn-row' }, [
      el('span', { class: 'field-label', text: 'machine events' }),
      ...eventButtons,
    ]),
    el('div', { class: 'btn-row' }, [
      el('span', { class: 'field-label', text: 'stream events' }),
      ...streamButtons,
    ]),
    eventLog,
  ]);
}

function renderScrubber(): void {
  if (scrubInput) {
    scrubInput.max = String(state.scrubLength);
    if (Number(scrubInput.value) > state.scrubLength) scrubInput.value = String(state.scrubLength);
  }
  if (scrubLabel) scrubLabel.textContent = `${state.t.toFixed(0)} / ${state.scrubLength} ms`;
}

// ─── boot ────────────────────────────────────────────────────────────────────

export function start(): void {
  host = document.getElementById('grid')!;
  buildGrid();

  const stage = document.getElementById('stage')!;
  stageSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  stageSvg.setAttribute('viewBox', '0 0 200 200');
  stageSvg.setAttribute('role', 'img');
  stageSvg.setAttribute('aria-label', 'The character, driven by the state machine');
  stageLabel = el('div', { class: 'mono stage-label' });
  stage.append(stageSvg, stageLabel);

  document.getElementById('controls')!.append(controls());
  document.getElementById('scrubber')!.append(scrubber());

  // Flagship shortcuts, so the five the brief cares about are one click away.
  const flagshipRow = el('div', { class: 'btn-row' });
  for (const group of FLAGSHIPS) {
    const best = bestInGroup(group, state.intensity);
    const button = el('button', {
      class: 'btn small',
      type: 'button',
      text: `${group} → ${best?.id ?? 'none'}`,
    });
    button.addEventListener('click', () => {
      animator.play(group, state.t);
      renderBigStage();
    });
    flagshipRow.append(button);
  }
  document.getElementById('flagships')!.append(flagshipRow);

  const swatch = document.getElementById('theme-swatch')!;
  for (const [name, value] of Object.entries(SUNNY_THEME)) {
    if (typeof value !== 'string') continue;
    swatch.append(
      el('div', { class: 'swatch' }, [
        el('span', { class: 'swatch-chip', style: `background:${value}` }),
        el('span', { class: 'mono', text: name }),
      ]),
    );
  }

  let last = performance.now();
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const dt = Math.min(64, now - last);
    last = now;
    if (state.playing) {
      state.t += dt * state.speed;
      if (state.t > state.scrubLength) state.t = 0;
      if (scrubInput) scrubInput.value = String(state.t);
      renderScrubber();
    }
    frame();
  };
  requestAnimationFrame(tick);
}

// The script tag sits at the end of the body, so the elements the lab mounts
// into already exist by the time this module runs.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => start(), { once: true });
} else {
  start();
}
