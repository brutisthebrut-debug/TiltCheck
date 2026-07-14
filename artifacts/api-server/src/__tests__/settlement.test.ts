/**
 * Integration tests for the flows that write to the database and then
 * recompute bankroll:
 *   - PATCH /api/bets/:id/settle   (won / lost / push / void + actualPayoutOverride)
 *   - PATCH /api/parlays/:id/settle (same variants + legResults)
 *   - PATCH /api/users/:id          (startingBankroll update + balance recalculation)
 *
 * Each test creates its own isolated user so bankroll math is deterministic.
 * All rows created by the tests are removed in afterAll.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

// The app now derives identity from the Clerk session. Tests control identity
// through this variable: `createUser` (and `actAs`) point it at a test user's
// clerkUserId, and setting it to null simulates a signed-out request.
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

// Tests create many linked users; lift the beta seat cap (read per-request).
process.env.BETA_SEAT_LIMIT = "0";

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

/** Creates an isolated test user directly in the DB and acts as them. */
async function createUser(startingBankroll = 1000) {
  const username = `test_${Date.now()}_${counter++}`;
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
  return {
    id: row.id,
    startingBankroll: Number(row.startingBankroll),
    clerkUserId,
  };
}

function actAs(user: { clerkUserId: string }) {
  currentClerkUserId = user.clerkUserId;
}

beforeAll(async () => {
  // Ensure a signed-in actor exists even for tests that don't create their own
  await createUser(1000);
});

async function createBet(
  userId: number,
  opts: { odds?: number; stake?: number } = {},
) {
  const res = await request(app)
    .post("/api/bets")
    .send({
      userId,
      sport: "NBA",
      event: "Test Game A vs B",
      betType: "moneyline",
      pick: "Team A ML",
      odds: opts.odds ?? 150,
      stake: opts.stake ?? 100,
      gameDate: "2026-07-14",
      confidenceScore: 7,
    });
  expect(res.status).toBe(201);
  return res.body as {
    id: number;
    stake: number;
    potentialPayout: number;
  };
}

async function createParlay(userId: number, stake = 50) {
  // Two +100 legs -> combined decimal 4.0 -> potentialPayout = 4 * stake
  const res = await request(app)
    .post("/api/parlays")
    .send({
      userId,
      name: "Test Parlay",
      stake,
      confidenceScore: 6,
      legs: [
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
          odds: 100,
          gameDate: "2026-07-14",
        },
      ],
    });
  expect(res.status).toBe(201);
  return res.body as {
    id: number;
    stake: number;
    potentialPayout: number;
    legs: Array<{ id: number; status: string }>;
  };
}

async function getBankroll(userId: number) {
  const res = await request(app).get(`/api/bankroll?userId=${userId}`);
  expect(res.status).toBe(200);
  return res.body as {
    currentBalance: number;
    startingBalance: number;
    netProfitLoss: number;
    roi: number;
  };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db
      .delete(transactionsTable)
      .where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
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

describe("PATCH /api/bets/:id/settle", () => {
  it("won: pays potentialPayout and credits bankroll with profit", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: 150, stake: 100 });
    expect(bet.potentialPayout).toBeCloseTo(250, 2);

    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won", postGameReview: "Nailed it" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("won");
    expect(res.body.actualPayout).toBeCloseTo(250, 2);
    expect(res.body.settledAt).toBeTruthy();

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1150, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(150, 2);
    expect(bankroll.roi).toBeCloseTo(150, 2); // 150 profit / 100 wagered
  });

  it("won with actualPayoutOverride: uses the override for payout and profit", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: 150, stake: 100 });

    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won", actualPayoutOverride: 300 });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBeCloseTo(300, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1200, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(200, 2);
    expect(bankroll.roi).toBeCloseTo(200, 2);
  });

  it("lost: zero payout, bankroll debited by stake", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: -110, stake: 110 });

    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "lost", missReason: "normal_variance" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("lost");
    expect(res.body.actualPayout).toBeCloseTo(0, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(890, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(-110, 2);
    expect(bankroll.roi).toBeCloseTo(-100, 2); // -110 / 110 wagered
  });

  it("push: stake returned, bankroll unchanged, counts as wagered", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: -110, stake: 100 });

    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "push" });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBeCloseTo(100, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(0, 2);
    expect(bankroll.roi).toBeCloseTo(0, 2);
  });

  it("void: stake returned, bankroll unchanged, not counted as wagered", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: 200, stake: 75 });

    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "void" });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBeCloseTo(75, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(0, 2);
    expect(bankroll.roi).toBeCloseTo(0, 2); // void bets excluded from wagered
  });

  it("sequential settles accumulate on the transaction chain", async () => {
    const user = await createUser(500);
    const win = await createBet(user.id, { odds: 100, stake: 50 }); // +50 on win
    const loss = await createBet(user.id, { odds: -120, stake: 60 }); // -60 on loss

    await request(app).patch(`/api/bets/${win.id}/settle`).send({ status: "won" });
    await request(app).patch(`/api/bets/${loss.id}/settle`).send({ status: "lost" });

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(490, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(-10, 2);
  });

  it("rejects an invalid status with 400 and writes nothing", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id);

    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "banana" });
    expect(res.status).toBe(400);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
  });

  it("returns 404 for a nonexistent bet", async () => {
    const res = await request(app)
      .patch(`/api/bets/99999999/settle`)
      .send({ status: "won" });
    expect(res.status).toBe(404);
  });

  it("rejects a repeat settle with 409 and leaves the bankroll unchanged", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: 150, stake: 100 }); // +150 on win

    const first = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won" });
    expect(first.status).toBe(200);

    const bankrollAfterFirst = await getBankroll(user.id);
    expect(bankrollAfterFirst.currentBalance).toBeCloseTo(1150, 2);

    // Retry (double-click / timeout retry) must not write a second transaction
    const second = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won" });
    expect(second.status).toBe(409);

    // Even settling with a different status must be rejected
    const flipped = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "lost" });
    expect(flipped.status).toBe(409);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1150, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(150, 2);

    const txs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, user.id));
    expect(txs.length).toBe(1);
  });

  it("rejects a repeat settle of a lost bet with 409, bankroll unchanged", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: -110, stake: 110 });

    const first = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "lost" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "lost" });
    expect(second.status).toBe(409);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(890, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(-110, 2);
  });
});

describe("PATCH /api/parlays/:id/settle", () => {
  it("won: pays potentialPayout and credits bankroll", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50); // payout 200
    expect(parlay.potentialPayout).toBeCloseTo(200, 2);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "won",
        legResults: parlay.legs.map((l) => ({ legId: l.id, status: "won" })),
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("won");
    expect(res.body.actualPayout).toBeCloseTo(200, 2);
    expect(res.body.settledAt).toBeTruthy();
    for (const leg of res.body.legs) {
      expect(leg.status).toBe("won");
    }

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1150, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(150, 2);
    // Parlay-only user: 150 profit / 50 wagered
    expect(bankroll.roi).toBeCloseTo(300, 2);
  });

  it("won with actualPayoutOverride: uses the override", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "won", actualPayoutOverride: 180 });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBeCloseTo(180, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1130, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(130, 2);
  });

  it("lost: zero payout, bankroll debited by stake, legs updated", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "lost",
        legResults: [
          { legId: parlay.legs[0].id, status: "won" },
          { legId: parlay.legs[1].id, status: "lost" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBeCloseTo(0, 2);
    const legStatuses = res.body.legs.map((l: { status: string }) => l.status).sort();
    expect(legStatuses).toEqual(["lost", "won"]);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(950, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(-50, 2);
    // Parlay-only user: -50 / 50 wagered
    expect(bankroll.roi).toBeCloseTo(-100, 2);
  });

  it("push: stake returned, bankroll unchanged", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "push" });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBeCloseTo(50, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(0, 2);
    // Pushed parlay still counts as wagered; 0 profit / 50 wagered
    expect(bankroll.roi).toBeCloseTo(0, 2);
  });

  it("void: stake returned, bankroll unchanged", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "void" });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBeCloseTo(50, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(0, 2);
    // Void parlays are excluded from total wagered
    expect(bankroll.roi).toBeCloseTo(0, 2);
  });

  it("mixed straight bet + parlay: ROI divides by both stakes", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: 100, stake: 100 }); // +100 on win
    const parlay = await createParlay(user.id, 50); // -50 on loss

    await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });
    await request(app).patch(`/api/parlays/${parlay.id}/settle`).send({ status: "lost" });

    const bankroll = await getBankroll(user.id);
    expect(bankroll.netProfitLoss).toBeCloseTo(50, 2);
    // 50 profit / (100 + 50) wagered
    expect(bankroll.roi).toBeCloseTo(33.33, 2);
  });

  it("rejects an invalid status with 400 and writes nothing", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "kinda-won" });
    expect(res.status).toBe(400);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
  });

  it("returns 404 for a nonexistent parlay", async () => {
    const res = await request(app)
      .patch(`/api/parlays/99999999/settle`)
      .send({ status: "lost" });
    expect(res.status).toBe(404);
  });

  it("rejects a repeat settle with 409 and leaves the bankroll unchanged", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50); // payout 200 on win

    const first = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "won",
        legResults: parlay.legs.map((l) => ({ legId: l.id, status: "won" })),
      });
    expect(first.status).toBe(200);

    const bankrollAfterFirst = await getBankroll(user.id);
    expect(bankrollAfterFirst.currentBalance).toBeCloseTo(1150, 2);

    const second = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "won" });
    expect(second.status).toBe(409);

    // Even settling with a different status must be rejected
    const flipped = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "lost" });
    expect(flipped.status).toBe(409);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1150, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(150, 2);

    const txs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, user.id));
    expect(txs.length).toBe(1);
  });

  it("rejects legResults containing a legId from a different parlay with 400 and touches nothing", async () => {
    const user = await createUser(1000);
    const target = await createParlay(user.id, 50);
    const other = await createParlay(user.id, 50);

    // Attempt to settle `target` while sneaking in a leg from `other`
    const res = await request(app)
      .patch(`/api/parlays/${target.id}/settle`)
      .send({
        status: "won",
        legResults: [
          { legId: target.legs[0].id, status: "won" },
          { legId: other.legs[0].id, status: "lost" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/do not belong/i);

    // The other parlay's legs must be untouched
    const otherAfter = await request(app).get(`/api/parlays/${other.id}`);
    expect(otherAfter.status).toBe(200);
    for (const leg of otherAfter.body.legs) {
      expect(leg.status).toBe("pending");
    }

    // The target parlay must be fully rolled back: still pending, legs pending
    const targetAfter = await request(app).get(`/api/parlays/${target.id}`);
    expect(targetAfter.status).toBe(200);
    expect(targetAfter.body.status).toBe("pending");
    expect(targetAfter.body.settledAt).toBeNull();
    for (const leg of targetAfter.body.legs) {
      expect(leg.status).toBe("pending");
    }

    // No bankroll movement
    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);

    const txs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, user.id));
    expect(txs.length).toBe(0);
  });

  it("rejects a legId that doesn't exist at all with 400", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "won",
        legResults: [{ legId: 99999999, status: "won" }],
      });
    expect(res.status).toBe(400);

    const after = await request(app).get(`/api/parlays/${parlay.id}`);
    expect(after.body.status).toBe("pending");

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
  });

  it("rejects settling as won when a leg result says lost, writes nothing", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "won",
        legResults: [
          { legId: parlay.legs[0].id, status: "won" },
          { legId: parlay.legs[1].id, status: "lost" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lost leg/i);

    // Parlay untouched: still pending, legs pending, no bankroll movement
    const after = await request(app).get(`/api/parlays/${parlay.id}`);
    expect(after.body.status).toBe("pending");
    expect(after.body.settledAt).toBeNull();
    for (const leg of after.body.legs) {
      expect(leg.status).toBe("pending");
    }
    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
  });

  it("rejects settling as won when even a partial legResults includes a lost leg", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "won",
        legResults: [{ legId: parlay.legs[0].id, status: "lost" }],
      });
    expect(res.status).toBe(400);

    const after = await request(app).get(`/api/parlays/${parlay.id}`);
    expect(after.body.status).toBe("pending");
  });

  it("rejects settling as push or void when a leg result says lost", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    for (const status of ["push", "void"]) {
      const res = await request(app)
        .patch(`/api/parlays/${parlay.id}/settle`)
        .send({
          status,
          legResults: [{ legId: parlay.legs[0].id, status: "lost" }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/lost/i);
    }

    const after = await request(app).get(`/api/parlays/${parlay.id}`);
    expect(after.body.status).toBe("pending");
    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
  });

  it("rejects settling as lost when every leg result says won", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "lost",
        legResults: parlay.legs.map((l) => ({ legId: l.id, status: "won" })),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one leg must be lost/i);

    const after = await request(app).get(`/api/parlays/${parlay.id}`);
    expect(after.body.status).toBe("pending");
    for (const leg of after.body.legs) {
      expect(leg.status).toBe("pending");
    }
    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1000, 2);
  });

  it("allows a partial legResults for a lost parlay (unlisted leg could be the loser)", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    // Only report the winning leg; the unlisted leg is the loser
    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "lost",
        legResults: [{ legId: parlay.legs[0].id, status: "won" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("lost");
    const statuses = res.body.legs
      .map((l: { status: string }) => l.status)
      .sort();
    expect(statuses).toEqual(["pending", "won"]);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(950, 2);
  });

  it("allows won with legs marked push/void alongside won", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "won",
        actualPayoutOverride: 100, // pushed leg reduces the payout
        legResults: [
          { legId: parlay.legs[0].id, status: "won" },
          { legId: parlay.legs[1].id, status: "push" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("won");
    expect(res.body.actualPayout).toBeCloseTo(100, 2);
  });

  it("rejects duplicate legIds in legResults with 400", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "lost",
        legResults: [
          { legId: parlay.legs[0].id, status: "won" },
          { legId: parlay.legs[0].id, status: "lost" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate/i);

    const after = await request(app).get(`/api/parlays/${parlay.id}`);
    expect(after.body.status).toBe("pending");
  });

  it("rejects a repeat settle of a lost parlay with 409, bankroll unchanged", async () => {
    const user = await createUser(1000);
    const parlay = await createParlay(user.id, 50);

    const first = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "lost" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "lost" });
    expect(second.status).toBe(409);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(950, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(-50, 2);
  });
});

describe("PATCH /api/users/:id", () => {
  it("updates startingBankroll; with no transactions the balance follows it", async () => {
    const user = await createUser(1000);

    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .send({ startingBankroll: 2500 });
    expect(res.status).toBe(200);
    expect(res.body.startingBankroll).toBeCloseTo(2500, 2);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.startingBalance).toBeCloseTo(2500, 2);
    expect(bankroll.currentBalance).toBeCloseTo(2500, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(0, 2);
    expect(bankroll.roi).toBeCloseTo(0, 2);
  });

  it("updates startingBankroll after settled bets; net P/L recalculates against new base", async () => {
    const user = await createUser(1000);
    const bet = await createBet(user.id, { odds: 100, stake: 100 }); // +100 on win
    await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" });

    let bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1100, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(100, 2);
    expect(bankroll.roi).toBeCloseTo(100, 2);

    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .send({ startingBankroll: 900 });
    expect(res.status).toBe(200);

    bankroll = await getBankroll(user.id);
    expect(bankroll.startingBalance).toBeCloseTo(900, 2);
    // Balance comes from the transaction chain, unchanged by the base edit
    expect(bankroll.currentBalance).toBeCloseTo(1100, 2);
    expect(bankroll.netProfitLoss).toBeCloseTo(200, 2);
    expect(bankroll.roi).toBeCloseTo(200, 2);
  });

  it("updates displayName without touching bankroll", async () => {
    const user = await createUser(1500);

    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .send({ displayName: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("Renamed");

    const bankroll = await getBankroll(user.id);
    expect(bankroll.currentBalance).toBeCloseTo(1500, 2);
  });

  it("rejects a non-positive startingBankroll with 400", async () => {
    const user = await createUser(1000);
    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .send({ startingBankroll: -50 });
    expect(res.status).toBe(400);

    const bankroll = await getBankroll(user.id);
    expect(bankroll.startingBalance).toBeCloseTo(1000, 2);
  });

  it("rejects an empty body with 400", async () => {
    const user = await createUser(1000);
    const res = await request(app).patch(`/api/users/${user.id}`).send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric id and 403 for someone else's id", async () => {
    const bad = await request(app)
      .patch(`/api/users/abc`)
      .send({ startingBankroll: 100 });
    expect(bad.status).toBe(400);

    // Not the signed-in user's own id → 403 (existence is not leaked)
    const missing = await request(app)
      .patch(`/api/users/99999999`)
      .send({ startingBankroll: 100 });
    expect(missing.status).toBe(403);
  });
});
