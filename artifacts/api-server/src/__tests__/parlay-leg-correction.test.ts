/**
 * PATCH /parlays/:id/legs/:legId — correcting one leg's odds must always
 * leave the parlay's combined odds and potential payout consistent with the
 * legs. These tests prove:
 *  - a corrected leg recomputes the combined odds and payout correctly
 *  - correcting the same leg twice converges on the same numbers (no drift)
 *  - dead-zone replacement odds are rejected
 *  - settled parlays are refused (payout is part of the bankroll ledger)
 *  - only the owner can correct a leg
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
  const username = `test_lc_${Date.now()}_${counter++}`;
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

async function createParlay(userId: number, legOdds: number[], stake = 50) {
  const res = await request(app)
    .post("/api/parlays")
    .send({
      userId,
      name: "Leg Correction Parlay",
      stake,
      confidenceScore: 6,
      legs: legOdds.map((odds, i) => ({
        sport: "NBA",
        event: `Game ${i}`,
        betType: "moneyline",
        pick: `Pick ${i}`,
        odds,
        gameDate: "2026-07-14",
      })),
    });
  expect(res.status).toBe(201);
  return res.body as {
    id: number;
    odds: number;
    potentialPayout: number;
    legs: Array<{ id: number; odds: number }>;
  };
}

describe("PATCH /parlays/:id/legs/:legId", () => {
  it("recomputes combined odds and payout from the corrected leg", async () => {
    const user = await createUser("Corrector");
    // +100 & +100 -> decimal 4.0, payout 200 at stake 50
    const parlay = await createParlay(user.id, [100, 100]);
    expect(parlay.odds).toBe(300);

    // Correct the first leg to -200 (decimal 1.5): combined 1.5 * 2 = 3.0
    // -> +200 American, payout 150.
    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/legs/${parlay.legs[0].id}`)
      .send({ odds: -200 });
    expect(res.status).toBe(200);
    expect(res.body.odds).toBe(200);
    expect(res.body.potentialPayout).toBeCloseTo(150, 2);

    const [stored] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, parlay.id));
    expect(stored.odds).toBe(200);
    expect(Number(stored.potentialPayout)).toBeCloseTo(150, 2);
  });

  it("converges when the same leg is corrected twice", async () => {
    const user = await createUser("TwiceCorrector");
    const parlay = await createParlay(user.id, [100, 100]);
    const legId = parlay.legs[0].id;

    await request(app).patch(`/api/parlays/${parlay.id}/legs/${legId}`).send({ odds: -500 });
    const res = await request(app).patch(`/api/parlays/${parlay.id}/legs/${legId}`).send({ odds: 100 });
    expect(res.status).toBe(200);
    // Back to the original numbers — no drift from the intermediate value.
    expect(res.body.odds).toBe(300);
    expect(res.body.potentialPayout).toBeCloseTo(200, 2);
  });

  it("rejects dead-zone replacement odds", async () => {
    const user = await createUser("DeadZoneLeg");
    const parlay = await createParlay(user.id, [100, 100]);
    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/legs/${parlay.legs[0].id}`)
      .send({ odds: 50 });
    expect(res.status).toBe(400);
  });

  it("refuses settled parlays", async () => {
    const user = await createUser("SettledLeg");
    const parlay = await createParlay(user.id, [100, 100]);
    await db
      .update(parlaysTable)
      .set({ status: "won", actualPayout: "200.00", settledAt: new Date() })
      .where(eq(parlaysTable.id, parlay.id));

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/legs/${parlay.legs[0].id}`)
      .send({ odds: -110 });
    expect(res.status).toBe(409);
  });

  it("refuses non-owners", async () => {
    const owner = await createUser("LegOwner");
    const parlay = await createParlay(owner.id, [100, 100]);
    await createUser("LegStranger"); // switches auth identity

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/legs/${parlay.legs[0].id}`)
      .send({ odds: -110 });
    expect(res.status).toBe(403);
  });
});
