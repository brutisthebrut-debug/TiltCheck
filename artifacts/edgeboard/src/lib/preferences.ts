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
