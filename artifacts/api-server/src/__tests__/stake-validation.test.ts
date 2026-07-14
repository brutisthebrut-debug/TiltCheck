/**
 * Integration tests for stake validation on bets and parlays.
 *
 * `stake` must be strictly positive (and below a sane cap) so negative or
 * zero stakes can never produce nonsensical payouts or corrupt bankroll
 * ledger math. These tests prove:
 *   1. POST /api/bets and POST /api/parlays reject stake <= 0 with a 400.
 *   2. PATCH /api/bets/:id and PATCH /api/parlays/:id reject stake <= 0.
 *   3. Absurdly large stakes (over the 1,000,000 cap) are rejected.
 *   4. Valid positive stakes still work.
 *
 * Each test creates its own isolated user; all rows are removed in afterAll.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

// Identity is derived from the Clerk session; tests control it via this
// variable, mirroring the pattern in settlement.test.ts.
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
  const username = `test_stake_${Date.now()}_${counter++}`;
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

function betBody(stake: number) {
  return {
    sport: "NBA",
    event: "Lakers vs Celtics",
    betType: "moneyline",
    pick: "Lakers ML",
    odds: -110,
    stake,
    gameDate: "2026-07-20",
    confidenceScore: 7,
  };
}

function parlayBody(stake: number) {
  return {
    name: "Test parlay",
    stake,
    confidenceScore: 6,
    legs: [
      {
        sport: "NBA",
        event: "Lakers vs Celtics",
        betType: "moneyline",
        pick: "Lakers ML",
        odds: -110,
        gameDate: "2026-07-20",
      },
      {
        sport: "NFL",
        event: "Chiefs vs Bills",
        betType: "spread",
        pick: "Chiefs -3",
        odds: -105,
        gameDate: "2026-07-21",
      },
    ],
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

describe("stake validation on bet creation", () => {
  it("rejects a zero stake with 400", async () => {
    await createUser();
    const res = await request(app).post("/api/bets").send(betBody(0));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stake/i);
  });

  it("rejects a negative stake with 400", async () => {
    await createUser();
    const res = await request(app).post("/api/bets").send(betBody(-50));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stake/i);
  });

  it("rejects a stake over the cap with 400", async () => {
    await createUser();
    const res = await request(app).post("/api/bets").send(betBody(1000001));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stake/i);
  });

  it("accepts a valid positive stake", async () => {
    await createUser();
    const res = await request(app).post("/api/bets").send(betBody(25));
    expect(res.status).toBe(201);
    expect(res.body.stake).toBe(25);
  });
});

describe("stake validation on bet update", () => {
  it("rejects updating a bet to a non-positive stake", async () => {
    await createUser();
    const created = await request(app).post("/api/bets").send(betBody(25));
    expect(created.status).toBe(201);

    const zero = await request(app).patch(`/api/bets/${created.body.id}`).send({ stake: 0 });
    expect(zero.status).toBe(400);

    const negative = await request(app).patch(`/api/bets/${created.body.id}`).send({ stake: -10 });
    expect(negative.status).toBe(400);

    // Bet unchanged
    const fetched = await request(app).get(`/api/bets/${created.body.id}`);
    expect(fetched.body.stake).toBe(25);
  });
});

describe("stake validation on parlay creation", () => {
  it("rejects a zero stake with 400", async () => {
    await createUser();
    const res = await request(app).post("/api/parlays").send(parlayBody(0));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stake/i);
  });

  it("rejects a negative stake with 400", async () => {
    await createUser();
    const res = await request(app).post("/api/parlays").send(parlayBody(-5));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stake/i);
  });

  it("accepts a valid positive stake", async () => {
    await createUser();
    const res = await request(app).post("/api/parlays").send(parlayBody(10));
    expect(res.status).toBe(201);
    expect(res.body.stake).toBe(10);
  });
});

describe("stake validation on parlay update", () => {
  it("rejects updating a parlay to a non-positive stake", async () => {
    await createUser();
    const created = await request(app).post("/api/parlays").send(parlayBody(10));
    expect(created.status).toBe(201);

    const zero = await request(app).patch(`/api/parlays/${created.body.id}`).send({ stake: 0 });
    expect(zero.status).toBe(400);

    const negative = await request(app)
      .patch(`/api/parlays/${created.body.id}`)
      .send({ stake: -1 });
    expect(negative.status).toBe(400);

    const fetched = await request(app).get(`/api/parlays/${created.body.id}`);
    expect(fetched.body.stake).toBe(10);
  });
});
