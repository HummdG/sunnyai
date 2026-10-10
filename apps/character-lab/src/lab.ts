import {
  CATALOGUE,
  SEQUENCES,
  GROUPS,
  INTENSITIES,
  SunnyAnimator,
  bestInGroup,
  machineEventForStreamEvent,
  sequencesInGroup,
} from '@sunny/animation-engine';
import type { Intensity, MachineEvent, Sequence } from '@sunny/animation-engine';
import { defaultRig, renderSunny, SUNNY_THEME, type SunnyRig } from '@sunny/character';

import type { Reactions } from './arcade.js';
import { el } from './dom.js';
import { gamePanel, type GamePanel } from './game.js';

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

  // After the stage has run a frame, so `lastFrame` is this instant's result.
  const drawn = animator.lastFrame?.sequenceId;
  const liveGroup = drawn ? groupOfSequence.get(drawn) : undefined;
  for (const moment of moments) {
    const live = moment.group === liveGroup;
    moment.node.classList.toggle('live', live);
    // Sticky until the next Play click, so a short moment is recorded rather
    // than only visible at the instant it happens.
    if (live) moment.node.dataset.drawn = '1';
  }
}

// ─── the catalogue ───────────────────────────────────────────────────────────

/**
 * The catalogue, as a person would read it.
 *
 * The grid below lists *sequences*, which is the engine's vocabulary. This lists
 * *moments*, which is the vocabulary a tenant or a prospect is shown -- and
 * because it is built from the same `CATALOGUE` the widget and the gallery
 * describe, a moment cannot exist here and be missing from there.
 *
 * `Play` goes through `animator.play(group)` rather than posing a sequence
 * directly, so what a click produces is exactly what a stream event would: the
 * scheduler picks the variant for the current intensity, and the card lights up
 * in `frame()` when that variant is the one being drawn. A card that lights up
 * when clicked has been *shown* to be playable; a card that does not lights up
 * nowhere, and that is the failure worth seeing.
 *
 * The highlight is per-frame and therefore transient, so clicking `Play` also
 * clears a `data-drawn` mark and `frame()` sets it for whatever it draws: the
 * mark is a record of what the page rendered *since the click*, which does not
 * depend on anyone sampling the screen at the right instant. A moment can be on
 * screen for a few hundred milliseconds -- the listening perk waits behind the
 * 420 ms bubble and is then drawn for less than a third of a second -- and a
 * test that only looked at the class could miss it and report a moment that
 * plays perfectly well as broken.
 */
let moments: Array<{ group: string; node: HTMLElement; button: HTMLButtonElement }> = [];
const groupOfSequence = new Map<string, string>(SEQUENCES.map((s) => [s.id, s.group]));

/**
 * How an application actually arrives at a moment.
 *
 * `Play` is a demonstration, not a bypass: it drives the machine the way a
 * stream event would, then asks for the moment. A moment whose only state is one
 * an event enters **does nothing when called from rest** -- the perk, the
 * thinking spin, the eureka, the speaking pulse, the point, the play move, the
 * tilt and the error each declare a state that only an event can enter, so
 * `play()` on its own is refused by the scheduler's state check. A gallery that
 * simply called `play()` in place would leave the most interesting cards doing
 * nothing when clicked, which reads as a broken engine rather than as a moment
 * that needs a reason.
 *
 * `idle` comes first so that every click starts from the same place: without it,
 * one moment would strand the next, and which cards worked would depend on the
 * order they were clicked in.
 */
const ROUTE: Record<string, readonly MachineEvent['type'][]> = {
  listen: ['attention'],
  think: ['turn_started'],
  // The answer arriving: `speaking_started` out of thinking is what the engine
  // itself reads as the eureka, so the gallery only has to set the scene.
  eureka: ['turn_started', 'speaking_started'],
  speak: ['speaking_started'],
  guide: ['guiding_started'],
  // A game starting is what makes Sunny show off; the move itself is the
  // engine's, asked for by `play_started` the same way the eureka is asked for
  // by `speaking_started` out of thinking.
  play: ['play_started'],
  // The break Sunny takes when the visitor closes the chat. The panel has to be
  // open for there to be anything to close, so the route opens it first: a
  // dismissal from rest is legal, but it is not the moment A04 is about, and the
  // bubble arriving first is the half-second of context that makes the chair
  // read as a break rather than as furniture appearing from nowhere.
  relax: ['attention', 'dismissed'],
  confused: ['confused'],
  // `turn_failed` is not accepted from rest, so the error has to be reached the
  // way it really happens: a turn that started and then failed.
  error: ['turn_started', 'turn_failed'],
};

function buildCatalogue(): void {
  const host = document.getElementById('catalogue-card')!;
  moments = CATALOGUE.map((entry) => {
    const route = ROUTE[entry.group] ?? [];
    const button = el('button', {
      class: 'btn small',
      type: 'button',
      text: 'Play',
      title:
        route.length === 0 ? 'Plays from the resting state' : `Goes idle → ${route.join(' → ')}`,
    });
    button.addEventListener('click', () => {
      // A fresh question, so `data-drawn` answers it rather than the last one,
      // and a fresh stage, so the previous demonstration is not the answer. A
      // moment expires on its own clock from the request, not from its first
      // frame, so without this a click made while something long is still
      // playing -- a 2.6 s charging panel -- would be dropped rather than shown.
      for (const moment of moments) delete moment.node.dataset.drawn;
      animator.reset();
      animator.dispatch({ type: 'idle' }, state.t);
      for (const type of route) animator.dispatch({ type }, state.t);
      // The route may already have asked for the moment -- the engine reads
      // `speaking_started` out of thinking as the eureka -- in which case this
      // is a no-op rather than a failure, so its result is not the gate.
      animator.play(entry.group, state.t);
      // Point the scrubber at whatever the scheduler just chose, so the moment
      // can be inspected frame by frame rather than only watched.
      const best = bestInGroup(entry.group, state.intensity);
      if (best) {
        state.scrubSource = best.id;
        state.scrubLength = best.duration;
      }
      renderScrubber();
      renderBigStage();
    });

    const node = el(
      'div',
      { class: entry.asked === 'engine' ? 'moment' : 'moment unwired', 'data-group': entry.group },
      [
        el('div', { class: 'moment-head' }, [
          el('span', { class: 'moment-name', text: entry.name }),
          el('span', { class: 'moment-cat', text: entry.category }),
        ]),
        el('div', { class: 'moment-desc', text: entry.description }),
        el('div', { class: 'moment-foot' }, [
          el('span', {
            class: 'moment-asked',
            // The backticks read well in the source and badly on a page.
            text: entry.askedBy ? `asked by ${entry.askedBy.replace(/`/g, '')}` : 'no caller yet',
          }),
          button,
        ]),
        ...(entry.note ? [el('div', { class: 'moment-why', text: entry.note })] : []),
      ],
    );
    host.append(node);
    return { group: entry.group, node, button };
  });
  refreshCatalogue();
}

/** Keeps the Play buttons honest about whether the moment survives this intensity. */
function refreshCatalogue(): void {
  for (const moment of moments) {
    const best = bestInGroup(moment.group, state.intensity);
    moment.button.disabled = best === null;
    moment.button.textContent = best ? `Play · ${best.id}` : `hidden at ${state.intensity}`;
  }
}

// ─── the arcade (A08) ────────────────────────────────────────────────────────

/** What an arcade game can say to the character. */
function reactions(): Reactions {
  return {
    dispatch: (type) => {
      // Cast rather than narrowed, exactly as the event buttons above do: the
      // arcade names a machine event, and a name the machine does not know is
      // refused by the same `dispatch` that refuses it here.
      animator.dispatch({ type } as never, state.t);
      renderBigStage();
    },
  };
}

/**
 * Fetch the arcade bundle, once.
 *
 * A script tag rather than a dynamic `import()`: the lab is served as a classic
 * script, and an importing lab would have to become an ES module and carry the
 * arcade's code in its own chunk -- which is the thing "lazy-loaded" is supposed
 * to avoid. The bundle registers itself on `window.SunnyArcade` and this waits
 * for it to say so, rather than assuming that `load` means the code has run.
 */
function loadArcade(): Promise<NonNullable<Window['SunnyArcade']>> {
  return new Promise((resolve, reject) => {
    if (window.SunnyArcade) {
      resolve(window.SunnyArcade);
      return;
    }
    const script = document.createElement('script');
    script.src = '/arcade.js';
    script.addEventListener(
      'load',
      () => {
        const loaded = window.SunnyArcade;
        if (loaded) resolve(loaded);
        else reject(new Error('arcade.js loaded but registered nothing'));
      },
      { once: true },
    );
    script.addEventListener('error', () => reject(new Error('the arcade bundle did not load')), {
      once: true,
    });
    document.head.append(script);
  });
}

/**
 * A08's arcade, on the page but not in the bundle.
 *
 * The point of the button is that until it is pressed, `/arcade.js` has not been
 * requested -- so the panel is built from a promise rather than from the module,
 * and a failure leaves the button in a state that can be pressed again rather
 * than a page that looks loaded and is not.
 */
function buildArcade(): void {
  const host = document.getElementById('arcade')!;
  const slot = el('div', { class: 'arcade-slot' });
  const note = el('p', {
    class: 'note',
    text: 'Nothing here is fetched until the button is pressed.',
  });
  const button = el('button', { class: 'btn', type: 'button', text: 'Load the arcade' });

  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Loading…';
    loadArcade()
      .then((loaded) => {
        loaded.mount(slot, reactions());
        button.remove();
        // The panel says how to play it; this note says the thing only the page
        // that loaded it can say, so the two are not the same sentence twice.
        note.textContent = 'Loaded: /arcade.js arrived on the press and not before.';
      })
      .catch((error: unknown) => {
        button.disabled = false;
        button.textContent = 'Load the arcade';
        note.textContent = error instanceof Error ? error.message : 'the arcade did not load';
      });
  });

  host.append(button, note, slot);
}

// ─── the single-character stage ──────────────────────────────────────────────

let stageSvg: SVGSVGElement | null = null;
let stageLabel: HTMLElement | null = null;
let animator = new SunnyAnimator(defaultRig(), { intensity: 'balanced' });
/** A06's board. Null until `start()` has built it. */
let board: GamePanel | null = null;

function renderBigStage(): void {
  if (!stageSvg) return;
  const rig = animator.frame(state.t, {
    reducedMotion: state.reducedMotion,
    intensity: state.intensity,
  }).rig;
  stageSvg.innerHTML = renderSunny(rig, { title: 'Sunny', uniqueIds: true });
  if (stageLabel) {
    const result = animator.lastFrame;
    const props = rig.props.filter((prop) => prop.opacity > 0.001).map((prop) => prop.id);
    stageLabel.textContent = [
      `state: ${animator.state}`,
      `sequence: ${result?.sequenceId ?? 'none'}`,
      props.length > 0 ? `props: ${props.join(', ')}` : '',
      `${state.t.toFixed(0)}ms`,
    ]
      .filter(Boolean)
      .join('   ·   ');
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
    ['play_started', 'play_started'],
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
  // A moment can be reachable at one intensity and not at another, so the
  // catalogue's buttons are re-asked rather than computed once.
  refreshCatalogue();
}

// ─── boot ────────────────────────────────────────────────────────────────────

export function start(): void {
  host = document.getElementById('grid')!;
  buildGrid();
  buildCatalogue();

  const stage = document.getElementById('stage')!;
  stageSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  stageSvg.setAttribute('viewBox', '0 0 200 200');
  stageSvg.setAttribute('role', 'img');
  stageSvg.setAttribute('aria-label', 'The character, driven by the state machine');
  stageLabel = el('div', { class: 'mono stage-label' });
  stage.append(
    stageSvg,
    el('div', {
      class: 'stage-hint',
      text: 'Tap her to give her a balloon, then tap the balloon to pop it.',
    }),
    stageLabel,
  );

  // The pointer channel (A05). One handler covers every kind of pointer: a mouse,
  // a finger and a pen all arrive as `pointerup`, so the lab demonstrates the
  // gesture the widget will have to forward rather than a mouse-specific version
  // of it. The coordinates come from the SVG's own screen matrix rather than from
  // arithmetic on the bounding box, because that is the transform the browser
  // actually applied -- it stays correct through a zoom or a resize, and it
  // accounts for the letterboxing a non-square stage would introduce.
  stage.addEventListener('pointerup', (event) => {
    if (!stageSvg) return;
    const ctm = stageSvg.getScreenCTM();
    if (!ctm) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const hit = animator.tap({ x: point.x, y: point.y }, state.t);
    // Drawn first, so the log reports what the tap actually produced rather than
    // what the previous frame happened to be showing.
    renderBigStage();
    if (eventLog) {
      const at = `${point.x.toFixed(0)},${point.y.toFixed(0)}`;
      eventLog.textContent = hit
        ? `${state.t.toFixed(0)}ms  tap ${at} → ${animator.lastFrame?.sequenceId ?? 'requested'}`
        : `${state.t.toFixed(0)}ms  tap ${at} → nothing there`;
    }
  });

  // A06's board, driven on the stage's own clock: the lab can be paused and
  // scrubbed, and the board has to pause and scrub with it rather than playing
  // on against a character that is standing still.
  board = gamePanel({
    animator: () => animator,
    now: () => state.t,
    redraw: () => renderBigStage(),
  });
  document.getElementById('game')!.append(board.element);
  buildArcade();

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
      // The preview clock is not restarted while something is still playing.
      // The window is scoped to the selected moment, and a moment can be
      // shorter-lived than what it waits behind: `attention` asks for a 420 ms
      // bubble, and the listening perk is queued behind it for longer than its
      // own 270 ms. Wrapping the clock at 270 would rewind mid-flight, the
      // bubble would never reach its 420 ms, and the perk would never be drawn
      // at all -- a moment that looks broken only from in here.
      if (state.t > state.scrubLength && animator.scheduler.active.length === 0) state.t = 0;
      if (scrubInput) scrubInput.value = String(Math.min(state.t, state.scrubLength));
      renderScrubber();
    }
    // Before the frame, so a move Sunny makes and the thinking she did on the
    // way to it are drawn in the same tick as the clock that caused them.
    board?.tick(state.t);
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
