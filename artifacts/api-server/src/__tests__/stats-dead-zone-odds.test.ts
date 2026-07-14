/**
 * Legacy rows saved before the dead-zone odds guard may carry American odds
 * between -99 and +99 — prices that don't exist. Their payout figures are
 * nonsense, so stats endpoints must exclude them from all math rather than
 * average garbage into ROI, win rate, and avgOdds.
 *
 * These tests insert corrupted rows directly into the database (the API can
 * no longer create them) and prove /stats/summary, /stats/by-sport, and
 * /stats/confidence-analysis all skip them while still counting valid rows.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

let currentClerkUserId: string | null = null;

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: currentClerkUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: null,
        emailAddresses: [],
        firstName: null,
        lastName: null,
      }),
    },
  },
}));

import app from "../app";
import { db, pool, usersTable, betsTable, parlaysTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(startingBankroll = 1000) {
  const username = `test_statsdz_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Test User",
      avatarColor: "#6366f1",
      startingBankroll: String(startingBankroll),
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return row;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

function betRow(userId: number, odds: number, status: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    sport: "NBA",
    event: `Event odds ${odds}`,
    betType: "moneyline",
    pick: "Home",
    odds,
    stake: "100",
    potentialPayout: "200.00",
    gameDate: "2026-07-01",
    confidenceScore: 5,
    status,
    actualPayout: status === "won" ? "200.00" : status === "lost" ? "0.00" : null,
    settledAt: status === "pending" ? null : new Date("2026-07-02T00:00:00Z"),
    ...overrides,
  };
}

describe("stats endpoints exclude legacy dead-zone odds rows", () => {
  it("summary skips corrupted bets and parlays in every aggregate", async () => {
    const user = await createUser();
    await db.insert(betsTable).values([
      // valid: one win at +150, one loss at -110
      betRow(user.id, 150, "won", { actualPayout: "250.00", potentialPayout: "250.00" }),
      betRow(user.id, -110, "lost"),
      // corrupted legacy rows: dead-zone odds with absurd payouts
      betRow(user.id, 50, "won", { actualPayout: "5000.00", potentialPayout: "5000.00" }),
      betRow(user.id, 0, "pending", { actualPayout: null }),
    ]);
    await db.insert(parlaysTable).values([
      {
        userId: user.id,
        name: "Corrupt legacy parlay",
        stake: "50",
        odds: 20, // dead zone
        potentialPayout: "9999.00",
        status: "won",
        actualPayout: "9999.00",
        confidenceScore: 5,
        settledAt: new Date("2026-07-02T00:00:00Z"),
      },
    ]);

    const res = await request(app).get(`/api/stats/summary?userId=${user.id}`);
    expect(res.status).toBe(200);
    // Only the 2 valid bets count (no corrupted bet, pending corrupted bet, or corrupted parlay)
    expect(res.body.totalBets).toBe(2);
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(1);
    expect(res.body.pending).toBe(0);
    expect(res.body.totalWagered).toBe(200);
    // profit = (250 - 100) + (0 - 100) = 50; the fake 4900 and 9949 profits must not appear
    expect(res.body.totalProfit).toBe(50);
    expect(res.body.roi).toBe(25);
    // avgOdds over valid bets only: (150 + -110) / 2 = 20
    expect(res.body.avgOdds).toBe(20);
    expect(res.body.parlayRecord).toEqual({ wins: 0, losses: 0, pushes: 0 });
    expect(res.body.bestBetProfit).toBe(150);
  });

  it("by-sport skips corrupted bets", async () => {
    const user = await createUser();
    await db.insert(betsTable).values([
      betRow(user.id, 150, "won", { actualPayout: "250.00" }),
      betRow(user.id, 99, "won", { actualPayout: "8000.00" }), // corrupted
    ]);

    const res = await request(app).get(`/api/stats/by-sport?userId=${user.id}`);
    expect(res.status).toBe(200);
    const nba = res.body.find((r: { sport: string }) => r.sport === "NBA");
    expect(nba.wins).toBe(1);
    expect(nba.totalWagered).toBe(100);
    expect(nba.profit).toBe(150);
  });

  it("confidence-analysis skips corrupted bets", async () => {
    const user = await createUser();
    await db.insert(betsTable).values([
      betRow(user.id, 200, "won", { actualPayout: "300.00", confidenceScore: 5 }),
      betRow(user.id, -50, "lost", { confidenceScore: 5 }), // corrupted
    ]);

    const res = await request(app).get(`/api/stats/confidence-analysis?userId=${user.id}`);
    expect(res.status).toBe(200);
    const bucket = res.body.find((b: { confidenceRange: string }) => b.confidenceRange === "4-6");
    expect(bucket.totalBets).toBe(1);
    expect(bucket.wins).toBe(1);
    expect(bucket.avgOdds).toBe(200);
  });
});
