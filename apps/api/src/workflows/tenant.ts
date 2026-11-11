/**
 * The workflows a tenant's chat can run.
 *
 * Read from `tenant.config.workflows` on every ask, like the conversation. A
 * tenant that has never saved workflows gets one built from the solar template
 * and its stored conversation (`migrated: true`), so what they had keeps
 * working. A stored set that no longer parses is never half-used: chat falls
 * back to the defaults and says so in the log, Studio is told it is
 * `unreadable`, and every write is refused rather than built on the defaults.
 *
 * A built-in workflow Sunny added after a set was made (the heat pump and
 * battery quotes) is appended to any set read, switched off, so Studio can show it and the
 * installer can turn it on. The set's version is left alone: nothing the
 * installer saved has changed, and the appended workflow is written with the
 * next save like any other.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  ApiError,
  WORKFLOW_LIMITS,
  conversationFlowSchema,
  workflowSetSchema,
  type ConversationFlow,
  type Workflow,
  type WorkflowSet,
} from '@sunny/contracts';

import { bankFor, LEGACY_SOLAR, type QuestionBank } from '../flow/banks.js';
import { resolveFlow, type ResolvedFlow } from '../flow/resolve.js';
import { flowForTenant } from '../flow/tenant.js';
import type { Tenant } from '../tenants.js';

import { APPENDED_BUILT_INS, V1_STEPS, defaultWorkflowSet, templateFor } from './templates.js';

export interface TenantWorkflows {
  set: WorkflowSet;
  /** Built from the template and the stored conversation: never saved yet. */
  migrated: boolean;
  /** A stored set is there but no longer parses; `set` is Sunny's defaults. */
  unreadable: boolean;
}

export const UNREADABLE_WORKFLOWS = 'Your saved workflows could not be read. Nothing was changed.';

/**
 * The set with every missing built-in workflow appended, in order, disabled and
 * stamped with the set's own time, so reading a set twice gives the same set.
 * Nothing is appended beyond the workflow limit.
 */
function withBuiltIns(set: WorkflowSet): WorkflowSet {
  let upgraded = false;
  const workflows = set.workflows.map((w) => {
    const next = upgradeUntouched(w, set.updatedAt);
    if (next !== w) upgraded = true;
    return next;
  });
  for (const builtIn of APPENDED_BUILT_INS) {
    if (workflows.length >= WORKFLOW_LIMITS.workflows) break;
    if (workflows.some((w) => w.kind === builtIn.kind || w.id === builtIn.id)) continue;
    workflows.push(builtIn.template(set.updatedAt));
  }
  return !upgraded && workflows.length === set.workflows.length ? set : { ...set, workflows };
}

/**
 * A built-in workflow still asking exactly its version 1 questions moves to the
 * current template's questions: the installer never edited them, so the
 * shorter default is theirs too. Anything they changed (a question, a prompt,
 * an effect) keeps their copy as it is. On, pages, name and triggers stay.
 */
function upgradeUntouched(w: Workflow, now: string): Workflow {
  if (w.kind === 'custom' || w.template?.id !== w.kind || w.template.version !== 1) return w;
  const v1 = V1_STEPS[w.kind];
  const current = templateFor(w.kind, now);
  if (!v1 || !current || current.template!.version === 1) return w;
  // Key order is not compared: a stored map can come back in any order.
  if (!isDeepStrictEqual(w.steps, v1)) return w;
  return { ...w, steps: current.steps, template: current.template, version: w.version + 1 };
}

export function workflowsForTenant(
  tenant: Pick<Tenant, 'id' | 'config'> | null | undefined,
  warn: (message: string) => void = (message) => console.warn(message),
): TenantWorkflows {
  const read = readWorkflows(tenant, warn);
  return { ...read, set: withBuiltIns(read.set) };
}

function readWorkflows(
  tenant: Pick<Tenant, 'id' | 'config'> | null | undefined,
  warn: (message: string) => void,
): TenantWorkflows {
  const set = defaultWorkflowSet(new Date().toISOString());
  const raw = tenant?.config.workflows;
  if (raw != null) {
    const parsed = workflowSetSchema.safeParse(raw);
    if (parsed.success) return { set: parsed.data, migrated: false, unreadable: false };
    warn(
      `[workflows] tenant ${tenant!.id}: the stored workflows do not parse ` +
        `(${parsed.error.issues[0]?.message ?? 'invalid'}); using Sunny's own.`,
    );
    return { set, migrated: false, unreadable: true };
  }

  const stored = tenant?.config.conversation;
  if (stored != null) {
    const conversation = conversationFlowSchema.safeParse(stored);
    if (conversation.success) {
      const solar = set.workflows[0]!;
      solar.steps = [{ kind: 'preset', id: 'address' }, ...conversation.data.steps];
      solar.template = null;
      solar.version = conversation.data.version;
    } else {
      warn(
        `[workflows] tenant ${tenant!.id}: the stored conversation does not parse ` +
          `(${conversation.error.issues[0]?.message ?? 'invalid'}); using Sunny's own questions.`,
      );
    }
  }
  return { set, migrated: true, unreadable: false };
}

/** The workflow's steps as a stored conversation, for `resolveFlow`. */
export function toFlow(workflow: Workflow): ConversationFlow {
  return { version: workflow.version, updatedAt: workflow.updatedAt, steps: workflow.steps };
}

/**
 * A solar workflow that opens with the address keeps SunScan's fixed order
 * (LEGACY_SOLAR), which is exactly what a migrated conversation needs; any
 * other workflow draws on the bank for its outcome.
 */
export function resolvedFlowFor(workflow: Workflow): ResolvedFlow {
  return resolveFlow(toFlow(workflow), runBankFor(workflow));
}

/** The bank a workflow runs on: LEGACY_SOLAR for an address-first solar workflow, else its outcome's. */
export function runBankFor(workflow: Pick<Workflow, 'outcome' | 'steps'>): QuestionBank {
  const { outcome } = workflow;
  if (outcome.kind === 'quote' && outcome.engine === 'solar') {
    const first = workflow.steps[0];
    const legacy = first?.kind === 'preset' && first.id === 'address';
    return legacy ? LEGACY_SOLAR : bankFor('solar');
  }
  return bankForWorkflow(workflow);
}

/** The question bank a workflow's outcome draws on: Studio's presets for it. */
export function bankForWorkflow(workflow: Pick<Workflow, 'outcome'>): QuestionBank {
  const { outcome } = workflow;
  return bankFor(outcome.kind === 'quote' ? outcome.engine : 'lead');
}

/**
 * The flow a session runs outside the chat turn (the quote journey, a lead's
 * answers). Once workflows are saved, that is the session's active workflow
 * when it names one in the set, else the solar workflow; before then it is the
 * stored conversation, as it always was.
 */
export function sessionFlowForTenant(
  tenant: Pick<Tenant, 'id' | 'config'> | null | undefined,
  activeWorkflowId?: string | null,
): ResolvedFlow {
  if (tenant?.config.workflows == null) return flowForTenant(tenant);
  const { set } = workflowsForTenant(tenant);
  const workflow =
    (activeWorkflowId ? set.workflows.find((w) => w.id === activeWorkflowId) : undefined) ??
    set.workflows.find((w) => w.outcome.kind === 'quote' && w.outcome.engine === 'solar');
  return workflow ? resolvedFlowFor(workflow) : flowForTenant(tenant);
}

/**
 * The tenant with its workflow set changed by `change`, for `tenants.update`.
 * Starts from what the tenant has stored, or from the migrated set when it has
 * never saved one (that is the migration's first save). A stored set that no
 * longer parses is refused, never replaced by the defaults. The set's version and
 * time are bumped, the result must parse, and it is written without undefined
 * fields (Firestore refuses them). Pure, so it is safe in a retried `mutate`.
 */
export function withWorkflowSet<T extends Pick<Tenant, 'id' | 'config'>>(
  current: T,
  now: string,
  change: (set: WorkflowSet) => WorkflowSet,
): { tenant: T; set: WorkflowSet } {
  const { set, unreadable } = workflowsForTenant(current);
  if (unreadable) throw new ApiError('internal', UNREADABLE_WORKFLOWS);
  const changed = change(structuredClone(set));
  const next = JSON.parse(
    JSON.stringify({ ...changed, version: set.version + 1, updatedAt: now }),
  ) as unknown;
  const parsed = workflowSetSchema.safeParse(next);
  if (!parsed.success) {
    throw new ApiError('bad_request', 'That workflow is not valid. Check each step.');
  }
  return {
    tenant: { ...current, config: { ...current.config, workflows: parsed.data } },
    set: parsed.data,
  };
}
