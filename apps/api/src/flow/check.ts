/**
 * Checks a stored conversation flow against the installer's price list.
 *
 * Runs when the flow is saved in Studio and whenever it is shown, so an effect
 * that has gone stale (item deleted, item made mandatory after linking) is
 * flagged beside its question. Messages are plain English for the installer.
 */

import type {
  ConversationFlow,
  FlowEffect,
  FlowFollowUp,
  FlowStep,
  Workflow,
  WorkflowSet,
} from '@sunny/contracts';

import type { PriceItem, PriceList } from '../catalogue/price-list.js';
import { EXTRA_CATEGORIES } from '../journey/catalogue-pricing.js';
import { QUESTIONS } from '../questionnaire.js';
import { runBankFor, toFlow } from '../workflows/tenant.js';

export interface FlowIssue {
  stepId: string;
  choice?: string;
  code:
    | 'missing_item'
    | 'mandatory_item'
    | 'not_targetable'
    | 'needs_quantity'
    | 'bad_parent'
    | 'duplicate_id'
    | 'no_choices';
  message: string;
}

/**
 * Units whose quantity comes from the package: panels. The price list has no
 * kWp unit, and an item priced per kWh is not a battery's own capacity, so any
 * other unit (kWh included) needs a fixed quantity, priced from the list.
 */
export const PACKAGE_UNITS: readonly string[] = ['panel'];

/** The unit an item is priced per, when it has one. */
export function unitOf(item: PriceItem): string | null {
  const p = item.pricing;
  return p.kind === 'per_unit' || p.kind === 'tiered' ? p.unit : null;
}

/**
 * Whether an answer adds this item in a fixed quantity the installer sets: an
 * extra (scaffolding, electrical, optional, admin, other) priced per metre,
 * side, storey or any unit but a package one. Shared by the Studio check (which
 * asks for the quantity), the quote (which prices that quantity) and Studio's
 * item list, so the editor never asks for a quantity the quote would ignore.
 * An inverter or battery priced per unit is placed by the package instead.
 */
export function isFixedQuantity(item: PriceItem): boolean {
  const unit = unitOf(item);
  return unit !== null && !PACKAGE_UNITS.includes(unit) && EXTRA_CATEGORIES.includes(item.category);
}

/**
 * Why an answer cannot add, remove or swap this item, or null when it can.
 * Shared by the Studio check and the quote, so both apply the same rules: a
 * mandatory item is on every quote already, and the base price table and
 * quote-only items are part of the system price.
 */
export function targetIssue(
  item: PriceItem,
): { code: 'mandatory_item' | 'not_targetable'; message: string } | null {
  if (item.mandatory) {
    return {
      code: 'mandatory_item',
      message: `${item.name} is on every quote, so an answer cannot remove or swap it.`,
    };
  }
  if (item.category === 'pv' || item.pricing.kind === 'quote_only') {
    return {
      code: 'not_targetable',
      message: `${item.name} is part of the system price, so an answer cannot change it.`,
    };
  }
  return null;
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
    const issue = item ? targetIssue(item) : null;
    if (!item) {
      push('missing_item', `${t.key} is no longer on your price list.`);
    } else if (issue) {
      push(issue.code, issue.message);
    } else if (t.adds && isFixedQuantity(item) && t.quantity === undefined) {
      const unit = unitOf(item);
      if (unit) {
        const units = unit === 'kwh' ? 'kWh' : `${unit}s`;
        push('needs_quantity', `Set how many ${units} of ${item.name} to add.`);
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
      if (step.answer === 'choice' && step.choices.length === 0) {
        issues.push({
          stepId: step.id,
          code: 'no_choices',
          message: 'Add at least one answer to this question.',
        });
      }
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

export type WorkflowIssueCode =
  | FlowIssue['code']
  | 'needs_address'
  | 'bad_page_pattern'
  | 'duplicate_step_id'
  | 'interest_overlap'
  | 'unknown_preset';

export interface WorkflowIssue {
  workflowId: string;
  stepId?: string;
  choice?: string;
  field?: 'pages' | 'steps' | 'interests';
  code: WorkflowIssueCode;
  message: string;
  warning?: boolean;
}

/** Every step under these, follow-ups included. */
function allSteps(steps: readonly FlowStep[], out: FlowStep[] = []): FlowStep[] {
  for (const s of steps) {
    out.push(s);
    allSteps(
      (s.followUps ?? []).map((f) => f.step),
      out,
    );
  }
  return out;
}

export function checkWorkflow(w: Workflow, list: PriceList | null): WorkflowIssue[] {
  const issues: WorkflowIssue[] = checkFlow(toFlow(w), list).map((i) => ({
    ...i,
    workflowId: w.id,
  }));

  // A preset question from another kind of workflow (a roof question in a heat
  // pump quote, say) has nothing to ask it in this one's bank.
  const bank = runBankFor(w);
  for (const s of allSteps(w.steps)) {
    if (s.kind === 'preset' && !Object.hasOwn(bank.questions, s.id)) {
      issues.push({
        workflowId: w.id,
        stepId: s.id,
        field: 'steps',
        code: 'unknown_preset',
        message: 'This question does not belong to this kind of workflow.',
      });
    }
  }

  // Every quote starts from the home: SunScan's roof, or the postcode.
  const engine = w.outcome.kind === 'quote' ? w.outcome.engine : null;
  const needsAddress = engine !== null;
  if (needsAddress && !allSteps(w.steps).some((s) => s.kind === 'preset' && s.id === 'address')) {
    issues.push({
      workflowId: w.id,
      field: 'steps',
      code: 'needs_address',
      message: `A ${engine === 'solar' ? 'solar' : engine === 'battery' ? 'battery' : 'heat pump'} quote needs the address question.`,
    });
  }

  const bad = [...w.pages.include, ...w.pages.exclude].some(
    (p) => !p.startsWith('/') || /[\s?#]/.test(p),
  );
  if (bad) {
    issues.push({
      workflowId: w.id,
      field: 'pages',
      code: 'bad_page_pattern',
      message: 'Page patterns start with / and are paths only, like /offers/battery*.',
    });
  }
  return issues;
}

export function checkWorkflowSet(set: WorkflowSet, list: PriceList | null): WorkflowIssue[] {
  const issues = set.workflows.flatMap((w) => checkWorkflow(w, list));

  const owner = new Map<string, string>();
  for (const w of set.workflows) {
    for (const s of allSteps(w.steps)) {
      if (s.kind !== 'custom') continue;
      const first = owner.get(s.id);
      if (first !== undefined && first !== w.id) {
        issues.push({
          workflowId: w.id,
          stepId: s.id,
          field: 'steps',
          code: 'duplicate_step_id',
          message: 'This question id is used in another workflow.',
        });
      } else owner.set(s.id, w.id);
    }
  }

  const open = set.workflows.filter((w) => w.enabled && w.pages.include.length === 0);
  for (let i = 1; i < open.length; i++) {
    const w = open[i]!;
    const clash = open.slice(0, i).some((o) => o.interests.some((x) => w.interests.includes(x)));
    if (clash) {
      issues.push({
        workflowId: w.id,
        field: 'interests',
        code: 'interest_overlap',
        message:
          'Two workflows on the same pages cover the same interest. Sunny will suggest the first.',
        warning: true,
      });
    }
  }
  return issues;
}

/**
 * The issues that stop one workflow being saved into this set: its own
 * problems, and a custom step id it shares with another workflow, whichever of
 * the two the set check names. A stale effect in another workflow is that
 * workflow's to fix, and warnings never block.
 */
export function savingIssues(
  set: WorkflowSet,
  list: PriceList | null,
  workflowId: string,
): WorkflowIssue[] {
  const saved = set.workflows.find((w) => w.id === workflowId);
  const mine = new Set(
    allSteps(saved?.steps ?? [])
      .filter((s) => s.kind === 'custom')
      .map((s) => s.id),
  );
  return checkWorkflowSet(set, list).filter(
    (i) =>
      !i.warning &&
      (i.workflowId === workflowId ||
        (i.code === 'duplicate_step_id' && i.stepId !== undefined && mine.has(i.stepId))),
  );
}
