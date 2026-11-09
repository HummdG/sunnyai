/**
 * What a visitor's answers do to the kit in each quote option.
 *
 * An installer links answers to items on their published price list: add an
 * item, remove one, or swap one for another. `effectsFor` lists the effects the
 * visitor's answers trigger, in flow order; `applyEffects` applies them to one
 * package's `SystemConfig`, which the engine then prices and models as usual,
 * so generation, savings and price all come from the adjusted kit.
 *
 * An effect only ever names an item key. The published price list says
 * whether an answer may touch it (`targetIssue`, shared with Studio's check:
 * never a mandatory item, the base price table or a quote-only item), and the
 * engine's catalogue (built from that list, item key = SKU) says where it lands.
 * An item priced per metre, side, storey and the like carries the fixed
 * quantity the installer set, and is priced as one line at exactly what the
 * list's `priceFor` gives for that quantity. Anything that cannot be applied is
 * skipped, and the visitor is told the installer will confirm it.
 */

import type { ConversationFlow, FlowEffect, FlowStep } from '@sunny/contracts';
import type {
  CatalogueExtra,
  CatalogueMounting,
  PricingCatalogue,
  SystemConfig,
} from '@sunny/quote-engine';

import { priceFor, type PriceItem, type PriceList } from '../catalogue/price-list.js';
import { EXTRA_CATEGORIES, extraCategory, pounds } from '../journey/catalogue-pricing.js';

import { PACKAGE_UNITS, targetIssue, unitOf } from './check.js';
import { resolveFlow } from './resolve.js';

export interface AppliedEffect {
  effect: FlowEffect;
  questionId: string;
  value: string;
}

/** Every stored step's effects by answer value, first listing of an id only. */
function effectsById(
  steps: FlowStep[],
  into = new Map<string, Record<string, FlowEffect[]>>(),
): Map<string, Record<string, FlowEffect[]>> {
  for (const step of steps) {
    if (!into.has(step.id)) {
      if (step.kind === 'preset') {
        into.set(step.id, step.effects ?? {});
      } else {
        // A lead-only question never changes the quote.
        into.set(
          step.id,
          step.mode === 'quote'
            ? Object.fromEntries(step.choices.map((c) => [c.value, c.effects]))
            : {},
        );
      }
    }
    effectsById(
      (step.followUps ?? []).map((f) => f.step),
      into,
    );
  }
  return into;
}

/**
 * The effects the answers trigger, in flow order: question by question as the
 * conversation asks them, and within a multi-select answer in the question's
 * option order. Only answered questions that apply count (an answer a later one
 * ruled out triggers nothing).
 */
export function effectsFor(
  flow: ConversationFlow | null,
  answers: Record<string, string>,
): AppliedEffect[] {
  if (!flow) return [];
  const resolved = resolveFlow(flow);
  const byId = effectsById(flow.steps);
  const kept = resolved.reconcile(answers).answers;
  const out: AppliedEffect[] = [];
  for (const q of resolved.questions) {
    const given = kept[q.id];
    if (given === undefined || resolved.applicability(q.id, kept) !== 'applies') continue;
    const effects = byId.get(q.id);
    if (!effects) continue;
    const picked = q.multi ? given.split(',').map((part) => part.trim()) : [given];
    const values = q.options && q.multi ? q.options.filter((o) => picked.includes(o)) : picked;
    for (const value of values) {
      for (const effect of effects[value] ?? []) out.push({ effect, questionId: q.id, value });
    }
  }
  return out;
}

// ─── applying them ───────────────────────────────────────────────────────────

/** The published list and the engine catalogue built from it (see `effectCatalogue`). */
export interface EffectPricing {
  list: PriceList;
  catalogue: PricingCatalogue;
}

/** v1's optimiser and bird-mesh SKUs, which the engine prices from flags, not extras. */
const OPTIMISER_SCOPE: Readonly<Record<string, SystemConfig['optimiserScope']>> = {
  'OPT-TIGO-PART': 'partial',
  'OPT-TIGO-FULL': 'full',
};
const BIRD_MESH = 'OPT-BIRDMESH';

type ExtraList = 'scaffoldingExtras' | 'electricalExtras' | 'optionalExtras';
const EXTRA_LISTS: readonly ExtraList[] = [
  'scaffoldingExtras',
  'electricalExtras',
  'optionalExtras',
];

type Target =
  | { kind: 'panel'; sku: string; name: string }
  | { kind: 'inverter'; sku: string; name: string }
  | { kind: 'battery'; sku: string; name: string }
  | { kind: 'mounting'; sku: string; name: string; mounting: CatalogueMounting }
  | { kind: 'optimiser'; sku: string; name: string; scope: SystemConfig['optimiserScope'] }
  | { kind: 'bird_mesh'; sku: string; name: string }
  /**
   * An extra, carried under its plain SKU or (with a fixed quantity) as a
   * `KEY*q` line. `extra` is the line to add; absent when the list cannot
   * price the item at that quantity.
   */
  | { kind: 'extra'; key: string; name: string; extra?: CatalogueExtra };

/**
 * An extra priced per metre, side, storey (anything but a package unit), which
 * an effect adds in the fixed quantity the installer set.
 */
function isFixedQuantity(item: PriceItem): boolean {
  const unit = unitOf(item);
  return unit !== null && !PACKAGE_UNITS.includes(unit) && EXTRA_CATEGORIES.includes(item.category);
}

/** The catalogue SKU of a fixed-quantity item's line at one quantity. */
function fixedSku(key: string, quantity: number): string {
  return `${key}*${quantity}`;
}

/** Whether a package line is this item, under its plain SKU or as a fixed-quantity line. */
const isItemLine = (sku: string, key: string) => sku === key || sku.startsWith(`${key}*`);

/**
 * The item's plain catalogue line when it already costs exactly what the list
 * gives for this quantity (e.g. one flat-roof survey). Using it keeps the
 * engine's own checks on that SKU working (the flat-roof survey is added
 * automatically unless the plain SKU is already in the package).
 */
function plainEquivalent(
  item: PriceItem,
  quantity: number,
  catalogue: PricingCatalogue,
): CatalogueExtra | undefined {
  const plain = catalogue.extras.find((e) => e.sku === item.key);
  if (!plain || plain.priceCalc !== 'flat') return undefined;
  const price = priceFor(item, { quantity });
  return price.status === 'priced' && plain.baseGbp === pounds(price.amountMinor)
    ? plain
    : undefined;
}

/**
 * The engine catalogue plus one priced line per fixed-quantity item and
 * quantity the effects add, each at exactly `priceFor(item, { quantity })`
 * from the published list. An item the list cannot price at that quantity gets
 * no line (its effect is then skipped with a warning). Nothing else changes,
 * so a quote without such effects prices exactly as before.
 */
export function effectCatalogue(
  catalogue: PricingCatalogue,
  list: PriceList,
  effects: AppliedEffect[],
): PricingCatalogue {
  const added: CatalogueExtra[] = [];
  const seen = new Set(catalogue.extras.map((e) => e.sku));
  for (const { effect } of effects) {
    if (effect.kind === 'remove') continue;
    const key = effect.kind === 'add' ? effect.itemKey : effect.toKey;
    const item = list.items.find((i) => i.key === key);
    if (!item || targetIssue(item) || !isFixedQuantity(item)) continue;
    const quantity = effect.quantity ?? 1;
    const sku = fixedSku(item.key, quantity);
    if (seen.has(sku) || plainEquivalent(item, quantity, catalogue)) continue;
    const price = priceFor(item, { quantity });
    if (price.status !== 'priced') continue;
    seen.add(sku);
    const category = extraCategory(item);
    added.push({
      sku,
      // Never 'eps': the premium preset takes the first EPS extra it finds.
      category: category === 'eps' ? 'general_electrical' : category,
      label: quantity > 1 ? `${item.name} × ${quantity}` : item.name,
      priceCalc: 'flat',
      baseGbp: pounds(price.amountMinor),
      perPanelGbp: 0,
      panelThreshold: null,
      isMandatory: false,
      exclusiveGroup: item.exclusiveGroup,
      sortOrder: catalogue.extras.length + added.length + 1,
    });
  }
  return added.length === 0 ? catalogue : { ...catalogue, extras: [...catalogue.extras, ...added] };
}

/**
 * Which list an extra goes in. The engine prices scaffold and electrical extras
 * as a flat amount times the quantity, so an extra priced per panel goes with
 * the optional extras, where its per-panel price is honoured.
 */
function listFor(extra: CatalogueExtra): ExtraList {
  if (extra.priceCalc !== 'flat') return 'optionalExtras';
  if (extra.category === 'scaffold') return 'scaffoldingExtras';
  if (extra.category === 'general_electrical' || extra.category === 'structural') {
    return 'electricalExtras';
  }
  return 'optionalExtras';
}

/** `name` is the item's name, or null when the item is no longer on the list. */
type Located = { ok: true; target: Target } | { ok: false; name: string | null };

/** Where an item key lands in a package, or why an answer cannot use it. */
function locate(key: string, quantity: number | undefined, pricing: EffectPricing): Located {
  const { list, catalogue } = pricing;
  const item = list.items.find((i) => i.key === key);
  if (!item) return { ok: false, name: null };
  if (targetIssue(item)) return { ok: false, name: item.name };
  const name = item.name;

  if (isFixedQuantity(item)) {
    const q = quantity ?? 1;
    const extra =
      plainEquivalent(item, q, catalogue) ??
      catalogue.extras.find((e) => e.sku === fixedSku(key, q));
    return { ok: true, target: { kind: 'extra', key, name, extra } };
  }
  if (catalogue.panels.some((p) => p.sku === key)) {
    return { ok: true, target: { kind: 'panel', sku: key, name } };
  }
  if (catalogue.inverters.some((i) => i.sku === key)) {
    return { ok: true, target: { kind: 'inverter', sku: key, name } };
  }
  if (catalogue.batteries.some((b) => b.sku === key)) {
    return { ok: true, target: { kind: 'battery', sku: key, name } };
  }
  const mounting = catalogue.mounting.find((m) => m.sku === key);
  if (mounting) return { ok: true, target: { kind: 'mounting', sku: key, name, mounting } };
  // Not something the engine can price (bespoke, or a shape it cannot evaluate).
  const extra = catalogue.extras.find((e) => e.sku === key);
  if (!extra || extra.isMandatory) return { ok: false, name };
  const scope = OPTIMISER_SCOPE[key];
  if (scope) return { ok: true, target: { kind: 'optimiser', sku: key, name, scope } };
  if (key === BIRD_MESH) return { ok: true, target: { kind: 'bird_mesh', sku: key, name } };
  // Any other optimiser SKU the engine would silently leave unpriced.
  if (key.startsWith('OPT-TIGO')) return { ok: false, name };
  return { ok: true, target: { kind: 'extra', key, name, extra } };
}

function isPresent(config: SystemConfig, t: Target, catalogue: PricingCatalogue): boolean {
  switch (t.kind) {
    case 'panel':
      return config.panelSku === t.sku;
    case 'inverter':
      return (
        config.inverterSku === t.sku ||
        (config.inverterSku === undefined &&
          (catalogue.inverters.find((i) => i.isDefault) ?? catalogue.inverters[0])?.sku === t.sku)
      );
    case 'battery':
      return config.battery?.sku === t.sku;
    case 'mounting':
      return config.mountingSku === t.sku;
    case 'optimiser':
      return config.optimiserScope === t.scope;
    case 'bird_mesh':
      return config.birdMesh;
    case 'extra':
      // In any list, at any quantity: an item is carried once.
      return EXTRA_LISTS.some((l) => config[l].some((x) => isItemLine(x.sku, t.key)));
  }
}

/** Adds one extra line, replacing any item from the same mutually exclusive group. */
function withExtra(
  config: SystemConfig,
  extra: CatalogueExtra,
  catalogue: PricingCatalogue,
): SystemConfig {
  const group = extra.exclusiveGroup;
  const out = { ...config };
  if (group) {
    // Whichever list the other item of the group sits in.
    for (const l of EXTRA_LISTS) {
      out[l] = config[l].filter(
        (x) => catalogue.extras.find((e) => e.sku === x.sku)?.exclusiveGroup !== group,
      );
    }
  }
  const list = listFor(extra);
  // Always quantity 1: a flat item ignores any quantity (as the list's
  // `priceFor` does), an item priced per panel takes its count from the
  // package, and a fixed-quantity line is already priced for its quantity.
  out[list] = [...out[list], { sku: extra.sku, quantity: 1 }];
  return out;
}

function add(config: SystemConfig, t: Target, catalogue: PricingCatalogue): SystemConfig {
  if (isPresent(config, t, catalogue)) return config;
  switch (t.kind) {
    case 'panel':
      return { ...config, panelSku: t.sku };
    case 'inverter':
      return { ...config, inverterSku: t.sku };
    case 'battery':
      return {
        ...config,
        battery: { sku: t.sku, expansionUnits: 0, isRetrofit: config.battery?.isRetrofit ?? false },
      };
    case 'mounting':
      return { ...config, mountingSku: t.sku };
    case 'optimiser':
      return { ...config, optimiserScope: t.scope };
    case 'bird_mesh':
      return { ...config, birdMesh: true };
    case 'extra':
      return t.extra ? withExtra(config, t.extra, catalogue) : config;
  }
}

function remove(config: SystemConfig, t: Target, catalogue: PricingCatalogue): SystemConfig {
  if (!isPresent(config, t, catalogue)) return config;
  switch (t.kind) {
    case 'panel': {
      // A package always has panels: taking the chosen one away means the base panel.
      const base = catalogue.panels.find((p) => p.isBase);
      return base ? { ...config, panelSku: base.sku } : config;
    }
    case 'inverter':
      return { ...config, inverterSku: undefined };
    case 'battery':
      return { ...config, battery: null };
    case 'mounting': {
      // A package always has mounting: back to the default for that roof.
      const fallback = catalogue.mounting.find(
        (m) => m.appliesTo === t.mounting.appliesTo && m.isDefault,
      );
      return fallback ? { ...config, mountingSku: fallback.sku } : config;
    }
    case 'optimiser':
      return { ...config, optimiserScope: 'none' };
    case 'bird_mesh':
      return { ...config, birdMesh: false };
    case 'extra': {
      const out = { ...config };
      for (const l of EXTRA_LISTS) out[l] = config[l].filter((x) => !isItemLine(x.sku, t.key));
      return out;
    }
  }
}

/** The visitor's warning for a skipped effect (`name` null: the item is gone from the list). */
export function skippedWarning(name: string | null, verb: 'added' | 'removed' | 'swapped'): string {
  return name === null
    ? `One of the items linked to your answers could not be ${verb}, so your installer will confirm it.`
    : `${name} could not be ${verb} from your answers, so your installer will confirm it.`;
}

/** A fixed-quantity item the list could not price at its quantity has no line to add. */
const addable = (t: Target) => t.kind !== 'extra' || t.extra !== undefined;

/**
 * One package's kit with the effects applied in order. An effect that cannot
 * be applied is skipped and reported through `warn`; the rest still apply.
 * `pricing.catalogue` must come from `effectCatalogue` for the same effects.
 */
export function applyEffects(
  config: SystemConfig,
  effects: AppliedEffect[],
  pricing: EffectPricing,
  warn: (message: string) => void,
): SystemConfig {
  const { catalogue } = pricing;
  let out = config;
  for (const { effect } of effects) {
    if (effect.kind === 'add') {
      const found = locate(effect.itemKey, effect.quantity, pricing);
      if (!found.ok) warn(skippedWarning(found.name, 'added'));
      else if (!addable(found.target)) warn(skippedWarning(found.target.name, 'added'));
      else out = add(out, found.target, catalogue);
    } else if (effect.kind === 'remove') {
      const found = locate(effect.itemKey, undefined, pricing);
      if (!found.ok) warn(skippedWarning(found.name, 'removed'));
      else out = remove(out, found.target, catalogue);
    } else {
      const from = locate(effect.fromKey, undefined, pricing);
      const to = locate(effect.toKey, effect.quantity, pricing);
      if (!from.ok) warn(skippedWarning(from.name, 'swapped'));
      else if (!to.ok) warn(skippedWarning(to.name, 'swapped'));
      else if (!addable(to.target)) warn(skippedWarning(to.target.name, 'swapped'));
      // A swap only touches a package that has the item being swapped out.
      else if (isPresent(out, from.target, catalogue)) {
        out = add(remove(out, from.target, catalogue), to.target, catalogue);
      }
    }
  }
  return out;
}
