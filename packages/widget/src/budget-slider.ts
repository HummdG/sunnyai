import { el } from './dom.js';

/**
 * "Try a different budget": a slider under a priced solar quote. Each point on
 * it is a system the server already priced and modelled (the quote's
 * `budget` ladder), so dragging changes the figures at once, with no request
 * and no price list in the browser. The slider lands on the most capable
 * system the budget affords, as the quote's own budget-fit logic does.
 */

export interface BudgetStep {
  priceGbp: number;
  panelCount: number;
  systemKwp: number;
  batteryKwh: number;
  annualGenerationKwh: number;
  annualSavingsGbp: number;
  paybackYears: number | null;
  twentyFiveYearSavingsGbp: number;
}

export interface BudgetLadder {
  minGbp: number;
  maxGbp: number;
  initialGbp: number;
  fromAnswer: boolean;
  steps: BudgetStep[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The ladder, if it has the shape the slider reads and something to slide between; else null. */
export function parseBudgetLadder(value: unknown): BudgetLadder | null {
  if (typeof value !== 'object' || value === null) return null;
  const l = value as Record<string, unknown>;
  if (!isNum(l['minGbp']) || !isNum(l['maxGbp']) || !isNum(l['initialGbp'])) return null;
  if (!Array.isArray(l['steps']) || l['steps'].length < 2 || l['maxGbp'] <= l['minGbp'])
    return null;
  for (const s of l['steps'] as Record<string, unknown>[]) {
    if (typeof s !== 'object' || s === null) return null;
    for (const k of [
      'priceGbp',
      'panelCount',
      'systemKwp',
      'batteryKwh',
      'annualGenerationKwh',
      'annualSavingsGbp',
      'twentyFiveYearSavingsGbp',
    ]) {
      if (!isNum(s[k])) return null;
    }
    if (s['paybackYears'] !== null && !isNum(s['paybackYears'])) return null;
  }
  return { ...(value as BudgetLadder), fromAnswer: l['fromAnswer'] === true };
}

/** The most capable step a budget affords, or the cheapest when it affords none. */
export function stepFor(steps: readonly BudgetStep[], budgetGbp: number): BudgetStep {
  let chosen = steps[0]!;
  for (const s of steps) {
    if (s.priceGbp <= budgetGbp) chosen = s;
    else break;
  }
  return chosen;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/** The slider moves in round amounts; the ends are the cheapest and dearest systems. */
const STEP_GBP = 250;

export function systemWords(s: BudgetStep): string {
  const panels = `${s.panelCount} panel${s.panelCount === 1 ? '' : 's'} (${s.systemKwp} kWp)`;
  return s.batteryKwh > 0 ? `${panels} with a ${s.batteryKwh} kWh battery` : panels;
}

/**
 * The slider and what the budget buys. `onBudget` is told each new budget,
 * so the option cards above can mark the ones it does not reach.
 */
export function budgetSlider(
  ladder: BudgetLadder,
  onBudget: (budgetGbp: number) => void = () => undefined,
): HTMLElement {
  const steps = [...ladder.steps].sort((a, b) => a.priceGbp - b.priceGbp);
  const min = Math.floor(ladder.minGbp / STEP_GBP) * STEP_GBP;
  const max = Math.ceil(ladder.maxGbp / STEP_GBP) * STEP_GBP;
  const start = Math.min(max, Math.max(min, Math.round(ladder.initialGbp / STEP_GBP) * STEP_GBP));

  const id = `sunny-budget-${Math.random().toString(36).slice(2, 8)}`;
  const input = el('input', {
    type: 'range',
    id,
    min: String(min),
    max: String(max),
    step: String(STEP_GBP),
    value: String(start),
    list: `${id}-ticks`,
  });
  const ticks = el(
    'datalist',
    { id: `${id}-ticks` },
    steps.map((s) => el('option', { value: String(s.priceGbp) })),
  );
  const amount = el('output', { class: 'budget-amount', for: id });
  const system = el('p', { class: 'budget-system' });
  const stat = () => el('b');
  const savedYear = stat();
  const payback = stat();
  const lifetime = stat();
  const stats = el('ul', { class: 'budget-stats' }, [
    el('li', {}, [savedYear, el('span', { text: 'saved a year' })]),
    el('li', {}, [payback, el('span', { text: 'to pay back' })]),
    el('li', {}, [lifetime, el('span', { text: 'saved over 25 years' })]),
  ]);
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });

  let announce = 0;
  const update = () => {
    const budget = Number(input.value);
    const s = stepFor(steps, budget);
    amount.textContent = gbp(budget);
    input.setAttribute('aria-valuetext', `${gbp(budget)} budget`);
    const within = s.priceGbp <= budget;
    system.textContent = within
      ? `${systemWords(s)}, for ${gbp(s.priceGbp)}`
      : `The smallest system is ${systemWords(s)}, at ${gbp(s.priceGbp)}`;
    savedYear.textContent = gbp(s.annualSavingsGbp);
    payback.textContent = s.paybackYears === null ? 'n/a' : `${s.paybackYears} yrs`;
    lifetime.textContent = gbp(s.twentyFiveYearSavingsGbp);
    onBudget(budget);
    window.clearTimeout(announce);
    announce = window.setTimeout(() => {
      live.textContent = `${gbp(budget)}: ${system.textContent}. Saves about ${gbp(s.annualSavingsGbp)} a year.`;
    }, 600);
  };
  input.addEventListener('input', update);
  update();
  live.textContent = '';

  return el('div', { class: 'budget' }, [
    el('div', { class: 'budget-head' }, [
      el('label', {
        for: id,
        text: ladder.fromAnswer ? 'Try a different budget' : 'What could your budget buy?',
      }),
      amount,
    ]),
    input,
    ticks,
    el('div', { class: 'budget-range', 'aria-hidden': 'true' }, [
      el('span', { text: gbp(min) }),
      el('span', { text: gbp(max) }),
    ]),
    system,
    stats,
    el('p', {
      class: 'budget-note',
      text: 'Indicative, from the same prices and roof as the options above.',
    }),
    live,
  ]);
}
