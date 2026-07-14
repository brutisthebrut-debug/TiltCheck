/**
 * Data-integrity guards added for the friends handover:
 *   - bankroll transactions: zero / wrong-direction amounts are rejected
 *   - settlement: negative actualPayoutOverride can't record impossible wins
 *   - settled bets/parlays: financial fields (odds/stake) are frozen
 *   - stats summary: money math includes settled parlays (matches bankroll ROI)
 *   - beta email allowlist: only invited emails can claim/create a profile
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray, like } from "drizzle-orm";

let currentClerkUserId: string | null = null;

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers?: Record<string, string | string[] | undefined> }) => ({
    userId: (req?.headers?.["x-test-clerk-id"] as string | undefined) ?? currentClerkUserId,
  }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async (id: string) =>
        id.startsWith("noemail")
          ? { primaryEmailAddress: null, emailAddresses: [], firstName: "Test", lastName: "User" }
          : {
              primaryEmailAddress: { emailAddress: `${id}@example.com` },
              emailAddresses: [{ emailAddress: `${id}@example.com` }],
              firstName: "Test",
              lastName: "User",
            },
    },
  },
}));

process.env.BETA_SEAT_LIMIT = "0";
delete process.env.BETA_ALLOWED_EMAILS;

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

async function createLinkedUser(startingBankroll = 1000) {
  const username = `integrity_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Integrity Test User",
      avatarColor: "#22c55e",
      startingBankroll: String(startingBankroll),
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  return { id: row.id, clerkUserId };
}

async function createBet(user: { clerkUserId: string }, overrides: Record<string, unknown> = {}) {
  currentClerkUserId = user.clerkUserId;
  const res = await request(app).post("/api/bets").send({
    sport: "NBA",
    event: "Integrity Test Game",
    betType: "moneyline",
    pick: "Team A ML",
    odds: -110,
    stake: 25,
    gameDate: "2026-07-13",
    confidenceScore: 5,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

async function createParlay(user: { clerkUserId: string }, overrides: Record<string, unknown> = {}) {
  currentClerkUserId = user.clerkUserId;
  const res = await request(app).post("/api/parlays").send({
    name: "Integrity Test Parlay",
    stake: 20,
    confidenceScore: 5,
    legs: [
      { sport: "NBA", event: "Game 1", betType: "moneyline", pick: "A ML", odds: -110, gameDate: "2026-07-13" },
      { sport: "NFL", event: "Game 2", betType: "spread", pick: "B -3", odds: -105, gameDate: "2026-07-13" },
    ],
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    if (parlays.length > 0) {
      await db.delete(parlayLegsTable).where(inArray(parlayLegsTable.parlayId, parlays.map((p) => p.id)));
    }
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  // Profiles created through the claim flow during allowlist tests
  await db.delete(usersTable).where(like(usersTable.username, "invited\\_%"));
  await pool.end();
});

describe("bankroll transaction sign discipline", () => {
  it("rejects a zero-amount transaction", async () => {
    const user = await createLinkedUser();
    currentClerkUserId = user.clerkUserId;
    const res = await request(app).post("/api/bankroll/transactions").send({ type: "deposit", amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zero/i);
  });

  it("rejects negative deposits and negative withdrawals", async () => {
    const user = await createLinkedUser();
    currentClerkUserId = user.clerkUserId;
    for (const type of ["deposit", "withdraw"] as const) {
      const res = await request(app).post("/api/bankroll/transactions").send({ type, amount: -50 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/positive/i);
    }
  });

  it("rejects amounts beyond the 1,000,000 cap", async () => {
    const user = await createLinkedUser();
    currentClerkUserId = user.clerkUserId;
    const res = await request(app).post("/api/bankroll/transactions").send({ type: "deposit", amount: 2000000 });
    expect(res.status).toBe(400);
  });

  it("records a positive withdrawal as a negative ledger amount", async () => {
    const user = await createLinkedUser(1000);
    currentClerkUserId = user.clerkUserId;
    const res = await request(app).post("/api/bankroll/transactions").send({ type: "withdraw", amount: 50 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(-50);
    expect(res.body.balanceAfter).toBe(950);
  });

  it("still allows a negative manual adjustment (corrections go down too)", async () => {
    const user = await createLinkedUser(1000);
    currentClerkUserId = user.clerkUserId;
    const res = await request(app).post("/api/bankroll/transactions").send({ type: "adjustment", amount: -25 });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(-25);
    expect(res.body.balanceAfter).toBe(975);
  });
});

describe("negative payout override rejection", () => {
  it("rejects a negative actualPayoutOverride when settling a bet", async () => {
    const user = await createLinkedUser();
    const bet = await createBet(user);
    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won", actualPayoutOverride: -50 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative actualPayoutOverride when settling a parlay", async () => {
    const user = await createLinkedUser();
    const parlay = await createParlay(user);
    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "won", actualPayoutOverride: -50 });
    expect(res.status).toBe(400);
  });

  it("still accepts a legitimate positive override", async () => {
    const user = await createLinkedUser();
    const bet = await createBet(user);
    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won", actualPayoutOverride: 40 });
    expect(res.status).toBe(200);
    expect(res.body.actualPayout).toBe(40);
  });
});

describe("settled bets/parlays freeze financial fields", () => {
  it("rejects odds/stake edits on a settled bet with 409, keeps notes editable", async () => {
    const user = await createLinkedUser();
    const bet = await createBet(user);
    await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "lost" });

    const oddsEdit = await request(app).patch(`/api/bets/${bet.id}`).send({ odds: 150 });
    expect(oddsEdit.status).toBe(409);
    const stakeEdit = await request(app).patch(`/api/bets/${bet.id}`).send({ stake: 99 });
    expect(stakeEdit.status).toBe(409);

    const noteEdit = await request(app)
      .patch(`/api/bets/${bet.id}`)
      .send({ rationale: "post-mortem note", tags: ["lesson"] });
    expect(noteEdit.status).toBe(200);
    expect(noteEdit.body.rationale).toBe("post-mortem note");
    // The recorded numbers must be untouched
    expect(noteEdit.body.stake).toBe(25);
    expect(noteEdit.body.odds).toBe(-110);
  });

  it("rejects stake edits on a settled parlay with 409, keeps name/rationale editable", async () => {
    const user = await createLinkedUser();
    const parlay = await createParlay(user);
    await request(app).patch(`/api/parlays/${parlay.id}/settle`).send({ status: "won" });

    const stakeEdit = await request(app).patch(`/api/parlays/${parlay.id}`).send({ stake: 500 });
    expect(stakeEdit.status).toBe(409);

    const nameEdit = await request(app)
      .patch(`/api/parlays/${parlay.id}`)
      .send({ name: "Renamed after settle", rationale: "still fine" });
    expect(nameEdit.status).toBe(200);
    expect(nameEdit.body.name).toBe("Renamed after settle");
    expect(nameEdit.body.stake).toBe(20);
  });

  it("still allows odds/stake edits while a bet is pending", async () => {
    const user = await createLinkedUser();
    const bet = await createBet(user);
    const res = await request(app).patch(`/api/bets/${bet.id}`).send({ odds: 120, stake: 30 });
    expect(res.status).toBe(200);
    expect(res.body.odds).toBe(120);
    expect(res.body.stake).toBe(30);
  });
});

describe("stats summary includes parlay money", () => {
  it("shows parlay stakes and payouts in totalWagered/totalProfit/ROI", async () => {
    const user = await createLinkedUser();
    const parlay = await createParlay(user, { stake: 100 });
    const settle = await request(app).patch(`/api/parlays/${parlay.id}/settle`).send({ status: "lost" });
    expect(settle.status).toBe(200);

    const res = await request(app).get(`/api/stats/summary?userId=${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.totalWagered).toBe(100);
    expect(res.body.totalProfit).toBe(-100);
    expect(res.body.roi).toBe(-100);
    // Counts stay straight-bet-only; the parlay shows up in parlayRecord
    expect(res.body.losses).toBe(0);
    expect(res.body.parlayRecord).toEqual({ wins: 0, losses: 1, pushes: 0 });
  });

  it("combines straight-bet and parlay money consistently", async () => {
    const user = await createLinkedUser();
    const bet = await createBet(user, { stake: 50, odds: 100 });
    await request(app).patch(`/api/bets/${bet.id}/settle`).send({ status: "won" }); // payout 100
    const parlay = await createParlay(user, { stake: 50 });
    await request(app).patch(`/api/parlays/${parlay.id}/settle`).send({ status: "lost" });

    const res = await request(app).get(`/api/stats/summary?userId=${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.totalWagered).toBe(100); // 50 bet + 50 parlay
    expect(res.body.totalProfit).toBe(0); // +50 bet win, -50 parlay loss
    expect(res.body.roi).toBe(0);
  });
});

describe("beta email allowlist", () => {
  it("blocks uninvited emails from claiming and lets invited emails in", async () => {
    const invitedId = `invited_${Date.now()}_${counter++}`;
    const strangerId = `stranger_${Date.now()}_${counter++}`;
    process.env.BETA_ALLOWED_EMAILS = ` ${invitedId}@Example.com , someone-else@example.com `;
    try {
      currentClerkUserId = strangerId;
      const blocked = await request(app).post("/api/users/claim").send({});
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe("not_invited");

      currentClerkUserId = invitedId;
      const allowed = await request(app).post("/api/users/claim").send({});
      expect(allowed.status).toBe(200);
      createdUserIds.push(allowed.body.id);
    } finally {
      delete process.env.BETA_ALLOWED_EMAILS;
    }
  });

  it("fails closed when the account has no email and an allowlist is configured", async () => {
    process.env.BETA_ALLOWED_EMAILS = "someone@example.com";
    try {
      currentClerkUserId = `noemail_${Date.now()}_${counter++}`;
      const res = await request(app).post("/api/users/claim").send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("not_invited");
    } finally {
      delete process.env.BETA_ALLOWED_EMAILS;
    }
  });

  it("does not restrict claims when no allowlist is configured", async () => {
    delete process.env.BETA_ALLOWED_EMAILS;
    currentClerkUserId = `invited_open_${Date.now()}_${counter++}`;
    const res = await request(app).post("/api/users/claim").send({});
    expect(res.status).toBe(200);
    createdUserIds.push(res.body.id);
  });
});
