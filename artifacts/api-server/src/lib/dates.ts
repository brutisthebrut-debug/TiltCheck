import { dayOf } from "@workspace/weeks";

/**
 * Validates that a YYYY-MM-DD string is a real calendar date.
 *
 * The generated Zod schemas enforce the `^\d{4}-\d{2}-\d{2}$` shape, but a
 * string like "2026-02-31" passes the regex and would still blow up as a
 * Postgres `date` error. This check closes that gap so the API can return a
 * clear 400 instead of a 500.
 */
export function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Today's date (YYYY-MM-DD) in the given IANA timezone.
 *
 * Game dates are stored as plain calendar dates, so "is this game over?"
 * depends on whose midnight you ask. The needs-settling nag uses the
 * bettor's browser timezone so it doesn't flip at UTC midnight — hours
 * before a west-of-UTC bettor's game day has actually ended. A missing or
 * invalid timezone falls back to UTC (the old behavior).
 */
export function todayInTimeZone(tz: string | null | undefined, now: Date = new Date()): string {
  if (tz) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    } catch {
      // Unknown timezone string — fall through to UTC.
    }
  }
  return dayOf(now);
}

export const INVALID_GAME_DATE_MESSAGE =
  "gameDate must be a valid calendar date in YYYY-MM-DD format";
