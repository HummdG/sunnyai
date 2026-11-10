/**
 * The portal routes behind Studio's workflow builder: read the installer's
 * workflows with everything the editor needs, switch discovery on or off,
 * create, save, delete and reset a workflow, preview one, and suggest an
 * answer's price changes. Every plan; admin and owner edit, viewer reads.
 *
 * Every write goes through `tenants.update` against the tenant as stored now.
 * A tenant that has never saved workflows starts from its migrated set, so the
 * first save here is the migration.
 */

import {
  ApiError,
  BUILTIN_WORKFLOW_IDS,
  WORKFLOW_LIMITS,
  pathMatches,
  workflowSchema,
  type FlowStep,
  type Workflow,
  type WorkflowSet,
} from '@sunny/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ChatProvider } from '../agent/provider.js';
import { createAuthenticator, requireMembership } from '../auth/index.js';
import type { PriceList } from '../catalogue/price-list.js';
import { getPublishedPriceList } from '../catalogue/price-list-service.js';
import { SOLAR } from '../flow/banks.js';
import { checkWorkflow, checkWorkflowSet, type WorkflowIssue } from '../flow/check.js';
import { effectsFor } from '../flow/effects.js';
import { suggestEffects } from '../flow/suggest.js';
import type { Tenant } from '../tenants.js';
import {
  blankWorkflow,
  customStepId,
  resetToTemplate,
  templateFor,
} from '../workflows/templates.js';
import {
  resolvedFlowFor,
  toFlow,
  withWorkflowSet,
  workflowsForTenant,
} from '../workflows/tenant.js';

import { SUGGEST_RULE, suggestBody, type ConversationRouteDeps } from './conversation.js';
import {
  describeEffect,
  presetViews,
  priceItemViews,
  type PresetView,
  type PriceItemView,
} from './flow-views.js';

export type WorkflowRouteDeps = ConversationRouteDeps;

export interface WorkflowSetView {
  set: WorkflowSet;
  migrated: boolean;
  presets: PresetView[];
  priceItems: PriceItemView[];
  issues: WorkflowIssue[];
}

const BUILTIN_IDS: readonly string[] = Object.values(BUILTIN_WORKFLOW_IDS);

const isBuiltIn = (w: Workflow) => w.template !== null || BUILTIN_IDS.includes(w.id);

const NOT_FOUND = 'No such workflow.';
const STALE = 'Someone else changed this workflow. Reload to see their changes.';

/** A refusal that carries more than an ApiError can: a 409, or a 400 with issues. */
class Refusal extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
    readonly issues?: WorkflowIssue[],
  ) {
    super(message);
  }
}

const createBody = z.object({
  from: z.union([
    z.literal('solar_quote'),
    z.literal('blank'),
    z.object({ copy: z.string().min(1).max(64) }),
  ]),
  name: z.string().trim().min(1).max(WORKFLOW_LIMITS.nameChars).optional(),
});

const previewBody = z.object({
  workflow: workflowSchema,
  answers: z.record(z.string(), z.string()).default({}),
  path: z.string().max(512).optional(),
});

/** `wf_` plus a slug of the name, unique in the set (`_2`, `_3` and so on). */
export function workflowIdFor(name: string, taken: ReadonlySet<string>): string {
  const MAX = 30;
  const slugOf = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  let slug = slugOf(name);
  if (slug.length < 3) slug = slug ? `${slug}_workflow` : 'workflow';
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `_${n}`;
    const base = slugOf(slug.slice(0, MAX - suffix.length));
    const id = `wf_${base}${suffix}`;
    if (!taken.has(id)) return id;
  }
}

/** The steps with every custom step id, follow-ups included, made fresh. */
function freshIds(steps: FlowStep[]): FlowStep[] {
  return steps.map((step) => {
    const copy: FlowStep = step.kind === 'custom' ? { ...step, id: customStepId() } : { ...step };
    if (step.followUps) {
      copy.followUps = step.followUps.map((f) => ({ ...f, step: freshIds([f.step])[0]! }));
    }
    return copy;
  });
}

/** The custom step ids under these steps, follow-ups included. */
function customIdsOf(steps: readonly FlowStep[], out = new Set<string>()): Set<string> {
  for (const s of steps) {
    if (s.kind === 'custom') out.add(s.id);
    customIdsOf(
      (s.followUps ?? []).map((f) => f.step),
      out,
    );
  }
  return out;
}

export function registerWorkflowRoutes(app: FastifyInstance, deps: WorkflowRouteDeps): void {
  const { store, tenants } = deps;
  const auth = createAuthenticator({
    portal: deps.portal,
    sessionSecret: deps.sessionSecret,
    now: deps.now,
    store,
  });
  const nowIso = () => new Date(deps.now()).toISOString();
  const base = '/v1/portal/tenants/:tenantId/workflows';

  async function member(request: FastifyRequest, minimum: 'viewer' | 'admin') {
    const identity = await auth.identify(request.headers.authorization);
    const { tenantId } = request.params as { tenantId: string };
    await requireMembership(store, identity, tenantId, minimum);
    const tenant = tenants.byId(tenantId);
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    return tenant;
  }

  function view(set: WorkflowSet, migrated: boolean, list: PriceList | null): WorkflowSetView {
    return {
      set,
      migrated,
      presets: presetViews(SOLAR),
      priceItems: priceItemViews(list),
      issues: checkWorkflowSet(set, list),
    };
  }

  /**
   * Applies `change` to the set as stored now and returns the saved set. A
   * Refusal or ApiError thrown by `change` refuses the whole write.
   */
  async function write(
    tenantId: string,
    change: (set: WorkflowSet, now: string) => WorkflowSet,
  ): Promise<WorkflowSet> {
    const written: { set: WorkflowSet | null } = { set: null };
    const saved = await tenants.update(tenantId, (current: Tenant) => {
      const now = nowIso();
      const { tenant, set } = withWorkflowSet(current, now, (s) => change(s, now));
      written.set = set;
      return tenant;
    });
    if (!saved || !written.set) throw new ApiError('not_found', 'No such installer.');
    return written.set;
  }

  /** Runs a route, turning a Refusal into its reply. */
  async function refusing<T>(
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

  app.get(base, async (request) => {
    const tenant = await member(request, 'viewer');
    const { set, migrated } = workflowsForTenant(tenant);
    return view(set, migrated, await getPublishedPriceList(store, tenant.id));
  });

  app.put(`${base}/settings`, async (request) => {
    const tenant = await member(request, 'admin');
    const body = z.object({ discoveryEnabled: z.boolean() }).safeParse(request.body);
    if (!body.success) throw new ApiError('bad_request', 'Say whether discovery is on.');
    const list = await getPublishedPriceList(store, tenant.id);
    const set = await write(tenant.id, (s) => ({
      ...s,
      discovery: { ...s.discovery, enabled: body.data.discoveryEnabled },
    }));
    return view(set, false, list);
  });

  app.post(base, async (request) => {
    const tenant = await member(request, 'admin');
    const body = createBody.safeParse(request.body);
    if (!body.success) throw new ApiError('bad_request', 'Say what to start the workflow from.');
    const { from, name } = body.data;
    const list = await getPublishedPriceList(store, tenant.id);
    const created: { workflow: Workflow | null } = { workflow: null };
    const set = await write(tenant.id, (s, now) => {
      if (s.workflows.length >= WORKFLOW_LIMITS.workflows) {
        throw new ApiError('bad_request', 'You can have up to 12 workflows.');
      }
      const taken = new Set(s.workflows.map((w) => w.id));
      let workflow: Workflow;
      const copyId =
        typeof from === 'object'
          ? from.copy
          : from === 'solar_quote' && taken.has(BUILTIN_WORKFLOW_IDS.solar_quote)
            ? BUILTIN_WORKFLOW_IDS.solar_quote
            : null;
      if (copyId !== null) {
        const source = s.workflows.find((w) => w.id === copyId);
        if (!source) throw new ApiError('not_found', NOT_FOUND);
        const copyName = (name ?? `${source.name} copy`).slice(0, WORKFLOW_LIMITS.nameChars).trim();
        workflow = {
          ...structuredClone(source),
          id: workflowIdFor(copyName, taken),
          kind: 'custom',
          name: copyName,
          enabled: false,
          template: null,
          steps: freshIds(source.steps),
          version: 1,
          updatedAt: now,
        };
      } else if (from === 'solar_quote') {
        workflow = templateFor('solar_quote', now)!;
      } else {
        const blankName = name ?? 'New workflow';
        workflow = { ...blankWorkflow(workflowIdFor(blankName, taken), now), name: blankName };
      }
      created.workflow = workflow;
      return { ...s, workflows: [...s.workflows, workflow] };
    });
    const workflow = set.workflows.find((w) => w.id === created.workflow!.id)!;
    return { workflow, view: view(set, false, list) };
  });

  app.get(`${base}/:workflowId`, async (request) => {
    const tenant = await member(request, 'viewer');
    const { workflowId } = request.params as { workflowId: string };
    const { set } = workflowsForTenant(tenant);
    const workflow = set.workflows.find((w) => w.id === workflowId);
    if (!workflow) throw new ApiError('not_found', NOT_FOUND);
    const list = await getPublishedPriceList(store, tenant.id);
    return {
      workflow,
      presets: presetViews(SOLAR),
      priceItems: priceItemViews(list),
      issues: checkWorkflowSet(set, list).filter((i) => i.workflowId === workflowId),
    };
  });

  app.put(`${base}/:workflowId`, async (request, reply) => {
    const tenant = await member(request, 'admin');
    const { workflowId } = request.params as { workflowId: string };
    const body = z.object({ workflow: workflowSchema }).safeParse(request.body);
    if (!body.success) {
      throw new ApiError('bad_request', 'That workflow is not valid. Check each step.');
    }
    const incoming = body.data.workflow;
    if (incoming.id !== workflowId) {
      throw new ApiError('bad_request', 'That workflow does not match the one being saved.');
    }
    const list = await getPublishedPriceList(store, tenant.id);
    return refusing(request, reply, async () => {
      const set = await write(tenant.id, (s, now) => {
        const stored = s.workflows.find((w) => w.id === workflowId);
        if (!stored) throw new ApiError('not_found', NOT_FOUND);
        if (incoming.version !== stored.version) throw new Refusal(409, STALE);
        // The version, time, kind and template are the server's.
        const workflow: Workflow = {
          ...incoming,
          kind: stored.kind,
          template: stored.template,
          version: stored.version + 1,
          updatedAt: now,
        };
        const next = {
          ...s,
          workflows: s.workflows.map((w) => (w.id === workflowId ? workflow : w)),
        };
        // Only this workflow's problems block its save: a stale effect in
        // another workflow is that workflow's to fix.
        const mine = customIdsOf(workflow.steps);
        const issues = checkWorkflowSet(next, list).filter(
          (i) =>
            !i.warning &&
            (i.workflowId === workflowId ||
              (i.code === 'duplicate_step_id' && i.stepId !== undefined && mine.has(i.stepId))),
        );
        if (issues.length > 0) throw new Refusal(400, issues[0]!.message, issues);
        return next;
      });
      return view(set, false, list);
    });
  });

  app.delete(`${base}/:workflowId`, async (request) => {
    const tenant = await member(request, 'admin');
    const { workflowId } = request.params as { workflowId: string };
    const list = await getPublishedPriceList(store, tenant.id);
    const set = await write(tenant.id, (s) => {
      const stored = s.workflows.find((w) => w.id === workflowId);
      if (!stored) throw new ApiError('not_found', NOT_FOUND);
      if (isBuiltIn(stored)) {
        throw new ApiError(
          'bad_request',
          'Built-in workflows can be switched off but not deleted.',
        );
      }
      return { ...s, workflows: s.workflows.filter((w) => w.id !== workflowId) };
    });
    return view(set, false, list);
  });

  app.post(`${base}/:workflowId/reset`, async (request) => {
    const tenant = await member(request, 'admin');
    const { workflowId } = request.params as { workflowId: string };
    const list = await getPublishedPriceList(store, tenant.id);
    const set = await write(tenant.id, (s, now) => {
      const stored = s.workflows.find((w) => w.id === workflowId);
      if (!stored) throw new ApiError('not_found', NOT_FOUND);
      const reset = isBuiltIn(stored) ? resetToTemplate(stored, now) : null;
      if (!reset) {
        throw new ApiError('bad_request', 'Only a built-in workflow can be reset.');
      }
      return { ...s, workflows: s.workflows.map((w) => (w.id === workflowId ? reset : w)) };
    });
    return view(set, false, list);
  });

  app.post(`${base}/:workflowId/preview`, async (request) => {
    const tenant = await member(request, 'viewer');
    const body = previewBody.safeParse(request.body);
    if (!body.success) {
      throw new ApiError('bad_request', 'That workflow is not valid. Check each step.');
    }
    const { workflow, answers, path } = body.data;
    const list = await getPublishedPriceList(store, tenant.id);
    const resolved = resolvedFlowFor(workflow);
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
      effects: effectsFor(toFlow(workflow), answers).map(({ effect, questionId, value }) => ({
        ...describeEffect(effect, list),
        questionId,
        value,
      })),
      issues: checkWorkflow(workflow, list),
      appearsOnPage: path === undefined ? null : pathMatches(workflow.pages, path),
    };
  });

  // As the conversation's suggest, under the same rate limit.
  app.post(`${base}/:workflowId/suggest`, async (request, reply) => {
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
}
