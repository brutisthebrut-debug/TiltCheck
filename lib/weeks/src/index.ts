/**
 * Shared week math for TiltCheck (UTC, Monday-start weeks).
 *
 * The weekly recap on the server and the recap teaser in the web app must
 * agree on which week "last week" is — both import from here so the math
 * can never drift.
 *
 * Days are `YYYY-MM-DD` strings interpreted at UTC midnight.
 */

/** `YYYY-MM-DD` (UTC) for a Date. */
export function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` day by `delta` days (UTC). */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dayOf(d);
}

/** Monday of the week containing `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Monday of the most recently *completed* week as of `today`. */
export function lastCompletedWeekStart(today: string): string {
  return addDays(mondayOf(today), -7);
}
