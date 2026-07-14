/**
 * Integration tests for POST /api/parlays atomicity.
 *
 * The route inserts the parlay row and its legs in a single DB transaction.
 * These tests prove:
 *   1. A successful create persists both the parlay and all its legs.
 *   2. A failure while inserting legs (a DB constraint violation) rolls the
 *      whole transaction back, leaving no orphan zero-leg parlay row behind.
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
import {
  db,
  pool,
  usersTable,
  parlaysTable,
  parlayLegsTable,
  transactionsTable,
} from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

/** Creates an isolated test user directly in the DB and acts as them. */
async function createUser(startingBankroll = 1000) {
  const username = `test_parlay_${Date.now()}_${counter++}`;
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
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    if (parlays.length > 0) {
      await db.delete(parlayLegsTable).where(
        inArray(
          parlayLegsTable.parlayId,
          parlays.map((p) => p.id),
        ),
      );
    }
    await db
      .delete(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

const validLegs = [
  {
    sport: "NBA",
    event: "Game 1",
    betType: "moneyline",
    pick: "Team A",
    odds: 100,
    gameDate: "2026-07-14",
  },
  {
    sport: "NFL",
    event: "Game 2",
    betType: "spread",
    pick: "Team B -3.5",
    odds: -110,
    gameDate: "2026-07-15",
  },
];

describe("POST /api/parlays", () => {
  it("creates the parlay with all its legs persisted and matching the request", async () => {
    const user = await createUser(1000);

    const res = await request(app).post("/api/parlays").send({
      name: "Atomic Parlay",
      stake: 50,
      confidenceScore: 6,
      legs: validLegs,
    });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(user.id);
    expect(res.body.legs).toHaveLength(2);

    // Legs in the response match the request payload
    const bySport = Object.fromEntries(
      (res.body.legs as Array<Record<string, unknown>>).map((l) => [l.sport, l]),
    );
    for (const leg of validLegs) {
      const got = bySport[leg.sport] as Record<string, unknown>;
      expect(got).toBeTruthy();
      expect(got.event).toBe(leg.event);
      expect(got.betType).toBe(leg.betType);
      expect(got.pick).toBe(leg.pick);
      expect(got.odds).toBe(leg.odds);
      expect(got.gameDate).toBe(leg.gameDate);
      expect(got.status).toBe("pending");
    }

    // And the legs actually exist in the database, tied to the parlay row
    const dbLegs = await db
      .select()
      .from(parlayLegsTable)
      .where(eq(parlayLegsTable.parlayId, res.body.id));
    expect(dbLegs).toHaveLength(2);
  });

  it("rolls back the parlay row when a leg insert fails mid-transaction", async () => {
    const user = await createUser(1000);

    // gameDate is validated only as a string, so "not-a-date" passes request
    // validation but violates the Postgres `date` column type. The parlay row
    // is inserted first inside the transaction; the failing leg insert must
    // roll it back.
    const res = await request(app).post("/api/parlays").send({
      name: "Doomed Parlay",
      stake: 50,
      confidenceScore: 6,
      legs: [
        validLegs[0],
        { ...validLegs[1], gameDate: "not-a-date" },
      ],
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    // No orphan parlay row may remain for this user
    const parlays = await db
      .select()
      .from(parlaysTable)
      .where(eq(parlaysTable.userId, user.id));
    expect(parlays).toHaveLength(0);
  });

  it("leaves no legs behind either when the transaction rolls back", async () => {
    const user = await createUser(1000);

    const before = await db
      .select({ id: parlayLegsTable.id })
      .from(parlayLegsTable);

    const res = await request(app).post("/api/parlays").send({
      name: "Doomed Parlay 2",
      stake: 25,
      confidenceScore: 5,
      legs: [
        { ...validLegs[0], gameDate: "not-a-date" },
        validLegs[1],
      ],
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    const after = await db
      .select({ id: parlayLegsTable.id })
      .from(parlayLegsTable);
    expect(after.length).toBe(before.length);

    const parlays = await db
      .select()
      .from(parlaysTable)
      .where(eq(parlaysTable.userId, user.id));
    expect(parlays).toHaveLength(0);
  });
});
