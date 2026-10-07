/**
 * Recurring expenses (rent, Wi-Fi, subscriptions). A template stores the
 * full expense payload plus a schedule; a daily job (Vercel Cron / Supabase
 * pg_cron) calls `dueOccurrences` and posts one expense per returned date.
 * Posting is idempotent: each occurrence is keyed by (templateId, date).
 */

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  frequency: Frequency;
  /** Every N periods (1 = every month, 3 = quarterly, ...). */
  interval: number;
  /** ISO date (YYYY-MM-DD) of the first occurrence. */
  startDate: string;
  /** Optional ISO date after which no occurrences are generated. */
  endDate?: string;
}

/**
 * The n-th occurrence (0-based) of a rule. Monthly/yearly anchor on the
 * start date's day and clamp to month end, so "31st" yields Feb 28/29,
 * then Mar 31 — it never drifts permanently to the 28th.
 */
export function occurrenceAt(rule: RecurrenceRule, n: number): string {
  const [y, m, d] = rule.startDate.split("-").map(Number);
  const step = n * rule.interval;
  switch (rule.frequency) {
    case "daily":
      return isoFromUTC(Date.UTC(y, m - 1, d + step));
    case "weekly":
      return isoFromUTC(Date.UTC(y, m - 1, d + step * 7));
    case "monthly":
      return clampedDate(y, m - 1 + step, d);
    case "yearly":
      return clampedDate(y + step, m - 1, d);
  }
}

/**
 * All occurrence dates in (lastPosted, today], in order. Pass `lastPosted`
 * as undefined for a template that has never posted (includes startDate).
 * `limit` guards against huge backfills after long downtime.
 */
export function dueOccurrences(
  rule: RecurrenceRule,
  today: string,
  lastPosted?: string,
  limit = 366,
): string[] {
  if (rule.interval < 1 || !Number.isInteger(rule.interval)) {
    throw new Error("interval must be a positive integer");
  }
  const out: string[] = [];
  for (let n = 0; out.length < limit; n++) {
    const date = occurrenceAt(rule, n);
    if (date > today || (rule.endDate && date > rule.endDate)) break;
    if (!lastPosted || date > lastPosted) out.push(date);
  }
  return out;
}

export function nextOccurrence(rule: RecurrenceRule, after: string): string | null {
  for (let n = 0; n < 10_000; n++) {
    const date = occurrenceAt(rule, n);
    if (rule.endDate && date > rule.endDate) return null;
    if (date > after) return date;
  }
  return null;
}

function clampedDate(year: number, monthIndex: number, day: number): string {
  const normalizedYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(normalizedYear, normalizedMonth + 1, 0)).getUTCDate();
  return isoFromUTC(Date.UTC(normalizedYear, normalizedMonth, Math.min(day, lastDay)));
}

function isoFromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
