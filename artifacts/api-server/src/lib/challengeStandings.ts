/**
 * Challenge standings computation.
 *
 * For each crew member, compute the relevant metric value using only
 * settled bets/parlays whose settledAt falls within the challenge window
 * (inclusive on both day boundaries, interpreted as midnight UTC).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, betsTable, parlaysTable, usersTable, crewChallengesTable } from "@workspace/db";
import { isValidAmericanOdds } from "./odds";
import { computeDecisionQuality } from "../routes/workspace";

export type ChallengeMetric = "roi" | "win_rate" | "calibration" | "postmortem_rate";

export interface StandingRow {
  userId: number;
  userName: string;
  avatarColor: string;
  value: number | null;
  rank: number;
  settledCount: number;
}

const SETTLED_STATUSES = ["won", "lost", "push"] as const;

/** Human-readable metric label for banners and recap narrative. */
export function metricLabel(metric: ChallengeMetric): string {
  return {
    roi: "Best ROI",
    win_rate: "Most Wins",
    calibration: "Sharpest Read",
    postmortem_rate: "Most Disciplined",
  }[metric];
}

/** Format a metric value for display (banner, recap). */
export function formatMetricValue(metric: ChallengeMetric, value: number): string {
  switch (metric) {
    case "roi":
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    case "win_rate":
      return `${value.toFixed(1)}%`;
    case "calibration":
      return value.toFixed(1);
    case "postmortem_rate":
      return `${value.toFixed(0)}%`;
  }
}

/**
 * Compute live standings for a challenge.
 * Returns rows sorted by rank (value desc, then settledCount desc for ties).
 */
export async function computeChallengeStandings(
  challenge: { metric: string; startDate: string; endDate: string },
  memberIds: number[],
): Promise<StandingRow[]> {
  if (memberIds.length === 0) return [];

  // Challenge window: [startDate 00:00 UTC, endDate+1 day 00:00 UTC)
  const windowStart = new Date(`${challenge.startDate}T00:00:00.000Z`);
  const endDay = new Date(`${challenge.endDate}T00:00:00.000Z`);
  const windowEnd = new Date(endDay.getTime() + 24 * 60 * 60 * 1000); // exclusive

  const inWindow = (d: Date | null): boolean =>
    d != null && d >= windowStart && d < windowEnd;

  // Load settled bets/parlays for all members in one query each
  const [allBets, allParlays, members] = await Promise.all([
    db
      .select()
      .from(betsTable)
      .where(
        and(
          inArray(betsTable.userId, memberIds),
          inArray(betsTable.status, [...SETTLED_STATUSES]),
        ),
      ),
    db
      .select()
      .from(parlaysTable)
      .where(
        and(
          inArray(parlaysTable.userId, memberIds),
          inArray(parlaysTable.status, [...SETTLED_STATUSES]),
        ),
      ),
    db
      .select({ id: usersTable.id, displayName: usersTable.displayName, avatarColor: usersTable.avatarColor })
      .from(usersTable)
      .where(inArray(usersTable.id, memberIds)),
  ]);

  const userMap = new Map(members.map((m) => [m.id, m]));
  const metric = challenge.metric as ChallengeMetric;

  const rows: Omit<StandingRow, "rank">[] = memberIds.map((userId) => {
    const user = userMap.get(userId);
    const bets = allBets.filter(
      (b) => b.userId === userId && isValidAmericanOdds(b.odds) && inWindow(b.settledAt),
    );
    const parlays = allParlays.filter(
      (p) => p.userId === userId && isValidAmericanOdds(p.odds) && inWindow(p.settledAt),
    );
    const settled = [...bets, ...parlays];
    const wins = settled.filter((p) => p.status === "won").length;
    const losses = settled.filter((p) => p.status === "lost").length;

    let value: number | null = null;
    switch (metric) {
      case "roi": {
        const wagered = settled.reduce((s, p) => s + Number(p.stake), 0);
        const payout = settled.reduce(
          (s, p) => s + (p.actualPayout != null ? Number(p.actualPayout) : 0),
          0,
        );
        if (wagered > 0) value = Math.round(((payout - wagered) / wagered) * 10000) / 100;
        break;
      }
      case "win_rate": {
        const decided = wins + losses;
        if (decided > 0) value = Math.round((wins / decided) * 1000) / 10;
        break;
      }
      case "calibration": {
        const dq = computeDecisionQuality(
          settled.map((p) => ({
            status: p.status,
            confidenceScore: "confidenceScore" in p ? p.confidenceScore : 5,
            reasoningQuality: p.reasoningQuality,
            whatHappened: p.whatHappened,
            missReason: p.missReason,
          })),
        );
        value = dq.calibrationScore;
        break;
      }
      case "postmortem_rate": {
        const dq = computeDecisionQuality(
          settled.map((p) => ({
            status: p.status,
            confidenceScore: "confidenceScore" in p ? p.confidenceScore : 5,
            reasoningQuality: p.reasoningQuality,
            whatHappened: p.whatHappened,
            missReason: p.missReason,
          })),
        );
        value = dq.postmortemRate;
        break;
      }
    }

    return {
      userId,
      userName: user?.displayName ?? "Unknown",
      avatarColor: user?.avatarColor ?? "#888",
      value,
      settledCount: settled.length,
    };
  });

  // Rank: higher value wins; null sinks to the bottom; ties broken by settledCount
  rows.sort((a, b) => {
    if (a.value == null && b.value == null) return b.settledCount - a.settledCount;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    if (a.value !== b.value) return b.value - a.value;
    return b.settledCount - a.settledCount;
  });

  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * Auto-close a challenge whose endDate has passed: compute final standings,
 * record the winner, and seal the row. Idempotent — safe to call repeatedly.
 * Returns the winner info if just closed (or already closed data passed back).
 */
export async function maybeCloseChallenge(
  challenge: {
    id: number;
    metric: string;
    startDate: string;
    endDate: string;
    closedAt: Date | null;
    winnerId: number | null;
    winnerValue: number | null;
  },
  memberIds: number[],
): Promise<{ justClosed: boolean; winnerId: number | null; winnerValue: number | null }> {
  if (challenge.closedAt != null) {
    // Already sealed — return existing winner data
    return { justClosed: false, winnerId: challenge.winnerId, winnerValue: challenge.winnerValue };
  }

  const now = new Date();
  const endDay = new Date(`${challenge.endDate}T00:00:00.000Z`);
  const challengeEnded = now >= new Date(endDay.getTime() + 24 * 60 * 60 * 1000);
  if (!challengeEnded) return { justClosed: false, winnerId: null, winnerValue: null };

  const standings = await computeChallengeStandings(challenge, memberIds);
  const winner = standings.find((s) => s.rank === 1 && s.value != null);

  await db
    .update(crewChallengesTable)
    .set({
      winnerId: winner?.userId ?? null,
      winnerValue: winner?.value ?? null,
      closedAt: now,
    })
    .where(eq(crewChallengesTable.id, challenge.id));

  return { justClosed: true, winnerId: winner?.userId ?? null, winnerValue: winner?.value ?? null };
}
