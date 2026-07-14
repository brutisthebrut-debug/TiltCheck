/**
 * Integration tests for gameDate validation on single bets.
 *
 * The parlay route already has coverage for malformed / impossible dates
 * (parlay-creation.test.ts); these tests prove POST /api/bets and
 * PATCH /api/bets/:id give the same friendly 400 rejection:
 *   1. POST with a malformed gameDate ("not-a-date") → 400, no row written.
 *   2. POST with an impossible calendar date ("2026-02-31") → 400, no row.
 *   3. PATCH with a malformed gameDate → 400, existing row unchanged.
 *   4. PATCH with an impossible calendar date → 400, existing row unchanged.
 *
 * Each test creates its own isolated user; all rows are removed in afterAll.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

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
import { db, pool, usersTable, betsTable, transactionsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

/** Creates an isolated test user directly in the DB and acts as them. */
async function createUser(startingBankroll = 1000) {
  const username = `test_betdate_${Date.now()}_${counter++}`;
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
  return { id: row.id, clerkUserId };
}

beforeAll(async () => {
  await createUser(1000);
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db
      .delete(transactionsTable)
      .where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

const validBet = {
  sport: "NBA",
  event: "Lakers vs Celtics",
  betType: "moneyline",
  pick: "Lakers",
  odds: 150,
  stake: 25,
  gameDate: "2026-07-14",
  confidenceScore: 7,
};

describe("POST /api/bets gameDate validation", () => {
  it("rejects a malformed gameDate ('not-a-date') with a 400 and writes no row", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/bets")
      .send({ ...validBet, gameDate: "not-a-date" });
    expect(res.status).toBe(400);

    const rows = await db.select().from(betsTable).where(eq(betsTable.userId, user.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects an impossible calendar date ('2026-02-31') with a 400 and a clear message", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/bets")
      .send({ ...validBet, gameDate: "2026-02-31" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("gameDate");

    const rows = await db.select().from(betsTable).where(eq(betsTable.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});

describe("PATCH /api/bets/:id gameDate validation", () => {
  it("rejects a malformed gameDate ('not-a-date') with a 400 and leaves the bet unchanged", async () => {
    await createUser();

    const created = await request(app).post("/api/bets").send(validBet);
    expect(created.status).toBe(201);
    const betId = created.body.id;

    const res = await request(app)
      .patch(`/api/bets/${betId}`)
      .send({ gameDate: "not-a-date" });
    expect(res.status).toBe(400);

    const [row] = await db.select().from(betsTable).where(eq(betsTable.id, betId));
    expect(row.gameDate).toBe(validBet.gameDate);
  });

  it("rejects an impossible calendar date ('2026-02-31') with a 400 and leaves the bet unchanged", async () => {
    await createUser();

    const created = await request(app).post("/api/bets").send(validBet);
    expect(created.status).toBe(201);
    const betId = created.body.id;

    const res = await request(app)
      .patch(`/api/bets/${betId}`)
      .send({ gameDate: "2026-02-31", sport: "NFL" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("gameDate");

    const [row] = await db.select().from(betsTable).where(eq(betsTable.id, betId));
    expect(row.gameDate).toBe(validBet.gameDate);
    expect(row.sport).toBe(validBet.sport);
  });
});
