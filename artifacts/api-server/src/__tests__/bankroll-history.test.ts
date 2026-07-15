/**
 * GET /bankroll/history — the chartable balance-over-time ledger:
 *   - unauthenticated → 401
 *   - always self-scoped: a foreign userId param → 403
 *   - first point is the starting balance, then one point per ledger row in
 *     chronological order, with balances matching the append-only chain
 *   - a user with no transactions still gets the starting point
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
import { db, pool, usersTable, transactionsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createLinkedUser() {
  const username = `bkhist_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId, startingBankroll: "1000" })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("GET /bankroll/history", () => {
  it("rejects unauthenticated requests", async () => {
    currentClerkUserId = null;
    const res = await request(app).get("/api/bankroll/history");
    expect(res.status).toBe(401);
  });

  it("refuses a foreign userId param", async () => {
    const { clerkUserId } = await createLinkedUser();
    const { user: other } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get(`/api/bankroll/history?userId=${other.id}`);
    expect(res.status).toBe(403);
  });

  it("returns just the starting point for a fresh user", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/bankroll/history");
    expect(res.status).toBe(200);
    expect(res.body.startingBalance).toBe(1000);
    expect(res.body.points).toHaveLength(1);
    expect(res.body.points[0]).toMatchObject({ type: "starting", balance: 1000, amount: 0 });
    expect(res.body.points[0].date).toBe(user.createdAt.toISOString());
  });

  it("returns the full chain in chronological order with matching balances", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;

    // Ledger rows always postdate the account's creation in real data
    const base = Date.now() + 1000;
    await db.insert(transactionsTable).values([
      {
        userId: user.id,
        type: "deposit",
        amount: "200.00",
        balanceAfter: "1200.00",
        createdAt: new Date(base),
      },
      {
        userId: user.id,
        type: "bet_loss",
        amount: "-50.00",
        balanceAfter: "1150.00",
        referenceType: "bet",
        createdAt: new Date(base + 60_000),
      },
      {
        userId: user.id,
        type: "bet_win",
        amount: "90.91",
        balanceAfter: "1240.91",
        referenceType: "bet",
        createdAt: new Date(base + 120_000),
      },
    ]);

    const res = await request(app).get("/api/bankroll/history");
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(4);
    expect(res.body.points.map((p: { balance: number }) => p.balance)).toEqual([
      1000, 1200, 1150, 1240.91,
    ]);
    expect(res.body.points.map((p: { type: string }) => p.type)).toEqual([
      "starting",
      "deposit",
      "bet_loss",
      "bet_win",
    ]);
    // Chain invariant: each balance = previous balance + amount
    for (let i = 1; i < res.body.points.length; i++) {
      expect(res.body.points[i].balance).toBeCloseTo(
        res.body.points[i - 1].balance + res.body.points[i].amount,
        2,
      );
    }
    // Chronological order
    const times = res.body.points.map((p: { date: string }) => new Date(p.date).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("never mixes in another user's ledger", async () => {
    const { user: other } = await createLinkedUser();
    await db.insert(transactionsTable).values({
      userId: other.id,
      type: "deposit",
      amount: "999.00",
      balanceAfter: "1999.00",
    });
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/bankroll/history");
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(1);
  });
});
