/**
 * What a visitor's answers do to the kit in each quote option.
 *
 * An installer links answers to items on their published price list: add an
 * item, remove one, or swap one for another. `effectsFor` lists the effects the
 * visitor's answers trigger, in flow order; `applyEffects` applies them to one
 * package's `SystemConfig`, which the engine then prices and models as usual,
 * so generation, savings and price all come from the adjusted kit.
 *
 * An effect only ever names an item key. Where it lands is read from the
 * engine's catalogue (built from the price list, item key = SKU); nothing is
 * priced here. An item the catalogue does not carry (deleted from the list, the
 * base price table, a quote-only or unpriceable item) or one every quote
 * includes anyway (mandatory) is skipped, and the visitor is told the installer
 * will confirm it.
 */

import type { ConversationFlow, FlowEffect, FlowStep } from '@sunny/contracts';
import type {
  CatalogueExtra,
  CatalogueMounting,
  PricingCatalogue,
  SystemConfig,
} from '@sunny/quote-engine';

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

/** v1's optimiser and bird-mesh SKUs, which the engine prices from flags, not extras. */
const OPTIMISER_SCOPE: Readonly<Record<string, SystemConfig['optimiserScope']>> = {
  'OPT-TIGO-PART': 'partial',
  'OPT-TIGO-FULL': 'full',
};
const BIRD_MESH = 'OPT-BIRDMESH';

type ExtraList = 'scaffoldingExtras' | 'electricalExtras' | 'optionalExtras';

type Target =
  | { kind: 'panel'; sku: string; name: string }
  | { kind: 'inverter'; sku: string; name: string }
  | { kind: 'battery'; sku: string; name: string }
  | { kind: 'mounting'; sku: string; name: string; mounting: CatalogueMounting }
  | { kind: 'optimiser'; sku: string; name: string; scope: SystemConfig['optimiserScope'] }
  | { kind: 'bird_mesh'; sku: string; name: string }
  | { kind: 'extra'; sku: string; name: string; extra: CatalogueExtra; list: ExtraList };

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

/** Where an item key lands in a package, or why it cannot be used. */
function locate(
  key: string,
  catalogue: PricingCatalogue,
): { ok: true; target: Target } | { ok: false; name: string } {
  const panel = catalogue.panels.find((p) => p.sku === key);
  if (panel) return { ok: true, target: { kind: 'panel', sku: key, name: panel.modelName } };
  const inverter = catalogue.inverters.find((i) => i.sku === key);
  if (inverter) {
    return { ok: true, target: { kind: 'inverter', sku: key, name: inverter.modelName } };
  }
  const battery = catalogue.batteries.find((b) => b.sku === key);
  if (battery) return { ok: true, target: { kind: 'battery', sku: key, name: battery.modelName } };
  const mounting = catalogue.mounting.find((m) => m.sku === key);
  if (mounting) {
    return { ok: true, target: { kind: 'mounting', sku: key, name: mounting.label, mounting } };
  }
  const extra = catalogue.extras.find((e) => e.sku === key);
  if (!extra) return { ok: false, name: key };
  // Every quote has it already; an answer can neither add nor take it away.
  if (extra.isMandatory) return { ok: false, name: extra.label };
  const scope = OPTIMISER_SCOPE[key];
  if (scope) return { ok: true, target: { kind: 'optimiser', sku: key, name: extra.label, scope } };
  if (key === BIRD_MESH)
    return { ok: true, target: { kind: 'bird_mesh', sku: key, name: extra.label } };
  // Any other optimiser SKU the engine would silently leave unpriced.
  if (key.startsWith('OPT-TIGO')) return { ok: false, name: extra.label };
  return {
    ok: true,
    target: { kind: 'extra', sku: key, name: extra.label, extra, list: listFor(extra) },
  };
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
      return config[t.list].some((x) => x.sku === t.sku);
  }
}

function add(
  config: SystemConfig,
  t: Target,
  quantity: number | undefined,
  catalogue: PricingCatalogue,
): SystemConfig {
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
    case 'extra': {
      // A flat item is added the number of times the installer set; an item
      // priced per panel takes its quantity from the package (the engine
      // multiplies by the panel count).
      const qty = t.extra.priceCalc === 'flat' ? (quantity ?? 1) : 1;
      const group = t.extra.exclusiveGroup;
      // An item from a mutually exclusive group replaces the one already chosen.
      const others = config[t.list].filter(
        (x) => !group || catalogue.extras.find((e) => e.sku === x.sku)?.exclusiveGroup !== group,
      );
      return { ...config, [t.list]: [...others, { sku: t.sku, quantity: qty }] };
    }
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
    case 'extra':
      return { ...config, [t.list]: config[t.list].filter((x) => x.sku !== t.sku) };
  }
}

const skipped = (name: string, verb: 'added' | 'removed' | 'swapped') =>
  `${name} could not be ${verb} from your answers, so your installer will confirm it.`;

/**
 * One package's kit with the effects applied in order. An effect that cannot
 * be applied is skipped and reported through `warn`; the rest still apply.
 */
export function applyEffects(
  config: SystemConfig,
  effects: AppliedEffect[],
  catalogue: PricingCatalogue,
  warn: (message: string) => void,
): SystemConfig {
  let out = config;
  for (const { effect } of effects) {
    if (effect.kind === 'add') {
      const found = locate(effect.itemKey, catalogue);
      if (!found.ok) warn(skipped(found.name, 'added'));
      else out = add(out, found.target, effect.quantity, catalogue);
    } else if (effect.kind === 'remove') {
      const found = locate(effect.itemKey, catalogue);
      if (!found.ok) warn(skipped(found.name, 'removed'));
      else out = remove(out, found.target, catalogue);
    } else {
      const from = locate(effect.fromKey, catalogue);
      const to = locate(effect.toKey, catalogue);
      if (!from.ok) warn(skipped(from.name, 'swapped'));
      else if (!to.ok) warn(skipped(to.name, 'swapped'));
      // A swap only touches a package that has the item being swapped out.
      else if (isPresent(out, from.target, catalogue)) {
        out = add(remove(out, from.target, catalogue), to.target, effect.quantity, catalogue);
      }
    }
  }
  return out;
}
