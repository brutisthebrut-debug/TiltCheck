// ── Weekly recap teaser gating ───────────────────────────────────────────────
// Week math (UTC, Monday-start) comes from @workspace/weeks — the same module
// the server's recap uses, so the two can never disagree about which week
// "last week" is. The dashboard teaser shows once per week until the recap is
// opened. The seen week lives server-side (users.recapSeenWeek), so the teaser
// stays hidden across devices once the recap is opened anywhere.

import { addDays, lastCompletedWeekStart } from "@workspace/weeks"

export { addDays, mondayOf } from "@workspace/weeks"

/** Monday of the most recently *completed* week — the week the recap covers. */
export function latestRecapWeekStart(today: string = new Date().toISOString().slice(0, 10)): string {
  return lastCompletedWeekStart(today)
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
