/**
 * Challenge standings — double-count proof (#185). Proves:
 *  - a parlay counts as ONE play in the standings, no matter how many legs
 *    it has (legs are never aggregated separately)
 *  - a bet is only counted from betsTable — nothing is counted twice
 *  - the challenge window is [startDate 00:00 UTC, endDate+1 00:00 UTC):
 *    the start boundary is inclusive, the end boundary exclusive
 *  - dead-zone odds (corrupt prices) are excluded from the standings math
 *  - roi/win_rate math matches hand-computed values from the seeded plays
 */
import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  betsTable,
  parlaysTable,
  parlayLegsTable,
} from "@workspace/db";
import { computeChallengeStandings } from "../lib/challengeStandings";

const createdUserIds: number[] = [];
let counter = 0;

const CHALLENGE = { metric: "win_rate", startDate: "2026-07-06", endDate: "2026-07-12" };
const WINDOW_START = new Date("2026-07-06T00:00:00.000Z"); // inclusive
const WINDOW_END = new Date("2026-07-13T00:00:00.000Z"); // exclusive
const IN_WINDOW = new Date("2026-07-08T18:00:00.000Z");

async function createUser(displayName: string) {
  const username = `chal_${Date.now()}_${counter++}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName,
      avatarColor: "#22d3ee",
      startingBankroll: "1000",
      clerkUserId: `clerk_${username}`,
    })
    .returning();
  createdUserIds.push(row.id);
  return row;
}

async function seedBet(
  userId: number,
  over: Partial<typeof betsTable.$inferInsert> = {},
) {
  const [bet] = await db
    .insert(betsTable)
    .values({
      userId,
      sport: "NFL",
      event: "Chiefs @ Bills",
      betType: "moneyline",
      pick: "Chiefs ML",
      odds: -110,
      stake: "100",
      potentialPayout: "190.91",
      gameDate: "2026-07-07",
      confidenceScore: 5,
      status: "won",
      actualPayout: "190.91",
      settledAt: IN_WINDOW,
      ...over,
    })
    .returning();
  return bet;
}

async function seedParlay(
  userId: number,
  legCount: number,
  over: Partial<typeof parlaysTable.$inferInsert> = {},
) {
  const [parlay] = await db
    .insert(parlaysTable)
    .values({
      userId,
      name: "Test Parlay",
      stake: "25",
      odds: 264,
      potentialPayout: "91.00",
      confidenceScore: 5,
      status: "won",
      actualPayout: "91.00",
      settledAt: IN_WINDOW,
      ...over,
    })
    .returning();
  await db.insert(parlayLegsTable).values(
    Array.from({ length: legCount }, (_, i) => ({
      parlayId: parlay.id,
      sport: "NBA",
      event: `Game ${i + 1}`,
      betType: "spread" as const,
      pick: `Team ${i + 1} -3`,
      odds: -110,
      gameDate: "2026-07-07",
      status: "won" as const,
    })),
  );
  return parlay;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    if (parlays.length > 0) {
      await db
        .delete(parlayLegsTable)
        .where(inArray(parlayLegsTable.parlayId, parlays.map((p) => p.id)));
      await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    }
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("computeChallengeStandings — no double counting", () => {
  it("counts a multi-leg parlay as exactly one play", async () => {
    const user = await createUser("ParlayOnce");
    // 1 won bet + 1 lost bet + 1 won 3-leg parlay = 3 plays, 2 wins / 3 decided
    await seedBet(user.id);
    await seedBet(user.id, { status: "lost", actualPayout: "0" });
    await seedParlay(user.id, 3);

    const rows = await computeChallengeStandings(CHALLENGE, [user.id]);
    expect(rows).toHaveLength(1);
    // If legs were counted, settledCount would be 5 (2 bets + 3 legs) or 6.
    expect(rows[0].settledCount).toBe(3);
    // win_rate = 2 wins / 3 decided = 66.7
    expect(rows[0].value).toBe(66.7);
  });

  it("ROI wagers each play's stake exactly once (parlay stake, not per leg)", async () => {
    const user = await createUser("RoiOnce");
    await seedBet(user.id); // stake 100 → payout 190.91
    await seedParlay(user.id, 4); // stake 25 → payout 91.00, four legs

    const rows = await computeChallengeStandings(
      { ...CHALLENGE, metric: "roi" },
      [user.id],
    );
    // wagered = 125, returned = 281.91 → roi = 125.53%
    // If the 4 legs were counted as plays, wagered would be inflated.
    expect(rows[0].settledCount).toBe(2);
    expect(rows[0].value).toBe(125.53);
  });

  it("window start is inclusive, end is exclusive, outside plays are ignored", async () => {
    const user = await createUser("Window");
    await seedBet(user.id, { settledAt: WINDOW_START }); // exactly at start → counts
    await seedBet(user.id, {
      settledAt: new Date(WINDOW_END.getTime() - 1000), // last second → counts
      status: "lost",
      actualPayout: "0",
    });
    await seedBet(user.id, { settledAt: WINDOW_END }); // exactly at end → excluded
    await seedBet(user.id, {
      settledAt: new Date("2026-06-01T12:00:00.000Z"), // way before → excluded
    });

    const rows = await computeChallengeStandings(CHALLENGE, [user.id]);
    expect(rows[0].settledCount).toBe(2);
    expect(rows[0].value).toBe(50); // 1 win / 2 decided
  });

  it("excludes dead-zone odds from the standings math", async () => {
    const user = await createUser("DeadZone");
    await seedBet(user.id); // valid
    await seedBet(user.id, { odds: 50, status: "lost", actualPayout: "0" }); // corrupt price

    const rows = await computeChallengeStandings(CHALLENGE, [user.id]);
    expect(rows[0].settledCount).toBe(1);
    expect(rows[0].value).toBe(100); // the corrupt lost bet must not drag the rate
  });

  it("ranks members independently — one member's plays never leak into another's row", async () => {
    const winner = await createUser("Winner");
    const grinder = await createUser("Grinder");
    await seedBet(winner.id);
    await seedBet(grinder.id, { status: "lost", actualPayout: "0" });
    await seedBet(grinder.id);

    const rows = await computeChallengeStandings(CHALLENGE, [winner.id, grinder.id]);
    const w = rows.find((r) => r.userId === winner.id)!;
    const g = rows.find((r) => r.userId === grinder.id)!;
    expect(w.settledCount).toBe(1);
    expect(g.settledCount).toBe(2);
    expect(w.value).toBe(100);
    expect(g.value).toBe(50);
    expect(w.rank).toBe(1);
    expect(g.rank).toBe(2);
  });
});
