// Per-host concurrency + pacing gate for live network requests (process-wide).
// Nominatim: concurrency 1 and >= 1.1 s between request starts (OSMF policy: max 1 req/s for the whole application).

/** Promise-based sleep. */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

interface HostState {
  active: number;
  lastStart: number;
  queue: (() => void)[];
  /** Serialises the pacing check so two waiters cannot start inside the same interval. */
  pacing: Promise<void>;
}

/**
 * Limits concurrency and spacing of requests per host. `acquire()` resolves with a release function once the
 * caller may start its request; the caller must call it exactly once when the request (incl. body) is finished.
 */
export class HostGate {
  private readonly hosts = new Map<string, HostState>();

  constructor(private readonly limitFor: (host: string) => { concurrency: number; minIntervalMs: number }) {}

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = { active: 0, lastStart: 0, queue: [], pacing: Promise.resolve() };
      this.hosts.set(host, s);
    }
    return s;
  }

  /** Waits for a free slot and the pacing interval of `host`; returns the release callback. */
  async acquire(host: string): Promise<() => void> {
    const s = this.state(host);
    const limit = this.limitFor(host);
    const max = Math.max(1, Math.floor(limit.concurrency));
    if (s.active >= max) await new Promise<void>((resolve) => s.queue.push(resolve));
    else s.active++;
    // pacing: chain on the previous waiter so starts are at least minIntervalMs apart
    const prev = s.pacing;
    let done!: () => void;
    s.pacing = new Promise<void>((r) => (done = r));
    try {
      await prev;
      const wait = s.lastStart + limit.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      s.lastStart = Date.now();
    } finally {
      done();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = s.queue.shift();
      if (next) next(); // hand the slot over directly (active count unchanged)
      else s.active--;
    };
  }

  /** Number of requests currently holding a slot for `host` (diagnostics/tests). */
  active(host: string): number {
    return this.hosts.get(host)?.active ?? 0;
  }

  /** Forgets all state (tests). */
  reset(): void {
    this.hosts.clear();
  }
}
