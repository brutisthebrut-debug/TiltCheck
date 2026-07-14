/**
 * Integration tests for DELETE /api/bets/:id and DELETE /api/parlays/:id.
 * Deleting a settled bet/parlay must reverse its bankroll impact atomically
 * so no ghost money is left in the ledger.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import request from "supertest";
import { eq, inArray, and } from "drizzle-orm";

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
  betsTable,
  parlaysTable,
  parlayLegsTable,
  transactionsTable,
} from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(startingBankroll = 1000) {
  const username = `del_test_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Delete Test User",
      avatarColor: "#6366f1",
      startingBankroll: String(startingBankroll),
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return { id: row.id, startingBankroll: Number(row.startingBankroll), clerkUserId };
}

beforeAll(async () => {
  await createUser(1000);
});

async function createBet(opts: { odds?: number; stake?: number } = {}) {
  const res = await request(app)
    .post("/api/bets")
    .send({
      sport: "NBA",
      event: "Delete Test Game",
      betType: "moneyline",
      pick: "Team A ML",
      odds: opts.odds ?? 150,
      stake: opts.stake ?? 100,
      gameDate: "2026-07-14",
      confidenceScore: 7,
    });
  expect(res.status).toBe(201);
  return res.body as { id: number; stake: number; potentialPayout: number };
}

async function createParlay(stake = 50) {
  const res = await request(app)
    .post("/api/parlays")
    .send({
      name: "Delete Test Parlay",
      stake,
      confidenceScore: 6,
      legs: [
        { sport: "NBA", event: "Game 1", betType: "moneyline", pick: "Team A", odds: 100, gameDate: "2026-07-14" },
        { sport: "NFL", event: "Game 2", betType: "spread", pick: "Team B -3.5", odds: 100, gameDate: "2026-07-14" },
      ],
    });
  expect(res.status).toBe(201);
  return res.body as { id: number; stake: number; potentialPayout: number; legs: Array<{ id: number }> };
}

async function getBankroll(userId: number) {
  const res = await request(app).get(`/api/bankroll?userId=${userId}`);
  expect(res.status).toBe(200);
  return res.body as { currentBalance: number; netProfitLoss: number };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    if (parlays.length > 0) {
      await db.delete(parlayLegsTable).where(
        inArray(parlayLegsTable.parlayId, parlays.map((p) => p.id)),
      );
    }
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("DELETE /api/bets/:id", () => {
  it("deleting a pending bet leaves the balance untouched and adds no ledger entry", async () => {
    const user = await createUser(1000);
    const bet = await createBet();

    const res = await request(app).delete(`/api/bets/${bet.id}`);
    expect(res.status).toBe(204);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);

    const txs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, user.id));
    expect(txs.length).toBe(0);
  });

  it("deleting a won bet reverses the win so the balance returns to its prior value", async () => {
    const user = await createUser(1000);
    const bet = await createBet({ odds: 150, stake: 100 });

    const settle = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });
    expect(settle.status).toBe(200);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(1150, 2);

    const res = await request(app).delete(`/api/bets/${bet.id}`);
    expect(res.status).toBe(204);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(0, 2);

    // A reversal adjustment entry is recorded — the ledger stays auditable.
    const reversals = await db
      .select()
      .from(transactionsTable)
      .where(and(eq(transactionsTable.userId, user.id), eq(transactionsTable.type, "adjustment")));
    expect(reversals.length).toBe(1);
    expect(Number(reversals[0].amount)).toBeCloseTo(-150, 2);
    expect(Number(reversals[0].balanceAfter)).toBeCloseTo(1000, 2);
    expect(reversals[0].referenceId).toBe(bet.id);
    expect(reversals[0].referenceType).toBe("bet");
  });

  it("deleting a lost bet restores the stake and records the correct adjustment", async () => {
    const user = await createUser(1000);
    const bet = await createBet({ odds: 150, stake: 100 });

    const settle = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "lost" });
    expect(settle.status).toBe(200);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(900, 2);

    const res = await request(app).delete(`/api/bets/${bet.id}`);
    expect(res.status).toBe(204);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(1000, 2);

    // The reversal credits the lost stake back with the right running balance.
    const reversals = await db
      .select()
      .from(transactionsTable)
      .where(and(eq(transactionsTable.userId, user.id), eq(transactionsTable.type, "adjustment")));
    expect(reversals.length).toBe(1);
    expect(Number(reversals[0].amount)).toBeCloseTo(100, 2);
    expect(Number(reversals[0].balanceAfter)).toBeCloseTo(1000, 2);
  });

  it("deleting a push bet adds no reversal entry (zero net impact)", async () => {
    const user = await createUser(1000);
    const bet = await createBet({ odds: 150, stake: 100 });

    const settle = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "push" });
    expect(settle.status).toBe(200);

    const res = await request(app).delete(`/api/bets/${bet.id}`);
    expect(res.status).toBe(204);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(1000, 2);

    const reversals = await db
      .select()
      .from(transactionsTable)
      .where(and(eq(transactionsTable.userId, user.id), eq(transactionsTable.type, "adjustment")));
    expect(reversals.length).toBe(0);
  });
});

describe("ledger consistency after deletion (append-only convention)", () => {
  /**
   * Convention under test (documented on transactionsTable.balanceAfter):
   * the ledger is append-only — `balanceAfter` is a point-in-time snapshot
   * that is never rewritten, even when a bet referenced by an earlier row is
   * later deleted. Deletion appends a compensating "adjustment" row, so for
   * rows ordered by (createdAt, id) the chain invariant always holds:
   *   balanceAfter[n] = balanceAfter[n-1] + amount[n]
   * and summing amounts always agrees with the latest balanceAfter.
   */
  function expectChainConsistent(
    startingBankroll: number,
    txs: Array<{ amount: string; balanceAfter: string }>,
  ) {
    let running = startingBankroll;
    for (const t of txs) {
      running += Number(t.amount);
      expect(Number(t.balanceAfter)).toBeCloseTo(running, 2);
    }
    return running;
  }

  it("keeps the chain invariant when transactions occur between settle and delete (bet)", async () => {
    const user = await createUser(1000);
    const bet = await createBet({ odds: 150, stake: 100 }); // won profit = 150

    const settle = await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });
    expect(settle.status).toBe(200);

    // Intervening transactions between settle and delete
    const dep = await request(app)
      .post("/api/bankroll/transactions")
      .send({ type: "deposit", amount: 200, note: "mid deposit" });
    expect(dep.status).toBe(201);
    const wd = await request(app)
      .post("/api/bankroll/transactions")
      .send({ type: "withdraw", amount: 50, note: "mid withdraw" });
    expect(wd.status).toBe(201);

    const del = await request(app).delete(`/api/bets/${bet.id}`);
    expect(del.status).toBe(204);

    const txs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, user.id))
      .orderBy(transactionsTable.createdAt, transactionsTable.id);
    expect(txs.length).toBe(4); // win, deposit, withdraw, reversal adjustment

    // Every row satisfies balanceAfter[n] = balanceAfter[n-1] + amount[n]
    const finalBalance = expectChainConsistent(1000, txs);

    // Intermediate rows keep their point-in-time snapshots (they still
    // include the deleted bet's money — that was the balance at the time).
    expect(Number(txs[0].balanceAfter)).toBeCloseTo(1150, 2); // win
    expect(Number(txs[1].balanceAfter)).toBeCloseTo(1350, 2); // deposit
    expect(Number(txs[2].balanceAfter)).toBeCloseTo(1300, 2); // withdraw
    expect(Number(txs[3].balanceAfter)).toBeCloseTo(1150, 2); // reversal (-150)

    // Summing amounts agrees with the latest balanceAfter and with /bankroll
    const summed = 1000 + txs.reduce((s, t) => s + Number(t.amount), 0);
    expect(summed).toBeCloseTo(finalBalance, 2);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(finalBalance, 2);

    // The transactions endpoint (what the web app renders row by row)
    // returns the same chain-consistent balanceAfter values.
    const listRes = await request(app).get("/api/bankroll/transactions");
    expect(listRes.status).toBe(200);
    const listed = (listRes.body as Array<{ id: number; amount: number; balanceAfter: number }>)
      .slice()
      .sort((a, b) => a.id - b.id);
    expectChainConsistent(
      1000,
      listed.map((t) => ({ amount: String(t.amount), balanceAfter: String(t.balanceAfter) })),
    );
  });

  it("keeps the chain invariant when a deposit lands between settle and delete (parlay)", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(50); // won profit = 150

    const settle = await request(app).patch(`/api/parlays/${parlay.id}/settle`).send({ status: "won" });
    expect(settle.status).toBe(200);

    const dep = await request(app)
      .post("/api/bankroll/transactions")
      .send({ type: "deposit", amount: 100 });
    expect(dep.status).toBe(201);

    const del = await request(app).delete(`/api/parlays/${parlay.id}`);
    expect(del.status).toBe(204);

    const txs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, user.id))
      .orderBy(transactionsTable.createdAt, transactionsTable.id);
    expect(txs.length).toBe(3); // win, deposit, reversal

    const finalBalance = expectChainConsistent(1000, txs);
    expect(finalBalance).toBeCloseTo(1100, 2); // 1000 + 100 deposit, parlay fully reversed
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(1100, 2);
  });
});

describe("DELETE /api/parlays/:id", () => {
  it("deleting a won parlay reverses the win and removes its legs", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(50); // potential payout 200 -> profit 150

    const settle = await request(app).patch(`/api/parlays/${parlay.id}/settle`).send({ status: "won" });
    expect(settle.status).toBe(200);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(1150, 2);

    const res = await request(app).delete(`/api/parlays/${parlay.id}`);
    expect(res.status).toBe(204);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);

    const legs = await db
      .select()
      .from(parlayLegsTable)
      .where(eq(parlayLegsTable.parlayId, parlay.id));
    expect(legs.length).toBe(0);

    const reversals = await db
      .select()
      .from(transactionsTable)
      .where(and(eq(transactionsTable.userId, user.id), eq(transactionsTable.type, "adjustment")));
    expect(reversals.length).toBe(1);
    expect(Number(reversals[0].amount)).toBeCloseTo(-150, 2);
  });

  it("deleting a lost parlay reverses the loss", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(50);

    const settle = await request(app).patch(`/api/parlays/${parlay.id}/settle`).send({ status: "lost" });
    expect(settle.status).toBe(200);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(950, 2);

    const res = await request(app).delete(`/api/parlays/${parlay.id}`);
    expect(res.status).toBe(204);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(1000, 2);
  });

  it("deleting a pending parlay leaves the balance untouched", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(50);

    const res = await request(app).delete(`/api/parlays/${parlay.id}`);
    expect(res.status).toBe(204);
    expect((await getBankroll(user.id)).currentBalance).toBeCloseTo(1000, 2);

    const txs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, user.id));
    expect(txs.length).toBe(0);
  });
});
