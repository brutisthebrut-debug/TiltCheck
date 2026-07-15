import { isValidAmericanOdds } from "./odds";
import { addDays } from "@workspace/weeks";

// Week math (UTC, Monday-start weeks) lives in @workspace/weeks — shared with
// the web app's recap teaser so the two can't drift. Re-exported here for
// convenience of recap consumers.
export { dayOf, addDays, mondayOf, lastCompletedWeekStart } from "@workspace/weeks";

// ── Recap computation ───────────────────────────────────────────────────────

type PlayRow = {
  id: number;
  userId: number;
  status: string;
  odds: number;
  stake: string | number;
  actualPayout: string | number | null;
  missReason: string | null;
  confidenceScore?: number | null;
  createdAt: Date;
  settledAt: Date | null;
};

export type RecapBet = PlayRow & { pick: string; event: string; sport: string };
export type RecapParlay = PlayRow & { name: string };

export type RecapUser = { id: number; displayName: string };

export type RecapPlay = {
  type: "bet" | "parlay";
  id: number;
  userId: number;
  userName: string;
  title: string;
  odds: number;
  amount: number;
};

export type RecapLeak = {
  kind: "sport" | "miss_reason" | "parlays";
  label: string;
  amount: number;
  count: number;
};

export type WeeklyRecap = {
  weekStart: string;
  weekEnd: string;
  personal: {
    userId: number;
    loggedCount: number;
    settledCount: number;
    wins: number;
    losses: number;
    pushes: number;
    profit: number;
    totalWagered: number;
    roi: number;
    bestWin: RecapPlay | null;
    worstBeat: RecapPlay | null;
    leak: RecapLeak | null;
  };
  crew: {
    winner: { userId: number; userName: string; profit: number; wins: number; losses: number } | null;
    biggestUpset: RecapPlay | null;
    worstBeat: RecapPlay | null;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const net = (p: PlayRow) => (p.actualPayout != null ? Number(p.actualPayout) : 0) - Number(p.stake);
const isSettled = (p: PlayRow) => p.status === "won" || p.status === "lost" || p.status === "push";

export function computeWeeklyRecap(input: {
  users: RecapUser[];
  bets: RecapBet[];
  parlays: RecapParlay[];
  userId: number;
  weekStart: string; // must already be a Monday
}): WeeklyRecap {
  const { users, userId, weekStart } = input;
  const weekEnd = addDays(weekStart, 6);
  const from = new Date(`${weekStart}T00:00:00Z`).getTime();
  const to = new Date(`${addDays(weekStart, 7)}T00:00:00Z`).getTime();
  const inWeek = (d: Date | null) => d != null && d.getTime() >= from && d.getTime() < to;

  const nameOf = new Map(users.map((u) => [u.id, u.displayName]));
  const toRecapPlay = (p: RecapBet | RecapParlay, type: "bet" | "parlay"): RecapPlay => ({
    type,
    id: p.id,
    userId: p.userId,
    userName: nameOf.get(p.userId) ?? "Unknown",
    title: type === "bet" ? `${(p as RecapBet).pick} (${(p as RecapBet).event})` : `Parlay: ${(p as RecapParlay).name}`,
    odds: p.odds,
    amount: round2(net(p)),
  });

  // Dead-zone odds rows carry nonsense payouts — recap math skips them, same
  // as the stats endpoints do.
  const bets = input.bets.filter((b) => isValidAmericanOdds(b.odds));
  const parlays = input.parlays.filter((p) => isValidAmericanOdds(p.odds));

  const allPlays: { row: RecapBet | RecapParlay; type: "bet" | "parlay" }[] = [
    ...bets.map((row) => ({ row, type: "bet" as const })),
    ...parlays.map((row) => ({ row, type: "parlay" as const })),
  ];
  const settledInWeek = allPlays.filter((p) => isSettled(p.row) && inWeek(p.row.settledAt));

  // ── Personal ──
  const mine = settledInWeek.filter((p) => p.row.userId === userId);
  const myLogged = allPlays.filter((p) => p.row.userId === userId && inWeek(p.row.createdAt)).length;
  const wins = mine.filter((p) => p.row.status === "won").length;
  const losses = mine.filter((p) => p.row.status === "lost").length;
  const pushes = mine.filter((p) => p.row.status === "push").length;
  const totalWagered = mine.reduce((acc, p) => acc + Number(p.row.stake), 0);
  const profit = mine.reduce((acc, p) => acc + net(p.row), 0);

  const best = mine.reduce<(typeof mine)[0] | null>((b, p) => (net(p.row) > (b ? net(b.row) : 0) ? p : b), null);
  const worst = mine.reduce<(typeof mine)[0] | null>((w, p) => (net(p.row) < (w ? net(w.row) : 0) ? p : w), null);

  // ── Leak: the week's most expensive pattern ──
  const candidates: RecapLeak[] = [];

  const mySettledBets = bets.filter((b) => b.userId === userId && isSettled(b) && inWeek(b.settledAt));
  const bySport = new Map<string, { amount: number; lossCount: number }>();
  for (const b of mySettledBets) {
    const s = bySport.get(b.sport) ?? { amount: 0, lossCount: 0 };
    s.amount += net(b);
    if (b.status === "lost") s.lossCount++;
    bySport.set(b.sport, s);
  }
  for (const [sport, s] of bySport) {
    if (s.amount < 0 && s.lossCount > 0) candidates.push({ kind: "sport", label: sport, amount: round2(s.amount), count: s.lossCount });
  }

  const mySettledParlays = parlays.filter((p) => p.userId === userId && isSettled(p) && inWeek(p.settledAt));
  const parlayAmount = mySettledParlays.reduce((acc, p) => acc + net(p), 0);
  const parlayLosses = mySettledParlays.filter((p) => p.status === "lost").length;
  if (parlayAmount < 0 && parlayLosses > 0) {
    candidates.push({ kind: "parlays", label: "parlays", amount: round2(parlayAmount), count: parlayLosses });
  }

  const byReason = new Map<string, { amount: number; count: number }>();
  for (const p of mine) {
    if (p.row.status !== "lost") continue;
    const reason = p.row.missReason;
    if (reason == null || reason === "na" || reason === "normal_variance") continue;
    const r = byReason.get(reason) ?? { amount: 0, count: 0 };
    r.amount += net(p.row);
    r.count++;
    byReason.set(reason, r);
  }
  for (const [reason, r] of byReason) {
    candidates.push({ kind: "miss_reason", label: reason, amount: round2(r.amount), count: r.count });
  }

  const leak = candidates.sort((a, b) => a.amount - b.amount)[0] ?? null;

  // ── Crew ──
  const byUser = new Map<number, { profit: number; wins: number; losses: number }>();
  for (const p of settledInWeek) {
    const u = byUser.get(p.row.userId) ?? { profit: 0, wins: 0, losses: 0 };
    u.profit += net(p.row);
    if (p.row.status === "won") u.wins++;
    else if (p.row.status === "lost") u.losses++;
    byUser.set(p.row.userId, u);
  }
  const winnerEntry = [...byUser.entries()].sort((a, b) => b[1].profit - a[1].profit || b[1].wins - a[1].wins)[0] ?? null;

  const upset = settledInWeek
    .filter((p) => p.row.status === "won" && p.row.odds >= 100)
    .sort((a, b) => b.row.odds - a.row.odds)[0] ?? null;

  const crewWorst = settledInWeek.reduce<(typeof settledInWeek)[0] | null>(
    (w, p) => (net(p.row) < (w ? net(w.row) : 0) ? p : w),
    null,
  );

  return {
    weekStart,
    weekEnd,
    personal: {
      userId,
      loggedCount: myLogged,
      settledCount: mine.length,
      wins,
      losses,
      pushes,
      profit: round2(profit),
      totalWagered: round2(totalWagered),
      roi: totalWagered > 0 ? round2((profit / totalWagered) * 100) : 0,
      bestWin: best && net(best.row) > 0 ? toRecapPlay(best.row, best.type) : null,
      worstBeat: worst && net(worst.row) < 0 ? toRecapPlay(worst.row, worst.type) : null,
      leak,
    },
    crew: {
      winner: winnerEntry
        ? {
            userId: winnerEntry[0],
            userName: nameOf.get(winnerEntry[0]) ?? "Unknown",
            profit: round2(winnerEntry[1].profit),
            wins: winnerEntry[1].wins,
            losses: winnerEntry[1].losses,
          }
        : null,
      biggestUpset: upset ? toRecapPlay(upset.row, upset.type) : null,
      worstBeat: crewWorst && net(crewWorst.row) < 0 ? toRecapPlay(crewWorst.row, crewWorst.type) : null,
    },
  };
}
