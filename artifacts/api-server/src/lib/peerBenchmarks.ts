/**
 * Peer benchmarking — platform-wide anonymous percentile computation.
 *
 * The aggregate job queries all opted-in, non-demo users with ≥10 settled
 * plays, computes 5 metrics per user, then upserts the percentile breakpoints
 * (p10/p25/p50/p75/p90) into the platformStatsTable.
 *
 * The job runs lazily: the first call to getOrRefreshPercentiles() after the
 * data ages past REFRESH_DAYS triggers a recompute. No external cron needed.
 *
 * Raw per-user values are never stored or returned — only the population-level
 * breakpoints are persisted.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  betsTable,
  parlaysTable,
  usersTable,
  platformStatsTable,
} from "@workspace/db";
import { dayOf } from "./recap";

const REFRESH_DAYS = 7;
const MIN_SETTLED_PLAYS = 10;

export type BenchmarkMetric =
  | "roi"
  | "win_rate"
  | "calibration"
  | "postmortem_rate"
  | "tilt_frequency";

export const BENCHMARK_METRICS: BenchmarkMetric[] = [
  "roi",
  "win_rate",
  "calibration",
  "postmortem_rate",
  "tilt_frequency",
];

export const METRIC_META: Record<
  BenchmarkMetric,
  { label: string; unit: string; higherIsBetter: boolean }
> = {
  roi: { label: "Overall ROI", unit: "%", higherIsBetter: true },
  win_rate: { label: "Win Rate", unit: "%", higherIsBetter: true },
  calibration: {
    label: "Calibration Score",
    unit: "%",
    higherIsBetter: true,
  },
  postmortem_rate: {
    label: "Post-Mortem Rate",
    unit: "%",
    higherIsBetter: true,
  },
  tilt_frequency: {
    label: "Tilt Frequency",
    unit: "%",
    higherIsBetter: false,
  },
};

/** Compute a single user's metric values from their bet/parlay history. */
async function computeUserMetricValues(
  userId: number,
): Promise<Record<BenchmarkMetric, number | null>> {
  const [bets, parlays] = await Promise.all([
    db
      .select()
      .from(betsTable)
      .where(
        and(
          eq(betsTable.userId, userId),
          inArray(betsTable.status, ["won", "lost", "push"]),
        ),
      ),
    db
      .select()
      .from(parlaysTable)
      .where(
        and(
          eq(parlaysTable.userId, userId),
          inArray(parlaysTable.status, ["won", "lost", "push"]),
        ),
      ),
  ]);

  const settledBets = bets.filter(
    (b) => b.odds > 99 || b.odds < -99 || b.odds === 0,
  );
  // Simpler valid odds filter: exclude dead-zone odds (-99 to +99, not 0)
  const validBets = bets.filter(
    (b) => Math.abs(b.odds) >= 100 || b.odds === 0,
  );
  const validParlays = parlays.filter(
    (p) => Math.abs(p.odds) >= 100 || p.odds === 0,
  );

  const decidedBets = validBets.filter(
    (b) => b.status === "won" || b.status === "lost",
  );
  const wins = decidedBets.filter((b) => b.status === "won").length;
  const losses = decidedBets.filter((b) => b.status === "lost").length;

  // ── ROI ─────────────────────────────────────────────────────────────────
  const betWagered = validBets.reduce((acc, b) => acc + Number(b.stake), 0);
  const betPayout = validBets.reduce(
    (acc, b) => acc + (b.actualPayout != null ? Number(b.actualPayout) : 0),
    0,
  );
  const parlayWagered = validParlays.reduce(
    (acc, p) => acc + Number(p.stake),
    0,
  );
  const parlayPayout = validParlays.reduce(
    (acc, p) => acc + (p.actualPayout != null ? Number(p.actualPayout) : 0),
    0,
  );
  const totalWagered = betWagered + parlayWagered;
  const totalPayout = betPayout + parlayPayout;
  const roi =
    totalWagered > 0
      ? ((totalPayout - totalWagered) / totalWagered) * 100
      : null;

  // ── Win Rate ─────────────────────────────────────────────────────────────
  const winRate =
    wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;

  // ── Calibration ──────────────────────────────────────────────────────────
  // High confidence (7-10) win rate minus low confidence (1-3) win rate.
  // Positive = well-calibrated (high confidence → higher win rate).
  const highConf = validBets.filter(
    (b) =>
      b.confidenceScore >= 7 &&
      (b.status === "won" || b.status === "lost"),
  );
  const lowConf = validBets.filter(
    (b) =>
      b.confidenceScore <= 3 &&
      (b.status === "won" || b.status === "lost"),
  );
  const highWr =
    highConf.length >= 3
      ? (highConf.filter((b) => b.status === "won").length / highConf.length) *
        100
      : null;
  const lowWr =
    lowConf.length >= 3
      ? (lowConf.filter((b) => b.status === "won").length / lowConf.length) *
        100
      : null;
  const calibration =
    highWr != null && lowWr != null ? highWr - lowWr : null;

  // ── Post-Mortem Rate ─────────────────────────────────────────────────────
  // Percentage of settled plays that have a completed post-mortem.
  const allPlays = [
    ...validBets,
    ...validParlays,
  ];
  const reviewed = allPlays.filter(
    (p) =>
      (p as typeof betsTable.$inferSelect).reasoningQuality != null ||
      ((p as typeof betsTable.$inferSelect).missReason != null &&
        (p as typeof betsTable.$inferSelect).missReason !== "na") ||
      ((p as typeof betsTable.$inferSelect).whatHappened != null &&
        ((p as typeof betsTable.$inferSelect).whatHappened as string).trim() !==
          ""),
  ).length;
  const postmortemRate =
    allPlays.length > 0 ? (reviewed / allPlays.length) * 100 : null;

  // ── Tilt Frequency ───────────────────────────────────────────────────────
  // Percentage of betting days that ended with a net loss (money down > 0
  // on that calendar day across bets placed that day by settledAt date).
  // We use settledAt to group by calendar day — a proxy for "session".
  const dayMap = new Map<string, { wagered: number; payout: number }>();
  for (const b of validBets) {
    if (!b.settledAt) continue;
    const day = dayOf(b.settledAt);
    const entry = dayMap.get(day) ?? { wagered: 0, payout: 0 };
    entry.wagered += Number(b.stake);
    entry.payout += b.actualPayout != null ? Number(b.actualPayout) : 0;
    dayMap.set(day, entry);
  }
  const days = [...dayMap.values()];
  const tiltDays = days.filter((d) => d.payout - d.wagered < 0).length;
  const tiltFrequency =
    days.length >= 3 ? (tiltDays / days.length) * 100 : null;

  return { roi, win_rate: winRate, calibration, postmortem_rate: postmortemRate, tilt_frequency: tiltFrequency };
}

/** Compute a percentile value from a sorted (ascending) array of numbers. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Refresh the platform percentile breakpoints across all opted-in real users. */
async function computeAndStorePlatformPercentiles(): Promise<void> {
  // Fetch all opted-in real users
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.isDemo, false),
        eq(usersTable.includedInBenchmarks, true),
      ),
    );

  // Compute each user's metric values
  const allValues: Record<BenchmarkMetric, number[]> = {
    roi: [],
    win_rate: [],
    calibration: [],
    postmortem_rate: [],
    tilt_frequency: [],
  };

  for (const user of users) {
    const vals = await computeUserMetricValues(user.id);
    // Count total settled plays for this user to enforce the minimum threshold
    const [betsCount, parlaysCount] = await Promise.all([
      db
        .select({ count: betsTable.id })
        .from(betsTable)
        .where(
          and(
            eq(betsTable.userId, user.id),
            inArray(betsTable.status, ["won", "lost", "push"]),
          ),
        ),
      db
        .select({ count: parlaysTable.id })
        .from(parlaysTable)
        .where(
          and(
            eq(parlaysTable.userId, user.id),
            inArray(parlaysTable.status, ["won", "lost", "push"]),
          ),
        ),
    ]);
    const totalSettled =
      betsCount.length + parlaysCount.length;
    if (totalSettled < MIN_SETTLED_PLAYS) continue;

    for (const metric of BENCHMARK_METRICS) {
      const v = vals[metric];
      if (v != null && isFinite(v)) allValues[metric].push(v);
    }
  }

  // Compute percentile breakpoints for each metric and upsert
  const now = new Date();
  for (const metric of BENCHMARK_METRICS) {
    const sorted = [...allValues[metric]].sort((a, b) => a - b);
    const sampleSize = sorted.length;
    if (sampleSize === 0) continue;

    await db
      .insert(platformStatsTable)
      .values({
        metric,
        p10: percentile(sorted, 10),
        p25: percentile(sorted, 25),
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p90: percentile(sorted, 90),
        sampleSize,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: platformStatsTable.metric,
        set: {
          p10: percentile(sorted, 10),
          p25: percentile(sorted, 25),
          p50: percentile(sorted, 50),
          p75: percentile(sorted, 75),
          p90: percentile(sorted, 90),
          sampleSize,
          computedAt: now,
        },
      });
  }
}

/** Get the current percentile breakpoints, refreshing them if stale (>7 days). */
export async function getOrRefreshPercentiles(): Promise<
  Map<BenchmarkMetric, typeof platformStatsTable.$inferSelect>
> {
  const existing = await db.select().from(platformStatsTable);

  const staleCutoff = new Date(
    Date.now() - REFRESH_DAYS * 24 * 60 * 60 * 1000,
  );
  const isStale =
    existing.length === 0 ||
    existing.some((r) => r.computedAt < staleCutoff);

  if (isStale) {
    await computeAndStorePlatformPercentiles();
    // Re-fetch after refresh
    const fresh = await db.select().from(platformStatsTable);
    return new Map(fresh.map((r) => [r.metric as BenchmarkMetric, r]));
  }

  return new Map(existing.map((r) => [r.metric as BenchmarkMetric, r]));
}

/** Determine which percentile band a value falls into for a given set of breakpoints. */
export function computeBand(
  value: number,
  metric: BenchmarkMetric,
  bp: typeof platformStatsTable.$inferSelect,
): "top_10" | "top_25" | "median" | "bottom_25" | "bottom_10" {
  const higherIsBetter = METRIC_META[metric].higherIsBetter;

  if (higherIsBetter) {
    if (value >= bp.p90) return "top_10";
    if (value >= bp.p75) return "top_25";
    if (value >= bp.p25) return "median";
    if (value >= bp.p10) return "bottom_25";
    return "bottom_10";
  } else {
    // For lower-is-better metrics (tilt_frequency), invert the band
    if (value <= bp.p10) return "top_10";
    if (value <= bp.p25) return "top_25";
    if (value <= bp.p75) return "median";
    if (value <= bp.p90) return "bottom_25";
    return "bottom_10";
  }
}

/** Estimate percentile rank (0–100) for a value given the breakpoints.
 *
 * For higher-is-better metrics (ROI, win rate, etc.):
 *   p10 anchor → rank 10, p90 anchor → rank 90. Monotonically increases.
 *
 * For lower-is-better metrics (tilt_frequency):
 *   p10 (population's lowest/best value) → rank 90; p90 (worst) → rank 10.
 *   Rank decreases as value increases — uses anchors (p10→90, p25→75, … p90→10).
 *
 * Edge cases:
 *   - Collapsed distribution (all breakpoints equal): returns the median rank (50).
 *   - Tied adjacent segments (v1 === v0): segment is skipped so no division-by-zero.
 *   - Values at the boundary of the first/last breakpoint fall into the interpolation
 *     loop rather than being clamped by a `<=` short-circuit.
 */
export function estimatePercentile(
  value: number,
  metric: BenchmarkMetric,
  bp: typeof platformStatsTable.$inferSelect,
): number {
  const higherIsBetter = METRIC_META[metric].higherIsBetter;

  // Collapsed distribution — all breakpoints are the same value.
  // Return median rank rather than silently pushing the user to an extreme.
  if (bp.p10 === bp.p90) return 50;

  // Build (value_anchor, rank_anchor) pairs.
  // For higher-is-better the rank increases with value; for lower-is-better it decreases.
  const points: [number, number][] = higherIsBetter
    ? [
        [bp.p10, 10],
        [bp.p25, 25],
        [bp.p50, 50],
        [bp.p75, 75],
        [bp.p90, 90],
      ]
    : [
        [bp.p10, 90], // best (lowest) value → highest rank
        [bp.p25, 75],
        [bp.p50, 50],
        [bp.p75, 25],
        [bp.p90, 10], // worst (highest) value → lowest rank
      ];

  // Beyond the extreme breakpoints — use strict inequalities so values exactly
  // at p10 or p90 still fall into the interpolation loop below.
  if (value < bp.p10) return higherIsBetter ? 5 : 95;
  if (value > bp.p90) return higherIsBetter ? 95 : 5;

  for (let i = 0; i < points.length - 1; i++) {
    const [v0, p0] = points[i];
    const [v1, p1] = points[i + 1];
    // Skip tied segments to avoid division-by-zero (NaN).
    if (v1 === v0) continue;
    if (value >= v0 && value <= v1) {
      const frac = (value - v0) / (v1 - v0);
      // Works for both directions: p0 < p1 (higher-is-better) and p0 > p1 (lower-is-better).
      return Math.round(p0 + frac * (p1 - p0));
    }
  }
  return 50;
}

/** Compute the full peer benchmark response for a single user. */
export async function buildPeerBenchmarks(userId: number): Promise<{
  sampleSize: number;
  computedAt: string | null;
  benchmarks: Array<{
    metric: BenchmarkMetric;
    label: string;
    userValue: number | null;
    percentile: number | null;
    band: string | null;
    breakpoints: { p10: number; p25: number; p50: number; p75: number; p90: number };
    unit: string;
    higherIsBetter: boolean;
  }>;
}> {
  const [bpMap, userVals] = await Promise.all([
    getOrRefreshPercentiles(),
    computeUserMetricValues(userId),
  ]);

  // Top-level sampleSize and computedAt reflect the overall population snapshot
  // (take the most recent computedAt across all stored metrics).
  let sampleSize = 0;
  let computedAt: string | null = null;
  for (const row of bpMap.values()) {
    if (row.sampleSize > sampleSize) sampleSize = row.sampleSize;
    const ts = row.computedAt.toISOString();
    if (computedAt === null || ts > computedAt) computedAt = ts;
  }

  const benchmarks = BENCHMARK_METRICS.map((metric) => {
    const bp = bpMap.get(metric);
    const meta = METRIC_META[metric];
    const userValue = userVals[metric] ?? null;

    // Use metric-specific sample size so each metric's sufficiency is judged
    // against the pool that actually contributed to its breakpoints, not a
    // global count that could belong to a different metric.
    const metricSampleSize = bp?.sampleSize ?? 0;

    if (!bp || metricSampleSize < 5) {
      return {
        metric,
        label: meta.label,
        userValue,
        percentile: null,
        band: null,
        breakpoints: bp
          ? { p10: bp.p10, p25: bp.p25, p50: bp.p50, p75: bp.p75, p90: bp.p90 }
          : { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        unit: meta.unit,
        higherIsBetter: meta.higherIsBetter,
      };
    }

    const band = userValue != null ? computeBand(userValue, metric, bp) : null;
    const pctile =
      userValue != null ? estimatePercentile(userValue, metric, bp) : null;

    return {
      metric,
      label: meta.label,
      userValue: userValue != null ? Math.round(userValue * 10) / 10 : null,
      percentile: pctile,
      band,
      breakpoints: { p10: bp.p10, p25: bp.p25, p50: bp.p50, p75: bp.p75, p90: bp.p90 },
      unit: meta.unit,
      higherIsBetter: meta.higherIsBetter,
    };
  });

  return { sampleSize, computedAt, benchmarks };
}
