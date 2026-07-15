/**
 * GET /stats/edge-finder — settled straight bets sliced into lanes:
 *   - unauthenticated → 401; foreign userId param → 403
 *   - empty lanes and null avgStake for a fresh user
 *   - dead-zone odds rows excluded from every lane
 *   - fav/dog and odds-band keys derived from the odds sign/magnitude
 *   - day-of-week lanes keyed from the game date (UTC)
 *   - stake bands drawn relative to the bettor's own average stake
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
  const username = `edge_${Date.now()}_${counter++}`;
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
  const status = overrides.status ?? "lost";
  await db.insert(betsTable).values({
    userId,
    sport: "NBA",
    event: "A @ B",
    betType: "spread",
    pick: "A -3.5",
    odds: -110,
    stake: "50.00",
    potentialPayout: "95.45",
    actualPayout: status === "won" ? "95.45" : status === "push" ? "50.00" : "0.00",
    status,
    gameDate: "2026-07-01",
    confidenceScore: 5,
    settledAt: new Date("2026-07-02T00:00:00Z"),
    ...overrides,
  });
}

type Lane = {
  key: string;
  wins: number;
  losses: number;
  pushes: number;
  bets: number;
  wagered: number;
  netProfit: number;
  roi: number;
};

const lane = (lanes: Lane[], key: string) => lanes.find((l) => l.key === key);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("GET /stats/edge-finder", () => {
  it("rejects unauthenticated requests and foreign userId params", async () => {
    currentClerkUserId = null;
    const unauth = await request(app).get("/api/stats/edge-finder");
    expect(unauth.status).toBe(401);

    const { clerkUserId } = await createLinkedUser();
    const { user: other } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const foreign = await request(app).get(`/api/stats/edge-finder?userId=${other.id}`);
    expect(foreign.status).toBe(403);
  });

  it("returns empty lanes and null avgStake for a fresh user", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/stats/edge-finder");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settledCount: 0,
      minSample: 5,
      avgStake: null,
      sport: [],
      favDog: [],
      oddsBand: [],
      dayOfWeek: [],
      stakeBand: [],
    });
  });

  it("aggregates sport lanes with record, money and ROI, skipping dead-zone odds", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    // NBA: 2 wins, 1 loss at -110 / $50 → payout 95.45 each win
    await seedBet(user.id, { sport: "NBA", status: "won" });
    await seedBet(user.id, { sport: "NBA", status: "won" });
    await seedBet(user.id, { sport: "NBA", status: "lost" });
    // NFL: 1 push
    await seedBet(user.id, { sport: "NFL", status: "push" });
    // Dead-zone odds row must not appear anywhere
    await seedBet(user.id, { sport: "MLB", status: "lost", odds: 50, stake: "500.00" });

    const res = await request(app).get("/api/stats/edge-finder");
    expect(res.status).toBe(200);
    expect(res.body.settledCount).toBe(4);

    const nba = lane(res.body.sport, "NBA")!;
    expect(nba).toMatchObject({ wins: 2, losses: 1, pushes: 0, bets: 3, wagered: 150 });
    expect(nba.netProfit).toBeCloseTo(2 * 95.45 - 150, 2); // 40.90
    expect(nba.roi).toBeCloseTo((nba.netProfit / 150) * 100, 1);

    const nfl = lane(res.body.sport, "NFL")!;
    expect(nfl).toMatchObject({ wins: 0, losses: 0, pushes: 1, bets: 1, netProfit: 0 });

    expect(lane(res.body.sport, "MLB")).toBeUndefined();
  });

  it("derives fav/dog and odds-band lanes from the odds", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    await seedBet(user.id, { odds: -250, status: "won", actualPayout: "70.00" }); // heavy_fav
    await seedBet(user.id, { odds: -110, status: "lost" }); // fav
    await seedBet(user.id, { odds: 150, status: "lost" }); // dog
    await seedBet(user.id, { odds: 200, status: "won", actualPayout: "150.00" }); // long_shot (boundary)

    const res = await request(app).get("/api/stats/edge-finder");
    expect(res.status).toBe(200);

    expect(lane(res.body.favDog, "favorite")).toMatchObject({ bets: 2, wins: 1, losses: 1 });
    expect(lane(res.body.favDog, "underdog")).toMatchObject({ bets: 2, wins: 1, losses: 1 });

    expect(lane(res.body.oddsBand, "heavy_fav")).toMatchObject({ bets: 1, wins: 1 });
    expect(lane(res.body.oddsBand, "fav")).toMatchObject({ bets: 1, losses: 1 });
    expect(lane(res.body.oddsBand, "dog")).toMatchObject({ bets: 1, losses: 1 });
    expect(lane(res.body.oddsBand, "long_shot")).toMatchObject({ bets: 1, wins: 1 });
  });

  it("keys day-of-week lanes from the game date in UTC", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    await seedBet(user.id, { gameDate: "2026-07-06", status: "won" }); // Monday
    await seedBet(user.id, { gameDate: "2026-07-06", status: "lost" }); // Monday
    await seedBet(user.id, { gameDate: "2026-07-12", status: "lost" }); // Sunday

    const res = await request(app).get("/api/stats/edge-finder");
    expect(lane(res.body.dayOfWeek, "mon")).toMatchObject({ bets: 2, wins: 1, losses: 1 });
    expect(lane(res.body.dayOfWeek, "sun")).toMatchObject({ bets: 1, losses: 1 });
    // Fixed ordering: monday lane comes before sunday
    const keys = res.body.dayOfWeek.map((l: { key: string }) => l.key);
    expect(keys.indexOf("mon")).toBeLessThan(keys.indexOf("sun"));
  });

  it("draws stake bands relative to the bettor's average stake", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    // Stakes: 20, 100, 100, 100, 180 → avg 100
    // light < 75, standard 75..150, heavy > 150
    await seedBet(user.id, { stake: "20.00", status: "lost" });
    await seedBet(user.id, { stake: "100.00", status: "lost" });
    await seedBet(user.id, { stake: "100.00", status: "lost" });
    await seedBet(user.id, { stake: "100.00", status: "lost" });
    await seedBet(user.id, { stake: "180.00", status: "lost" });

    const res = await request(app).get("/api/stats/edge-finder");
    expect(res.body.avgStake).toBe(100);
    expect(lane(res.body.stakeBand, "light")).toMatchObject({ bets: 1, wagered: 20 });
    expect(lane(res.body.stakeBand, "standard")).toMatchObject({ bets: 3, wagered: 300 });
    expect(lane(res.body.stakeBand, "heavy")).toMatchObject({ bets: 1, wagered: 180 });
  });
});
