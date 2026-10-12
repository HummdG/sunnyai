import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Voice minutes, per tenant per calendar month (Blueprint §6: voice is billed
 * and capped by minutes, "300 minutes/month of Web Voice or ~500 minutes/month
 * of AI Phone Receptionist calls").
 *
 * A ledger rather than a counter, so a month's total is derivable and auditable
 * from the entries. The file ledger is the development and single-instance
 * implementation; a multi-instance production deployment needs a Firestore
 * ledger behind the same interface (not built yet -- see docs/integration/voice.md).
 */
export interface VoiceUsageEntry {
  tenantId: string;
  sessionId: string;
  kind: 'web' | 'phone';
  startedAt: string;
  endedAt: string;
  seconds: number;
  endReason: string;
  /** Twilio's call id, for reconciling against Twilio's own billing. */
  callSid?: string;
}

export interface VoiceUsageLedger {
  record(entry: VoiceUsageEntry): Promise<void>;
  /** Seconds used by `tenantId` in the calendar month (UTC) containing `now`. */
  secondsThisMonth(tenantId: string, now: number): Promise<number>;
}

function sameMonth(iso: string, now: number): boolean {
  const a = new Date(iso);
  const b = new Date(now);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

export class MemoryVoiceUsage implements VoiceUsageLedger {
  readonly entries: VoiceUsageEntry[] = [];
  record(entry: VoiceUsageEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
  secondsThisMonth(tenantId: string, now: number): Promise<number> {
    return Promise.resolve(
      this.entries
        .filter((e) => e.tenantId === tenantId && sameMonth(e.startedAt, now))
        .reduce((sum, e) => sum + e.seconds, 0),
    );
  }
}

/** Append-only JSONL under the API's data directory. */
export class FileVoiceUsage implements VoiceUsageLedger {
  readonly #file: string;
  constructor(dataDir: string) {
    this.#file = join(dataDir, 'voice-usage.jsonl');
  }
  async record(entry: VoiceUsageEntry): Promise<void> {
    await mkdir(join(this.#file, '..'), { recursive: true });
    await appendFile(this.#file, `${JSON.stringify(entry)}\n`, 'utf8');
  }
  async secondsThisMonth(tenantId: string, now: number): Promise<number> {
    let text: string;
    try {
      text = await readFile(this.#file, 'utf8');
    } catch {
      return 0;
    }
    let total = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as VoiceUsageEntry;
        if (e.tenantId === tenantId && sameMonth(e.startedAt, now)) total += e.seconds;
      } catch {
        // A torn final line from a crash is skipped, not fatal.
      }
    }
    return total;
  }
}
