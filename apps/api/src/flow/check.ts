/**
 * Checks a stored conversation flow against the installer's price list.
 *
 * Runs when the flow is saved in Studio and whenever it is shown, so an effect
 * that has gone stale (item deleted, item made mandatory after linking) is
 * flagged beside its question. Messages are plain English for the installer.
 */

import type { ConversationFlow, FlowEffect, FlowFollowUp, FlowStep } from '@sunny/contracts';

import type { PriceItem, PriceList } from '../catalogue/price-list.js';
import { QUESTIONS } from '../questionnaire.js';

export interface FlowIssue {
  stepId: string;
  choice?: string;
  code:
    | 'missing_item'
    | 'mandatory_item'
    | 'not_targetable'
    | 'needs_quantity'
    | 'bad_parent'
    | 'duplicate_id';
  message: string;
}

/**
 * Units whose quantity comes from the package (panels, battery kWh). The price
 * list has no kWp unit, so none is added; any other unit needs a fixed quantity.
 */
export const PACKAGE_UNITS: readonly string[] = ['panel', 'kwh'];

/** The unit an item is priced per, when it has one. */
function unitOf(item: PriceItem): string | null {
  const p = item.pricing;
  return p.kind === 'per_unit' || p.kind === 'tiered' ? p.unit : null;
}

/** The base price table and quote-only items are not something an answer can change. */
function targetable(item: PriceItem): boolean {
  return item.category !== 'pv' && item.pricing.kind !== 'quote_only';
}

function checkEffect(
  effect: FlowEffect,
  list: PriceList | null,
  at: { stepId: string; choice: string },
): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const targets: Array<{ key: string; adds: boolean; quantity?: number }> =
    effect.kind === 'swap'
      ? [
          { key: effect.fromKey, adds: false },
          { key: effect.toKey, adds: true, quantity: effect.quantity },
        ]
      : [
          {
            key: effect.itemKey,
            adds: effect.kind === 'add',
            quantity: effect.kind === 'add' ? effect.quantity : undefined,
          },
        ];

  for (const t of targets) {
    const item = list?.items.find((i) => i.key === t.key);
    const push = (code: FlowIssue['code'], message: string) =>
      issues.push({ ...at, code, message });
    if (!item) {
      push('missing_item', `${t.key} is no longer on your price list.`);
    } else if (item.mandatory) {
      push(
        'mandatory_item',
        `${item.name} is on every quote, so an answer cannot remove or swap it.`,
      );
    } else if (!targetable(item)) {
      push(
        'not_targetable',
        `${item.name} is part of the system price, so an answer cannot change it.`,
      );
    } else if (t.adds) {
      const unit = unitOf(item);
      if (unit && !PACKAGE_UNITS.includes(unit) && t.quantity === undefined) {
        push('needs_quantity', `Set how many ${unit}s of ${item.name} to add.`);
      }
    }
  }
  return issues;
}

/** The answer values a step's follow-ups can wait on, or null when it has none to offer. */
function answerValues(step: FlowStep): readonly string[] | null {
  if (step.kind === 'custom') {
    return step.answer === 'choice' ? step.choices.map((c) => c.value) : null;
  }
  return QUESTIONS[step.id]?.options ?? null;
}

export function checkFlow(flow: ConversationFlow, list: PriceList | null): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const seen = new Set<string>();

  const visit = (step: FlowStep, via: FlowFollowUp | null, parent: FlowStep | null) => {
    if (seen.has(step.id)) {
      issues.push({
        stepId: step.id,
        code: 'duplicate_id',
        message: 'Two questions share the same id.',
      });
    }
    seen.add(step.id);

    if (via && parent) {
      const values = answerValues(parent);
      if (!values || via.when.some((w) => !values.includes(w))) {
        issues.push({
          stepId: step.id,
          code: 'bad_parent',
          message: "This follow-up's question is no longer in the conversation.",
        });
      }
    }

    if (step.kind === 'custom') {
      for (const c of step.choices) {
        for (const e of c.effects) {
          issues.push(...checkEffect(e, list, { stepId: step.id, choice: c.value }));
        }
      }
    } else {
      for (const [value, effects] of Object.entries(step.effects ?? {})) {
        for (const e of effects) {
          issues.push(...checkEffect(e, list, { stepId: step.id, choice: value }));
        }
      }
    }

    for (const f of step.followUps ?? []) visit(f.step, f, step);
  };

  for (const s of flow.steps) visit(s, null, null);
  return issues;
}
