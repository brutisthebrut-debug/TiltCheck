/**
 * Integration tests for American odds validation on bets and parlay legs.
 *
 * American odds are never between -99 and +99 (0, +50, -20 are not real
 * prices). Values in that dead zone would feed americanToDecimal and produce
 * nonsense payouts that corrupt potential-payout and ROI figures. These
 * tests prove:
 *   1. POST /api/bets rejects odds of 0, +50, and -99 with a 400.
 *   2. PATCH /api/bets/:id rejects dead-zone odds with a 400.
 *   3. POST /api/parlays rejects any leg with dead-zone odds with a 400.
 *   4. Boundary values -100 and +100 are accepted everywhere.
 *
 * Each test creates its own isolated user; all rows are removed in afterAll.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

// Identity is derived from the Clerk session; tests control it via this
// variable, mirroring the pattern in stake-validation.test.ts.
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

async function createUser(startingBankroll = 1000) {
  const username = `test_odds_${Date.now()}_${counter++}`;
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

function betPayload(odds: number) {
  return {
    sport: "NBA",
    event: "Lakers vs Celtics",
    betType: "moneyline",
    pick: "Lakers ML",
    odds,
    stake: 50,
    gameDate: "2026-07-20",
    confidenceScore: 7,
  };
}

function parlayPayload(legOdds: number[]) {
  return {
    name: "Test Parlay",
    stake: 25,
    confidenceScore: 6,
    legs: legOdds.map((odds, i) => ({
      sport: "NBA",
      event: `Game ${i + 1}`,
      betType: "moneyline",
      pick: `Pick ${i + 1}`,
      odds,
      gameDate: "2026-07-20",
    })),
  };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    const parlayIds = parlays.map((p) => p.id);
    if (parlayIds.length > 0) {
      await db.delete(parlayLegsTable).where(inArray(parlayLegsTable.parlayId, parlayIds));
      await db.delete(parlaysTable).where(inArray(parlaysTable.id, parlayIds));
    }
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("POST /api/bets odds validation", () => {
  it.each([0, 50, -99, 99, -1])("rejects dead-zone odds %d with a 400", async (odds) => {
    await createUser();
    const res = await request(app).post("/api/bets").send(betPayload(odds));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/American odds/i);
  });

  it.each([100, -100, 150, -110])("accepts valid odds %d", async (odds) => {
    await createUser();
    const res = await request(app).post("/api/bets").send(betPayload(odds));
    expect(res.status).toBe(201);
    expect(res.body.odds).toBe(odds);
  });
});

describe("PATCH /api/bets/:id odds validation", () => {
  it("rejects updating a bet's odds into the dead zone", async () => {
    await createUser();
    const created = await request(app).post("/api/bets").send(betPayload(-110));
    expect(created.status).toBe(201);

    for (const odds of [0, 50, -99]) {
      const res = await request(app).patch(`/api/bets/${created.body.id}`).send({ odds });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/American odds/i);
    }

    // Bet is unchanged
    const fetched = await request(app).get(`/api/bets/${created.body.id}`);
    expect(fetched.body.odds).toBe(-110);
  });

  it("accepts updating odds to boundary values ±100", async () => {
    await createUser();
    const created = await request(app).post("/api/bets").send(betPayload(-110));
    expect(created.status).toBe(201);

    const resPlus = await request(app).patch(`/api/bets/${created.body.id}`).send({ odds: 100 });
    expect(resPlus.status).toBe(200);
    expect(resPlus.body.odds).toBe(100);

    const resMinus = await request(app).patch(`/api/bets/${created.body.id}`).send({ odds: -100 });
    expect(resMinus.status).toBe(200);
    expect(resMinus.body.odds).toBe(-100);
  });
});

describe("POST /api/parlays leg odds validation", () => {
  it.each([0, 50, -99])("rejects a parlay whose leg has dead-zone odds %d", async (odds) => {
    await createUser();
    const res = await request(app).post("/api/parlays").send(parlayPayload([-110, odds]));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/American odds/i);
  });

  it("accepts a parlay with boundary odds ±100", async () => {
    await createUser();
    const res = await request(app).post("/api/parlays").send(parlayPayload([100, -100]));
    expect(res.status).toBe(201);
    expect(res.body.legs).toHaveLength(2);
  });
});
