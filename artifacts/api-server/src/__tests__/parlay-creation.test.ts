/**
 * Integration tests for POST /api/parlays atomicity.
 *
 * The route inserts the parlay row and its legs in a single DB transaction.
 * These tests prove:
 *   1. A successful create persists both the parlay and all its legs.
 *   2. A failure while inserting legs (injected by making the leg insert
 *      throw mid-transaction) rolls the whole transaction back, leaving no
 *      orphan zero-leg parlay row behind.
 *   3. Malformed or impossible gameDate values and out-of-range odds are
 *      rejected with a 400 before touching the database.
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

// Odds are now bounded by the OpenAPI spec (-100000..100000), so an
// int4-overflow value can no longer sneak past request validation. To test
// transaction rollback, we instead make the *leg* insert throw inside the
// real transaction: db.transaction is wrapped so the parlay row insert runs
// for real, but inserting into parlay_legs raises. The thrown error causes a
// genuine Postgres ROLLBACK.
function injectLegInsertFailure() {
  const originalTransaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, "transaction").mockImplementation(((
    callback: (tx: never) => Promise<unknown>,
  ) =>
    originalTransaction(async (tx) => {
      const proxied = new Proxy(tx as object, {
        get(target, prop) {
          if (prop === "insert") {
            return (table: unknown) => {
              if (table === parlayLegsTable) {
                throw new Error("injected leg insert failure");
              }
              return (target as typeof tx).insert(table as never);
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return callback(proxied as never);
    })) as typeof db.transaction);
  return spy;
}

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

    // Both gameDate and odds are now validated up front, so failure is
    // injected by making the leg insert throw mid-transaction. The parlay
    // row inserts fine inside the transaction; the failing leg insert must
    // then roll it back.
    const spy = injectLegInsertFailure();
    try {
      const res = await request(app).post("/api/parlays").send({
        name: "Doomed Parlay",
        stake: 50,
        confidenceScore: 6,
        legs: validLegs,
      });
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }

    // No orphan parlay row may remain for this user
    const parlays = await db
      .select()
      .from(parlaysTable)
      .where(eq(parlaysTable.userId, user.id));
    expect(parlays).toHaveLength(0);
  });

  it("rejects a leg with odds beyond the allowed range with a 400 (no DB overflow 500)", async () => {
    const user = await createUser(1000);

    // Would overflow Postgres int4 — must be caught by request validation now
    const res = await request(app).post("/api/parlays").send({
      name: "Overflow Odds Parlay",
      stake: 50,
      confidenceScore: 6,
      legs: [validLegs[0], { ...validLegs[1], odds: -2147483649 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("odds");

    const parlays = await db
      .select()
      .from(parlaysTable)
      .where(eq(parlaysTable.userId, user.id));
    expect(parlays).toHaveLength(0);
  });

  it("rejects odds just outside the bounds and accepts odds at the bounds", async () => {
    await createUser(1000);

    const tooBig = await request(app).post("/api/parlays").send({
      name: "Too Big Odds",
      stake: 10,
      confidenceScore: 5,
      legs: [validLegs[0], { ...validLegs[1], odds: 100001 }],
    });
    expect(tooBig.status).toBe(400);

    const atBound = await request(app).post("/api/parlays").send({
      name: "At Bound Odds",
      stake: 10,
      confidenceScore: 5,
      legs: [validLegs[0], { ...validLegs[1], odds: 100000 }],
    });
    expect(atBound.status).toBe(201);
  });

  it("rejects a parlay whose combined odds would overflow storage with a 400", async () => {
    const user = await createUser(1000);

    // Each leg is within the per-leg bounds, but the combined odds explode
    // multiplicatively far past int4 range.
    const longShotLegs = Array.from({ length: 6 }, (_, i) => ({
      sport: "NBA",
      event: `Long Shot ${i + 1}`,
      betType: "moneyline",
      pick: `Team ${i + 1}`,
      odds: 100000,
      gameDate: "2026-07-14",
    }));

    const res = await request(app).post("/api/parlays").send({
      name: "Impossible Long Shot",
      stake: 10,
      confidenceScore: 3,
      legs: longShotLegs,
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("too large");

    const parlays = await db
      .select()
      .from(parlaysTable)
      .where(eq(parlaysTable.userId, user.id));
    expect(parlays).toHaveLength(0);
  });

  it("rejects a malformed gameDate with a 400 and a clear message", async () => {
    const user = await createUser(1000);

    const res = await request(app).post("/api/parlays").send({
      name: "Bad Date Parlay",
      stake: 50,
      confidenceScore: 6,
      legs: [validLegs[0], { ...validLegs[1], gameDate: "not-a-date" }],
    });
    expect(res.status).toBe(400);

    const parlays = await db
      .select()
      .from(parlaysTable)
      .where(eq(parlaysTable.userId, user.id));
    expect(parlays).toHaveLength(0);
  });

  it("rejects an impossible calendar date (2026-02-31) with a 400", async () => {
    const user = await createUser(1000);

    const res = await request(app).post("/api/parlays").send({
      name: "Impossible Date Parlay",
      stake: 50,
      confidenceScore: 6,
      legs: [validLegs[0], { ...validLegs[1], gameDate: "2026-02-31" }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("gameDate");

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

    const spy = injectLegInsertFailure();
    try {
      const res = await request(app).post("/api/parlays").send({
        name: "Doomed Parlay 2",
        stake: 25,
        confidenceScore: 5,
        legs: validLegs,
      });
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }

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
