/**
 * Demo-board seeding: builds the fictional 5-person crew that powers the
 * public read-only demo at /api/demo.
 *
 * - `ensureDemoSeeded()` runs at server boot: seeds only when the demo world
 *   is empty, so a fresh production deploy self-seeds and an already-seeded
 *   database is left untouched.
 * - `seedDemoBoard({ force: true })` wipes and rebuilds the demo world
 *   (used by the reseed script after test runs or seed-logic changes).
 * - Deterministic PRNG: same seed, same board, every run.
 * - Generates ~12 weeks of bets and parlays in every state (pending, won,
 *   lost, push, void), post-game reviews, miss reasons, tags, and a bankroll
 *   ledger that honors the append-only balanceAfter chain invariant:
 *   balanceAfter[n] = balanceAfter[n-1] + amount[n].
 * - Demo users are never linked to a sign-in (clerkUserId stays null) and are
 *   invisible to the real app (every real query is scoped to isDemo=false).
 */
import { eq, inArray, asc } from "drizzle-orm";
import {
  db,
  usersTable,
  betsTable,
  parlaysTable,
  parlayLegsTable,
  transactionsTable,
  userBadgesTable,
} from "@workspace/db";
import { payoutFromAmerican, combineAmerican, parlayPayoutExact } from "@workspace/odds";
import { dayOf } from "@workspace/weeks";
import { ensureCrewsBootstrapped } from "./crews";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The crew — obviously fictional, distinct betting personalities.
// ---------------------------------------------------------------------------
const CREW = [
  {
    username: "demo_mav",
    displayName: "Mav Maverick",
    avatarColor: "#6366f1",
    startingBankroll: 1500,
    winBias: 0.5, // coin-flipper with volume
    stakes: [25, 50, 75, 100],
    betsPerWeek: [3, 5] as const,
    favSports: ["NFL", "NBA", "MLB"],
  },
  {
    username: "demo_professor",
    displayName: "The Professor",
    avatarColor: "#22c55e",
    startingBankroll: 2000,
    winBias: 0.58, // grinds closing-line value
    stakes: [40, 60, 80],
    betsPerWeek: [2, 4] as const,
    favSports: ["NBA", "MLB", "Tennis"],
  },
  {
    username: "demo_lucky_lena",
    displayName: "Lucky Lena",
    avatarColor: "#ec4899",
    startingBankroll: 1000,
    winBias: 0.38, // longshot addict
    stakes: [10, 15, 20, 25],
    betsPerWeek: [2, 4] as const,
    favSports: ["NHL", "UFC", "Soccer"],
  },
  {
    username: "demo_steady_eddie",
    displayName: "Steady Eddie",
    avatarColor: "#06b6d4",
    startingBankroll: 1200,
    winBias: 0.53, // small, disciplined
    stakes: [20, 25, 30],
    betsPerWeek: [1, 3] as const,
    favSports: ["MLB", "NFL", "Golf"],
  },
  {
    username: "demo_tony_tilt",
    displayName: "Tony Two-Legs",
    avatarColor: "#f59e0b",
    startingBankroll: 1800,
    winBias: 0.44, // chases losses, blames refs
    stakes: [50, 75, 100, 150],
    betsPerWeek: [2, 5] as const,
    favSports: ["NBA", "NFL", "Boxing"],
  },
] as const;

// Realistic American odds (no dead zone between -99 and +99).
const FAV_ODDS = [-110, -115, -120, -130, -145, -160, -180, -200, -250] as const;
const DOG_ODDS = [100, 105, 115, 125, 140, 160, 185, 220, 260, 320] as const;
const LEG_ODDS = [-200, -180, -150, -130, -110, 100, 120, 150] as const;

const MATCHUPS: Record<string, string[]> = {
  NFL: ["Gridiron Gators @ Steel Stallions", "Neon Knights @ Bay City Bombers", "Thunder Hawks @ Iron Wolves"],
  NBA: ["Skyline Comets @ Harbor Sharks", "Midtown Monarchs @ Canyon Coyotes", "Electric Eels @ Granite Giants"],
  MLB: ["River Rats @ Dusty Devils", "Copper Kings @ Marsh Monsters", "Salt Flats Sluggers @ Pine Valley Pilots"],
  NHL: ["Glacier Ghosts @ Ember Elks", "Frostbite Falcons @ Tundra Titans"],
  UFC: ["'Hammer' Hansen vs 'Cobra' Cruz", "'Bulldozer' Banks vs 'Phantom' Flores"],
  Soccer: ["Port Vale Rovers vs Kingsbridge FC", "Atletico Solara vs Real Montara"],
  Tennis: ["V. Larsson vs M. Okafor", "T. Beaumont vs K. Ishida"],
  Golf: ["Sunrise Invitational", "Cliffside Open"],
  Boxing: ["'Iron Jaw' Jones vs 'Lights Out' Lopez"],
};
const BET_TYPES = ["spread", "moneyline", "total"] as const;
const PICKS: Record<(typeof BET_TYPES)[number], string[]> = {
  spread: ["Home -3.5", "Away +6.5", "Home -1.5", "Away +2.5"],
  moneyline: ["Home ML", "Away ML", "Underdog ML"],
  total: ["Over 44.5", "Under 210.5", "Over 8.5", "Under 6.5"],
};
const SPORTSBOOKS = ["BetVault", "OddsmakerX", "PrimeLines", null, null];
const TAGS = ["prime-time", "revenge-game", "fade-the-public", "home-dog", "b2b-spot", "weather-play", "sharp-money"];
const MISS_REASONS = ["bad_read", "bad_price", "lineup_injury", "emotional", "misunderstood_market", "normal_variance"] as const;
const WHAT_HAPPENED = [
  "Backdoor cover in garbage time. Brutal.",
  "Star sat the 4th quarter, line never had a chance.",
  "Led wire to wire — never sweated it.",
  "Bullpen imploded in the 8th. Again.",
  "Late scratch flipped the whole matchup.",
  "Refs swallowed the whistle all night.",
  "Sharp side all the way — closed 2 points better.",
  "Should have waited for a better number.",
  "Empty-netter pushed it over. Free money.",
  "Got the read right, price was just bad.",
];
const RATIONALES = [
  "Home team 7-1 ATS in last 8 as a favorite.",
  "Public heavy on the other side — taking the value.",
  "Pace matchup screams over.",
  "Key injury not priced in yet.",
  "Short week + travel spot. Fading.",
  "Line moved my way all morning.",
  "Division dog with a top-10 defense — live.",
];

const DAY = 24 * 60 * 60 * 1000;
const WEEKS = 12;

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toFixed(2);
const dayStr = (d: Date) => dayOf(d);

function mondayOf(d: Date): Date {
  const diff = (d.getUTCDay() + 6) % 7;
  const m = new Date(d.getTime() - diff * DAY);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()));
}

type LedgerEvent = {
  at: Date;
  type: string;
  amount: number;
  referenceId?: number;
  referenceType?: string;
  note: string;
};

export type DemoSeedResult = { seeded: boolean; users: number };

/** Seed only when the demo world is empty. Safe to call on every boot. */
export async function ensureDemoSeeded(): Promise<DemoSeedResult> {
  return seedDemoBoard({ force: false });
}

/** Seed the demo board. With `force`, wipe the demo world and rebuild it. */
export async function seedDemoBoard(opts: { force: boolean }): Promise<DemoSeedResult> {
  const rand = mulberry32(0xed6eb0a2);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const chance = (p: number) => rand() < p;

  const now = new Date();
  const firstMonday = new Date(mondayOf(now).getTime() - WEEKS * 7 * DAY);

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isDemo, true));
  if (existing.length > 0 && !opts.force) {
    return { seeded: false, users: existing.length };
  }

  await db.transaction(async (tx) => {
    // ---- Wipe previous demo world ------------------------------------------
    const ids = existing.map((u) => u.id);
    if (ids.length > 0) {
      await tx.delete(userBadgesTable).where(inArray(userBadgesTable.userId, ids));
      await tx.delete(transactionsTable).where(inArray(transactionsTable.userId, ids));
      await tx.delete(parlaysTable).where(inArray(parlaysTable.userId, ids)); // legs cascade
      await tx.delete(betsTable).where(inArray(betsTable.userId, ids));
      await tx.delete(usersTable).where(inArray(usersTable.id, ids));
    }

    for (const persona of CREW) {
      const [user] = await tx
        .insert(usersTable)
        .values({
          username: persona.username,
          displayName: persona.displayName,
          avatarColor: persona.avatarColor,
          startingBankroll: String(persona.startingBankroll),
          isDemo: true,
        })
        .returning();

      const ledger: LedgerEvent[] = [];

      // ---- Straight bets over 12 weeks + current week -----------------------
      for (let w = 0; w <= WEEKS; w++) {
        const weekStart = new Date(firstMonday.getTime() + w * 7 * DAY);
        const n = randInt(persona.betsPerWeek[0], persona.betsPerWeek[1]);
        for (let i = 0; i < n; i++) {
          const gameDay = new Date(weekStart.getTime() + randInt(0, 6) * DAY);
          if (gameDay.getTime() > now.getTime() + 2 * DAY) continue;
          const gameDate = dayStr(gameDay);
          const sport = pick(persona.favSports);
          const betType = pick(BET_TYPES);
          const isDog = chance(persona.username === "demo_lucky_lena" ? 0.7 : 0.35);
          const odds = isDog ? pick(DOG_ODDS) : pick(FAV_ODDS);
          const stake = pick(persona.stakes);
          const potentialPayout = round2(payoutFromAmerican(odds, stake));
          const createdAt = new Date(gameDay.getTime() - randInt(2, 30) * 60 * 60 * 1000);

          // Settle everything except games from the last ~2 days (a few stay
          // pending/overdue so the "needs settling" flow shows up in the demo).
          const settleEligible = gameDay.getTime() < now.getTime() - 2 * DAY;
          let status = "pending";
          if (settleEligible) {
            const r = rand();
            if (r < 0.03) status = "void";
            else if (r < 0.08) status = "push";
            else status = chance(persona.winBias) ? "won" : "lost";
          }
          const settledAt = status === "pending" ? null : new Date(gameDay.getTime() + DAY);
          const actualPayout =
            status === "won"
              ? potentialPayout
              : status === "push" || status === "void"
                ? stake
                : status === "lost"
                  ? 0
                  : null;

          const lost = status === "lost";
          const reviewed = status !== "pending" && chance(0.6);
          const [bet] = await tx
            .insert(betsTable)
            .values({
              userId: user.id,
              sport,
              event: pick(MATCHUPS[sport]),
              betType,
              pick: pick(PICKS[betType]),
              odds,
              stake: money(stake),
              potentialPayout: money(potentialPayout),
              actualPayout: actualPayout != null ? money(actualPayout) : null,
              status,
              gameDate,
              confidenceScore: randInt(persona.username === "demo_professor" ? 5 : 3, 9),
              rationale: chance(0.7) ? pick(RATIONALES) : null,
              sportsbook: pick(SPORTSBOOKS),
              tags: chance(0.55) ? [pick(TAGS), ...(chance(0.3) ? [pick(TAGS)] : [])] : [],
              reasoningQuality: reviewed ? (chance(lost ? 0.45 : 0.75) ? "sound" : "flawed") : null,
              missReason:
                lost && reviewed
                  ? persona.username === "demo_tony_tilt" && chance(0.4)
                    ? "emotional"
                    : pick(MISS_REASONS)
                  : null,
              whatHappened: reviewed && chance(0.6) ? pick(WHAT_HAPPENED) : null,
              createdAt,
              settledAt,
            })
            .returning();

          if (status !== "pending" && actualPayout != null) {
            const profit = round2(actualPayout - stake);
            const txType =
              status === "won" ? "bet_win" : status === "push" ? "bet_push" : status === "void" ? "bet_void" : "bet_loss";
            ledger.push({
              at: settledAt!,
              type: txType,
              amount: profit,
              referenceId: bet.id,
              referenceType: "bet",
              note: `${status === "won" ? "Won" : status === "lost" ? "Lost" : status === "push" ? "Push" : "Void"}: ${bet.event}`,
            });
          }
        }

        // ---- One parlay most weeks --------------------------------------------
        if (w < WEEKS && chance(persona.username === "demo_lucky_lena" ? 0.9 : 0.5)) {
          const legCount = randInt(2, persona.username === "demo_lucky_lena" ? 5 : 3);
          const lastGameDay = new Date(weekStart.getTime() + randInt(3, 6) * DAY);
          if (lastGameDay.getTime() > now.getTime() - 2 * DAY) continue;
          const legs = Array.from({ length: legCount }, (_, li) => {
            const sport = pick(persona.favSports);
            const betType = pick(BET_TYPES);
            return {
              sport,
              event: pick(MATCHUPS[sport]),
              betType,
              pick: pick(PICKS[betType]),
              odds: pick(LEG_ODDS),
              gameDate: dayStr(new Date(lastGameDay.getTime() - randInt(0, Math.min(li, 2)) * DAY)),
            };
          });
          const stake = pick(persona.stakes);
          const combined = combineAmerican(legs.map((l) => l.odds));
          const potentialPayout = round2(parlayPayoutExact(legs.map((l) => l.odds), stake));
          // Each leg wins ~65%, pushes ~7% ⇒ realistic parlay hit rates by
          // leg count, with the occasional pushed leg reducing the ticket.
          const legStatuses = legs.map(() => (chance(0.72) ? (chance(0.1) ? "push" : "won") : "lost"));
          const anyLost = legStatuses.includes("lost");
          const anyWon = legStatuses.includes("won");
          const status = anyLost ? "lost" : anyWon ? "won" : "push";
          const won = status === "won";
          const settledAt = new Date(lastGameDay.getTime() + DAY);
          // Pushed legs come off the ticket: a won parlay pays from the
          // combined odds of the remaining legs only; all-push refunds.
          const remainingOdds = legs.filter((_, li) => legStatuses[li] !== "push").map((l) => l.odds);
          const actualPayout = won
            ? round2(parlayPayoutExact(remainingOdds, stake))
            : status === "push"
              ? stake
              : 0;
          const reviewed = chance(0.55);

          const [parlay] = await tx
            .insert(parlaysTable)
            .values({
              userId: user.id,
              name: `${legs[0].sport} ${legCount}-leg special`,
              stake: money(stake),
              odds: combined,
              potentialPayout: money(potentialPayout),
              actualPayout: money(actualPayout),
              status,
              confidenceScore: randInt(3, 8),
              rationale: chance(0.5) ? pick(RATIONALES) : null,
              sportsbook: pick(SPORTSBOOKS),
              reasoningQuality: reviewed ? (chance(0.6) ? "sound" : "flawed") : null,
              missReason: status === "lost" && reviewed ? pick(MISS_REASONS) : null,
              whatHappened: reviewed && chance(0.5) ? pick(WHAT_HAPPENED) : null,
              createdAt: new Date(lastGameDay.getTime() - randInt(24, 72) * 60 * 60 * 1000),
              settledAt,
            })
            .returning();

          await tx
            .insert(parlayLegsTable)
            .values(legs.map((l, li) => ({ parlayId: parlay.id, ...l, status: legStatuses[li] })));

          ledger.push({
            at: settledAt,
            type: won ? "bet_win" : status === "push" ? "bet_push" : "bet_loss",
            amount: round2(actualPayout - stake),
            referenceId: parlay.id,
            referenceType: "parlay",
            note: `${won ? "Won" : status === "push" ? "Push" : "Lost"}: Parlay ${parlay.name}`,
          });
        }
      }

      // A couple of deposits/withdrawals so the bankroll page tells a story.
      ledger.push({
        at: new Date(firstMonday.getTime() + randInt(10, 20) * DAY),
        type: "deposit",
        amount: randInt(1, 4) * 100,
        note: "Topping up for the weekend slate",
      });
      if (chance(0.6)) {
        const isDeposit = chance(0.5);
        ledger.push({
          at: new Date(firstMonday.getTime() + randInt(45, 70) * DAY),
          type: isDeposit ? "deposit" : "withdraw",
          amount: isDeposit ? 150 : -200,
          note: "Bankroll management",
        });
      }

      // ---- Ledger: chronological, chain-invariant balanceAfter ---------------
      ledger.sort((a, b) => a.at.getTime() - b.at.getTime());
      let balance: number = persona.startingBankroll;
      for (const ev of ledger) {
        balance = round2(balance + ev.amount);
        await tx.insert(transactionsTable).values({
          userId: user.id,
          type: ev.type,
          amount: money(ev.amount),
          balanceAfter: money(balance),
          referenceId: ev.referenceId ?? null,
          referenceType: ev.referenceType ?? null,
          note: ev.note,
          createdAt: ev.at,
        });
      }
    }
  });

  const seededUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isDemo, true))
    .orderBy(asc(usersTable.id));

  // A force-reseed wiped the old demo users, which cascades away the old demo
  // crew — rebuild it right away so the demo board never runs crewless.
  await ensureCrewsBootstrapped();

  return { seeded: true, users: seededUsers.length };
}
