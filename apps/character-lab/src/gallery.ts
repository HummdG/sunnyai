import { SEQUENCES, type Sequence } from '@sunny/animation-engine';
import { cartoonClock, createSunnyView, defaultRig, type SunnyView } from '@sunny/character';

/**
 * The animation gallery: every sequence in the engine, each playing on its own
 * loop, for checking by eye against the reference artwork.
 *
 * It calls each sequence's `pose(base, t)` directly rather than going through
 * the scheduler, so a card shows exactly what that sequence draws -- not what
 * the state machine would choose -- and a short hold at rest between loops
 * shows whether it really returns to the default pose.
 */

const HOLD_MS = 500;
const base = defaultRig();

interface Card {
  seq: Sequence;
  view: SunnyView;
  bar: HTMLElement;
  clock: HTMLElement;
}

const cards: Card[] = [];
let speed = 1;
let paused = false;
let scrub = 0;
let elapsed = 0;
let last = performance.now();
let boil = 0;
let filmTime = 0;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Progress 0..1 within the sequence, or null while holding at rest. */
function progressAt(seq: Sequence, ms: number): number | null {
  const local = ms % (seq.duration + HOLD_MS);
  return local < seq.duration ? local / seq.duration : null;
}

function build(): void {
  createSunnyView(document.getElementById('rest')!, { decorative: true }).draw(base);

  const grid = document.getElementById('grid')!;
  const groups = new Map<string, Sequence[]>();
  for (const seq of SEQUENCES) {
    const list = groups.get(seq.group) ?? [];
    list.push(seq);
    groups.set(seq.group, list);
  }
  for (const [group, list] of groups) {
    const section = make('section', 'group');
    section.append(make('h2', '', group));
    const row = make('div', 'row');
    for (const seq of list) {
      const card = make('article', 'card');
      const stage = make('div', 'stage');
      const art = make('div', 'art');
      stage.append(art);
      const meta = make('div', 'meta');
      meta.append(make('strong', '', seq.id));
      const facts = [
        seq.duration <= 1 ? 'still' : `${seq.duration} ms`,
        seq.loop ? 'loops' : 'once',
        `${seq.intensity}+`,
        seq.canInterrupt ? 'interruptible' : 'not interruptible',
      ];
      meta.append(make('span', 'facts', facts.join(' · ')));
      if (seq.assets.length > 0) {
        meta.append(make('span', 'facts', `props: ${seq.assets.join(', ')}`));
      }
      meta.append(
        make('span', 'facts', `reduced motion → ${seq.reducedMotionFallback ?? 'rest pose'}`),
      );
      const track = make('div', 'track');
      const bar = make('div', 'bar');
      track.append(bar);
      const clock = make('span', 'clock', '');
      card.append(stage, track, clock, meta);
      row.append(card);
      cards.push({ seq, view: createSunnyView(art, { decorative: true }), bar, clock });
    }
    section.append(row);
    grid.append(section);
  }
}

function render(): void {
  for (const card of cards) {
    const { seq } = card;
    let t: number | null;
    if (paused) t = scrub;
    else t = seq.duration <= 1 ? 0 : progressAt(seq, filmTime);
    card.view.draw(t === null ? base : seq.pose(base, t), { boil });
    card.bar.style.width = `${(t ?? 1) * 100}%`;
    card.bar.classList.toggle('holding', t === null);
    card.clock.textContent =
      t === null ? 'holding at rest' : `t = ${t.toFixed(2)} (${Math.round(t * seq.duration)} ms)`;
  }
}

function tick(now: number): void {
  if (!paused) elapsed += (now - last) * speed;
  last = now;
  // Motion advances on whole film frames and the ink boils, like a 1930s cartoon.
  const clock = cartoonClock(elapsed);
  filmTime = clock.time;
  boil = cartoonClock(now).boil;
  render();
  requestAnimationFrame(tick);
}

function controls(): void {
  const speedSelect = document.getElementById('speed') as HTMLSelectElement;
  speedSelect.addEventListener('change', () => {
    speed = Number(speedSelect.value);
  });
  const pauseButton = document.getElementById('pause') as HTMLButtonElement;
  const scrubber = document.getElementById('scrub') as HTMLInputElement;
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Play' : 'Pause';
    scrubber.disabled = !paused;
  });
  scrubber.addEventListener('input', () => {
    scrub = Number(scrubber.value) / 1000;
  });
  const overlay = document.getElementById('overlay') as HTMLInputElement;
  overlay.addEventListener('change', () => {
    document.body.classList.toggle('with-reference', overlay.checked);
  });
  document.getElementById('restart')!.addEventListener('click', () => {
    elapsed = 0;
  });
}

build();
controls();
requestAnimationFrame(tick);
