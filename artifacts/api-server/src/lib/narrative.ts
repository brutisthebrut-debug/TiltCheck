/**
 * AI-narrated weekly recap — the narration engine.
 *
 * Portability rule: the model only ever sees a compact JSON facts object
 * assembled here from already-computed stats (the WeeklyRecap plus a few
 * decision-review facts derived from the same rows). It never sees raw bet
 * rows, and the prompt forbids inventing numbers beyond those facts. Swap
 * the facts assembler and the same engine narrates any future domain.
 */
import { isValidAmericanOdds } from "./odds";
import type { WeeklyRecap, RecapBet, RecapParlay } from "./recap";
import { addDays } from "./recap";

export const NARRATIVE_MODEL = "gpt-5.4";

// ---------------------------------------------------------------------------
// Fact assembly — decision-review facts beyond the recap card numbers
// ---------------------------------------------------------------------------

type SettledPlay = {
  stake: number;
  profit: number;
  won: boolean;
  lost: boolean;
  confidence: number | null;
  sport: string | null;
  isParlay: boolean;
  settledAt: Date;
};

export type RecapFacts = {
  displayName: string;
  weekStart: string;
  weekEnd: string;
  record: { wins: number; losses: number; pushes: number };
  profit: number;
  totalWagered: number;
  roiPct: number;
  playsLogged: number;
  playsSettled: number;
  bestWin: { title: string; odds: number; amount: number } | null;
  worstBeat: { title: string; odds: number; amount: number } | null;
  leak: { kind: string; label: string; amount: number; count: number } | null;
  /** Average stake on plays placed within 24h after a loss vs. all plays. */
  stakeSizing: { avgStake: number; avgStakeAfterLoss: number | null; playsAfterLoss: number } | null;
  /** Win rate on high-confidence (7+) vs low-confidence (<=4) plays. */
  confidenceCheck: {
    highConfidence: { count: number; wins: number } | null;
    lowConfidence: { count: number; wins: number } | null;
  } | null;
  /** Sports by settled play count, descending. */
  sportMix: { sport: string; plays: number; profit: number }[];
  parlays: { settled: number; won: number; profit: number } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function assembleRecapFacts(input: {
  displayName: string;
  recap: WeeklyRecap;
  myBets: RecapBet[];
  myParlays: RecapParlay[];
}): RecapFacts {
  const { displayName, recap } = input;
  const p = recap.personal;
  const from = new Date(`${recap.weekStart}T00:00:00Z`).getTime();
  const to = new Date(`${addDays(recap.weekStart, 7)}T00:00:00Z`).getTime();

  const settled: SettledPlay[] = [];
  const collect = (rows: (RecapBet | RecapParlay)[], isParlay: boolean) => {
    for (const r of rows) {
      if (!isValidAmericanOdds(r.odds)) continue;
      if (r.settledAt == null) continue;
      const t = r.settledAt.getTime();
      if (t < from || t >= to) continue;
      if (r.status !== "won" && r.status !== "lost" && r.status !== "push") continue;
      settled.push({
        stake: Number(r.stake),
        profit: round2((r.actualPayout != null ? Number(r.actualPayout) : 0) - Number(r.stake)),
        won: r.status === "won",
        lost: r.status === "lost",
        confidence: r.confidenceScore ?? null,
        sport: isParlay ? null : ((r as RecapBet).sport ?? null),
        isParlay,
        settledAt: r.settledAt,
      });
    }
  };
  collect(input.myBets, false);
  collect(input.myParlays, true);

  // Stake sizing after a loss: plays settled within 24h AFTER an earlier loss
  const byTime = [...settled].sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
  const afterLoss: number[] = [];
  for (let i = 0; i < byTime.length; i++) {
    const play = byTime[i];
    const chased = byTime.some(
      (q, j) =>
        j < i &&
        q.lost &&
        play.settledAt.getTime() - q.settledAt.getTime() <= 24 * 60 * 60 * 1000,
    );
    if (chased) afterLoss.push(play.stake);
  }
  const avgStake = settled.length > 0 ? round2(settled.reduce((a, s) => a + s.stake, 0) / settled.length) : 0;

  const high = settled.filter((s) => s.confidence != null && s.confidence >= 7);
  const low = settled.filter((s) => s.confidence != null && s.confidence <= 4);

  const sportAgg = new Map<string, { plays: number; profit: number }>();
  for (const s of settled) {
    if (!s.sport) continue;
    const agg = sportAgg.get(s.sport) ?? { plays: 0, profit: 0 };
    agg.plays += 1;
    agg.profit = round2(agg.profit + s.profit);
    sportAgg.set(s.sport, agg);
  }

  const settledParlays = settled.filter((s) => s.isParlay);

  return {
    displayName,
    weekStart: recap.weekStart,
    weekEnd: recap.weekEnd,
    record: { wins: p.wins, losses: p.losses, pushes: p.pushes },
    profit: p.profit,
    totalWagered: p.totalWagered,
    roiPct: p.roi,
    playsLogged: p.loggedCount,
    playsSettled: p.settledCount,
    bestWin: p.bestWin ? { title: p.bestWin.title, odds: p.bestWin.odds, amount: p.bestWin.amount } : null,
    worstBeat: p.worstBeat ? { title: p.worstBeat.title, odds: p.worstBeat.odds, amount: p.worstBeat.amount } : null,
    leak: p.leak,
    stakeSizing:
      settled.length > 0
        ? {
            avgStake,
            avgStakeAfterLoss: afterLoss.length > 0 ? round2(afterLoss.reduce((a, b) => a + b, 0) / afterLoss.length) : null,
            playsAfterLoss: afterLoss.length,
          }
        : null,
    confidenceCheck:
      high.length > 0 || low.length > 0
        ? {
            highConfidence: high.length > 0 ? { count: high.length, wins: high.filter((s) => s.won).length } : null,
            lowConfidence: low.length > 0 ? { count: low.length, wins: low.filter((s) => s.won).length } : null,
          }
        : null,
    sportMix: [...sportAgg.entries()]
      .map(([sport, agg]) => ({ sport, ...agg }))
      .sort((a, b) => b.plays - a.plays),
    parlays:
      settledParlays.length > 0
        ? {
            settled: settledParlays.length,
            won: settledParlays.filter((s) => s.won).length,
            profit: round2(settledParlays.reduce((a, s) => a + s.profit, 0)),
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are EdgeBoard's weekly tape reviewer. EdgeBoard is a private bet tracker a friend group uses to study their own decision-making — it never gives picks.

Voice (non-negotiable): blunt like a trainer reviewing game tape, delivered like a close friend busting your balls. Big-sibling energy — good-natured tough love. Never mean, never preachy, never corporate, no pep-talk clichés. Dry humor is welcome. Address the bettor as "you".

Hard rules:
- You may ONLY reference the numbers and facts in the provided JSON. Never invent, estimate, or extrapolate a number that is not literally there. If a fact is null or missing, do not mention it.
- Reflection only: talk about how they decided — stake sizing, confidence vs. results, concentration, the leak. NEVER suggest what to bet, which sports/teams/markets to play or avoid as a tip, and never predict outcomes.
- No moralizing about gambling. They track because they want the mirror, not a lecture.
- 2–3 short paragraphs, then a final single-sentence paragraph starting with "Watch next week:" naming ONE concrete behavior to observe (a habit to watch, not a bet to place).
- Plain text only. No headings, no bullet points, no emoji, no markdown.
- Keep it under 180 words.`;

/**
 * Generate the narrative for one bettor-week. Throws on provider failure —
 * the route treats any throw as "unavailable" and the page hides the section.
 *
 * The AI client is loaded lazily: its module throws at import time when the
 * integration env vars are missing, and that must degrade to "no narrative",
 * never prevent the API server from booting.
 */
export async function generateRecapNarrative(facts: RecapFacts): Promise<string> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const completion = await openai.chat.completions.create({
    model: NARRATIVE_MODEL,
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here is ${facts.displayName}'s week of tape (${facts.weekStart} to ${facts.weekEnd}) as computed facts. Write the review.\n\n${JSON.stringify(facts, null, 2)}`,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Narrative generation returned empty content");
  }
  return text;
}
