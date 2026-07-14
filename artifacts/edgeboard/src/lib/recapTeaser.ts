// ── Weekly recap teaser gating ───────────────────────────────────────────────
// Week math (UTC, Monday-start) — mirrors the server's recap.ts.
// The dashboard teaser shows once per week until the recap is opened.

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

export const RECAP_SEEN_KEY = (userId: number) => `edgeboard-recap-seen-${userId}`

type SeenStore = Pick<Storage, "getItem" | "setItem">

/** True when this user hasn't opened the current week's recap yet. */
export function isRecapUnseen(
  userId: number,
  today?: string,
  store: SeenStore = localStorage,
): boolean {
  return store.getItem(RECAP_SEEN_KEY(userId)) !== latestRecapWeekStart(today)
}

/** Opening any recap counts as having seen this week's — kills the teaser. */
export function markRecapSeen(
  userId: number,
  today?: string,
  store: SeenStore = localStorage,
): void {
  store.setItem(RECAP_SEEN_KEY(userId), latestRecapWeekStart(today))
}
