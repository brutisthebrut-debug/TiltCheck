import { isValidAmericanOdds } from "./odds";

/**
 * Badge engine — everything is computed from plays the crew already logs.
 * Definitions live here (server-side source of truth); earned badges are
 * persisted in user_badges by the badges route the first time they qualify,
 * and are never revoked.
 *
 * Dead-zone-odds rows (American odds between -99 and +99) are excluded from
 * anything odds- or payout-based, exactly like the stats endpoints.
 */

export type BadgeDefinition = {
  id: string;
  name: string;
  description: string;
  emoji: string;
};

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  { id: "first_blood", name: "First Blood", emoji: "🩸", description: "Cashed your first winning play." },
  { id: "hot_hand", name: "Hot Hand", emoji: "🔥", description: "Won 3 plays in a row." },
  { id: "dog_whisperer", name: "Dog Whisperer", emoji: "🐕", description: "Cashed an underdog at +200 or longer." },
  { id: "chalk_eater", name: "Chalk Eater", emoji: "🍦", description: "Won 5 plays laying -150 or heavier. Delicious chalk." },
  { id: "degen_night", name: "Degen Night", emoji: "🎰", description: "Logged 3+ plays in a single day. We don't judge. Much." },
  { id: "iron_bankroll", name: "Iron Bankroll", emoji: "🧊", description: "20 plays logged without ever staking more than 10% of your starting bankroll." },
  { id: "parlay_prophet", name: "Parlay Prophet", emoji: "🔮", description: "Hit a parlay with 3+ legs." },
  { id: "film_junkie", name: "Film Junkie", emoji: "🎬", description: "Wrote the honest post-game review on 10 settled plays." },
  { id: "comeback_kid", name: "Comeback Kid", emoji: "🦅", description: "Snapped a 3+ loss skid with a win." },
  { id: "sharp", name: "Certified Sharp", emoji: "🎯", description: "55%+ win rate across 20+ decided plays." },
  { id: "week_warrior", name: "Week Warrior", emoji: "📅", description: "Logged plays 7 days in a row." },
  { id: "bookkeeper", name: "Bookkeeper", emoji: "📒", description: "Every finished game graded — nothing overdue for 7 straight days." },
];

const SETTLED = ["won", "lost", "push"];

/** The subset of bet/parlay fields the engine needs (both shapes satisfy it). */
export type PlayLike = {
  odds: number;
  stake: string;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
  reasoningQuality: string | null;
  whatHappened: string | null;
  missReason: string | null;
};

export type BadgeInput = {
  bets: (PlayLike & { gameDate: string })[];
  /** Parlays with their leg count and the latest leg game date (YYYY-MM-DD, null when legless). */
  parlays: (PlayLike & { legCount: number; lastLegGameDate: string | null })[];
  startingBankroll: number;
  /** "Today" as a UTC calendar date, injectable for tests. */
  today?: string;
};

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
};

/** Longest run of consecutive calendar days present in the set. */
function longestConsecutiveRun(days: Set<string>): number {
  let longest = 0;
  for (const day of days) {
    if (days.has(addDays(day, -1))) continue; // not a run start
    let len = 1;
    let cur = day;
    while (days.has(addDays(cur, 1))) { cur = addDays(cur, 1); len++; }
    longest = Math.max(longest, len);
  }
  return longest;
}

/** Run of consecutive logged days ending today or yesterday (grace day). */
function currentRun(days: Set<string>, today: string): number {
  let anchor = days.has(today) ? today : days.has(addDays(today, -1)) ? addDays(today, -1) : null;
  if (!anchor) return 0;
  let len = 0;
  while (days.has(anchor)) { len++; anchor = addDays(anchor, -1); }
  return len;
}

/**
 * Was any play overdue on day D? A play is overdue on D when its game ended
 * before D and it wasn't settled yet as of the end of D.
 */
function hasOverdueOn(input: BadgeInput, day: string): boolean {
  const endOfDay = new Date(`${day}T23:59:59.999Z`);
  for (const b of input.bets) {
    if (b.status === "void") continue;
    if (b.gameDate >= day) continue;
    if (b.settledAt == null ? b.status === "pending" : b.settledAt > endOfDay) return true;
  }
  for (const p of input.parlays) {
    if (p.status === "void") continue;
    if (p.lastLegGameDate == null || p.lastLegGameDate >= day) continue;
    if (p.settledAt == null ? p.status === "pending" : p.settledAt > endOfDay) return true;
  }
  return false;
}

export type StreaksSummary = {
  loggingStreakDays: number;
  longestLoggingStreakDays: number;
  settleStreakDays: number;
  overdueCount: number;
};

/** How many days back we bother scanning for the settle streak. */
const SETTLE_SCAN_DAYS = 365;

export function computeStreaks(input: BadgeInput): StreaksSummary {
  const today = input.today ?? dayOf(new Date());
  const loggedDays = new Set<string>([
    ...input.bets.map((b) => dayOf(b.createdAt)),
    ...input.parlays.map((p) => dayOf(p.createdAt)),
  ]);

  // The settle streak is anchored to the bettor's own history: it can never
  // be longer than the days since their first logged play. A brand-new
  // account is not "365 days clean" — it has no history at all.
  const firstLoggedDay = [...loggedDays].sort()[0] ?? null;
  let settleStreakDays = 0;
  if (firstLoggedDay != null) {
    for (let i = 0; i < SETTLE_SCAN_DAYS; i++) {
      const day = addDays(today, -i);
      if (day < firstLoggedDay) break;
      if (hasOverdueOn(input, day)) break;
      settleStreakDays++;
    }
  }

  const overdueCount =
    input.bets.filter((b) => b.status === "pending" && b.gameDate < today).length +
    input.parlays.filter(
      (p) => p.status === "pending" && p.lastLegGameDate != null && p.lastLegGameDate < today,
    ).length;

  return {
    loggingStreakDays: currentRun(loggedDays, today),
    longestLoggingStreakDays: longestConsecutiveRun(loggedDays),
    settleStreakDays,
    overdueCount,
  };
}

/** Badge ids the bettor currently qualifies for (persistence handles "earned"). */
export function computeQualifiedBadges(input: BadgeInput): Set<string> {
  const today = input.today ?? dayOf(new Date());
  const earned = new Set<string>();

  const validBets = input.bets.filter((b) => isValidAmericanOdds(b.odds));
  const validParlays = input.parlays.filter((p) => isValidAmericanOdds(p.odds));
  const allPlays: PlayLike[] = [...input.bets, ...input.parlays];
  const settledPlays = [...validBets, ...validParlays]
    .filter((p) => SETTLED.includes(p.status))
    .sort((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));

  // first_blood — any settled win
  if (settledPlays.some((p) => p.status === "won")) earned.add("first_blood");

  // hot_hand / comeback_kid — walk the settle order once
  let winRun = 0;
  let lossRun = 0;
  for (const p of settledPlays) {
    if (p.status === "won") {
      winRun++;
      if (winRun >= 3) earned.add("hot_hand");
      if (lossRun >= 3) earned.add("comeback_kid");
      lossRun = 0;
    } else if (p.status === "lost") {
      lossRun++;
      winRun = 0;
    } else {
      winRun = 0; // push interrupts both runs
      lossRun = 0;
    }
  }

  // dog_whisperer — a straight-bet win at +200 or longer
  if (validBets.some((b) => b.status === "won" && b.odds >= 200)) earned.add("dog_whisperer");

  // chalk_eater — 5 straight-bet wins at -150 or heavier
  if (validBets.filter((b) => b.status === "won" && b.odds <= -150).length >= 5)
    earned.add("chalk_eater");

  // degen_night — 3+ plays logged the same calendar day
  const perDay: Record<string, number> = {};
  for (const p of allPlays) {
    const d = dayOf(p.createdAt);
    perDay[d] = (perDay[d] ?? 0) + 1;
    if (perDay[d] >= 3) earned.add("degen_night");
  }

  // iron_bankroll — 20+ plays, none staking more than 10% of starting bankroll
  if (
    input.startingBankroll > 0 &&
    allPlays.length >= 20 &&
    allPlays.every((p) => Number(p.stake) <= input.startingBankroll * 0.1)
  )
    earned.add("iron_bankroll");

  // parlay_prophet — a won parlay with 3+ legs
  if (validParlays.some((p) => p.status === "won" && p.legCount >= 3)) earned.add("parlay_prophet");

  // film_junkie — post-game review filled on 10 settled plays
  const reviewed = allPlays.filter(
    (p) =>
      SETTLED.includes(p.status) &&
      (p.reasoningQuality != null ||
        (p.whatHappened != null && p.whatHappened.trim() !== "") ||
        (p.missReason != null && p.missReason !== "na")),
  );
  if (reviewed.length >= 10) earned.add("film_junkie");

  // sharp — 55%+ win rate over 20+ decided plays (pushes don't count)
  const decided = settledPlays.filter((p) => p.status !== "push");
  const wins = decided.filter((p) => p.status === "won").length;
  if (decided.length >= 20 && wins / decided.length >= 0.55) earned.add("sharp");

  // week_warrior / bookkeeper — streak-based. Bookkeeper additionally needs
  // real grading history (at least one settled play), not a vacuous "nothing
  // was ever overdue because nothing was ever at stake".
  const streaks = computeStreaks({ ...input, today });
  if (streaks.longestLoggingStreakDays >= 7) earned.add("week_warrior");
  if (settledPlays.length > 0 && streaks.settleStreakDays >= 7) earned.add("bookkeeper");

  return earned;
}
