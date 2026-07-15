/**
 * GET /stats/leak-profile — pre-bet warning signals:
 *   - unauthenticated → 401; foreign userId param → 403
 *   - all signals null below their sample thresholds (no noise for new users)
 *   - avgStake and lastLossAt computed from settled history
 *   - worstSport only when it cost >= $50 across >= 5 bets, skipping
 *     dead-zone odds rows
 *   - overconfidence only when 7+ confidence plays hit under 45% over >= 5
 *   - topMissReason excludes "na" and "normal_variance", needs >= 3
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

let currentClerkUserId: string | null = null;

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers?: Record<string, string | string[] | undefined> }) => ({
    userId: (req?.headers?.["x-test-clerk-id"] as string | undefined) ?? currentClerkUserId,
  }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        primaryEmailAddress: { emailAddress: `${id}@example.com` },
        emailAddresses: [{ emailAddress: `${id}@example.com` }],
        firstName: "Test",
        lastName: "User",
      }),
    },
  },
}));

process.env.BETA_SEAT_LIMIT = "0";

import app from "../app";
import { db, pool, usersTable, betsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createLinkedUser() {
  const username = `leak_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

type BetOverrides = Partial<typeof betsTable.$inferInsert>;

async function seedBet(userId: number, overrides: BetOverrides = {}) {
  await db.insert(betsTable).values({
    userId,
    sport: "NBA",
    event: "A @ B",
    betType: "spread",
    pick: "A -3.5",
    odds: -110,
    stake: "50.00",
    potentialPayout: "95.45",
    actualPayout: overrides.status === "won" ? "95.45" : overrides.status === "push" ? "50.00" : "0.00",
    status: "lost",
    gameDate: "2026-07-01",
    confidenceScore: 5,
    // Default to a settle time inside the 30-day recent window so trend
    // figures are deterministic regardless of the wall clock.
    settledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    ...overrides,
  });
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("GET /stats/leak-profile", () => {
  it("rejects unauthenticated requests and foreign userId params", async () => {
    currentClerkUserId = null;
    const unauth = await request(app).get("/api/stats/leak-profile");
    expect(unauth.status).toBe(401);

    const { clerkUserId } = await createLinkedUser();
    const { user: other } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const foreign = await request(app).get(`/api/stats/leak-profile?userId=${other.id}`);
    expect(foreign.status).toBe(403);
  });

  it("returns all-null signals for a fresh user", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settledCount: 0,
      recentWindowDays: 30,
      avgStake: null,
      lastLossAt: null,
      worstSport: null,
      overconfidence: null,
      topMissReason: null,
      trendFlip: false,
    });
  });

  it("computes avgStake and lastLossAt once the sample is real", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const latest = new Date("2026-07-10T18:00:00Z");
    await seedBet(user.id, { status: "won", stake: "100.00", settledAt: new Date("2026-07-01T00:00:00Z") });
    await seedBet(user.id, { status: "lost", stake: "50.00", settledAt: new Date("2026-07-05T00:00:00Z") });
    await seedBet(user.id, { status: "lost", stake: "50.00", settledAt: latest });
    await seedBet(user.id, { status: "push", stake: "50.00", settledAt: new Date("2026-07-03T00:00:00Z") });
    await seedBet(user.id, { status: "won", stake: "250.00", settledAt: new Date("2026-07-04T00:00:00Z") });

    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.status).toBe(200);
    expect(res.body.settledCount).toBe(5);
    expect(res.body.lastLossAt).toBe(latest.toISOString());
    expect(res.body.avgStake).toBe(100); // (100+50+50+50+250)/5
  });

  it("flags the worst sport only past the $50 / 5-bet thresholds and skips dead-zone odds", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    // 5 NFL losses of $20 each = -$100 net, valid odds
    for (let i = 0; i < 5; i++) {
      await seedBet(user.id, { sport: "NFL", status: "lost", stake: "20.00" });
    }
    // A dead-zone odds NFL loss that must NOT count
    await seedBet(user.id, { sport: "NFL", status: "lost", stake: "500.00", odds: 50 });
    // 4 MLB losses (under sample threshold)
    for (let i = 0; i < 4; i++) {
      await seedBet(user.id, { sport: "MLB", status: "lost", stake: "100.00" });
    }

    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.status).toBe(200);
    expect(res.body.worstSport).toEqual({ sport: "NFL", netLoss: -100, bets: 5, recentNet: -100, recentBets: 5 });
  });

  it("splits the worst sport's damage into recent vs older so the trend is visible", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    // 5 old NFL losses of $30 each = -$150 all-time
    for (let i = 0; i < 5; i++) {
      await seedBet(user.id, { sport: "NFL", status: "lost", stake: "30.00", settledAt: old });
    }
    // One recent NFL win: +$45.45 net inside the window
    await seedBet(user.id, { sport: "NFL", status: "won", stake: "50.00", actualPayout: "95.45" });

    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.status).toBe(200);
    expect(res.body.recentWindowDays).toBe(30);
    expect(res.body.worstSport).toEqual({
      sport: "NFL",
      netLoss: -104.55,
      bets: 6,
      recentNet: 45.45,
      recentBets: 1,
    });
  });

  it("flags overconfidence only when 7+ plays genuinely miss", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    // 5 high-confidence plays: 1 win, 4 losses => 20% hit rate
    await seedBet(user.id, { confidenceScore: 8, status: "won" });
    for (let i = 0; i < 4; i++) {
      await seedBet(user.id, { confidenceScore: 9, status: "lost" });
    }
    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.body.overconfidence).toEqual({ winRate: 20, sample: 5, recentWinRate: 20, recentSample: 5 });

    // A user whose high-confidence plays hit fine gets no flag
    const { user: sharp, clerkUserId: sharpClerk } = await createLinkedUser();
    currentClerkUserId = sharpClerk;
    for (let i = 0; i < 4; i++) {
      await seedBet(sharp.id, { confidenceScore: 8, status: "won" });
    }
    await seedBet(sharp.id, { confidenceScore: 8, status: "lost" });
    const sharpRes = await request(app).get("/api/stats/leak-profile");
    expect(sharpRes.body.overconfidence).toBeNull();
  });

  it("surfaces the top miss reason, ignoring na and normal variance", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    for (let i = 0; i < 3; i++) {
      await seedBet(user.id, { status: "lost", missReason: "emotional", stake: "40.00" });
    }
    await seedBet(user.id, { status: "lost", missReason: "bad_price" });
    for (let i = 0; i < 5; i++) {
      await seedBet(user.id, { status: "lost", missReason: "normal_variance" });
    }
    await seedBet(user.id, { status: "lost", missReason: "na" });

    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.body.topMissReason).toEqual({ reason: "emotional", count: 3, netLoss: 120, recentCount: 3, recentNetLoss: 120 });

    // Below the 3-loss threshold → null
    const { user: fresh, clerkUserId: freshClerk } = await createLinkedUser();
    currentClerkUserId = freshClerk;
    await seedBet(fresh.id, { status: "lost", missReason: "emotional" });
    await seedBet(fresh.id, { status: "lost", missReason: "emotional" });
    const freshRes = await request(app).get("/api/stats/leak-profile");
    expect(freshRes.body.topMissReason).toBeNull();
  });

  describe("trendFlip one-time celebration", () => {
    it("stays false while the reported leak is still bleeding", async () => {
      const { user, clerkUserId } = await createLinkedUser();
      currentClerkUserId = clerkUserId;
      // 5 recent NFL losses — worst sport reported, trend negative
      for (let i = 0; i < 5; i++) {
        await seedBet(user.id, { sport: "NFL", status: "lost", stake: "20.00" });
      }
      const res = await request(app).get("/api/stats/leak-profile");
      expect(res.status).toBe(200);
      expect(res.body.worstSport).not.toBeNull();
      expect(res.body.trendFlip).toBe(false);

      const [row] = await db.select().from(usersTable).where(inArray(usersTable.id, [user.id]));
      expect(row.leakTrendCelebratedAt).toBeNull();
    });

    it("fires exactly once when the worst sport's recent window goes non-negative", async () => {
      const { user, clerkUserId } = await createLinkedUser();
      currentClerkUserId = clerkUserId;
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      // 5 old NFL losses = the leak; one recent NFL win = flipped window
      for (let i = 0; i < 5; i++) {
        await seedBet(user.id, { sport: "NFL", status: "lost", stake: "30.00", settledAt: old });
      }
      await seedBet(user.id, { sport: "NFL", status: "won", stake: "50.00", actualPayout: "95.45" });

      const first = await request(app).get("/api/stats/leak-profile");
      expect(first.status).toBe(200);
      expect(first.body.worstSport.recentNet).toBeGreaterThanOrEqual(0);
      expect(first.body.trendFlip).toBe(true);

      // Persisted per user — the second visit doesn't repeat the celebration
      const second = await request(app).get("/api/stats/leak-profile");
      expect(second.status).toBe(200);
      expect(second.body.trendFlip).toBe(false);

      const [row] = await db.select().from(usersTable).where(inArray(usersTable.id, [user.id]));
      expect(row.leakTrendCelebratedAt).not.toBeNull();
    });

    it("fires when the top miss reason's recent losses hit zero", async () => {
      const { user, clerkUserId } = await createLinkedUser();
      currentClerkUserId = clerkUserId;
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      // 3 old "emotional" losses, none recent → improving miss-reason leak
      for (let i = 0; i < 3; i++) {
        await seedBet(user.id, { status: "lost", missReason: "emotional", stake: "40.00", settledAt: old });
      }
      const res = await request(app).get("/api/stats/leak-profile");
      expect(res.status).toBe(200);
      expect(res.body.worstSport).toBeNull();
      expect(res.body.topMissReason).not.toBeNull();
      expect(res.body.topMissReason.recentCount).toBe(0);
      expect(res.body.trendFlip).toBe(true);
    });

    it("stays false when no leak is reported at all, even with a winning window", async () => {
      const { user, clerkUserId } = await createLinkedUser();
      currentClerkUserId = clerkUserId;
      await seedBet(user.id, { status: "won" });
      const res = await request(app).get("/api/stats/leak-profile");
      expect(res.status).toBe(200);
      expect(res.body.worstSport).toBeNull();
      expect(res.body.topMissReason).toBeNull();
      expect(res.body.overconfidence).toBeNull();
      expect(res.body.trendFlip).toBe(false);

      const [row] = await db.select().from(usersTable).where(inArray(usersTable.id, [user.id]));
      expect(row.leakTrendCelebratedAt).toBeNull();
    });
  });
});
