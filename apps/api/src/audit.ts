import type {
  AuditAction,
  AuditEvent,
  AuditOutcome,
  AuditReason,
  AuditTarget,
} from '@sunny/contracts';

import { newId, type Store } from './store.js';

/**
 * Writing the audit trail.
 *
 * The routes describe *what was attempted and how it ended*; everything that
 * makes the record a record -- the id, the clock, the nulls that stand for "not
 * applicable here" -- is filled in here, so a call site cannot forget one and
 * cannot invent its own convention for it.
 *
 * ## Why a failed write never fails the request
 *
 * The act has already happened by the time most of these are written: the
 * catalogue is stored, the lead list has been read out and is on its way back.
 * Throwing here would refuse a request that succeeded, which is a lie in the
 * other direction -- and a worse one, because the caller would retry a write that
 * already landed. So the failure is *reported* instead: `onFailure` is wired to
 * the request log at error level, where an operator sees it.
 *
 * The alternative that is genuinely tempting -- swallow it and carry on -- is how
 * an audit log quietly stops being written while every dashboard says it is fine.
 * That is why `onFailure` exists as a required-by-convention parameter rather
 * than as an optional nicety: a caller that passes nothing gets a silent log, and
 * the comment here is the only thing standing between that and a false claim.
 */
export interface AuditEntry {
  /** The tenant the act was against, or null when none could be named. */
  tenantId: string | null;
  actor: 'admin' | 'system';
  action: AuditAction;
  target: AuditTarget;
  outcome: AuditOutcome;
  /** Required on `denied` and `failed`; omitted on `permitted`. */
  reason?: AuditReason;
  sessionId?: string | null;
  requestId?: string | null;
  /** Numbers and booleans only. See `packages/contracts/src/audit.ts`. */
  detail?: Record<string, number | boolean>;
}

export interface Auditor {
  record(entry: AuditEntry): Promise<void>;
}

export interface AuditorOptions {
  store: Store;
  /** Injected so tests can pin the timestamp. */
  now: () => number;
  /** Where a failed write goes. Wire it to the request log. */
  onFailure?: (error: unknown) => void;
}

export function createAuditor({ store, now, onFailure }: AuditorOptions): Auditor {
  return {
    async record(entry: AuditEntry): Promise<void> {
      const event: AuditEvent = {
        id: newId('aud'),
        tenantId: entry.tenantId,
        // `id` is always null for now: the admin token is deployment-wide and the
        // assistant is not a person. See `AUDIT_ACTOR_KINDS`.
        actor: { kind: entry.actor, id: null },
        action: entry.action,
        target: entry.target,
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        sessionId: entry.sessionId ?? null,
        requestId: entry.requestId ?? null,
        detail: entry.detail ?? {},
        at: new Date(now()).toISOString(),
      };

      try {
        await store.appendAuditEvent(event);
      } catch (error) {
        // Reported, not thrown, and not swallowed. See the note above.
        onFailure?.(error);
      }
    },
  };
}
