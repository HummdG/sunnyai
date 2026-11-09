/**
 * The portal routes behind Studio's conversation editor: read the installer's
 * flow with everything the editor needs to draw it, save it, reset it, and
 * preview what a set of answers would do. Every plan; admin and owner edit,
 * viewer reads. Prices come only from the published price list.
 */

import {
  ApiError,
  conversationFlowSchema,
  type ConversationFlow,
  type FlowEffect,
} from '@sunny/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createAuthenticator, requireMembership } from '../auth/index.js';
import {
  describePricing,
  priceFor,
  type PriceItem,
  type PriceList,
} from '../catalogue/price-list.js';
import { getPublishedPriceList } from '../catalogue/price-list-service.js';
import { PACKAGE_UNITS, checkFlow, targetIssue, unitOf, type FlowIssue } from '../flow/check.js';
import { effectsFor } from '../flow/effects.js';
import { FIXED_START, PRESET_GROUPS, PRESET_WARNINGS } from '../flow/presets.js';
import { resolveFlow } from '../flow/resolve.js';
import { QUESTIONS, optionLabel } from '../questionnaire.js';
import type { MemberRole, Store } from '../store.js';
import type { TenantRegistry } from '../tenants.js';
import type { PortalConfig } from './portal-config.js';

export interface ConversationRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
}

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

const FIXED = new Set<string>(FIXED_START);

const previewBody = z.object({
  flow: conversationFlowSchema,
  answers: z.record(z.string(), z.string()).default({}),
});

function presetViews(): PresetView[] {
  return Object.entries(QUESTIONS).map(([id, q]) => ({
    id,
    prompt: q.prompt,
    options: (q.options ?? []).map((value) => ({ value, label: optionLabel(value) })),
    fixed: FIXED.has(id),
    warning: PRESET_WARNINGS[id] ?? null,
    group: [...(PRESET_GROUPS[id] ?? [])],
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

function priceItemViews(list: PriceList | null): PriceItemView[] {
  return (list?.items ?? []).map((item) => {
    const unit = unitOf(item);
    return {
      key: item.key,
      name: item.name,
      category: item.category,
      unitLabel: unitLabel(item),
      packageUnit: unit !== null && PACKAGE_UNITS.includes(unit),
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

function describeEffect(
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
      return {
        label: `Swaps ${name(effect.fromKey)} for ${name(effect.toKey)}${times(effect.quantity)}`,
        priceText: priceText(find(effect.toKey), list, effect.quantity),
      };
  }
}

export function registerConversationRoutes(
  app: FastifyInstance,
  deps: ConversationRouteDeps,
): void {
  const { store, tenants } = deps;
  const auth = createAuthenticator({
    portal: deps.portal,
    sessionSecret: deps.sessionSecret,
    now: deps.now,
    store,
  });

  async function member(request: FastifyRequest, minimum: MemberRole) {
    const identity = await auth.identify(request.headers.authorization);
    const { tenantId } = request.params as { tenantId: string };
    await requireMembership(store, identity, tenantId, minimum);
    const tenant = tenants.byId(tenantId);
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    return tenant;
  }

  async function view(tenantId: string, flow: ConversationFlow | null): Promise<ConversationView> {
    const list = await getPublishedPriceList(store, tenantId);
    return {
      flow,
      presets: presetViews(),
      priceItems: priceItemViews(list),
      issues: flow ? checkFlow(flow, list) : [],
    };
  }

  /** The stored flow, or null when none is saved or it no longer parses. */
  function storedFlow(config: { conversation?: unknown }): ConversationFlow | null {
    if (config.conversation == null) return null;
    const parsed = conversationFlowSchema.safeParse(config.conversation);
    return parsed.success ? parsed.data : null;
  }

  app.get('/v1/portal/tenants/:tenantId/conversation', async (request) => {
    const tenant = await member(request, 'viewer');
    return view(tenant.id, storedFlow(tenant.config));
  });

  app.put('/v1/portal/tenants/:tenantId/conversation', async (request, reply) => {
    const tenant = await member(request, 'admin');
    const body = z.object({ flow: conversationFlowSchema }).safeParse(request.body);
    if (!body.success) {
      throw new ApiError('bad_request', 'That conversation is not valid. Check each question.');
    }
    const list = await getPublishedPriceList(store, tenant.id);
    const issues = checkFlow(body.data.flow, list);
    if (issues.length > 0) {
      return reply.code(400).send({
        error: {
          code: 'bad_request',
          message: issues[0]!.message,
          requestId: String(request.id),
        },
        issues,
      });
    }
    // The version and time are the server's: whatever the client sent is ignored.
    const flow: ConversationFlow = {
      ...body.data.flow,
      version: (storedFlow(tenant.config)?.version ?? 0) + 1,
      updatedAt: new Date(deps.now()).toISOString(),
    };
    await tenants.save({ ...tenant, config: { ...tenant.config, conversation: flow } });
    return view(tenant.id, flow);
  });

  app.delete('/v1/portal/tenants/:tenantId/conversation', async (request) => {
    const tenant = await member(request, 'admin');
    const { conversation: _removed, ...config } = tenant.config;
    await tenants.save({ ...tenant, config });
    return view(tenant.id, null);
  });

  app.post('/v1/portal/tenants/:tenantId/conversation/preview', async (request) => {
    const tenant = await member(request, 'viewer');
    const body = previewBody.safeParse(request.body);
    if (!body.success) {
      throw new ApiError('bad_request', 'That conversation is not valid. Check each question.');
    }
    const { flow, answers } = body.data;
    const list = await getPublishedPriceList(store, tenant.id);
    const resolved = resolveFlow(flow);
    const nextId = resolved.next(resolved.reconcile(answers).answers);
    const question = nextId ? resolved.question(nextId) : undefined;
    return {
      next: question
        ? {
            id: question.id,
            prompt: question.prompt,
            options: (question.options ?? []).map((value) => ({
              value,
              label: question.label(value),
            })),
          }
        : null,
      effects: effectsFor(flow, answers).map(({ effect }) => describeEffect(effect, list)),
      issues: checkFlow(flow, list),
    };
  });
}
