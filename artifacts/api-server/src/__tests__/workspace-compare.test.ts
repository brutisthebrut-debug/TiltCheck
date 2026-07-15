/**
 * /workspace/compare must use the SAME math rules as the leaderboard so the
 * head-to-head panel can never disagree with the rankings:
 *  - settled parlays count in the money math (wagered/profit/ROI)
 *  - dead-zone-odds rows are excluded
 *  - the period window (week/month/all) filters on settledAt
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
import { db, pool, usersTable, betsTable, parlaysTable, parlayLegsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName: string) {
  const username = `test_cmp_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName,
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return row;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    const parlayIds = (
      await db.select({ id: parlaysTable.id }).from(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds))
    ).map((p) => p.id);
    if (parlayIds.length > 0) {
      await db.delete(parlayLegsTable).where(inArray(parlayLegsTable.parlayId, parlayIds));
    }
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
    event: `Event ${counter++}`,
    betType: "moneyline",
    pick: "Home",
    odds,
    stake: "100",
    potentialPayout: "200.00",
    gameDate: "2026-07-01",
    confidenceScore: 5,
    status,
    actualPayout: status === "won" ? "200.00" : status === "lost" ? "0.00" : null,
    settledAt: status === "pending" ? null : new Date(),
    ...overrides,
  };
}

type CompareRow = {
  userId: number;
  wins: number;
  losses: number;
  roi: number;
  totalProfit: number;
  totalBets: number;
};

async function fetchMine(ids: number[], period?: string): Promise<CompareRow[]> {
  const res = await request(app).get(`/api/workspace/compare${period ? `?period=${period}` : ""}`);
  expect(res.status).toBe(200);
  return (res.body as CompareRow[]).filter((r) => ids.includes(r.userId));
}

describe("GET /workspace/compare", () => {
  it("includes settled parlays in the money math", async () => {
    const user = await createUser("ParlayPlayer");

    // One lost straight bet (-100) and one won parlay (+150 profit).
    await db.insert(betsTable).values([betRow(user.id, -110, "lost")]);
    const [parlay] = await db
      .insert(parlaysTable)
      .values({
        userId: user.id,
        name: "Compare Parlay",
        stake: "50",
        odds: 300,
        potentialPayout: "200.00",
        confidenceScore: 6,
        status: "won",
        actualPayout: "200.00",
        settledAt: new Date(),
      })
      .returning();
    await db.insert(parlayLegsTable).values([
      { parlayId: parlay.id, sport: "NBA", event: "G1", betType: "moneyline", pick: "A", odds: 100, gameDate: "2026-07-14", status: "won" },
      { parlayId: parlay.id, sport: "NFL", event: "G2", betType: "spread", pick: "B", odds: 100, gameDate: "2026-07-14", status: "won" },
    ]);

    const [row] = await fetchMine([user.id]);
    // wagered 150, payout 200 -> profit +50
    expect(row.totalProfit).toBeCloseTo(50, 2);
    expect(row.wins).toBe(1);
    expect(row.losses).toBe(1);
    expect(row.roi).toBeCloseTo((50 / 150) * 100, 1);
  });

  it("excludes dead-zone-odds rows from the math", async () => {
    const user = await createUser("DeadZone");
    await db.insert(betsTable).values([
      betRow(user.id, -110, "won"), // +100
      betRow(user.id, 50, "won"),   // dead zone — must not count
    ]);
    const [row] = await fetchMine([user.id]);
    expect(row.wins).toBe(1);
    expect(row.totalProfit).toBeCloseTo(100, 2);
  });

  it("honors the period window on settledAt", async () => {
    const user = await createUser("Windowed");
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await db.insert(betsTable).values([
      betRow(user.id, -110, "won"), // settled now: +100
      betRow(user.id, -110, "lost", { settledAt: old }), // settled 40 days ago: -100
    ]);

    const [week] = await fetchMine([user.id], "week");
    expect(week.wins).toBe(1);
    expect(week.losses).toBe(0);
    expect(week.totalProfit).toBeCloseTo(100, 2);

    const [all] = await fetchMine([user.id], "all");
    expect(all.wins).toBe(1);
    expect(all.losses).toBe(1);
    expect(all.totalProfit).toBeCloseTo(0, 2);
  });
});
