/**
 * POST /bets/:id/unsettle and POST /parlays/:id/unsettle — reopen a settled
 * play so a wrong result can be fixed. These tests prove:
 *  - a settled bet reopens: status pending, payout cleared, ledger reversed
 *    with a compensating adjustment (append-only convention preserved)
 *  - re-settling after a reopen records the corrected result and the ledger
 *    ends at exactly the corrected balance
 *  - a pending play 409s (nothing to reopen)
 *  - only the owner can reopen
 *  - a reopened parlay's legs return to pending
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray, eq, asc } from "drizzle-orm";

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
import { db, pool, usersTable, betsTable, parlaysTable, parlayLegsTable, transactionsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName: string) {
  const username = `test_us_${Date.now()}_${counter++}`;
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

async function createBet(stake = 100, odds = 100) {
  const res = await request(app).post("/api/bets").send({
    sport: "NBA",
    betType: "moneyline",
    event: `Unsettle Test Game ${counter++}`,
    pick: "Home ML",
    odds,
    stake,
    confidenceScore: 5,
    gameDate: "2026-07-14",
  });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

async function ledgerRows(userId: number) {
  return db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, userId))
    .orderBy(asc(transactionsTable.createdAt), asc(transactionsTable.id));
}

function chainHolds(rows: Awaited<ReturnType<typeof ledgerRows>>, starting: number) {
  let running = starting;
  for (const row of rows) {
    running += Number(row.amount);
    expect(Number(row.balanceAfter)).toBeCloseTo(running, 2);
  }
  return running;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    const parlayIds = (
      await db.select({ id: parlaysTable.id }).from(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds))
    ).map((p) => p.id);
    if (parlayIds.length > 0) {
      await db.delete(parlayLegsTable).where(inArray(parlayLegsTable.parlayId, parlayIds));
      await db.delete(parlaysTable).where(inArray(parlaysTable.id, parlayIds));
    }
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("POST /bets/:id/unsettle", () => {
  it("reopens a settled bet, reverses the ledger, and lets the corrected settle land", async () => {
    const user = await createUser("Fixer");
    const bet = await createBet(100, 100); // even money: win pays +100 profit

    // Wrong result first: won (+100)
    const settleWrong = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });
    expect(settleWrong.status).toBe(200);

    const reopen = await request(app).post(`/api/bets/${bet.id}/unsettle`);
    expect(reopen.status).toBe(200);
    expect(reopen.body.status).toBe("pending");
    expect(reopen.body.actualPayout).toBeNull();
    expect(reopen.body.settledAt).toBeNull();

    // Ledger: win row (+100) then reversal (-100); chain intact, net zero.
    let rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(2);
    let final = chainHolds(rows, 1000);
    expect(final).toBeCloseTo(1000, 2);

    // Correct result: lost (-100 stake)
    const settleRight = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "lost" });
    expect(settleRight.status).toBe(200);

    rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(3);
    final = chainHolds(rows, 1000);
    expect(final).toBeCloseTo(900, 2);
  });

  it("two concurrent unsettles append exactly one reversal", async () => {
    const user = await createUser("Racer");
    const bet = await createBet(100, 100);
    const settle = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });
    expect(settle.status).toBe(200);

    const [a, b] = await Promise.all([
      request(app).post(`/api/bets/${bet.id}/unsettle`),
      request(app).post(`/api/bets/${bet.id}/unsettle`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(2); // settle + exactly one reversal
    const final = chainHolds(rows, 1000);
    expect(final).toBeCloseTo(1000, 2);
  });

  it("survives repeated settle/unsettle cycles with different results", async () => {
    const user = await createUser("Flip Flopper");
    const bet = await createBet(100, 150); // win pays +150 profit

    // won (+150) → reopen → lost (-100) → reopen → push (0)
    expect((await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" })).status).toBe(200);
    expect((await request(app).post(`/api/bets/${bet.id}/unsettle`)).status).toBe(200);
    expect((await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "lost" })).status).toBe(200);
    expect((await request(app).post(`/api/bets/${bet.id}/unsettle`)).status).toBe(200);
    expect((await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "push" })).status).toBe(200);

    const rows = await ledgerRows(user.id);
    // +150, -150, -100, +100, and possibly a zero-impact push row —
    // whatever the row count, the chain must hold and the net must be zero.
    const final = chainHolds(rows, 1000);
    expect(final).toBeCloseTo(1000, 2);

    const netImpact = rows
      .filter((r) => r.referenceId === bet.id)
      .reduce((sum, r) => sum + Number(r.amount), 0);
    expect(netImpact).toBeCloseTo(0, 2);
  });

  it("409s when the bet is still pending", async () => {
    await createUser("Impatient");
    const bet = await createBet();
    const reopen = await request(app).post(`/api/bets/${bet.id}/unsettle`);
    expect(reopen.status).toBe(409);
  });

  it("403s for a non-owner", async () => {
    await createUser("Owner");
    const bet = await createBet();
    const settle = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });
    expect(settle.status).toBe(200);
    await createUser("Stranger"); // switches the authenticated user
    const reopen = await request(app).post(`/api/bets/${bet.id}/unsettle`);
    expect(reopen.status).toBe(403);
  });
});

describe("POST /parlays/:id/unsettle", () => {
  it("reopens a settled parlay, resets legs to pending, and reverses the ledger", async () => {
    const user = await createUser("Parlay Fixer");
    const create = await request(app).post("/api/parlays").send({
      name: "Unsettle Test Parlay",
      stake: 50,
      confidenceScore: 6,
      legs: [
        { sport: "NBA", betType: "moneyline", event: "Game A", pick: "A ML", odds: 100, gameDate: "2026-07-14" },
        { sport: "NFL", betType: "moneyline", event: "Game B", pick: "B ML", odds: 100, gameDate: "2026-07-14" },
      ],
    });
    expect(create.status).toBe(201);
    const parlayId = create.body.id as number;
    const legIds = (create.body.legs as Array<{ id: number }>).map((l) => l.id);

    const settle = await request(app).patch(`/api/parlays/${parlayId}/settle`).send({
      status: "won",
      legResults: legIds.map((legId) => ({ legId, status: "won" })),
    });
    expect(settle.status).toBe(200);

    const reopen = await request(app).post(`/api/parlays/${parlayId}/unsettle`);
    expect(reopen.status).toBe(200);
    expect(reopen.body.status).toBe("pending");
    expect(reopen.body.settledAt).toBeNull();

    const legs = await db.select().from(parlayLegsTable).where(eq(parlayLegsTable.parlayId, parlayId));
    for (const leg of legs) expect(leg.status).toBe("pending");

    const rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(2); // win + reversal
    const final = chainHolds(rows, 1000);
    expect(final).toBeCloseTo(1000, 2);

    // Second reopen finds nothing settled.
    const again = await request(app).post(`/api/parlays/${parlayId}/unsettle`);
    expect(again.status).toBe(409);
  });
});
