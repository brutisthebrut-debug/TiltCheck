import { pgTable, serial, text, real, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Platform-wide percentile breakpoints for peer benchmarking.
 *
 * One row per metric; upserted by the aggregate job (triggered lazily when the
 * peer-benchmarks endpoint is called and the data is >7 days old). Only
 * opted-in, non-demo users with ≥10 settled plays are included in the sample.
 *
 * Metrics: "roi" | "win_rate" | "calibration" | "postmortem_rate" | "tilt_frequency"
 */
export const platformStatsTable = pgTable(
  "platform_stats",
  {
    id: serial("id").primaryKey(),
    /** Which metric these breakpoints belong to. */
    metric: text("metric").notNull(),
    /** 10th percentile (bottom 10%). */
    p10: real("p10").notNull(),
    /** 25th percentile (bottom quartile). */
    p25: real("p25").notNull(),
    /** 50th percentile (median). */
    p50: real("p50").notNull(),
    /** 75th percentile (top quartile). */
    p75: real("p75").notNull(),
    /** 90th percentile (top 10%). */
    p90: real("p90").notNull(),
    /** Number of users included in this computation. */
    sampleSize: integer("sample_size").notNull(),
    /** When this row was last computed. */
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_stats_metric_unique").on(t.metric)],
);

export type PlatformStat = typeof platformStatsTable.$inferSelect;
