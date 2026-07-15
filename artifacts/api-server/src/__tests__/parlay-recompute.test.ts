/**
 * POST /parlays/:id/recompute-odds — fixes a parlay whose stored combined
 * odds are wrong while every leg carries a valid price. These tests prove:
 *  - a corrupted total is recomputed correctly from valid legs
 *  - parlays with an invalid (dead-zone) leg are rejected with guidance
 *  - settled parlays are refused (payout is part of the bankroll ledger)
 *  - only the owner can recompute
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";

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
import { db, pool, usersTable, parlaysTable, parlayLegsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName: string) {
  const username = `test_rc_${Date.now()}_${counter++}`;
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

afterAll(async () => {
  if (createdUserIds.length > 0) {
    const parlayIds = (
      await db.select({ id: parlaysTable.id }).from(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds))
    ).map((p) => p.id);
    if (parlayIds.length > 0) {
      await db.delete(parlayLegsTable).where(inArray(parlayLegsTable.parlayId, parlayIds));
    }
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

// Insert a parlay directly so we can plant a corrupted combined-odds total
// (the POST /parlays endpoint would never produce one).
async function plantParlay(
  userId: number,
  opts: { combinedOdds: number; legOdds: number[]; status?: string },
) {
  const [parlay] = await db
    .insert(parlaysTable)
    .values({
      userId,
      name: "Corrupt Total",
      stake: "50",
      odds: opts.combinedOdds,
      potentialPayout: "1.00",
      confidenceScore: 6,
      status: opts.status ?? "pending",
      settledAt: opts.status && opts.status !== "pending" ? new Date() : null,
      actualPayout: opts.status === "won" ? "200.00" : null,
    })
    .returning();
  await db.insert(parlayLegsTable).values(
    opts.legOdds.map((odds, i) => ({
      parlayId: parlay.id,
      sport: "NBA",
      event: `G${i}`,
      betType: "moneyline",
      pick: `Pick ${i}`,
      odds,
      gameDate: "2026-07-14",
      status: "pending",
    })),
  );
  return parlay;
}

describe("POST /parlays/:id/recompute-odds", () => {
  it("recomputes a corrupted total from valid legs", async () => {
    const user = await createUser("Owner");
    // Two +100 legs -> combined decimal 4.0 -> +300 American, payout 200.
    const parlay = await plantParlay(user.id, { combinedOdds: 7, legOdds: [100, 100] });

    const res = await request(app).post(`/api/parlays/${parlay.id}/recompute-odds`);
    expect(res.status).toBe(200);
    expect(res.body.odds).toBe(300);
    expect(res.body.potentialPayout).toBeCloseTo(200, 2);

    const [stored] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, parlay.id));
    expect(stored.odds).toBe(300);
    expect(Number(stored.potentialPayout)).toBeCloseTo(200, 2);
  });

  it("rejects when a leg still carries dead-zone odds", async () => {
    const user = await createUser("BadLeg");
    const parlay = await plantParlay(user.id, { combinedOdds: 7, legOdds: [100, 50] });

    const res = await request(app).post(`/api/parlays/${parlay.id}/recompute-odds`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/leg/i);
  });

  it("refuses settled parlays", async () => {
    const user = await createUser("Settled");
    const parlay = await plantParlay(user.id, { combinedOdds: 7, legOdds: [100, 100], status: "won" });

    const res = await request(app).post(`/api/parlays/${parlay.id}/recompute-odds`);
    expect(res.status).toBe(409);
  });

  it("refuses non-owners", async () => {
    const owner = await createUser("RealOwner");
    const parlay = await plantParlay(owner.id, { combinedOdds: 7, legOdds: [100, 100] });
    await createUser("Stranger"); // switches currentClerkUserId

    const res = await request(app).post(`/api/parlays/${parlay.id}/recompute-odds`);
    expect(res.status).toBe(403);
  });
});
