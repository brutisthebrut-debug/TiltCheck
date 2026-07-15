/**
 * /api/stats/summary must count settled parlays (won/lost/push, void excluded)
 * in the money math (totalWagered/totalProfit/roi) so the stats page agrees
 * with the bankroll page. Top-level win/loss/push/pending counts stay
 * straight-bet-only, with the parlay record broken out in parlayRecord.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

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

async function createUser(startingBankroll = 1000) {
  const username = `test_sproi_${Date.now()}_${counter++}`;
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

async function createBet(userId: number, opts: { odds?: number; stake?: number } = {}) {
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
  return res.body as { id: number };
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
  return res.body as { id: number; legs: Array<{ id: number; status: string }> };
}

async function settleParlay(
  parlay: { id: number; legs: Array<{ id: number }> },
  status: "won" | "lost" | "push" | "void",
) {
  const body: Record<string, unknown> = { status };
  if (status === "won") {
    body.legResults = parlay.legs.map((l) => ({ legId: l.id, status: "won" }));
  } else if (status === "lost") {
    body.legResults = [
      { legId: parlay.legs[0].id, status: "won" },
      { legId: parlay.legs[1].id, status: "lost" },
    ];
  }
  const res = await request(app).patch(`/api/parlays/${parlay.id}/settle`).send(body);
  expect(res.status).toBe(200);
}

async function getSummary(userId: number) {
  const res = await request(app).get(`/api/stats/summary?userId=${userId}`);
  expect(res.status).toBe(200);
  return res.body as {
    totalBets: number;
    wins: number;
    losses: number;
    pushes: number;
    pending: number;
    winRate: number;
    totalWagered: number;
    totalProfit: number;
    roi: number;
    parlayRecord: { wins: number; losses: number; pushes: number };
    straightBetRecord: { wins: number; losses: number; pushes: number };
  };
}

describe("GET /api/stats/summary — parlay money math", () => {
  it("parlay-only user: totalWagered/totalProfit/roi include settled parlays, void excluded", async () => {
    const user = await createUser(1000);

    const won = await createParlay(user.id, 50); // payout 200 -> +150
    const lost = await createParlay(user.id, 50); // payout 0 -> -50
    const push = await createParlay(user.id, 40); // payout 40 -> 0
    const voided = await createParlay(user.id, 30); // excluded entirely
    await createParlay(user.id, 25); // pending — excluded from money math

    await settleParlay(won, "won");
    await settleParlay(lost, "lost");
    await settleParlay(push, "push");
    await settleParlay(voided, "void");

    const summary = await getSummary(user.id);

    // Money math: wagered 50+50+40 = 140; payout 200+0+40 = 240; profit 100
    expect(summary.totalWagered).toBeCloseTo(140, 2);
    expect(summary.totalProfit).toBeCloseTo(100, 2);
    expect(summary.roi).toBeCloseTo(71.43, 2);

    // Counts: top-level record is straight-bet-only; parlays broken out
    expect(summary.totalBets).toBe(5);
    expect(summary.wins).toBe(0);
    expect(summary.losses).toBe(0);
    expect(summary.pushes).toBe(0);
    expect(summary.pending).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.parlayRecord).toEqual({ wins: 1, losses: 1, pushes: 1 });
    expect(summary.straightBetRecord).toEqual({ wins: 0, losses: 0, pushes: 0 });

    // The stats page and the bankroll page must tell the same ROI story
    const bankroll = await request(app).get(`/api/bankroll?userId=${user.id}`);
    expect(bankroll.status).toBe(200);
    expect(bankroll.body.roi).toBeCloseTo(summary.roi, 2);
  });

  it("mixed user: ROI divides profit by straight + parlay stakes, matching bankroll", async () => {
    const user = await createUser(1000);

    const bet = await createBet(user.id, { odds: 100, stake: 100 }); // +100 on win
    const parlay = await createParlay(user.id, 50); // -50 on loss

    const betRes = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won" });
    expect(betRes.status).toBe(200);
    await settleParlay(parlay, "lost");

    const summary = await getSummary(user.id);

    // 50 profit / (100 + 50) wagered
    expect(summary.totalWagered).toBeCloseTo(150, 2);
    expect(summary.totalProfit).toBeCloseTo(50, 2);
    expect(summary.roi).toBeCloseTo(33.33, 2);

    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(0);
    expect(summary.parlayRecord).toEqual({ wins: 0, losses: 1, pushes: 0 });

    const bankroll = await request(app).get(`/api/bankroll?userId=${user.id}`);
    expect(bankroll.status).toBe(200);
    expect(bankroll.body.roi).toBeCloseTo(summary.roi, 2);
  });
});
