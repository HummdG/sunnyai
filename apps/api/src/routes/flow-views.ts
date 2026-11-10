/**
 * What Studio's editors need to draw a flow: the preset questions, the price
 * list's items, and a plain-English line for each answer effect. Shared by the
 * conversation routes and the workflow routes.
 */

import type { ConversationFlow, FlowEffect } from '@sunny/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  describePricing,
  priceFor,
  type PriceItem,
  type PriceList,
} from '../catalogue/price-list.js';
import { LEGACY_SOLAR, SKIPPED, type QuestionBank } from '../flow/banks.js';
import {
  PACKAGE_UNITS,
  isFixedQuantity,
  targetIssue,
  unitOf,
  type FlowIssue,
  type WorkflowIssue,
} from '../flow/check.js';
import { PRESET_WARNINGS } from '../flow/presets.js';
import type { ResolvedFlow } from '../flow/resolve.js';
import { optionLabel } from '../questionnaire.js';

export interface PresetView {
  id: string;
  prompt: string;
  options: Array<{ value: string; label: string }>;
  fixed: boolean;
  warning: string | null;
  group: string[];
  /** The earlier answer this question waits on (a group member's, say), or null. */
  appearsWhen: { questionId: string; anyOf: string[] } | null;
}

export interface PriceItemView {
  key: string;
  name: string;
  category: string;
  unitLabel: string;
  packageUnit: boolean;
  /**
   * An answer adds this item in a quantity the installer sets (`isFixedQuantity`),
   * so Studio asks for one. Package-counted items and an inverter or battery
   * priced per unit do not need one.
   */
  needsQuantity: boolean;
  mandatory: boolean;
  targetable: boolean;
  priceText: string;
}

export interface ConversationView {
  flow: ConversationFlow | null;
  presets: PresetView[];
  priceItems: PriceItemView[];
  issues: FlowIssue[];
}

/** Said whenever Studio cannot show a figure: the installer sets it, never Sunny. */
const BY_INSTALLER = 'Priced by your installer';

/**
 * The bank's questions as Studio shows them. The legacy bank keeps today's
 * list; any other bank has no fixed questions, hides the questions Sunny sets
 * itself and the followers that travel with their anchor, and lists those
 * followers as the anchor's group.
 */
export function presetViews(bank: QuestionBank = LEGACY_SOLAR): PresetView[] {
  const legacy = bank.id === 'legacy_solar';
  const fixed = new Set<string>(bank.fixedStart);
  const hidden = new Set<string>(legacy ? [] : Object.values(bank.followers).flat());
  if (!legacy) for (const id of bank.systemSet) hidden.add(id);
  return Object.entries(bank.questions)
    .filter(([id]) => !hidden.has(id))
    .map(([id, q]) => ({
      id,
      prompt: q.prompt,
      options: (q.options ?? []).map((value) => ({ value, label: optionLabel(value) })),
      fixed: fixed.has(id),
      warning: PRESET_WARNINGS[id] ?? null,
      group: [...(bank.groups[id] ?? bank.followers[id] ?? [])],
      appearsWhen: q.appearsWhen
        ? { questionId: q.appearsWhen.questionId, anyOf: [...q.appearsWhen.anyOf] }
        : null,
    }));
}

function unitLabel(item: PriceItem): string {
  const unit = unitOf(item);
  if (unit) return unit;
  return item.pricing.kind === 'flat' ? 'each' : item.pricing.kind.replace(/_/g, ' ');
}

export function priceItemViews(list: PriceList | null): PriceItemView[] {
  return (list?.items ?? []).map((item) => {
    const unit = unitOf(item);
    return {
      key: item.key,
      name: item.name,
      category: item.category,
      unitLabel: unitLabel(item),
      packageUnit: unit !== null && PACKAGE_UNITS.includes(unit),
      needsQuantity: isFixedQuantity(item),
      mandatory: item.mandatory,
      targetable: targetIssue(item) === null,
      priceText: describePricing(item, list!.currency),
    };
  });
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}

/** What the installer's own list says an item costs for an effect, or that they set it. */
function priceText(
  item: PriceItem | undefined,
  list: PriceList | null,
  quantity: number | undefined,
): string {
  if (!item || !list) return BY_INSTALLER;
  const unit = unitOf(item);
  // A per-panel item depends on the package size, so it is shown per panel.
  if (unit !== null && PACKAGE_UNITS.includes(unit)) return describePricing(item, list.currency);
  const price = priceFor(item, { quantity });
  return price.status === 'priced' ? money(price.amountMinor, list.currency) : BY_INSTALLER;
}

export function describeEffect(
  effect: FlowEffect,
  list: PriceList | null,
): { label: string; priceText: string } {
  const find = (key: string) => list?.items.find((i) => i.key === key);
  const name = (key: string) => find(key)?.name ?? key;
  const times = (quantity: number | undefined) =>
    quantity && quantity > 1 ? ` (x${quantity})` : '';
  switch (effect.kind) {
    case 'add':
      return {
        label: `Adds ${name(effect.itemKey)}${times(effect.quantity)}`,
        priceText: priceText(find(effect.itemKey), list, effect.quantity),
      };
    case 'remove':
      return {
        label: `Removes ${name(effect.itemKey)}`,
        priceText: 'Comes off the quote',
      };
    case 'swap':
      // The figure is the new item's own price on the list, not a difference:
      // the label says it replaces the old item so it never reads as the cost
      // of the swap.
      return {
        label: `Replaces ${name(effect.fromKey)}: ${name(effect.toKey)}${times(effect.quantity)}`,
        priceText: priceText(find(effect.toKey), list, effect.quantity),
      };
  }
}

/**
 * A refusal thrown from inside a `tenants.update` mutate that carries more than
 * an ApiError can: a 409, or a 400 with the issues behind it. It passes through
 * the store's transaction unchanged (it has no `code`, so Firestore never
 * retries it) and `refusing` turns it into the reply.
 */
export class Refusal extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
    readonly issues?: WorkflowIssue[],
  ) {
    super(message);
  }
}

/** Runs a route body, replying to a Refusal with its status, message and issues. */
export async function refusing<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  run: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    return reply.code(err.status).send({
      error: { code: 'bad_request', message: err.message, requestId: String(request.id) },
      ...(err.issues ? { issues: err.issues } : {}),
    });
  }
}

/**
 * What chat would set itself once the address is in, for a preview: a roof
 * that mapped confidently, so the preview goes on to confirm it as chat would.
 */
const PREVIEW_SYSTEM_ANSWERS: Readonly<Record<string, string>> = { roof_confidence: 'high' };

/**
 * The next question the visitor would be asked. A question Sunny sets itself
 * (the bank's systemSet) is never asked: it is filled as chat fills it and the
 * walk goes on.
 */
export function previewNext(
  resolved: ResolvedFlow,
  answers: Record<string, string>,
): string | null {
  const filled = { ...answers };
  const system = resolved.bank.systemSet;
  for (let guard = 0; guard <= system.size; guard++) {
    const nextId = resolved.next(resolved.reconcile(filled).answers);
    if (nextId === null || !system.has(nextId)) return nextId;
    filled[nextId] =
      PREVIEW_SYSTEM_ANSWERS[nextId] ?? resolved.question(nextId)?.options?.[0] ?? SKIPPED;
  }
  return null;
}
