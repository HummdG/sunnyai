// Sunny addition: the "watch your package save you money" simulation drawn over the 3D roof.
//
// Month by month a £ coin pops up above the roof with what the package saved that month, a running total ticks
// up, the sun sweeps across each month's day, then a year-end card and a 25-year card close it out.
//
// Split in two: the script (pure: steps, wording, money formatting, the reduced-motion table) is tested in Node;
// `createSavingsOverlay` is the thin DOM layer that plays it. The viewer knows nothing about pricing: the timeline
// comes from @sunny/quote-engine's buildSavingsTimeline, typed structurally here.

export interface SavingsTimelineLike {
  months: readonly { monthName: string; month?: string; savingsGbp: number; cumulativeGbp: number }[];
  year1TotalGbp: number;
  twentyFiveYearTotalGbp: number;
  twentyFiveYearNetGbp: number | null;
  assumptions: { energyInflationRate: number; panelDegradationPerYear: number };
}

export const INDICATIVE_NOTE = 'Indicative — subject to an on-site survey';

/** £1,234 (whole pounds; pence only under £100 per the brand guidelines, which the months never need). */
export function formatGbp(value: number): string {
  const v = Math.round(value);
  return `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB')}`;
}

/** Rounded the way estimates are said out loud: nearest £10 past £1,000, nearest £100 past £10,000. */
export function aboutGbp(value: number): string {
  const step = Math.abs(value) >= 10000 ? 100 : Math.abs(value) >= 1000 ? 10 : 1;
  return formatGbp(Math.round(value / step) * step);
}

const pct = (r: number) => `${Math.round(r * 1000) / 10}%`.replace('.0%', '%');

export function monthLine(month: SavingsTimelineLike['months'][number]): string {
  return `${month.monthName} — your panels saved you about ${formatGbp(month.savingsGbp)}`;
}

export function yearLine(t: SavingsTimelineLike): string {
  return `Your first year: about ${formatGbp(t.year1TotalGbp)} saved`;
}

export function lifetimeLine(t: SavingsTimelineLike): string {
  return `Over 25 years: about ${aboutGbp(t.twentyFiveYearTotalGbp)}`;
}

export function netLine(t: SavingsTimelineLike): string | null {
  if (t.twentyFiveYearNetGbp === null) return null;
  return t.twentyFiveYearNetGbp >= 0
    ? `That's about ${aboutGbp(t.twentyFiveYearNetGbp)} more than the system costs.`
    : `That's about ${aboutGbp(-t.twentyFiveYearNetGbp)} short of the system's cost over 25 years.`;
}

export function assumptionsLine(t: SavingsTimelineLike): string {
  return (
    `Assumes energy prices rise ${pct(t.assumptions.energyInflationRate)} a year and the panels lose ` +
    `${pct(t.assumptions.panelDegradationPerYear)} of their output a year.`
  );
}

/** Coin size by month: summer coins are bigger and brighter (0.8–1.3). */
export function coinScale(t: SavingsTimelineLike, index: number): number {
  const max = Math.max(1, ...t.months.map((m) => m.savingsGbp));
  return 0.8 + 0.5 * ((t.months[index]?.savingsGbp ?? 0) / max);
}

export type SimulationStep =
  | { kind: 'month'; index: number; line: string; amountGbp: number; cumulativeGbp: number; coinScale: number }
  | { kind: 'year'; line: string; totalGbp: number }
  | { kind: 'lifetime'; line: string; net: string | null; assumptions: string; note: string };

export function simulationScript(t: SavingsTimelineLike): SimulationStep[] {
  return [
    ...t.months.map((m, index) => ({
      kind: 'month' as const, index, line: monthLine(m), amountGbp: m.savingsGbp, cumulativeGbp: m.cumulativeGbp,
      coinScale: coinScale(t, index),
    })),
    { kind: 'year', line: yearLine(t), totalGbp: t.year1TotalGbp },
    { kind: 'lifetime', line: lifetimeLine(t), net: netLine(t), assumptions: assumptionsLine(t), note: INDICATIVE_NOTE },
  ];
}

/** The month table shown instead of the animation under reduced motion (and offered to everyone). */
export function summaryRows(t: SavingsTimelineLike): { month: string; saved: string; total: string }[] {
  return t.months.map((m) => ({ month: m.monthName, saved: formatGbp(m.savingsGbp), total: formatGbp(m.cumulativeGbp) }));
}

/** When each step starts, in ms from the beginning. */
export function stepTimes(t: SavingsTimelineLike, monthMs: number): { start: number; end: number }[] {
  const months = t.months.length;
  const yearMs = 2600;
  return simulationScript(t).map((step, i) => {
    if (step.kind === 'month') return { start: i * monthMs, end: (i + 1) * monthMs };
    if (step.kind === 'year') return { start: months * monthMs, end: months * monthMs + yearMs };
    return { start: months * monthMs + yearMs, end: Infinity };
  });
}

// ------------------------------------------------------------------ DOM layer

export interface SavingsOverlayDeps {
  /** Screen position (px, relative to the host) to float the coin above, or null when off screen. */
  anchor(): { x: number; y: number } | null;
  /** Move the sun to month `index` (0 = Jan) at `dayFraction` of the daylight hours. */
  setSun(index: number, dayFraction: number): void;
  requestRender(): void;
}

export interface SavingsSimulationOptions {
  /** Milliseconds per month (default 1200). */
  monthMs?: number;
  reducedMotion?: boolean;
  autoplay?: boolean;
  onMonth?(index: number): void;
  /** Fired when the 25-year card is shown (e.g. let Sunny celebrate). */
  onComplete?(): void;
}

export interface SavingsSimulationHandle {
  pause(): void;
  resume(): void;
  /** Jump to the end (year and 25-year totals). */
  skip(): void;
  replay(): void;
  readonly state: 'playing' | 'paused' | 'done';
  dispose(): void;
}

const CSS = `
.sv-sim{position:absolute;inset:0;pointer-events:none;font:inherit;color:#171717;overflow:hidden}
.sv-sim *{box-sizing:border-box}
.sv-sim__total{position:absolute;top:12px;left:12px;background:#fffcf8;border:2px solid #171717;border-radius:14px;padding:8px 12px;box-shadow:0 1px 2px rgba(23,23,23,.06),0 8px 24px rgba(23,23,23,.08)}
.sv-sim__total small{display:block;font-size:12px;color:#5c5c5c}
.sv-sim__total strong{display:block;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:#b04e00}
.sv-sim__coin{position:absolute;left:0;top:0;width:64px;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:6px}
.sv-sim__coin svg{width:46px;height:46px;filter:drop-shadow(0 4px 6px rgba(23,23,23,.25));transform:scale(var(--s,1));transform-origin:50% 100%}
.sv-sim__bubble{white-space:normal;text-align:center;width:max-content;background:#fffcf8;border:2px solid #171717;border-radius:14px;padding:6px 10px;font-size:13px;font-weight:600;position:relative}
.sv-sim__bubble::after{content:"";position:absolute;left:50%;bottom:-8px;width:12px;height:12px;background:#fffcf8;border-right:2px solid #171717;border-bottom:2px solid #171717;transform:translateX(-50%) rotate(45deg)}
.sv-sim__coin.is-popping{animation:sv-pop 1s cubic-bezier(.34,1.56,.64,1) both}
@keyframes sv-pop{0%{opacity:0;transform:translate(-50%,-80%) scale(.4)}18%{opacity:1;transform:translate(-50%,-100%) scale(1.06)}28%{transform:translate(-50%,-100%) scale(1)}80%{opacity:1;transform:translate(-50%,-108%) scale(1)}100%{opacity:0;transform:translate(-50%,-114%) scale(1)}}
.sv-sim__dots{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px}
.sv-sim__dots i{width:8px;height:8px;border-radius:50%;background:rgba(23,23,23,.18);transition:background .16s,transform .16s}
.sv-sim__dots i.is-on{background:#ff7900;transform:scale(1.25)}
.sv-sim__card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(88%,360px);background:#fffcf8;border:2px solid #171717;border-radius:22px;padding:18px 20px;text-align:center;box-shadow:0 24px 60px rgba(23,23,23,.14);pointer-events:auto;animation:sv-card .42s cubic-bezier(.34,1.56,.64,1) both}
@keyframes sv-card{from{opacity:0;transform:translate(-50%,-44%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.sv-sim__card h3{margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:-.02em}
.sv-sim__card p{margin:4px 0;font-size:14px;line-height:1.5}
.sv-sim__card .sv-sim__note{font-size:12px;color:#5c5c5c}
.sv-sim__controls{position:absolute;right:12px;bottom:10px;display:flex;gap:6px;pointer-events:auto}
.sv-sim button{font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:6px 12px;border-radius:999px;border:1px solid rgba(23,23,23,.18);background:#fff;color:#171717;cursor:pointer}
.sv-sim button:hover{background:#fff1e5}
.sv-sim button:focus-visible{outline:3px solid #ff7900;outline-offset:2px}
.sv-sim button.is-primary{background:#b04e00;border-color:#b04e00;color:#fff}
.sv-sim__actions{display:flex;justify-content:center;gap:8px;margin-top:10px}
.sv-sim__card > button{margin-top:6px}
.sv-sim table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;margin:8px 0}
.sv-sim th,.sv-sim td{padding:3px 6px;text-align:right}.sv-sim th:first-child,.sv-sim td:first-child{text-align:left}
.sv-sim__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion: reduce){.sv-sim__coin.is-popping,.sv-sim__card{animation:none}}
`;

const COIN_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
  '<circle cx="24" cy="24" r="21" fill="#f5b800" stroke="#171717" stroke-width="3"/>' +
  '<circle cx="24" cy="24" r="15.5" fill="none" stroke="#c98d00" stroke-width="2"/>' +
  '<path d="M17 18c3-4 9-3 9 1" fill="none" stroke="#fff6cc" stroke-width="2" stroke-linecap="round" opacity=".8"/>' +
  '<text x="24" y="31" text-anchor="middle" font-size="20" font-weight="800" font-family="Plus Jakarta Sans, system-ui, sans-serif" fill="#171717">£</text>' +
  '</svg>';

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createSavingsOverlay(
  host: HTMLElement,
  timeline: SavingsTimelineLike,
  deps: SavingsOverlayDeps,
  opts: SavingsSimulationOptions = {},
): SavingsSimulationHandle {
  const doc = host.ownerDocument;
  const monthMs = Math.max(300, opts.monthMs ?? 1200);
  const script = simulationScript(timeline);
  const times = stepTimes(timeline, monthMs);
  if (doc.defaultView && getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const root = el(doc, 'div', 'sv-sim');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Savings simulation');
  const style = el(doc, 'style');
  style.textContent = CSS;
  const total = el(doc, 'div', 'sv-sim__total');
  const totalLabel = el(doc, 'small', undefined, 'Saved so far · Year 1');
  const totalValue = el(doc, 'strong', undefined, formatGbp(0));
  total.append(totalLabel, totalValue);
  const coin = el(doc, 'div', 'sv-sim__coin');
  coin.setAttribute('aria-hidden', 'true');
  const coinArt = el(doc, 'div');
  coinArt.innerHTML = COIN_SVG; // static markup above, no data in it
  const bubble = el(doc, 'div', 'sv-sim__bubble');
  coin.append(bubble, coinArt);
  coin.style.opacity = '0';
  const dots = el(doc, 'div', 'sv-sim__dots');
  dots.setAttribute('aria-hidden', 'true');
  const dotEls = timeline.months.map(() => el(doc, 'i'));
  dots.append(...dotEls);
  const live = el(doc, 'div', 'sv-sim__sr');
  live.setAttribute('aria-live', 'polite');
  const controls = el(doc, 'div', 'sv-sim__controls');
  const pauseBtn = el(doc, 'button', undefined, 'Pause');
  pauseBtn.type = 'button';
  const skipBtn = el(doc, 'button', undefined, 'Skip to totals');
  skipBtn.type = 'button';
  controls.append(pauseBtn, skipBtn);
  let card: HTMLElement | null = null;
  root.append(style, total, coin, dots, controls, live);
  host.append(root);

  let elapsed = 0;
  let last = 0;
  let raf = 0;
  let state: SavingsSimulationHandle['state'] = 'playing';
  let shownStep = -1;
  let completed = false;

  const announce = (text: string) => {
    const line = el(doc, 'p', undefined, text);
    live.append(line);
  };

  const showCard = (step: Extract<SimulationStep, { kind: 'year' | 'lifetime' }>, withTable: boolean) => {
    card?.remove();
    card = el(doc, 'div', 'sv-sim__card');
    if (step.kind === 'year') {
      card.append(el(doc, 'h3', undefined, step.line));
      card.append(el(doc, 'p', 'sv-sim__note', 'Keep watching for the 25-year total…'));
    } else {
      card.append(el(doc, 'h3', undefined, step.line));
      card.append(el(doc, 'p', undefined, yearLine(timeline) + '.'));
      if (step.net) card.append(el(doc, 'p', undefined, step.net));
      if (withTable) {
        // The month table: open straight away when there is no animation to watch, otherwise behind a
        // toggle so the card does not hide the house.
        const table = el(doc, 'table');
        table.id = `sv-sim-months-${Math.random().toString(36).slice(2, 8)}`;
        table.hidden = !opts.reducedMotion;
        if (!opts.reducedMotion) {
          const toggle = el(doc, 'button', undefined, 'See month by month');
          toggle.type = 'button';
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-controls', table.id);
          toggle.addEventListener('click', () => {
            table.hidden = !table.hidden;
            toggle.setAttribute('aria-expanded', String(!table.hidden));
            toggle.textContent = table.hidden ? 'See month by month' : 'Hide month by month';
          });
          card.append(toggle);
        }
        const caption = el(doc, 'caption', 'sv-sim__sr', 'Savings month by month, first year');
        const head = el(doc, 'tr');
        head.append(el(doc, 'th', undefined, 'Month'), el(doc, 'th', undefined, 'Saved'), el(doc, 'th', undefined, 'So far'));
        table.append(caption, head);
        for (const row of summaryRows(timeline)) {
          const tr = el(doc, 'tr');
          tr.append(el(doc, 'td', undefined, row.month), el(doc, 'td', undefined, row.saved), el(doc, 'td', undefined, row.total));
          table.append(tr);
        }
        card.append(table);
      }
      card.append(el(doc, 'p', 'sv-sim__note', step.assumptions));
      card.append(el(doc, 'p', 'sv-sim__note', step.note));
      const replayBtn = el(doc, 'button', 'is-primary', 'Watch it again');
      replayBtn.type = 'button';
      replayBtn.addEventListener('click', () => handle.replay());
      const row = el(doc, 'div', 'sv-sim__actions');
      row.append(replayBtn);
      card.append(row);
    }
    root.append(card);
  };

  const clearCoin = () => {
    coin.classList.remove('is-popping');
    coin.style.opacity = '0';
  };

  const finish = (withTable: boolean) => {
    const year = script[script.length - 2] as Extract<SimulationStep, { kind: 'year' }>;
    const life = script[script.length - 1] as Extract<SimulationStep, { kind: 'lifetime' }>;
    totalValue.textContent = formatGbp(year.totalGbp);
    for (const d of dotEls) d.classList.add('is-on');
    clearCoin();
    deps.setSun(5, 0.45);
    deps.requestRender();
    showCard(life, withTable);
    state = 'done';
    pauseBtn.hidden = true;
    skipBtn.hidden = true;
    if (!completed) {
      completed = true;
      announce(year.line);
      announce([life.line, life.net, life.assumptions, life.note].filter(Boolean).join(' '));
      opts.onComplete?.();
    }
  };

  const place = () => {
    const a = deps.anchor();
    if (!a) { coin.style.visibility = 'hidden'; return; }
    coin.style.visibility = '';
    // Keep the bubble inside the stage: it wraps to the stage's width, and the coin is nudged in from the
    // edges (and down from the running total) so a narrow widget never clips it.
    const w = host.clientWidth, h = host.clientHeight;
    bubble.style.maxWidth = `${Math.max(140, Math.min(260, w - 24))}px`;
    const half = Math.max(32, bubble.offsetWidth / 2) + 12;
    // The coin floats up ~14% of its height while it shows; keep its top clear of the running total.
    const tall = (coin.offsetHeight || 100) * 1.14;
    const below = total.offsetTop + total.offsetHeight + 10;
    const x = Math.min(Math.max(a.x, half), Math.max(half, w - half));
    const y = Math.min(Math.max(a.y, tall + below), Math.max(tall + below, h - 60));
    coin.style.left = `${x}px`;
    coin.style.top = `${y}px`;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (state === 'playing') elapsed += last ? now - last : 0;
    last = now;
    const idx = times.findIndex((t) => elapsed >= t.start && elapsed < t.end);
    const step = idx >= 0 ? script[idx]! : null;
    if (step?.kind === 'month') {
      const within = (elapsed - times[idx]!.start) / monthMs;
      deps.setSun(step.index, within);
      // The running total counts up through the first half of the month.
      const prev = step.cumulativeGbp - step.amountGbp;
      const k = Math.min(1, within * 2);
      totalValue.textContent = formatGbp(prev + (step.amountGbp * (1 - Math.pow(1 - k, 3))));
      if (shownStep !== idx) {
        shownStep = idx;
        bubble.textContent = step.line;
        coin.style.setProperty('--s', String(step.coinScale));
        coin.style.opacity = '';
        coin.classList.remove('is-popping');
        void coin.offsetWidth; // restart the pop
        coin.classList.add('is-popping');
        dotEls.forEach((d, i) => d.classList.toggle('is-on', i <= step.index));
        announce(step.line + '.');
        opts.onMonth?.(step.index);
      }
      place();
      deps.requestRender();
    } else if (step?.kind === 'year' && shownStep !== idx) {
      shownStep = idx;
      totalValue.textContent = formatGbp(step.totalGbp);
      clearCoin();
      deps.setSun(5, 0.45); // a bright June midday behind the totals
      deps.requestRender();
      showCard(step, false);
      announce(step.line + '.');
    } else if (step?.kind === 'lifetime' && state !== 'done') {
      finish(true);
    }
  };

  const handle: SavingsSimulationHandle = {
    get state() { return state; },
    pause() { if (state === 'playing') { state = 'paused'; pauseBtn.textContent = 'Play'; } },
    resume() { if (state === 'paused') { state = 'playing'; last = 0; pauseBtn.textContent = 'Pause'; } },
    skip() { finish(true); },
    replay() {
      card?.remove(); card = null;
      live.replaceChildren();
      for (const d of dotEls) d.classList.remove('is-on');
      totalValue.textContent = formatGbp(0);
      elapsed = 0; last = 0; shownStep = -1; completed = false;
      pauseBtn.hidden = false; skipBtn.hidden = false; pauseBtn.textContent = 'Pause';
      state = 'playing';
      if (opts.reducedMotion) finish(true);
    },
    dispose() { cancelAnimationFrame(raf); root.remove(); },
  };
  pauseBtn.addEventListener('click', () => (state === 'paused' ? handle.resume() : handle.pause()));
  skipBtn.addEventListener('click', () => handle.skip());

  if (opts.reducedMotion) {
    // No animation: the month table and both totals at once.
    finish(true);
  } else {
    if (opts.autoplay === false) handle.pause();
    raf = requestAnimationFrame(frame);
  }
  return handle;
}
