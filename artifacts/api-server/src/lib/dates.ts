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

export const INVALID_GAME_DATE_MESSAGE =
  "gameDate must be a valid calendar date in YYYY-MM-DD format";
