/**
 * The conversation a tenant's chat runs on.
 *
 * Read from `tenant.config.conversation` every time it is asked for (once per
 * chat turn, once per journey request), so a flow the installer saves
 * mid-conversation governs the next turn. The stored flow is validated again
 * here: a flow that no longer parses is never half-used. Sunny falls back to
 * its own questions and says so in the log, because a broken setting must not
 * break a visitor's chat.
 */

import { conversationFlowSchema } from '@sunny/contracts';

import type { Tenant } from '../tenants.js';

import { resolveFlow, type ResolvedFlow } from './resolve.js';

export function flowForTenant(
  tenant: Pick<Tenant, 'id' | 'config'> | null | undefined,
  warn: (message: string) => void = (message) => console.warn(message),
): ResolvedFlow {
  const raw = tenant?.config.conversation;
  if (raw == null) return resolveFlow(null);
  const parsed = conversationFlowSchema.safeParse(raw);
  if (!parsed.success) {
    warn(
      `[flow] tenant ${tenant!.id}: the stored conversation does not parse ` +
        `(${parsed.error.issues[0]?.message ?? 'invalid'}); using Sunny's own questions.`,
    );
    return resolveFlow(null);
  }
  return resolveFlow(parsed.data);
}
