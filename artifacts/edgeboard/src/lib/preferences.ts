// Shared betting option lists + lightweight per-device preferences captured
// during first-run setup. Preferences are conveniences only — everything
// works if they're absent — so localStorage is the right home for them.

export const SPORTSBOOKS = [
  "bet365", "DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet", "Hard Rock Bet", "ESPN Bet", "Other",
]

export const SPORTS = [
  "NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer", "Tennis", "MMA", "Golf",
]

const SPORTSBOOK_KEY = "edgeboard-default-sportsbook"
const FAVORITE_SPORTS_KEY = "edgeboard-favorite-sports"

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage unavailable — preferences are optional
  }
}

/** The bettor's main sportsbook, if they told us during setup. */
export function getDefaultSportsbook(): string | null {
  const value = safeGet(SPORTSBOOK_KEY)
  return value && SPORTSBOOKS.includes(value) ? value : null
}

export function setDefaultSportsbook(value: string | null) {
  safeSet(SPORTSBOOK_KEY, value)
}

/** Favorite sports picked during setup, in the order chosen. */
export function getFavoriteSports(): string[] {
  const raw = safeGet(FAVORITE_SPORTS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => SPORTS.includes(s)) : []
  } catch {
    return []
  }
}

export function setFavoriteSports(sports: string[]) {
  safeSet(FAVORITE_SPORTS_KEY, sports.length > 0 ? JSON.stringify(sports) : null)
}

// ── Bet-slip memory ──────────────────────────────────────────────────────────
// The slip remembers where you bet and what you usually risk, so logging the
// next one is mostly taps. Per-device on purpose: it's a convenience, and the
// stored bets remain the source of truth.

const LAST_SPORTSBOOK_KEY = "edgeboard-last-sportsbook"
const RECENT_STAKES_KEY = "edgeboard-recent-stakes"
const RECENT_STAKES_MAX = 30

/**
 * The book used on the most recently logged bet/parlay (beats the setup
 * default). May be a custom name that isn't in SPORTSBOOKS — the forms show
 * those via the "Other" option.
 */
export function getLastSportsbook(): string | null {
  const value = safeGet(LAST_SPORTSBOOK_KEY)
  return value && value.trim() ? value : getDefaultSportsbook()
}

function getRecentStakes(): number[] {
  const raw = safeGet(RECENT_STAKES_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number" && n > 0) : []
  } catch {
    return []
  }
}

/** Call after a successful log so the next slip starts where this one ended. */
export function rememberBetSlipDefaults({ sportsbook, stake }: { sportsbook?: string; stake?: number }) {
  if (sportsbook && sportsbook.trim()) safeSet(LAST_SPORTSBOOK_KEY, sportsbook.trim())
  if (stake && stake > 0) {
    const next = [stake, ...getRecentStakes()].slice(0, RECENT_STAKES_MAX)
    safeSet(RECENT_STAKES_KEY, JSON.stringify(next))
  }
}

/**
 * The bettor's go-to stakes: their most common recent amounts, most frequent
 * first (recency breaks ties). Falls back to sensible chips until there's
 * history.
 */
export function getStakePresets(count = 3): number[] {
  const recent = getRecentStakes()
  if (recent.length === 0) return [25, 50, 100].slice(0, count)
  const freq = new Map<number, { n: number; firstIdx: number }>()
  recent.forEach((s, i) => {
    const entry = freq.get(s)
    if (entry) entry.n++
    else freq.set(s, { n: 1, firstIdx: i })
  })
  const presets = [...freq.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].firstIdx - b[1].firstIdx)
    .slice(0, count)
    .map(([stake]) => stake)
  return presets
}
