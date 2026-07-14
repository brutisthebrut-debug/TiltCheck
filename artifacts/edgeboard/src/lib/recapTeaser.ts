// ── Weekly recap teaser gating ───────────────────────────────────────────────
// Week math (UTC, Monday-start) — mirrors the server's recap.ts.
// The dashboard teaser shows once per week until the recap is opened.
// The seen week lives server-side (users.recapSeenWeek), so the teaser stays
// hidden across devices once the recap is opened anywhere.

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return addDays(day, -((d.getUTCDay() + 6) % 7))
}

/** Monday of the most recently *completed* week — the week the recap covers. */
export function latestRecapWeekStart(today: string = new Date().toISOString().slice(0, 10)): string {
  return addDays(mondayOf(today), -7)
}

/**
 * True when this user hasn't opened the current week's recap yet.
 * `seenWeek` is the server-stored week (users.recapSeenWeek); null/undefined
 * (never opened, or the flag couldn't be fetched) counts as unseen, so the
 * teaser falls back to showing.
 */
export function isRecapUnseen(seenWeek: string | null | undefined, today?: string): boolean {
  return seenWeek !== latestRecapWeekStart(today)
}
