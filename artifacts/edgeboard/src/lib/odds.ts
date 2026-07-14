/**
 * American odds sanity helpers.
 *
 * American odds are never between -99 and +99 — a price of 0, +50, or -20
 * does not exist. Rows saved before the server-side guard existed may still
 * carry such "dead zone" odds; they are excluded from all stats math until
 * their owner re-enters the real price.
 */
export const MIN_ODDS_MAGNITUDE = 100

export function isDeadZoneOdds(odds: number): boolean {
  return !Number.isFinite(odds) || Math.abs(odds) < MIN_ODDS_MAGNITUDE
}
