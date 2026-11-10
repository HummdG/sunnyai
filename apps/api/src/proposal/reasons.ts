/**
 * Why an item is on the quote, in the customer's own terms. Only two causes
 * are ever stated: an installer's flow effect that added the item, and a
 * preset answer that plainly explains a battery or an EV charger. An item with
 * no cause gets no reason.
 */

import type { AppliedEffect } from '../flow/effects.js';
import type { ResolvedFlow } from '../flow/resolve.js';
import type { QuoteOptionView } from '../journey/quote.js';

const EVENING = 'You told us you use most of your electricity in the evening.';
const EV_NOW = 'You told us you drive an electric car.';
const EV_PLANNED = 'You told us you are planning an electric car.';

export function reasonsFor(
  effects: AppliedEffect[],
  flow: ResolvedFlow,
  answers: Record<string, string>,
  option: QuoteOptionView,
): Record<string, string> {
  const skus = new Set(option.lineItems.map((l) => l.sku));
  const out: Record<string, string> = {};

  const tags = (answers['lifestyle'] ?? '').split(',').map((t) => t.trim());
  const battery = option.batteryType
    ? option.lineItems.find((l) => l.label.startsWith(option.batteryType!))
    : undefined;
  if (battery && tags.includes('evening_use')) out[battery.sku] = EVENING;
  const charger = option.lineItems.find((l) => l.sku.toUpperCase().startsWith('EV-'));
  if (charger && tags.includes('ev_now')) out[charger.sku] = EV_NOW;
  else if (charger && tags.includes('ev_planned')) out[charger.sku] = EV_PLANNED;

  // A flow effect names the answer behind the item, so it wins.
  for (const applied of effects) {
    const added =
      applied.effect.kind === 'add'
        ? applied.effect.itemKey
        : applied.effect.kind === 'swap'
          ? applied.effect.toKey
          : null;
    if (!added || !skus.has(added)) continue;
    const question = flow.question(applied.questionId);
    if (!question) continue;
    out[added] = `You answered "${question.label(applied.value)}" to "${question.prompt}".`;
  }
  return out;
}
