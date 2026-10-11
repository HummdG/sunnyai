import type { Auditor } from './audit.js';
import type { PurgeResult, Store } from './store.js';

/**
 * The retention sweep.
 *
 * A lead is personal data an installer has no unbounded right to hold, so the
 * deployment keeps a window and removes what has fallen out of it. The plan's §4
 * asks for "retention and deletion" as one requirement, and they are the two ends
 * of the same promise: deletion is the visitor asking, retention is the deployment
 * asking itself. A system that only implements the first relies on visitors who
 * remember to ask.
 *
 * ## Why a timer rather than a scheduled job
 *
 * Cloud Run has no cron in the container, so the choices are an external scheduler
 * hitting a route or an interval inside the process. The interval wins here for
 * two reasons. An external scheduler is another credential to provision and
 * another thing that is silently absent if it is not -- and this project's whole
 * stance is that a missing capability should be visible rather than quietly
 * degraded. And the sweep is idempotent and cheap: running it twice because two
 * instances both hold a timer costs a directory listing, whereas a misconfigured
 * cron costs the promise.
 *
 * ## Why the failure is logged and not thrown
 *
 * Same reasoning as `createAuditor`: a sweep that throws on a schedule fills the
 * log with one repeated line and, worse, tells nobody anything new. It reports and
 * carries on, and the next run tries again -- because a record that survives one
 * sweep because of a transient error is removed by the next one.
 */

export interface RetentionOptions {
  store: Store;
  auditor: Auditor;
  /**
   * How long a record is kept, in milliseconds. Zero or less disables the sweep.
   *
   * Disabled rather than "delete everything" or "delete nothing by accident": an
   * operator who set `SUNNY_LEAD_RETENTION_DAYS=0` said "we keep these", and the
   * honest response is to do nothing and say so at boot, not to sweep with a
   * zero-length window and erase the deployment.
   */
  retentionMs: number;
  /** How often to sweep. Independent of the window, which is what is kept. */
  intervalMs?: number;
  /** Injected so tests can pin the clock. */
  now?: () => number;
  /** Where a failed sweep goes. Wire it to the process log. */
  onFailure?: (error: unknown) => void;
}

export interface RetentionSweep {
  /**
   * Run one sweep now, whatever the interval says.
   *
   * Exposed so a test does not have to wait for a timer, and so an operator could
   * run it from a route later without reimplementing the rule.
   */
  purgeOnce(): Promise<PurgeResult>;
  /** Cancel the timer. Idempotent. */
  stop(): void;
}

/** Six hours: often enough that a window is honoured to the day, rare enough to be free. */
export const DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The floor. A retention window is a policy about months; a sweep every second is
 * a misconfiguration, not a policy.
 */
const MIN_SWEEP_INTERVAL_MS = 60 * 1000;

export function startRetention(options: RetentionOptions): RetentionSweep {
  const { store, auditor, retentionMs } = options;
  const now = options.now ?? Date.now;
  const onFailure = options.onFailure ?? ((): void => {});
  const requested = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

  if (retentionMs <= 0) {
    // No timer and no audit event: a sweep that removed nothing did not happen, and
    // writing "retention ran, erased 0" six times a day is how a log becomes
    // something people stop reading.
    return {
      // Resolved rather than `async`, so the disabled path carries no `await` a
      // reader might take for a sweep that is quietly still running.
      purgeOnce: () => Promise.resolve<PurgeResult>({ leads: 0, conversations: 0, tenants: [] }),
      stop: () => {},
    };
  }

  async function purgeOnce(): Promise<PurgeResult> {
    const cutoffMs = now() - retentionMs;
    const result = await store.purgeExpired(cutoffMs);

    // One event per affected tenant, because the act was against that tenant's
    // records. Nothing is written when nothing was removed.
    for (const tenant of result.tenants) {
      await auditor.record({
        tenantId: tenant.tenantId,
        actor: 'system',
        action: 'retention.purge',
        target: { kind: 'conversation', id: null },
        outcome: 'permitted',
        detail: { leads: tenant.leads, conversations: tenant.conversations },
      });
    }

    return result;
  }

  // Neither more often than asked for, nor less often than the window it enforces:
  // a window shorter than the interval would otherwise be honoured late, which for
  // a short window is the same as not honouring it. The floor keeps a mis-set
  // retention from becoming a hot loop.
  const interval = Math.max(MIN_SWEEP_INTERVAL_MS, Math.min(requested, retentionMs));
  const timer = setInterval(() => {
    void purgeOnce().catch(onFailure);
  }, interval);
  // `unref` so the sweep never holds the process open. Without it a deployment
  // would take six hours to exit and a test file would never finish.
  timer.unref?.();

  // And once now, because the interval alone would let a deployment that restarts
  // with every release push the sweep past the end of its own window -- the one
  // schedule guaranteed never to fire is the one that only ever counts down from
  // boot.
  void purgeOnce().catch(onFailure);

  return {
    purgeOnce,
    stop: (): void => {
      clearInterval(timer);
    },
  };
}
