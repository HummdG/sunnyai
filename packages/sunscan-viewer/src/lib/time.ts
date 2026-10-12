// UK civil time <-> UTC. The sun study is driven by UK clock time (GMT in winter, BST in summer) on a chosen
// date, converted to a UTC instant with the Europe/London zone rules from Intl (no Temporal needed).
const ZONE = 'Europe/London';
let offsetFmt: Intl.DateTimeFormat | null = null;

/** Minutes east of UTC for Europe/London at the given instant (0 = GMT, 60 = BST). */
export function ukOffsetMinutes(at: Date): number {
  offsetFmt ??= new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, timeZoneName: 'shortOffset' });
  const name = offsetFmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -v : v;
}

/** Parses 'YYYY-MM-DD' (validated); returns [year, monthIndex, day]. */
export function parseIsoDate(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`invalid date '${iso}'`);
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

/**
 * UTC instant of a UK clock time (`minutes` after local midnight) on `isoDate`. In the skipped spring-forward hour
 * the result lands one hour later (01:30 -> 02:30 BST); in the repeated autumn hour the later (GMT) instance is used.
 */
export function ukLocalToUtc(isoDate: string, minutes: number): Date {
  const [y, mo, d] = parseIsoDate(isoDate);
  const naive = Date.UTC(y, mo, d, 0, 0, 0) + Math.round(minutes) * 60_000;
  let t = naive - ukOffsetMinutes(new Date(naive)) * 60_000;
  t = naive - ukOffsetMinutes(new Date(t)) * 60_000;
  return new Date(t);
}

/** UK calendar date (YYYY-MM-DD) and clock minutes for a UTC instant. */
export function utcToUkLocal(at: Date): { isoDate: string; minutes: number } {
  const local = new Date(at.getTime() + ukOffsetMinutes(at) * 60_000);
  const isoDate = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
  return { isoDate, minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** 'BST' or 'GMT' for the UK clock at that instant. */
export const ukZoneName = (at: Date) => (ukOffsetMinutes(at) === 60 ? 'BST' : 'GMT');

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '21 June 2026' */
export function formatLongDate(isoDate: string): string {
  const [y, mo, d] = parseIsoDate(isoDate);
  return `${d} ${MONTHS[mo]} ${y}`;
}

/** formatLongDate for 'YYYY-MM-DD' or an ISO timestamp; other strings are returned unchanged. */
export function formatLongDateSafe(s: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? formatLongDate(s.slice(0, 10)) : s;
}

/** Day of the year (1-based) for 'YYYY-MM-DD'. */
export function dayOfYear(isoDate: string): number {
  const [y, mo, d] = parseIsoDate(isoDate);
  return Math.round((Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

export const daysInYear = (year: number) => (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365);

/** 'YYYY-MM-DD' for a 1-based day of `year` (clamped to the year). */
export function isoFromDayOfYear(year: number, doy: number): string {
  const d = new Date(Date.UTC(year, 0, 1) + (Math.min(Math.max(1, Math.round(doy)), daysInYear(year)) - 1) * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
