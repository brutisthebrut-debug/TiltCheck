/**
 * Ledger append serialization — proves that concurrent bankroll appends for
 * the same user can never derive their balances from the same stale
 * snapshot. Every append path (manual deposit/withdrawal, bet settle,
 * parlay settle, deletion reversal) takes a per-user transaction-scoped
 * advisory lock before reading the latest balanceAfter, so the chain
 * invariant balanceAfter[n] = balanceAfter[n-1] + amount[n] holds even when
 * a deposit and a settle land at the same instant.
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
import { db, pool, usersTable, betsTable, transactionsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName: string) {
  const username = `test_lr_${Date.now()}_${counter++}`;
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

async function createPendingBet(stake: number, odds: number) {
  const res = await request(app).post("/api/bets").send({
    sport: "NBA",
    betType: "moneyline",
    event: `Race Test Game ${counter++}`,
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

function expectChainInvariant(rows: Awaited<ReturnType<typeof ledgerRows>>, startingBankroll: number) {
  let running = startingBankroll;
  for (const row of rows) {
    running += Number(row.amount);
    expect(Number(row.balanceAfter)).toBeCloseTo(running, 2);
  }
  return running;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("ledger append serialization", () => {
  it("keeps the balance chain intact when deposits land concurrently", async () => {
    const user = await createUser("Race Depositor");

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post("/api/bankroll/transactions")
          .send({ type: "deposit", amount: 10 + i, note: `concurrent ${i}` })
      )
    );
    for (const res of results) expect(res.status).toBe(201);

    const rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(5);
    const finalBalance = expectChainInvariant(rows, 1000);
    // 10+11+12+13+14 = 60 on top of the 1000 starting bankroll
    expect(finalBalance).toBeCloseTo(1060, 2);
  });

  it("keeps the balance chain intact when a deposit and a settle land concurrently", async () => {
    const user = await createUser("Race Settler");
    const bet = await createPendingBet(100, +100); // win pays +100 profit

    const [depositRes, settleRes] = await Promise.all([
      request(app).post("/api/bankroll/transactions").send({ type: "deposit", amount: 250 }),
      request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" }),
    ]);
    expect(depositRes.status).toBe(201);
    expect(settleRes.status).toBe(200);

    const rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(2);
    const finalBalance = expectChainInvariant(rows, 1000);
    // 1000 + 250 deposit + 100 win profit, in either order
    expect(finalBalance).toBeCloseTo(1350, 2);
  });

  it("keeps the chain intact when a withdrawal races a bet deletion reversal", async () => {
    const user = await createUser("Race Deleter");
    const bet = await createPendingBet(50, -110);
    const settle = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });
    expect(settle.status).toBe(200);

    const [withdrawRes, deleteRes] = await Promise.all([
      request(app).post("/api/bankroll/transactions").send({ type: "withdraw", amount: 20 }),
      request(app).delete(`/api/bets/${bet.id}`),
    ]);
    expect(withdrawRes.status).toBe(201);
    expect([200, 204]).toContain(deleteRes.status);

    const rows = await ledgerRows(user.id);
    // settle win + withdrawal + deletion reversal adjustment
    expect(rows).toHaveLength(3);
    expectChainInvariant(rows, 1000);

    // After the reversal, the bet's net ledger impact must be zero.
    const betLinked = rows.filter((r) => r.referenceId === bet.id);
    const netImpact = betLinked.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(netImpact).toBeCloseTo(0, 2);
  });
});
