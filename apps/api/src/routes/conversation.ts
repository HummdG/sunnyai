/**
 * The portal routes behind Studio's conversation editor: read the installer's
 * flow with everything the editor needs to draw it, save it, reset it,
 * preview what a set of answers would do, and suggest each answer's price
 * changes. Every plan; admin and owner edit, viewer reads. Prices come only
 * from the published price list.
 *
 * Once the installer has saved workflows, this is a view of the solar workflow
 * (`wf_solar`): its steps without the leading address question, which this
 * editor treats as fixed. Before then it reads and writes the stored
 * conversation exactly as it always has.
 */

import {
  ApiError,
  BUILTIN_WORKFLOW_IDS,
  FLOW_LIMITS,
  conversationFlowSchema,
  type ConversationFlow,
  type FlowStep,
  type WorkflowSet,
} from '@sunny/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ChatProvider } from '../agent/provider.js';
import { createAuthenticator, requireMembership } from '../auth/index.js';
import { getPublishedPriceList } from '../catalogue/price-list-service.js';
import { checkFlow } from '../flow/check.js';
import { effectsFor } from '../flow/effects.js';
import { resolveFlow } from '../flow/resolve.js';
import { suggestEffects } from '../flow/suggest.js';
import type { RateLimitRule } from '../ratelimit.js';
import type { MemberRole, Store } from '../store.js';
import type { Tenant, TenantRegistry } from '../tenants.js';
import { resetToTemplate, solarTemplate } from '../workflows/templates.js';
import { withWorkflowSet, workflowsForTenant } from '../workflows/tenant.js';
import {
  describeEffect,
  presetViews,
  priceItemViews,
  type ConversationView,
} from './flow-views.js';
import type { PortalConfig } from './portal-config.js';

export interface ConversationRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  /** The model that works out an answer's price changes (the one email uses). */
  getProvider: () => Promise<ChatProvider>;
  enforceRateLimit: (
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    subject: string,
    rule: RateLimitRule,
  ) => void;
}

/**
 * Suggestions per installer: Studio asks once a question stops changing, so a
 * busy editing session asks a few dozen times at most.
 */
export const SUGGEST_RULE: RateLimitRule = { limit: 120, windowMs: 10 * 60_000 };

export const suggestBody = z.object({
  prompt: z.string().trim().min(1).max(FLOW_LIMITS.promptChars),
  choices: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(FLOW_LIMITS.labelChars),
      }),
    )
    .min(1)
    .max(FLOW_LIMITS.choices),
});

const previewBody = z.object({
  flow: conversationFlowSchema,
  answers: z.record(z.string(), z.string()).default({}),
});

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

  const SOLAR_ID = BUILTIN_WORKFLOW_IDS.solar_quote;
  const ADDRESS: FlowStep = { kind: 'preset', id: 'address' };
  const isAddress = (s: FlowStep | undefined) => s?.kind === 'preset' && s.id === 'address';

  /** The solar workflow as this editor's flow, or null when the set has none. */
  function solarFlow(set: WorkflowSet): ConversationFlow | null {
    const solar = set.workflows.find((w) => w.id === SOLAR_ID);
    if (!solar) return null;
    const steps = isAddress(solar.steps[0]) ? solar.steps.slice(1) : solar.steps;
    return { version: solar.version, updatedAt: solar.updatedAt, steps };
  }

  /** What the editor shows: the solar workflow once workflows are saved, else the stored flow. */
  function currentFlow(tenant: Pick<Tenant, 'id' | 'config'>): ConversationFlow | null {
    if (tenant.config.workflows == null) return storedFlow(tenant.config);
    return solarFlow(workflowsForTenant(tenant).set);
  }

  app.get('/v1/portal/tenants/:tenantId/conversation', async (request) => {
    const tenant = await member(request, 'viewer');
    return view(tenant.id, currentFlow(tenant));
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
    // Applied to the tenant as the store holds it now, not this instance's
    // cached copy, so a settings save made elsewhere is not undone, and the
    // version counts on from the flow actually stored. `mutate` may run more
    // than once (a retried transaction); the flow from its last run is the one
    // written.
    const written: { flow: ConversationFlow | null } = { flow: null };
    const saved = await tenants.update(tenant.id, (current) => {
      if (current.config.workflows != null) {
        // Saved into the solar workflow, after the address it always opens with.
        const now = new Date(deps.now()).toISOString();
        const { steps } = body.data.flow;
        const { tenant: next, set } = withWorkflowSet(current, now, (s) => {
          const stored = s.workflows.find((w) => w.id === SOLAR_ID);
          const solar = stored ?? solarTemplate(now);
          const updated = {
            ...solar,
            steps: steps.some(isAddress) ? steps : [ADDRESS, ...steps],
            version: solar.version + 1,
            updatedAt: now,
          };
          return {
            ...s,
            workflows: stored
              ? s.workflows.map((w) => (w.id === SOLAR_ID ? updated : w))
              : [updated, ...s.workflows],
          };
        });
        written.flow = solarFlow(set);
        return next;
      }
      // The version and time are the server's: whatever the client sent is ignored.
      const flow: ConversationFlow = {
        ...body.data.flow,
        version: (storedFlow(current.config)?.version ?? 0) + 1,
        updatedAt: new Date(deps.now()).toISOString(),
      };
      written.flow = flow;
      return { ...current, config: { ...current.config, conversation: flow } };
    });
    if (!saved) throw new ApiError('not_found', 'No such installer.');
    return view(tenant.id, written.flow);
  });

  app.delete('/v1/portal/tenants/:tenantId/conversation', async (request) => {
    const tenant = await member(request, 'admin');
    const written: { flow: ConversationFlow | null } = { flow: null };
    const saved = await tenants.update(tenant.id, (current) => {
      if (current.config.workflows != null) {
        // The solar workflow goes back to its template.
        const now = new Date(deps.now()).toISOString();
        const { tenant: next, set } = withWorkflowSet(current, now, (s) => {
          const stored = s.workflows.find((w) => w.id === SOLAR_ID);
          if (!stored) return { ...s, workflows: [solarTemplate(now), ...s.workflows] };
          const reset = resetToTemplate(stored, now) ?? stored;
          return { ...s, workflows: s.workflows.map((w) => (w.id === SOLAR_ID ? reset : w)) };
        });
        written.flow = solarFlow(set);
        return next;
      }
      written.flow = null;
      const { conversation: _removed, ...config } = current.config;
      return { ...current, config };
    });
    if (!saved) throw new ApiError('not_found', 'No such installer.');
    return view(tenant.id, written.flow);
  });

  // What Sunny would have each answer do, from the published list only. A
  // problem with the model answers with no suggestion rather than an error.
  app.post('/v1/portal/tenants/:tenantId/conversation/suggest', async (request, reply) => {
    const tenant = await member(request, 'admin');
    const body = suggestBody.safeParse(request.body);
    if (!body.success) {
      throw new ApiError('bad_request', 'Give the question and at least one answer.');
    }
    deps.enforceRateLimit(request, reply, 'flow-suggest', tenant.id, SUGGEST_RULE);
    const list = await getPublishedPriceList(store, tenant.id);
    if (!list) return { effects: {} };
    let provider: ChatProvider;
    try {
      provider = await deps.getProvider();
    } catch {
      return { effects: {} };
    }
    return suggestEffects(provider, body.data, list);
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
      // Each effect names the answer that causes it, so Studio can show one
      // question's effects without those of the answers leading to it.
      effects: effectsFor(flow, answers).map(({ effect, questionId, value }) => ({
        ...describeEffect(effect, list),
        questionId,
        value,
      })),
      issues: checkFlow(flow, list),
    };
  });
}
